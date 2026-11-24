//! Apna Billing desktop shell.
//!
//! The very first thing it does is start the local engine (the sealed single-file server,
//! engine\apna-billing-engine.exe) as a hidden child process on 127.0.0.1:<free port>, while the native start screen
//! (splash.rs) is already on screen; the window is then made directly on the engine's address. While it starts, every
//! engine file is checked against the SHA-256 manifest compiled into this executable (reading the files overlaps with
//! the engine loading and the virus scanner looking at it); the database key is handed over the engine's stdin pipe
//! only once every file matches, so a modified engine never gets it.
//! Customer data lives in %APPDATA%\ApnaBilling\data - never in the install folder - and is encrypted. The window
//! may only navigate to the local server. The custom title bar may minimize, resize and close the window.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use tauri::webview::PageLoadEvent;
use tauri::window::Color;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
#[cfg(not(windows))]
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

mod splash;

include!(concat!(env!("OUT_DIR"), "/data_key.rs"));
include!(concat!(env!("OUT_DIR"), "/engine_manifest.rs"));

const ENGINE_EXE: &str = "apna-billing-engine.exe";

/// This build's version: the app version, plus "+N" for update N of that same version (APNA_BUILD at build time,
/// deploy/apna_vps.py). Clients see 1.2.3; the updater and the vendor's server tell 1.2.3+2 from 1.2.3.
fn app_version() -> String {
    match option_env!("APNA_BUILD").map(str::trim) {
        Some(n) if !n.is_empty() => format!("{}+{n}", env!("CARGO_PKG_VERSION")),
        _ => env!("CARGO_PKG_VERSION").to_string(),
    }
}

struct Backend(Mutex<Option<Child>>);

/// Key of the local database and its backups. Derived from the product data key compiled into this shell, so it is
/// the same on every installation (a backup restores on any computer) yet never stored on disk or in the environment.
/// tauri/scripts/prepare.cjs (shellDatabaseKey) makes the same key to encrypt the sign-in media: change both together.
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

/// Refuse to use an engine whose files differ from the ones this shell was built with (it is not given the key).
fn verify_engine(dir: &Path) -> Result<(), String> {
    if ENGINE_MANIFEST.is_empty() {
        return Err("This build has no engine manifest. Build it with \"npm run build\" in the tauri folder.".into());
    }
    // The files are independent, so they are read and hashed side by side
    let bad = std::thread::scope(|scope| {
        let jobs: Vec<_> = ENGINE_MANIFEST
            .iter()
            .map(|(expected, rel)| {
                scope.spawn(move || sha256_file(&dir.join(rel)).map(|h| h == *expected).unwrap_or(false).then_some(()).ok_or(*rel))
            })
            .collect();
        jobs.into_iter().filter_map(|j| j.join().ok().and_then(|r| r.err())).next()
    });
    match bad {
        Some(rel) => Err(format!("The installation is damaged or has been modified ({rel}).\nPlease reinstall Apna Billing.")),
        None => Ok(()),
    }
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
fn license_ca_file() -> Option<PathBuf> {
    engine_dir().ok().map(|d| d.join("license-ca.crt")).filter(|p| p.exists())
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

/// The installed engine folder (release: beside this program), or tauri/engine from the last release preparation
/// (debug, certificate only). Needs no framework, so the engine can be started before the framework is.
fn engine_dir() -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        Ok(tauri_project_dir().join("engine"))
    } else {
        std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .map(|d| strip_verbatim(d.to_path_buf()).join("engine"))
            .ok_or_else(|| "cannot find the program folder".to_string())
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

/// Starts the engine on its own thread, right away; the answer (the process and its port, or why not) arrives on the
/// returned channel.
fn start_backend_async() -> mpsc::Receiver<Result<(Child, u16), String>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(start_backend());
    });
    rx
}

fn start_backend() -> Result<(Child, u16), String> {
    start_engine(false)
}

