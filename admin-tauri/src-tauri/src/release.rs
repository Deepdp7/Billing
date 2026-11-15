//! "Build & Release" page of the Admin app (Admin Panel → Build & Release, shown only in this desktop window).
//!
//! Runs deploy/apna_vps.py in the Billing folder this app was built from: build the billing app and this Admin app,
//! make their installers with Installer Studio, sign them, upload the server. Its output streams to the page as
//! "release-output" events, and "release-done" carries the exit code. Only the fixed actions below can be started,
//! with checked arguments, one at a time. The VPS password goes to that one run only (its environment), never to disk.
//! A built installer is handed to the page (release_file), which uploads and publishes it like a hand-picked file.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread::JoinHandle;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const NO_WINDOW: u32 = 0x0800_0000; // CREATE_NO_WINDOW: no console windows popping up

/// The run in progress, if any
#[derive(Default)]
pub struct Running(Mutex<Option<Job>>);

struct Job {
    pid: u32,
    title: String,
    stdin: Option<ChildStdin>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseFile {
    name: String,
    size: u64,
    /// Milliseconds since 1970
    modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    repo: String,
    found: bool,
    client_version: String,
    admin_version: String,
    studio: bool,
    running: Option<String>,
    files: Vec<ReleaseFile>,
}

#[derive(Clone, Serialize)]
struct Done {
    title: String,
    code: i32,
}

fn repo() -> PathBuf {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..");
    let p = p.canonicalize().unwrap_or(p);
    let s = p.to_string_lossy().to_string();
    s.strip_prefix(r"\\?\").map(PathBuf::from).unwrap_or(p)
}

fn releases() -> PathBuf {
    repo().join("releases")
}

fn studio_exe() -> PathBuf {
    match std::env::var_os("INSTALLER_STUDIO") {
        Some(p) => PathBuf::from(p),
        None => PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("Installer Studio").join("installer-studio.exe"),
    }
}

/// Where Installer Studio's own setup is made (next to this Billing folder, on the Desktop)
fn studio_setup_dir() -> PathBuf {
    repo().join("..").join("InstallerStudio").join("src-tauri").join("target").join("release").join("bundle").join("nsis")
}

fn version_in(conf: &Path) -> String {
    std::fs::read_to_string(conf)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("version").and_then(|v| v.as_str()).map(str::to_string))
        .unwrap_or_else(|| "?".into())
}

/// 1.2.3, or 1.2.3+2 for update 2 of the same version (clients still see 1.2.3)
fn valid_version(v: &str) -> bool {
    let number = |p: &str| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit());
    let (main, update) = match v.split_once('+') {
        Some((m, u)) => (m, Some(u)),
        None => (v, None),
    };
    let parts: Vec<&str> = main.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| number(p)) && update.is_none_or(number)
}

/// The billing app's version as last built here, with "+N" for update N (tauri/update-number.txt, apna_vps.py)
fn client_version(root: &Path) -> String {
    let version = version_in(&root.join("tauri").join("src-tauri").join("tauri.conf.json"));
    match std::fs::read_to_string(root.join("tauri").join("update-number.txt")).map(|s| s.trim().to_string()) {
        Ok(n) if !n.is_empty() => format!("{version}+{n}"),
        _ => version,
    }
}

#[tauri::command]
pub fn release_info(running: State<'_, Running>) -> ReleaseInfo {
    let root = repo();
    let mut files: Vec<ReleaseFile> = std::fs::read_dir(releases())
        .map(|dir| {
            dir.filter_map(Result::ok)
                .filter_map(|e| {
                    let meta = e.metadata().ok().filter(|m| m.is_file())?;
                    let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64;
                    Some(ReleaseFile { name: e.file_name().to_string_lossy().into(), size: meta.len(), modified })
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort_by(|a, b| b.modified.cmp(&a.modified));
    ReleaseInfo {
        found: root.join("deploy").join("apna_vps.py").is_file(),
        client_version: client_version(&root),
        admin_version: version_in(&root.join("admin-tauri").join("src-tauri").join("tauri.conf.json")),
        studio: studio_exe().is_file(),
        running: running.0.lock().unwrap().as_ref().map(|j| j.title.clone()),
        repo: root.to_string_lossy().into(),
        files,
    }
}

/// Sends output on as it comes, as text (a character split across two reads waits for the rest)
fn pump(app: AppHandle, mut from: impl Read + Send + 'static) -> JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match from.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let upto = match std::str::from_utf8(&pending) {
                        Ok(_) => pending.len(),
                        Err(e) if e.error_len().is_none() => e.valid_up_to(),
                        Err(_) => pending.len(), // not UTF-8 at all: shown with replacement characters
                    };
                    let text = String::from_utf8_lossy(&pending[..upto]).into_owned();
                    pending.drain(..upto);
                    if !text.is_empty() {
                        let _ = app.emit("release-output", text);
                    }
                }
            }
        }
        if !pending.is_empty() {
            let _ = app.emit("release-output", String::from_utf8_lossy(&pending).into_owned());
        }
    })
}

