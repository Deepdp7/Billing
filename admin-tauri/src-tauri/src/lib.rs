//! Apna Billing Admin desktop shell.
//!
//! Production build (`python deploy/apna_vps.py admin-app`): opens the Admin Panel served by the VPS license server.
//! The window talks to a small relay inside this app on 127.0.0.1, which forwards to the server over HTTPS and trusts
//! only the server's own certificate (compiled in), the same way the billing app does.
//!
//! Development build (`npm run dev:admin`), run with three terminals from the Billing folder:
//!   1. `npm run dev:license`  — license API on :7000
//!   2. `npm run dev:admin`    — this shell (+ admin panel on :3100)
//!   3. `npm run dev:app`      — customer billing desktop app
//!
//! The relay starts first thing (a few milliseconds) and the window is made directly on it, behind the native start
//! screen, so it never shows a blank white window. The relay keeps a copy of the panel's own files on this computer
//! (never of the data): the panel opens from that copy at once, without waiting for the internet, and refreshes it in
//! the background; if the server has a newer panel, the window reloads into it right away.
//!
//! Closing the Admin window stops only the panel process this app started.

mod release;
// The native start screen, shared with the billing app
#[path = "../../../tauri/src-tauri/src/splash.rs"]
mod splash;

use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use tauri::webview::PageLoadEvent;
use tauri::window::Color;
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

struct Services(Mutex<Vec<Child>>);

const LICENSE_PORT: u16 = 7000;
const PANEL_PORT: u16 = 3100;
/// The relay listens here when the port is free, so the panel keeps one address between runs and the window reuses
/// its cached files instead of downloading the whole panel again (any free port otherwise).
const RELAY_PORT: u16 = 47831;

/// Set at build time for the production app; None for the development shell.
const SERVER_URL: Option<&str> = option_env!("APNA_ADMIN_SERVER_URL");
/// Public certificate of the server (self-signed CA, no domain); empty when the server has a public certificate.
const SERVER_CA: &str = include_str!(concat!(env!("OUT_DIR"), "/server_ca.pem"));

/// Called when the server turned out to have a newer panel than the copy the window was opened from
type NewPanelHook = Arc<Mutex<Option<Box<dyn Fn() + Send>>>>;

struct Relay {
    client: reqwest::Client,
    base: String,
    /// Where the panel's own files are kept (None: no local copy, everything is forwarded)
    cache: Option<PathBuf>,
    on_new_panel: NewPanelHook,
}

/// The panel's pages and scripts, as opposed to its data (/api) or installer downloads (/updates)
fn is_panel_file(path: &str) -> bool {
    !path.starts_with("/api") && !path.starts_with("/updates") && !path.contains("..")
}

fn is_index(path: &str) -> bool {
    path == "/" || path == "/index.html"
}

/// Files under /assets have the content in their name (a new build has new names): they never change
fn is_immutable(path: &str) -> bool {
    path.starts_with("/assets/")
}

fn cache_name(path: &str) -> String {
    if is_index(path) {
        return "index.html".into();
    }
    path.trim_start_matches('/')
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect()
}

fn app_data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    // (a side-by-side test build keeps its own files)
    base.join(option_env!("APNA_TEST_IDENTIFIER").unwrap_or("in.apnabilling.admin"))
}

fn cache_dir() -> Option<PathBuf> {
    Some(app_data_dir().join("panel-cache"))
}

/// The light/dark choice, kept by the app itself in a file: the window's own storage can lose a change made just
/// before the app was closed
fn theme_file() -> PathBuf {
    app_data_dir().join("theme")
}

fn saved_theme() -> Option<&'static str> {
    match std::fs::read_to_string(theme_file()).ok()?.trim() {
        "dark" => Some("dark"),
        "light" => Some("light"),
        _ => None,
    }
}

/// The panel remembers the theme here whenever it changes
#[tauri::command]
fn admin_set_theme(theme: String) {
    if theme == "dark" || theme == "light" {
        let _ = std::fs::create_dir_all(app_data_dir());
        let _ = std::fs::write(theme_file(), theme);
    }
}

