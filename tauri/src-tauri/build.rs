use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::path::PathBuf;
use std::{env, fs};

/// The data key (see scripts/prepare.cjs) is compiled in XOR-masked with a fresh random mask on every build, so the
/// executable never contains it as a plain byte string.
fn embed_data_key(out: &PathBuf) {
    println!("cargo:rerun-if-env-changed=APNA_DATA_KEY_FILE");
    let file = env::var("APNA_DATA_KEY_FILE").map(PathBuf::from).unwrap_or_else(|_| {
        let home = env::var("USERPROFILE").or_else(|_| env::var("HOME")).expect("no home folder");
        PathBuf::from(home).join(".apna-billing").join("data.key")
    });
    println!("cargo:rerun-if-changed={}", file.display());
    let hex = fs::read_to_string(&file)
        .unwrap_or_else(|_| panic!("{} is missing - run \"node scripts/prepare.cjs\" first", file.display()));
    let hex = hex.trim();
    assert!(hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()), "{} must hold 64 hex characters", file.display());
    let key: Vec<u8> = (0..32).map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap()).collect();
    let mask: Vec<u8> = (0..4)
        .flat_map(|_| RandomState::new().build_hasher().finish().to_le_bytes())
        .collect();
    let masked: Vec<u8> = key.iter().zip(&mask).map(|(k, m)| k ^ m).collect();
    fs::write(
        out.join("data_key.rs"),
        format!("const DATA_KEY_MASKED: [u8; 32] = {masked:?};\nconst DATA_KEY_MASK: [u8; 32] = {mask:?};\n"),
    )
    .unwrap();
}

/// SHA-256 of every engine file (written by scripts/prepare.cjs), checked before the engine is started.
fn embed_engine_manifest(out: &PathBuf) {
    let file = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("../build/engine-manifest.txt");
    println!("cargo:rerun-if-changed={}", file.display());
    let entries: Vec<(String, String)> = fs::read_to_string(&file)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once("  ").map(|(h, p)| (h.to_string(), p.to_string())))
        .collect();
    fs::write(out.join("engine_manifest.rs"), format!("const ENGINE_MANIFEST: &[(&str, &str)] = &{entries:?};\n")).unwrap();
}

fn main() {
    println!("cargo:rerun-if-env-changed=LICENSE_SERVER_URL");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    embed_data_key(&out);
    embed_engine_manifest(&out);
    // App commands the window may call; each gets an "allow-<name>" permission granted in capabilities/default.json.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["apna_install_update"])),
    )
    .expect("failed to run tauri-build");
}