/// Starts the engine: normally the local server (its port comes back); with `uninstall` it only tells the vendor's
/// server that Apna Billing is leaving this computer and exits (port 0).
fn start_engine(uninstall: bool) -> Result<(Child, u16), String> {
    let data = data_dir();
    std::fs::create_dir_all(&data).map_err(|e| format!("Cannot create {}: {e}", data.display()))?;

    let client_dist = tauri_project_dir().join("..").join("client").join("dist");
    // The files are read and checked on their own thread while the engine process starts (see below)
    let mut verification: Option<std::thread::JoinHandle<Result<(), String>>> = None;
    let mut cmd = if cfg!(debug_assertions) {
        // Development: run the engine entry point with Node against server/dist and client/dist.
        let script = tauri_project_dir().join("sidecar").join("run-server.cjs");
        let mut c = Command::new("node");
        c.arg(script);
        // Cwd must be the tauri folder so server/dist relative requires in run-server.cjs resolve.
        c.current_dir(tauri_project_dir());
        c
    } else {
        let dir = engine_dir()?;
        let to_check = dir.clone();
        verification = Some(std::thread::spawn(move || verify_engine(&to_check)));
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
        .env("APNA_APP_VERSION", app_version())
        .env("APNA_LICENSE_SERVER_URL", license_server_url())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if cfg!(debug_assertions) {
        cmd.env("APNA_CLIENT_DIST", &client_dist);
    }
    if let Some(ca) = license_ca_file() {
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
    splash::trace("engine process started");
    // The engine waits for its database key on stdin: it gets it only when every file has been checked. The check
    // ran alongside the start, so it normally adds no time of its own.
    if let Some(check) = verification {
        let verdict = check.join().unwrap_or_else(|_| Err("The engine could not be checked.".to_string()));
        if let Err(msg) = verdict {
            let _ = child.kill();
            let _ = child.wait();
            return Err(msg);
        }
        splash::trace("engine files verified");
    }
    // The key goes over the private pipe (never the environment or a file). Keeping stdin open is what keeps the
    // engine alive: it exits when this process goes away.
    let handshake = format!("{{\"dbKey\":\"{}\",\"uninstall\":{uninstall}}}\n", database_key());
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
            if line.starts_with("APNA_UNINSTALLED=") {
                let _ = tx.send(0);
            }
            if let Some(p) = line.strip_prefix("APNA_PORT=") {
                if let Ok(port) = p.trim().parse::<u16>() {
                    splash::trace("engine answers");
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

/// Stops the local engine. Its input is closed first: the engine then tells the vendor's server the app was closed and
/// exits by itself (well under a second, at most ~1.5 s offline). Still running after 2 s: it is ended. Either way no
/// engine is left running after the app closes.
fn kill_backend(app: &AppHandle) {
    if let Some(state) = app.try_state::<Backend>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            drop(child.stdin.take());
            let deadline = std::time::Instant::now() + Duration::from_millis(2000);
            while std::time::Instant::now() < deadline {
                match child.try_wait() {
                    Ok(Some(_)) => return,
                    Ok(None) => std::thread::sleep(Duration::from_millis(25)),
                    Err(_) => break,
                }
            }
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
    let ca = license_ca_file().and_then(|p| std::fs::read(p).ok());
    let before_exit = app.clone();
    let mut builder = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(600))
        // Whatever version the vendor has live, newer or older: the server only offers an older one when the vendor
        // rolled back on purpose (Admin Panel → Updates & Releases)
        .version_comparator(|_, remote| remote.version.to_string() != app_version())
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
        .ok_or_else(|| "This computer already has the version on the update server.".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("The update could not be installed: {e}"))?;
    // Windows: the installer has already taken over and the app exits. Elsewhere, restart into the new version.
    kill_backend(&app);
    app.restart();
}

/// The engine could not start: the window stays hidden behind the error message
static STARTUP_FAILED: AtomicBool = AtomicBool::new(false);
/// The first screen said it is ready (the slow-start fallback then has nothing to do)
static FIRST_SCREEN_READY: AtomicBool = AtomicBool::new(false);
/// If the app's first screen has not said it is ready by then, the window is shown anyway (with the start screen of
/// ui/index.html): quickly when there is no native start screen, later when the start screen is keeping the user company
const SHOW_ANYWAY_AFTER: Duration = Duration::from_millis(2500);
const SHOW_ANYWAY_AFTER_START_SCREEN: Duration = Duration::from_secs(15);

/// The native start screen while it is open (splash.rs)
#[derive(Default)]
struct StartScreen(Mutex<Option<splash::Splash>>);

fn show_window(w: &tauri::WebviewWindow) {
    splash::trace("window shown");
    let _ = w.show();
    let _ = w.unminimize();
    // Always opens maximized (on every computer and every start); the restore button gives the normal window
    if !w.is_maximized().unwrap_or(true) {
        let _ = w.maximize();
    }
    let _ = w.set_focus();
}

/// Shows the app's window: from under the native start screen, which then closes, or straight away
fn reveal(app: &AppHandle, w: &tauri::WebviewWindow) {
    let splash = app.try_state::<StartScreen>().and_then(|s| s.0.lock().unwrap().take());
    match splash {
        Some(s) => {
            let w = w.clone();
            s.hand_over(move || show_window(&w));
        }
        None if !w.is_visible().unwrap_or(false) => show_window(w),
        None => {}
    }
}

/// The page calls this once its first real screen is drawn: the window appears with the app already in it, never
/// as an empty window.
#[tauri::command]
fn apna_ready(app: AppHandle, window: tauri::WebviewWindow) {
    if FIRST_SCREEN_READY.swap(true, Ordering::SeqCst) {
        return reveal(&app, &window);
    }
    splash::trace("first screen drawn");
    reveal(&app, &window);
    splash::save_trace(data_dir().join("startup.log"));
}

/**
 * `Apna Billing.exe --uninstall [--quiet]`, run by the uninstaller (never by an update) before it removes the program:
 * every business on this computer tells the vendor's server (the device slot is freed and the vendor sees the computer
 * as uninstalled), then the app's data on this computer is deleted: the databases, backups in the app's folder and
 * the window's storage. Without --quiet the user is asked first and may keep the data for a later reinstall.
 */
fn uninstall() {
    let quiet = std::env::args().any(|a| a == "--quiet");
    if let Ok((mut child, _)) = start_engine(true) {
        // The report is quick; an offline computer gives up within the engine's own timeout
        for _ in 0..250 {
            if matches!(child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
    let delete = quiet || ask_delete_data();
    if delete {
        let data = data_dir();
        let app_folder = data.parent().filter(|p| p.file_name().is_some_and(|n| n == "ApnaBilling")).map(PathBuf::from);
        let _ = std::fs::remove_dir_all(app_folder.unwrap_or(data));
        // (a test run against its own data folder leaves the installed app's window storage alone)
        let testing = std::env::args().any(|a| a.starts_with("--apna-data-dir="));
        if let (false, Some(local)) = (testing, std::env::var_os("LOCALAPPDATA")) {
            let _ = std::fs::remove_dir_all(PathBuf::from(local).join("in.apnabilling.desktop"));
        }
    }
}

#[cfg(windows)]
fn ask_delete_data() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDNO, MB_DEFBUTTON1, MB_ICONQUESTION, MB_SETFOREGROUND, MB_YESNO};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let text = wide("Also delete all Apna Billing data on this computer?\n\nYour businesses, bills, products, customers and the backups \
in the app's folder are removed for good. Choose No to keep them for a later reinstall.");
    let title = wide("Uninstall Apna Billing");
    unsafe { MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON1 | MB_SETFOREGROUND) != IDNO }
}

#[cfg(not(windows))]
fn ask_delete_data() -> bool {
    true
}

/// The light/dark choice, kept by the app itself (the window's own storage belongs to the engine's address)
fn theme_file() -> PathBuf {
    data_dir().join("ui-theme")
}

fn saved_dark() -> bool {
    std::fs::read_to_string(theme_file()).map(|t| t.trim() == "dark").unwrap_or(false)
}

/// The app remembers the theme here whenever it changes; the next start (start screen included) opens in it
#[tauri::command]
fn apna_set_theme(theme: String) {
    if theme == "dark" || theme == "light" {
        let _ = std::fs::create_dir_all(data_dir());
        let _ = std::fs::write(theme_file(), theme);
    }
}

pub fn run() {
    if std::env::args().any(|a| a == "--uninstall") {
        uninstall();
        return;
    }
    splash::trace("program started");
    const ID: &str = "in.apnabilling.desktop";
    // Only the first copy starts anything: a second one just brings the first forward (single-instance plugin)
    let first = splash::first_instance(ID) && !splash::already_running(ID);
    // The engine is the slowest thing to wait for, so it starts before anything else, on its own thread; its file
    // check and start-up overlap the start screen and the framework's own start-up
    let engine = if first { Some(start_backend_async()) } else { None };
    let dark = saved_dark();
    let start_screen = if first {
        splash::show(splash::Style {
            title: "Apna Billing",
            background: if dark { 0x1E1E21 } else { 0xEEF3F0 },
            text: if dark { 0xF1F5F9 } else { 0x0F172A },
            track: if dark { 0x343439 } else { 0xE2E8F0 },
            accent: 0x10B981,
            size: (1366.0, 860.0),
            fill: true,
        })
    } else {
        None
    };
    let place = start_screen.as_ref().map(|s| s.logical);

    splash::trace("framework starting");
    let context = tauri::generate_context!();
    splash::trace("context built");
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                reveal(app, &w);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![apna_install_update, apna_ready, apna_set_theme])
        .manage(Backend(Mutex::new(None)))
        .manage(StartScreen(Mutex::new(start_screen)))
        .setup(move |app| {
            splash::trace("framework ready");
            // The slow-start fallback: if the first screen has not said it is ready by then, the window is shown anyway
            let slow = app.handle().clone();
            let wait = if place.is_some() { SHOW_ANYWAY_AFTER_START_SCREEN } else { SHOW_ANYWAY_AFTER };
            std::thread::spawn(move || {
                std::thread::sleep(wait);
                if let Some(w) = slow.get_webview_window("main") {
                    if !STARTUP_FAILED.load(Ordering::SeqCst) && !FIRST_SCREEN_READY.load(Ordering::SeqCst) {
                        splash::trace("first screen not ready yet: shown anyway");
                        reveal(&slow, &w);
                        splash::save_trace(data_dir().join("startup.log"));
                    }
                }
            });

            // The window is made at once, and making it takes about as long as the engine needs to start, so the two
            // overlap: the window opens on the built-in start page and moves on to the engine as soon as both are ready
            // (leaving a page that is still loading flashes the window black, so that waits for the page). If the
            // engine is already up (it has been starting since the program began) the window is made directly on it.
            let engine = engine.unwrap_or_else(start_backend_async);
            let mut pending = None;
            let mut failed = None;
            let mut first_url = WebviewUrl::App("index.html".into());
            match engine.try_recv() {
                Ok(Ok((child, port))) => {
                    *app.state::<Backend>().0.lock().unwrap() = Some(child);
                    first_url = WebviewUrl::External(format!("http://127.0.0.1:{port}").parse().expect("valid url"));
                }
                Ok(Err(msg)) => failed = Some(msg),
                Err(_) => pending = Some(engine),
            }
            let (shown, start_screen) = mpsc::channel::<()>();
            let shown = Mutex::new(Some(shown));
            let handle = app.handle().clone();
            if failed.is_some() || pending.is_some() {
                std::thread::spawn(move || {
                    // Also waits for the window: its start page has loaded once this returns
                    let started = match (failed, pending) {
                        (Some(msg), _) => Err(msg),
                        (None, Some(rx)) => rx.recv_timeout(Duration::from_secs(60)).unwrap_or_else(|_| {
                            Err("The local engine did not start within 60 seconds.".to_string())
                        }),
                        (None, None) => unreachable!(),
                    };
                    let _ = start_screen.recv_timeout(Duration::from_secs(3));
                    let window = handle.get_webview_window("main");
                    match started {
                        Ok((child, port)) => {
                            *handle.state::<Backend>().0.lock().unwrap() = Some(child);
                            let url: tauri::Url = format!("http://127.0.0.1:{port}").parse().expect("valid url");
                            if let Some(w) = window {
                                let _ = w.navigate(url);
                            }
                        }
                        Err(msg) => {
                            // Hidden, not closed: closing the last window would quit before the message is read
                            STARTUP_FAILED.store(true, Ordering::SeqCst);
                            if let Some(s) = handle.state::<StartScreen>().0.lock().unwrap().take() {
                                s.close();
                            }
                            if let Some(w) = window {
                                let _ = w.hide();
                            }
                            let text = format!("{msg}\n\nYour data is safe in:\n{}", data_dir().display());
                            show_startup_error(&handle, &text);
                            handle.exit(1);
                        }
                    }
                });
            }

            let mut builder = WebviewWindowBuilder::new(app, "main", first_url);
            // A test run against its own data folder (--apna-data-dir) keeps its own window storage too
            if std::env::args().any(|a| a.starts_with("--apna-data-dir=")) {
                builder = builder.data_directory(data_dir().join("webview"));
            }
            let builder = builder
                .title("Apna Billing")
                .min_inner_size(1024.0, 680.0)
                .decorations(false)
                .shadow(true)
                .visible(false)
                .background_color(if dark { Color(30, 30, 33, 255) } else { Color(238, 243, 240, 255) }) // the app's background
                // The saved theme, before any of the page's own scripts run (index.html and ThemeContext read it)
                .initialization_script(if dark {
                    "document.documentElement.dataset.apnaTheme='dark';"
                } else {
                    "document.documentElement.dataset.apnaTheme='light';"
                })
                // Stop two-finger swipe from dragging / navigating the page sideways, and keep drawing while the
                // start screen covers the window (otherwise it would appear unpainted).
                // Hide WebView browser chrome feel: no overscroll history swipe, no status bubble.
                .additional_browser_args(
                    "--disable-features=msOverscrollHistoryNavigation,OverscrollHistoryNavigation,CalculateNativeWinOcclusion --disable-pinch",
                )
                // The start screen (tauri.localhost) and the local server only
                .on_navigation(|u| matches!(u.host_str(), Some("127.0.0.1") | Some("tauri.localhost")))
                .on_page_load(move |_, page| {
                    if page.event() == PageLoadEvent::Finished {
                        if let Some(tx) = shown.lock().unwrap().take() {
                            let _ = tx.send(());
                        }
                    }
                });
            // Maximized from the start, over the same work area as the start screen, so the hand-over cannot be seen and
            // the page is laid out at its real size before it shows. 1366 x 860, centred, is the size the restore
            // button gives.
            builder.inner_size(1366.0, 860.0).center().maximized(true).build()?;
            splash::trace("window created");
            Ok(())
        })
        .build(context)
        .expect("error while building Apna Billing")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                kill_backend(app);
            }
        });
}