/// The page opens in the saved theme from its first frame: <html data-apna-theme="dark"> (read by index.html)
fn with_theme(path: &str, body: Vec<u8>) -> Vec<u8> {
    let Some(theme) = saved_theme().filter(|_| is_index(path)) else { return body };
    let Ok(text) = String::from_utf8(body.clone()) else { return body };
    text.replacen("<html", &format!("<html data-apna-theme=\"{theme}\""), 1).into_bytes()
}

fn read_cached(dir: &Path, name: &str) -> Option<(Vec<u8>, String)> {
    let body = std::fs::read(dir.join(name)).ok()?;
    let kind = std::fs::read_to_string(dir.join(format!("{name}.type"))).unwrap_or_else(|_| "application/octet-stream".into());
    Some((body, kind))
}

/// Written whole and renamed into place, so a file is never half there
fn write_cached(dir: &Path, name: &str, body: &[u8], kind: &str) {
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let tmp = dir.join(format!("{name}.tmp"));
    if std::fs::write(&tmp, body).is_ok() && std::fs::rename(&tmp, dir.join(name)).is_ok() {
        let _ = std::fs::write(dir.join(format!("{name}.type")), kind);
    }
}

async fn fetch_panel_file(relay: &Relay, path: &str) -> Option<(Vec<u8>, String)> {
    let res = relay.client.get(format!("{}{path}", relay.base)).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let kind = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("application/octet-stream").to_string();
    let body = res.bytes().await.ok()?;
    (body.len() < 20_000_000).then(|| (body.to_vec(), kind))
}

fn file_response(body: Vec<u8>, kind: &str, immutable: bool) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, kind)
        // The page is asked for again every time (it is local and quick); hashed files are kept by the window
        .header(header::CACHE_CONTROL, if immutable { "public, max-age=31536000, immutable" } else { "no-cache" })
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

/// Fetches the file again and keeps it if it changed; a changed index.html means the server has a newer panel.
async fn refresh_panel_file(relay: Arc<Relay>, path: String) {
    let (Some(dir), Some((body, kind))) = (relay.cache.clone(), fetch_panel_file(&relay, &path).await) else { return };
    let name = cache_name(&path);
    if read_cached(&dir, &name).map(|(old, _)| old != body).unwrap_or(true) {
        write_cached(&dir, &name, &body, &kind);
        if is_index(&path) {
            if let Some(hook) = relay.on_new_panel.lock().unwrap().as_ref() {
                hook();
            }
        }
    }
}

/// A panel file from the local copy at once (refreshed in the background); the first time, from the server.
async fn panel_file(relay: &Arc<Relay>, path: &str) -> Option<Response> {
    let dir = relay.cache.as_ref()?;
    let name = cache_name(path);
    let immutable = is_immutable(path);
    if let Some((body, kind)) = read_cached(dir, &name) {
        if !immutable {
            tauri::async_runtime::spawn(refresh_panel_file(relay.clone(), path.to_string()));
        }
        return Some(file_response(with_theme(path, body), &kind, immutable));
    }
    let (body, kind) = fetch_panel_file(relay, path).await?;
    write_cached(dir, &name, &body, &kind);
    Some(file_response(with_theme(path, body), &kind, immutable))
}

/// Headers that belong to one connection, or that would reveal/upset the local origin, are not forwarded.
const SKIP_REQUEST_HEADERS: &[&str] = &[
    "host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "origin",
    "referer",
];
const SKIP_RESPONSE_HEADERS: &[&str] = &[
    "connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer", "strict-transport-security",
];

