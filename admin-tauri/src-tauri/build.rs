use std::path::PathBuf;
use std::{env, fs};

/// Production builds (python deploy/apna_vps.py admin-app) set APNA_ADMIN_SERVER_URL and APNA_ADMIN_SERVER_CA: the
/// app then opens the Admin Panel on that server and trusts only that certificate. Without them it is the
/// development shell for the local license server.
fn main() {
    println!("cargo:rerun-if-env-changed=APNA_ADMIN_SERVER_URL");
    println!("cargo:rerun-if-env-changed=APNA_ADMIN_SERVER_CA");
    if let Ok(url) = env::var("APNA_ADMIN_SERVER_URL") {
        assert!(url.starts_with("https://"), "APNA_ADMIN_SERVER_URL must use https://");
    }
    let pem = match env::var("APNA_ADMIN_SERVER_CA") {
        Ok(path) if !path.is_empty() => {
            println!("cargo:rerun-if-changed={path}");
            let pem = fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"));
            assert!(pem.contains("BEGIN CERTIFICATE") && !pem.contains("PRIVATE KEY"), "{path} must be a public certificate");
            pem
        }
        _ => String::new(),
    };
    fs::write(PathBuf::from(env::var("OUT_DIR").unwrap()).join("server_ca.pem"), pem).unwrap();
    // App commands the window may call (window ready, the theme, and the build parts of Updates & Releases); each gets an
    // "allow-<name>" permission granted in capabilities/default.json.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "app_ready",
        "admin_set_theme",
        "release_info",
        "release_run",
        "release_file",
        "release_answer",
        "release_stop",
        "release_open",
    ])))
    .expect("failed to run tauri-build")
}
