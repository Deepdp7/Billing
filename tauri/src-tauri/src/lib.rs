//! Apna Billing desktop shell.
//!
//! Starts the local engine (the sealed single-file server, engine\apna-billing-engine.exe) as a hidden child process
//! on 127.0.0.1:<free port>, then opens a window on it. Before starting it, every engine file is checked against the
//! SHA-256 manifest compiled into this executable; the database key is then handed over the engine's stdin pipe.
//! Customer data lives in %APPDATA%\ApnaBilling\data - never in the install folder - and is encrypted. The window
//! may only navigate to the local server. The custom title bar may minimize, resize and close the window.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
#[cfg(not(windows))]
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

include!(concat!(env!("OUT_DIR"), "/data_key.rs"));
include!(concat!(env!("OUT_DIR"), "/engine_manifest.rs"));

const ENGINE_EXE: &str = "apna-billing-engine.exe";

struct Backend(Mutex<Option<Child>>);

/// Key of the local database and its backups. Derived from the product data key compiled into this shell, so it is
/// the same on every installation (a backup restores on any computer) yet never stored on disk or in the environment.
fn database_key() -> String {
    let data_key: Vec<u8> = DATA_KEY_MASKED.iter().zip(DATA_KEY_MASK.iter()).map(|(a, b)| a ^ b).collect();
    let mut mac = Hmac::<Sha256>::new_from_slice(&data_key).expect("HMAC accepts any key length");
    mac.update(b"apna-billing/sqlite/v1");
    mac.finalize().into_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Refuse to run an engine whose files differ from the ones this shell was built with.
fn verify_engine(dir: &Path) -> Result<(), String> {
    if ENGINE_MANIFEST.is_empty() {
        return Err("This build has no engine manifest. Build it with \"npm run build\" in the tauri folder.".into());
    }
    for (expected, rel) in ENGINE_MANIFEST {
        let ok = sha256_file(&dir.join(rel)).map(|h| h == *expected).unwrap_or(false);
        if !ok {
            return Err(format!(
                "The installation is damaged or has been modified ({rel}).\nPlease reinstall Apna Billing."
            ));
        }
    }
    Ok(())
}

/// Where activation/licence checks go. Release builds use the URL compiled in (LICENSE_SERVER_URL at build time);
/// only debug builds honour a runtime override.
fn license_server_url() -> String {
    if cfg!(debug_assertions) {
        if let Ok(v) = std::env::var("APNA_LICENSE_SERVER_URL") {
            if !v.trim().is_empty() {
                return v;
            }
        }
    }
    option_env!("LICENSE_SERVER_URL").unwrap_or("http://127.0.0.1:7000").to_string()
}

/// Public certificate of the vendor's server (self-signed, no domain). When present, the app trusts exactly this
/// certificate for license checks and update downloads.
fn license_ca_file(handle: &AppHandle) -> Option<PathBuf> {
    engine_dir(handle).ok().map(|d| d.join("license-ca.crt")).filter(|p| p.exists())
}

fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy().to_string();
    match s.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p,
    }
}

fn tauri_project_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

/// The installed engine folder (release), or tauri/engine from the last release preparation (debug, certificate only).
fn engine_dir(handle: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        Ok(tauri_project_dir().join("engine"))
    } else {
        handle
            .path()
            .resource_dir()
            .map(|d| strip_verbatim(d).join("engine"))
            .map_err(|e| e.to_string())
    }
}

/// Environment variables the engine may inherit; everything else (NODE_OPTIONS, overrides of data or licensing
/// settings, ...) is dropped.
const INHERITED_ENV: &[&str] = &[
    "SystemRoot", "SystemDrive", "windir", "TEMP", "TMP", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "HOMEDRIVE",
    "HOMEPATH", "USERNAME", "USERDOMAIN", "COMPUTERNAME", "ProgramData", "ALLUSERSPROFILE", "PUBLIC", "OS", "PATH",
    "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
];