async fn relay(State(relay): State<Arc<Relay>>, req: Request) -> Response {
    let (parts, body) = req.into_parts();
    if parts.method == Method::GET && parts.uri.query().is_none() && is_panel_file(parts.uri.path()) {
        if let Some(response) = panel_file(&relay, parts.uri.path()).await {
            return response;
        }
    }
    let path = parts.uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let mut out = relay.client.request(parts.method, format!("{}{path}", relay.base));
    for (name, value) in &parts.headers {
        if !SKIP_REQUEST_HEADERS.contains(&name.as_str()) {
            out = out.header(name, value);
        }
    }
    // Streamed both ways: installer uploads on the App Updates page and the live event feed.
    out = out.body(reqwest::Body::wrap_stream(body.into_data_stream()));
    match out.send().await {
        Ok(res) => {
            let mut response = Response::builder().status(res.status());
            for (name, value) in res.headers() {
                if !SKIP_RESPONSE_HEADERS.contains(&name.as_str()) {
                    response = response.header(name, value);
                }
            }
            response
                .body(Body::from_stream(res.bytes_stream()))
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
        }
        Err(_) => (
            StatusCode::BAD_GATEWAY,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"code":"SERVER_UNREACHABLE","message":"Cannot reach the Apna Billing server. Check the internet connection."}"#,
        )
            .into_response(),
    }
}

/// Start the relay on 127.0.0.1:<free port> and return the port, and the hook the window sets to be told of a newer
/// panel.
fn start_relay(server: &str) -> Result<(u16, NewPanelHook), String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let mut builder = reqwest::Client::builder().connect_timeout(Duration::from_secs(15));
    if !SERVER_CA.is_empty() {
        let cert = reqwest::Certificate::from_pem(SERVER_CA.as_bytes()).map_err(|e| format!("Bad server certificate: {e}"))?;
        builder = builder.tls_certs_only([cert]);
    }
    let client = builder.build().map_err(|e| format!("Could not set up the connection: {e}"))?;
    let listener = std::net::TcpListener::bind(("127.0.0.1", RELAY_PORT))
        .or_else(|_| std::net::TcpListener::bind(("127.0.0.1", 0)))
        .map_err(|e| format!("Could not open a local port: {e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    println!("[admin] Admin Panel of {server} via 127.0.0.1:{port}");
    let on_new_panel: NewPanelHook = Arc::new(Mutex::new(None));
    let cache = cache_dir();
    if let Some(dir) = cache.clone() {
        // Files of panels that were replaced long ago are not kept for ever
        std::thread::spawn(move || {
            let old = Duration::from_secs(90 * 24 * 3600);
            for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
                let stale = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age > old);
                if stale && entry.file_name().to_string_lossy().starts_with("assets_") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        });
    }
    let state = Arc::new(Relay { client, base: server.trim_end_matches('/').to_string(), cache, on_new_panel: on_new_panel.clone() });
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => {
                let app = axum::Router::new().fallback(relay).with_state(state);
                if let Err(e) = axum::serve(listener, app).await {
                    eprintln!("[admin] relay stopped: {e}");
                }
            }
            Err(e) => eprintln!("[admin] relay could not start: {e}"),
        }
    });
    Ok((port, on_new_panel))
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("..")
}

fn port_open(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok()
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if port_open(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    false
}

fn npm_command() -> Command {
    if cfg!(windows) {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg("npm");
        cmd
    } else {
        Command::new("npm")
    }
}

fn spawn_npm(cwd: PathBuf, args: &[&str], label: &'static str) -> Result<Child, String> {
    let mut cmd = npm_command();
    cmd.args(args).current_dir(&cwd);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| {
        format!("Could not start {label} in {} ({e}). Node.js and npm must be on PATH.", cwd.display())
    })?;
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                println!("[{label}] {line}");
            }
        });
    }
    Ok(child)
}

