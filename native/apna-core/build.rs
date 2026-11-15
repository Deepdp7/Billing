//! Embeds the license-verification public key. The single source of truth is server/src/licensing/publicKey.ts,
//! which `npm --prefix license-server run keys:generate` rewrites; the key is compiled in, never read at runtime.

use base64::Engine;
use std::{env, fs, path::PathBuf};

/// DER prefix of an Ed25519 SubjectPublicKeyInfo; the 32-byte key follows it.
const ED25519_SPKI_PREFIX: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];

fn main() {
    napi_build::setup();

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let source = manifest.join("../../server/src/licensing/publicKey.ts");
    println!("cargo:rerun-if-changed={}", source.display());
    let text = fs::read_to_string(&source).unwrap_or_else(|e| panic!("cannot read {}: {e}", source.display()));
    let begin = text.find("-----BEGIN PUBLIC KEY-----").expect("no PEM public key in publicKey.ts");
    let end = text.find("-----END PUBLIC KEY-----").expect("unterminated PEM public key in publicKey.ts");
    let b64: String = text[begin + 26..end].chars().filter(|c| !c.is_whitespace()).collect();
    let der = base64::engine::general_purpose::STANDARD.decode(b64).expect("public key is not valid base64");
    assert!(der.len() == 44 && der[..12] == ED25519_SPKI_PREFIX, "publicKey.ts must hold an Ed25519 public key");

    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("license_key.rs");
    fs::write(out, format!("pub const LICENSE_PUBLIC_KEY: [u8; 32] = {:?};\n", &der[12..])).unwrap();
}
