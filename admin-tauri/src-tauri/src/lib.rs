//! Apna Billing Admin desktop shell.
//!
//! Run three processes in separate terminals (from the Billing folder):
//!   1. `npm run dev:license`  — license API on :7000
//!   2. `npm run dev:admin`    — this shell (+ admin panel on :3100)
//!   3. `npm run dev:app`      — customer billing desktop app
//!
//! Closing the Admin window stops only the panel process this app started.

use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

struct Services(Mutex<Vec<Child>>);

const LICENSE_PORT: u16 = 7000;
const PANEL_PORT: u16 = 3100;

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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Services(Mutex::new(Vec::new())))
        .setup(|app| {
            let children = match start_services() {
                Ok(v) => v,
                Err(msg) => {
                    app.dialog()
                        .message(&msg)
                        .title("Apna Billing Admin could not start")
                        .kind(MessageDialogKind::Error)
                        .blocking_show();
                    return Err(msg.into());
                }
            };
            *app.state::<Services>().0.lock().unwrap() = children;

            let url: tauri::Url = format!("http://127.0.0.1:{PANEL_PORT}").parse().expect("valid url");
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Apna Admin")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 640.0)
                .decorations(false)
                .shadow(true)
                .center()
                .on_navigation(|u| matches!(u.host_str(), Some("127.0.0.1") | Some("localhost")))
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Apna Billing Admin")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_services(app);
            }
        });
}