/// Starts one of the fixed actions; `version` is checked.
#[tauri::command]
pub fn release_run(
    app: AppHandle,
    running: State<'_, Running>,
    action: String,
    version: Option<String>,
    vps_password: Option<String>,
) -> Result<(), String> {
    let mut slot = running.0.lock().unwrap();
    if let Some(job) = slot.as_ref() {
        return Err(format!("Still working on: {}. Wait for it to finish, or press Stop.", job.title));
    }
    let root = repo();
    if !root.join("deploy").join("apna_vps.py").is_file() {
        return Err(format!("The Billing folder was not found at {}.", root.display()));
    }
    let version = || -> Result<String, String> {
        let v = version.clone().unwrap_or_default().trim().to_string();
        if valid_version(&v) { Ok(v) } else { Err("The version must look like 1.0.0 (three numbers with dots).".into()) }
    };
    let (title, args, needs_vps): (String, Vec<String>, bool) = match action.as_str() {
        "build-client" => {
            let v = version()?;
            (format!("Building the client installer {v}"), vec!["build".into(), v], false)
        }
        "prepare-client" => {
            let v = version()?;
            (format!("Preparing the client program {v} for Installer Studio"), vec!["build".into(), v, "--files-only".into()], false)
        }
        "sign-client" => {
            let v = version()?;
            (format!("Signing ApnaBilling-{v}-setup.exe"), vec!["sign".into(), v], false)
        }
        "build-admin" => {
            let v = version()?;
            (format!("Building the Admin app installer {v}"), vec!["admin-app".into(), v], false)
        }
        "prepare-admin" => {
            let v = version()?;
            (format!("Preparing the Admin app program {v} for Installer Studio"), vec!["admin-app".into(), v, "--files-only".into()], false)
        }
        "deploy-server" => ("Uploading the Admin Panel and licence server to the VPS".into(), vec!["deploy".into()], true),
        "reset-updates" => ("Reset update history on the VPS".into(), vec!["reset-updates".into()], true),
        other => return Err(format!("Unknown action: {other}")),
    };
    let vps_password = vps_password.filter(|p| !p.is_empty());
    if needs_vps && vps_password.is_none() {
        return Err("Type the VPS password first.".into());
    }

    let mut cmd = Command::new("python");
    cmd.arg("-u").arg(root.join("deploy").join("apna_vps.py")).args(&args).current_dir(&root);
    cmd.env("PYTHONUNBUFFERED", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0")
        .env("CARGO_TERM_COLOR", "never")
        .env("npm_config_color", "false")
        .env_remove("VPS_PASSWORD")
        .env_remove("APNA_ADMIN_PASSWORD");
    if studio_exe().is_file() {
        cmd.env("INSTALLER_STUDIO", studio_exe());
    }
    if let Some(p) = vps_password {
        cmd.env("VPS_PASSWORD", p);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(NO_WINDOW);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Could not start Python ({e}). Python 3 must be installed and on PATH."))?;

    let readers = [
        child.stdout.take().map(|o| pump(app.clone(), o)),
        child.stderr.take().map(|e| pump(app.clone(), e)),
    ];
    *slot = Some(Job { pid: child.id(), title: title.clone(), stdin: child.stdin.take() });
    drop(slot);

    let _ = app.emit("release-output", format!("\n▶ {title}\n"));
    std::thread::spawn(move || {
        for r in readers.into_iter().flatten() {
            let _ = r.join();
        }
        let code = child.wait().ok().and_then(|s| s.code()).unwrap_or(-1);
        if let Some(state) = tauri::Manager::try_state::<Running>(&app) {
            state.0.lock().unwrap().take();
        }
        let _ = app.emit("release-done", Done { title, code });
    });
    Ok(())
}

/// A built installer or its signature from the releases folder, as bytes, for the page to upload and publish
#[tauri::command]
pub fn release_file(name: String) -> Result<tauri::ipc::Response, String> {
    let lower = name.to_lowercase();
    if name.contains(['/', '\\', ':']) || name.contains("..") || !(lower.ends_with(".exe") || lower.ends_with(".sig")) {
        return Err("Only installers (.exe) and signatures (.sig) in the releases folder.".into());
    }
    std::fs::read(releases().join(&name)).map(tauri::ipc::Response::new).map_err(|e| format!("Could not read {name}: {e}"))
}

/// Answer to "Type the word RESET" of reset-updates
#[tauri::command]
pub fn release_answer(running: State<'_, Running>, confirm: bool) -> Result<(), String> {
    let mut slot = running.0.lock().unwrap();
    let stdin = slot.as_mut().and_then(|j| j.stdin.as_mut()).ok_or("Nothing is waiting for an answer.")?;
    stdin
        .write_all(if confirm { b"RESET\n" } else { b"\n" })
        .and_then(|_| stdin.flush())
        .map_err(|e| e.to_string())
}

fn kill_tree(pid: u32) {
    let mut cmd = Command::new("taskkill");
    cmd.args(["/T", "/F", "/PID", &pid.to_string()]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(NO_WINDOW);
    let _ = cmd.status();
}

#[tauri::command]
pub fn release_stop(running: State<'_, Running>) {
    if let Some(job) = running.0.lock().unwrap().as_ref() {
        kill_tree(job.pid);
    }
}

/// Stops a run that is still going when the app closes (builds, npm and cargo included)
pub fn stop_on_exit(app: &AppHandle) {
    if let Some(state) = tauri::Manager::try_state::<Running>(app) {
        if let Some(job) = state.0.lock().unwrap().as_ref() {
            kill_tree(job.pid);
        }
    }
}

/// Opens a fixed place: "releases" (folder), "file:<name>" (a file in releases, shown selected), "studio-client" /
/// "studio-admin" (the project in Installer Studio), "studio-setup" (the folder with Installer Studio's setup)
#[tauri::command]
pub fn release_open(target: String) -> Result<(), String> {
    let explorer = |args: Vec<String>| -> Result<(), String> {
        let mut cmd = Command::new("explorer.exe");
        #[cfg(windows)]
        cmd.raw_arg(args.join(" "));
        cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
    };
    match target.as_str() {
        "releases" => {
            let dir = releases();
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            explorer(vec![format!("\"{}\"", dir.display())])
        }
        "studio-setup" => {
            let dir = studio_setup_dir();
            let dir = if dir.is_dir() { dir } else { repo().join("..") };
            explorer(vec![format!("\"{}\"", dir.canonicalize().unwrap_or(dir).display()).replace(r"\\?\", "")])
        }
        "studio-client" | "studio-admin" => {
            let exe = studio_exe();
            if !exe.is_file() {
                return Err("Installer Studio is not installed yet.".into());
            }
            let project = if target == "studio-admin" { "Apna Billing Admin.isproj" } else { "Apna Billing.isproj" };
            Command::new(exe)
                .arg(repo().join("deploy").join("installer-studio").join(project))
                .spawn()
                .map(|_| ())
                .map_err(|e| format!("Could not open Installer Studio: {e}"))
        }
        t => {
            let name = t.strip_prefix("file:").ok_or_else(|| format!("Unknown place: {t}"))?;
            if name.is_empty() || name.contains(['/', '\\', ':']) || name.contains("..") {
                return Err("Not a file in the releases folder.".into());
            }
            let file = releases().join(name);
            if !file.is_file() {
                return Err(format!("{name} is not in the releases folder."));
            }
            explorer(vec![format!("/select,\"{}\"", file.display())])
        }
    }
}