fn data_dir() -> PathBuf {
    // --apna-data-dir=<path> runs against a separate data folder (testing). A new folder is a new installation,
    // so it still has to be activated on its own.
    if let Some(arg) = std::env::args().find(|a| a.starts_with("--apna-data-dir=")) {
        return PathBuf::from(&arg["--apna-data-dir=".len()..]);
    }
    let base = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    base.join("ApnaBilling").join("data")
}

fn start_backend(handle: &AppHandle) -> Result<(Child, u16), String> {
    let data = data_dir();
    std::fs::create_dir_all(&data).map_err(|e| format!("Cannot create {}: {e}", data.display()))?;

    let client_dist = tauri_project_dir().join("..").join("client").join("dist");
    let mut cmd = if cfg!(debug_assertions) {
        // Development: run the engine entry point with Node against server/dist and client/dist.
        let script = tauri_project_dir().join("sidecar").join("run-server.cjs");
        let mut c = Command::new("node");
        c.arg(script);
        // Cwd must be the tauri folder so server/dist relative requires in run-server.cjs resolve.
        c.current_dir(tauri_project_dir());
        c
    } else {
        let dir = engine_dir(handle)?;
        verify_engine(&dir)?;
        let mut c = Command::new(dir.join(ENGINE_EXE));
        c.current_dir(&dir);
        c
    };

    // Nothing from the user's environment may weaken licensing, load code into the engine or redirect data.
    // APNA_CLIENT_DIST must be set *after* env_clear — otherwise the window opens on Express with no UI
    // and shows the plain "Cannot GET /" page.
    cmd.env_clear();
    for k in INHERITED_ENV {
        if let Some(v) = std::env::var_os(k) {
            cmd.env(k, v);
        }
    }
    cmd.env("NODE_ENV", "production")
        .env("APNA_EMBEDDED", "1")
        .env("APNA_DATA_DIR", &data)
        .env("APNA_APP_VERSION", env!("CARGO_PKG_VERSION"))
        .env("APNA_LICENSE_SERVER_URL", license_server_url())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if cfg!(debug_assertions) {
        cmd.env("APNA_CLIENT_DIST", &client_dist);
    }
    if let Some(ca) = license_ca_file(handle) {
        cmd.env("NODE_EXTRA_CA_CERTS", ca);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!("Could not start the local engine: {e}\nIn development, Node.js must be on PATH.")
    })?;
    // The key goes over the private pipe (never the environment or a file). Keeping stdin open is what keeps the
    // engine alive: it exits when this process goes away.
    let handshake = format!("{{\"dbKey\":\"{}\"}}\n", database_key());
    if let Some(stdin) = child.stdin.as_mut() {
        if let Err(e) = stdin.write_all(handshake.as_bytes()).and_then(|_| stdin.flush()) {
            let _ = child.kill();
            return Err(format!("Could not start the local engine: {e}"));
        }
    }

    // Keep the end of the engine's error output for the message shown if it fails to start.
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(stderr) = child.stderr.take() {
        let errors = errors.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                eprintln!("[engine] {line}");
                let mut e = errors.lock().unwrap();
                e.push(line);
                if e.len() > 8 {
                    e.remove(0);
                }
            }
        });
    }
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let (tx, rx) = mpsc::channel::<u16>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            println!("[engine] {line}");
            if let Some(p) = line.strip_prefix("APNA_PORT=") {
                if let Ok(port) = p.trim().parse::<u16>() {
                    let _ = tx.send(port);
                }
            }
        }
    });
    // Disconnected (the engine exited) ends the wait at once; otherwise give it a minute.
    match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(port) => Ok((child, port)),
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            std::thread::sleep(Duration::from_millis(200)); // let the error reader drain
            let detail = errors.lock().unwrap().join("\n");
            let what = match e {
                mpsc::RecvTimeoutError::Timeout => "The local engine did not start within 60 seconds.",
                mpsc::RecvTimeoutError::Disconnected => "The local engine stopped while starting.",
            };
            Err(if detail.is_empty() { what.to_string() } else { format!("{what}\n\n{detail}") })
        }
    }
}