fn kill_child(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

fn start_services() -> Result<Vec<Child>, String> {
    let root = repo_root();
    let panel_dir = root.join("admin-panel");
    if !panel_dir.join("package.json").exists() {
        return Err(format!(
            "Could not find the admin panel next to this app (looked in {}).",
            root.display()
        ));
    }

    // License must already be running in its own terminal (`npm run dev:license`).
    // Wait briefly so you can start license then admin without racing the dialog.
    if !port_open(LICENSE_PORT) {
        println!("[admin] Waiting for license server on {LICENSE_PORT} (npm run dev:license)…");
        if !wait_for_port(LICENSE_PORT, Duration::from_secs(20)) {
            return Err(format!(
                "The license server is not running on port {LICENSE_PORT}.\n\nUse three separate terminals from the Billing folder:\n  npm run dev:license   ← start this first\n  npm run dev:admin\n  npm run dev:app\n\nThen start Admin again."
            ));
        }
    }
    println!("[admin] Using license server on {LICENSE_PORT}");

    let mut children = Vec::new();
    if port_open(PANEL_PORT) {
        println!("[admin] Admin panel is already running on {PANEL_PORT}");
    } else {
        println!("[admin] Starting admin panel…");
        children.push(spawn_npm(panel_dir, &["run", "dev"], "panel")?);
        if !wait_for_port(PANEL_PORT, Duration::from_secs(60)) {
            for child in &mut children {
                kill_child(child);
            }
            return Err("The admin panel did not start on port 3100 within 60 seconds.".into());
        }
    }
    Ok(children)
}

fn stop_services(app: &AppHandle) {
    if let Some(state) = app.try_state::<Services>() {
        for child in state.0.lock().unwrap().iter_mut() {
            kill_child(child);
        }
    }
}

/// Starting failed: the window stays hidden behind the error message
static STARTUP_FAILED: AtomicBool = AtomicBool::new(false);
/// If the panel has not said it is ready by then, the window is shown anyway: quickly when there is no native start
/// screen, later when the start screen is keeping the user company (slow internet to the server)
const SHOW_ANYWAY_AFTER: Duration = Duration::from_millis(2500);
const SHOW_ANYWAY_AFTER_START_SCREEN: Duration = Duration::from_secs(15);

/// The native start screen while it is open (splash.rs)
#[derive(Default)]
struct StartScreen(Mutex<Option<splash::Splash>>);

fn show_window(w: &tauri::WebviewWindow) {
    splash::trace("window shown");
    let _ = w.show();
    let _ = w.unminimize();
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

/// The panel calls this once its first real page is drawn: the window appears with it, never as an empty window
#[tauri::command]
fn app_ready(app: AppHandle, window: tauri::WebviewWindow) {
    splash::trace("first page drawn");
    reveal(&app, &window);
}

pub fn run() {
    splash::trace("program started");
    // (A test build can be given its own identity at build time, to run next to the installed app)
    let id: &str = option_env!("APNA_TEST_IDENTIFIER").unwrap_or("in.apnabilling.admin");
    // Only the first copy starts anything: a second one just brings the first forward (single-instance plugin)
    let first = splash::first_instance(id) && !splash::already_running(id);
    // The relay is ready in a few milliseconds: it starts before anything else, so the window can open on the panel
    let relay_started = if first { SERVER_URL.map(start_relay) } else { None };
    splash::trace("relay listening");
    let dark = saved_theme() == Some("dark");
    let start_screen = if first {
        splash::show(splash::Style {
            title: "Apna Billing Admin",
            background: if dark { 0x1A1A1C } else { 0xF1F5F9 },
            text: if dark { 0xF2F2F3 } else { 0x0F172A },
            track: if dark { 0x303034 } else { 0xE2E8F0 },
            accent: 0x6366F1,
            size: (1280.0, 800.0),
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
        .manage(Services(Mutex::new(Vec::new())))
        .manage(release::Running::default())
        .manage(StartScreen(Mutex::new(start_screen)))
        .invoke_handler(tauri::generate_handler![
            app_ready,
            admin_set_theme,
            release::release_info,
            release::release_run,
            release::release_file,
            release::release_answer,
            release::release_stop,
            release::release_open
        ])
        .setup(move |app| {
            splash::trace("framework ready");
            // If the panel has not said it is ready by then, the window is shown anyway
            let slow = app.handle().clone();
            let wait = if place.is_some() { SHOW_ANYWAY_AFTER_START_SCREEN } else { SHOW_ANYWAY_AFTER };
            std::thread::spawn(move || {
                std::thread::sleep(wait);
                if let Some(w) = slow.get_webview_window("main") {
                    if !STARTUP_FAILED.load(Ordering::SeqCst) {
                        reveal(&slow, &w);
                    }
                }
            });
            // Production: the window is made directly on the relay (already listening). Development (and a failure
            // to start the relay) opens the built-in start page first and moves on when the panel is up.
            let relay_started = relay_started.or_else(|| SERVER_URL.map(start_relay));
            let (first_url, hook, relay_failed) = match &relay_started {
                Some(Ok((port, hook))) => (
                    WebviewUrl::External(format!("http://127.0.0.1:{port}").parse().expect("valid url")),
                    Some(hook.clone()),
                    None,
                ),
                Some(Err(msg)) => (WebviewUrl::App("index.html".into()), None, Some(msg.clone())),
                None => (WebviewUrl::App("index.html".into()), None, None),
            };
            let direct = hook.is_some();
            let (shown, start_screen) = mpsc::channel::<()>();
            let shown = Mutex::new(Some(shown));
            let mut builder = WebviewWindowBuilder::new(app, "main", first_url);
            // A side-by-side test build keeps its own window storage too (never the installed app's)
            if option_env!("APNA_TEST_IDENTIFIER").is_some() {
                builder = builder.data_directory(app_data_dir().join("webview"));
            }
            let builder = builder
                .title("Apna Admin")
                .min_inner_size(960.0, 640.0)
                .decorations(false)
                .shadow(true)
                .visible(false)
                .background_color(if saved_theme() == Some("dark") { Color(26, 26, 28, 255) } else { Color(241, 245, 249, 255) }) // the panel's background
                // No swipe-to-go-back or pinch zoom from the touchpad (like the billing app), and keep drawing while
                // the start screen covers the window (otherwise it would appear unpainted)
                .additional_browser_args(
                    "--disable-features=msOverscrollHistoryNavigation,OverscrollHistoryNavigation,CalculateNativeWinOcclusion --disable-pinch",
                )
                // The start screen (tauri.localhost) and the panel only
                .on_navigation(|u| matches!(u.host_str(), Some("127.0.0.1") | Some("localhost") | Some("tauri.localhost")))
                .on_page_load(move |_, page| {
                    if page.event() == PageLoadEvent::Finished {
                        if let Some(tx) = shown.lock().unwrap().take() {
                            let _ = tx.send(());
                        }
                    }
                });
            let builder = match place {
                Some((x, y, w, h)) => builder.position(x, y).inner_size(w, h),
                None => builder.inner_size(1280.0, 800.0).center(),
            };
            let window = builder.build()?;
            splash::trace("window created");

            // A newer panel on the server: once its first file has been kept, the window reloads into it, as long as
            // the app has only just opened (later, it is used the next time the app opens)
            if let Some(hook) = hook {
                let (w, launched) = (window.clone(), Instant::now());
                *hook.lock().unwrap() = Some(Box::new(move || {
                    if launched.elapsed() < Duration::from_secs(10) {
                        let _ = w.eval("location.reload()");
                    }
                }));
            }

            if direct {
                return Ok(());
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let started = match (relay_failed, SERVER_URL) {
                    (Some(msg), _) => Err(msg),
                    (None, Some(_)) => Err("Could not start the connection to the server.".to_string()),
                    (None, None) => start_services().map(|children| {
                        *handle.state::<Services>().0.lock().unwrap() = children;
                        PANEL_PORT
                    }),
                };
                match started {
                    Ok(port) => {
                        let _ = start_screen.recv_timeout(Duration::from_secs(3));
                        let url: tauri::Url = format!("http://127.0.0.1:{port}").parse().expect("valid url");
                        let _ = window.navigate(url);
                    }
                    Err(msg) => {
                        // Hidden, not closed: closing the last window would quit before the message is read
                        STARTUP_FAILED.store(true, Ordering::SeqCst);
                        if let Some(s) = handle.state::<StartScreen>().0.lock().unwrap().take() {
                            s.close();
                        }
                        let _ = window.hide();
                        handle
                            .dialog()
                            .message(&msg)
                            .title("Apna Billing Admin could not start")
                            .kind(MessageDialogKind::Error)
                            .blocking_show();
                        handle.exit(1);
                    }
                }
            });
            Ok(())
        })
        .build(context)
        .expect("error while building Apna Billing Admin")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_services(app);
                release::stop_on_exit(app);
            }
        });
}