/// Marks a run where the engine could not be started (only the error message is shown).
struct StartupFailed;

/// Tell the user why the app cannot start; returns when they close the message.
fn show_startup_error(handle: &AppHandle, text: &str) {
    const TITLE: &str = "Apna Billing could not start";
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK, MB_SETFOREGROUND};
        let _ = handle;
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let (text, title) = (wide(text), wide(TITLE));
        // SAFETY: both strings are NUL-terminated UTF-16 buffers that outlive the call.
        unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_OK | MB_ICONERROR | MB_SETFOREGROUND) };
    }
    #[cfg(not(windows))]
    handle.dialog().message(text).title(TITLE).kind(MessageDialogKind::Error).blocking_show();
}

fn kill_backend(app: &AppHandle) {
    if let Some(state) = app.try_state::<Backend>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// "Install now" in the update popup: download the update from the vendor's server, verify its signature with the
/// updater public key compiled into this app, stop the local server (so its files can be replaced), install, restart.
#[tauri::command]
async fn apna_install_update(app: AppHandle) -> Result<(), String> {
    let endpoint: tauri::Url = format!("{}/updates/latest.json", license_server_url().trim_end_matches('/'))
        .parse()
        .map_err(|e| format!("Bad update address: {e}"))?;
    let ca = license_ca_file(&app).and_then(|p| std::fs::read(p).ok());
    let before_exit = app.clone();
    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(600))
        .on_before_exit(move || kill_backend(&before_exit));
    if let Some(pem) = ca {
        builder = builder.configure_client(move |client| match reqwest::Certificate::from_pem(&pem) {
            Ok(cert) => client.add_root_certificate(cert),
            Err(_) => client,
        });
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("Could not reach the update server: {e}"))?
        .ok_or_else(|| "No newer version was found on the update server.".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("The update could not be installed: {e}"))?;
    // Windows: the installer has already taken over and the app exits. Elsewhere, restart into the new version.
    kill_backend(&app);
    app.restart();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![apna_install_update])
        .manage(Backend(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();
            let (child, port) = match start_backend(&handle) {
                Ok(v) => v,
                Err(msg) => {
                    // Returning an error from setup would abort the process (panic). Instead open no window, stay alive
                    // (see ExitRequested below) until the message is closed, then exit cleanly with code 1.
                    app.manage(StartupFailed);
                    let text = format!("{msg}\n\nYour data is safe in:\n{}", data_dir().display());
                    std::thread::spawn(move || {
                        show_startup_error(&handle, &text);
                        handle.exit(1);
                    });
                    return Ok(());
                }
            };
            *app.state::<Backend>().0.lock().unwrap() = Some(child);

            let url: tauri::Url = format!("http://127.0.0.1:{port}").parse().expect("valid url");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Apna Billing")
                .inner_size(1366.0, 860.0)
                .min_inner_size(1024.0, 680.0)
                .decorations(false)
                .shadow(true)
                .center()
                // Stop two-finger swipe from dragging / navigating the page sideways.
                // Hide WebView browser chrome feel: no overscroll history swipe, no status bubble.
                .additional_browser_args("--disable-features=msOverscrollHistoryNavigation,OverscrollHistoryNavigation --disable-pinch")
                .on_navigation(|u| u.host_str() == Some("127.0.0.1"))
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Apna Billing")
        .run(|app, event| match event {
            // With no window open the app would quit on its own and take the error message with it.
            RunEvent::ExitRequested { code: None, api, .. } if app.try_state::<StartupFailed>().is_some() => {
                api.prevent_exit();
            }
            RunEvent::Exit => kill_backend(app),
            _ => {}
        });
}
