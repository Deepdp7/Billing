//! Apna Billing licensing core, compiled into a Node-API module that the packaged engine loads at startup.
//!
//! Holds the license-verification public key (compiled in by build.rs) and decides what a stored license allows:
//! token signature and format, clock-tamper detection, license/device status, expiry, offline grace and per-feature
//! entitlements. It always enforces; there is no switch to turn licensing off.
//!
//! Mirrors server/src/licensing/token.ts and evaluateLicense() in licenseClient.ts, which stay in use for development
//! and tests. Keep the two in step.

use std::collections::HashMap;

use base64::alphabet;
use base64::engine::{DecodePaddingMode, Engine, GeneralPurpose, GeneralPurposeConfig};
use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, SecondsFormat, TimeZone, Utc};
use ed25519_dalek::{Signature, VerifyingKey};
use napi::{Error, Result, Status};
use napi_derive::napi;
use serde_json::Value;
use sha2::{Digest, Sha256};

include!(concat!(env!("OUT_DIR"), "/license_key.rs"));

const CLOCK_TOLERANCE_MS: f64 = 60.0 * 60.0 * 1000.0;
const MAX_SEEN_STEP_MS: f64 = 60_000.0;

const B64URL: GeneralPurpose = GeneralPurpose::new(
    &alphabet::URL_SAFE,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

type TokenResult = std::result::Result<Value, (&'static str, &'static str)>;

/// JavaScript truthiness for a JSON value (`undefined` is `None`).
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

fn str_of(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str)
}

/// `Date.parse` for the ISO-8601 forms the license server writes. NaN when unparseable, as in JavaScript.
fn parse_date(s: &str) -> f64 {
    if let Ok(d) = DateTime::parse_from_rfc3339(s) {
        return d.timestamp_millis() as f64;
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return d.and_hms_opt(0, 0, 0).map(|t| t.and_utc().timestamp_millis() as f64).unwrap_or(f64::NAN);
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
        if let Ok(t) = NaiveDateTime::parse_from_str(s, fmt) {
            return Local.from_local_datetime(&t).earliest().map(|d| d.timestamp_millis() as f64).unwrap_or(f64::NAN);
        }
    }
    f64::NAN
}

fn date_of(v: Option<&Value>) -> f64 {
    str_of(v).map(parse_date).unwrap_or(f64::NAN)
}

/// `Math.max` (NaN wins, unlike f64::max).
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

fn iso(ms: f64) -> Option<String> {
    Utc.timestamp_millis_opt(ms as i64).single().map(|d| d.to_rfc3339_opts(SecondsFormat::Millis, true))
}

/// Token format: base64url(JSON payload) + "." + base64url(Ed25519 signature over the first part).
fn verify_with(key: &[u8; 32], token: &str) -> TokenResult {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 2 {
        return Err(("TOKEN_MALFORMED", "License token is malformed"));
    }
    let (body, sig) = (parts[0], parts[1]);
    let valid = VerifyingKey::from_bytes(key).ok().zip(B64URL.decode(sig).ok()).is_some_and(|(vk, sig)| {
        Signature::from_slice(&sig).is_ok_and(|sig| vk.verify_strict(body.as_bytes(), &sig).is_ok())
    });
    if !valid {
        return Err(("TOKEN_SIGNATURE_INVALID", "License signature is invalid"));
    }
    let payload: Value = B64URL
        .decode(body)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .ok_or(("TOKEN_MALFORMED", "License payload is unreadable"))?;
    let v_is_1 = payload.get("v").and_then(Value::as_f64) == Some(1.0);
    if !v_is_1 || !truthy(payload.get("iid")) || !truthy(payload.get("iat")) || !truthy(payload.get("exp")) {
        return Err(("TOKEN_MALFORMED", "License payload is incomplete"));
    }
    Ok(payload)
}

#[napi(object)]
pub struct LicenseInput {
    pub token: Option<String>,
    pub installation_id: Option<String>,
    pub max_seen_time: Option<String>,
    /// Current time, epoch milliseconds.
    pub now: f64,
    pub feature_keys: Vec<String>,
}

#[napi(object)]
pub struct LicenseEvaluation {
    pub mode: String,
    pub can_write: bool,
    /// Verified payload as JSON, when the stored token is valid for this installation.
    pub payload_json: Option<String>,
    pub features: HashMap<String, bool>,
    pub feature_expiry: HashMap<String, Option<String>>,
    /// New "latest time seen" to store (clock-tamper detection), when it moved forward.
    pub store_max_seen_time: Option<String>,
}

fn evaluate_with(key: &[u8; 32], input: &LicenseInput) -> LicenseEvaluation {
    let now = input.now;
    let mut payload: Option<Value> = None;
    let mut mode = "ACTIVE";

    match (input.token.as_deref(), input.installation_id.as_deref()) {
        (Some(token), Some(iid)) if !token.is_empty() && !iid.is_empty() => match verify_with(key, token) {
            Ok(p) if str_of(p.get("iid")) == Some(iid) => payload = Some(p),
            _ => mode = "INVALID",
        },
        _ => mode = "UNLICENSED",
    }

    let mut store_max_seen_time = None;
    if let Some(p) = &payload {
        let iat = date_of(p.get("iat"));
        let stored = input.max_seen_time.as_deref().filter(|s| !s.is_empty()).map(parse_date).unwrap_or(0.0);
        let max_seen = js_max(iat, stored);
        let status = str_of(p.get("status")).unwrap_or("");
        let device = str_of(p.get("installationStatus")).unwrap_or("");
        let expires = p.get("licenseExpiresAt");
        mode = if now + CLOCK_TOLERANCE_MS < max_seen {
            "CLOCK_TAMPERED"
        } else if device == "DEACTIVATED" {
            "DEACTIVATED"
        } else if status == "REVOKED" {
            "REVOKED"
        } else if status == "SUSPENDED" || device == "SUSPENDED" {
            "SUSPENDED"
        } else if status == "EXPIRED" || (truthy(expires) && now > date_of(expires)) {
            "EXPIRED"
        } else if now > date_of(p.get("exp")) {
            "GRACE_EXPIRED"
        } else {
            "ACTIVE"
        };
        if mode != "CLOCK_TAMPERED" && now > max_seen + MAX_SEEN_STEP_MS {
            store_max_seen_time = iso(now);
        }
    }

    let mut features = HashMap::new();
    let mut feature_expiry = HashMap::new();
    for k in &input.feature_keys {
        let f = payload.as_ref().and_then(|p| p.get("features")).and_then(|fs| fs.get(k));
        let expires_at = f.and_then(|f| f.get("expiresAt"));
        let enabled = truthy(f.and_then(|f| f.get("enabled"))) && (!truthy(expires_at) || now < date_of(expires_at));
        features.insert(k.clone(), payload.is_some() && enabled);
        if payload.is_some() {
            feature_expiry.insert(k.clone(), str_of(expires_at).map(str::to_string));
        }
    }

    LicenseEvaluation {
        mode: mode.to_string(),
        can_write: mode == "ACTIVE",
        payload_json: payload.map(|p| p.to_string()),
        features,
        feature_expiry,
        store_max_seen_time,
    }
}

/// Verify a license token with the embedded public key. Returns the payload as JSON; errors read "CODE: message".
#[napi]
pub fn verify_license_token(token: String) -> Result<String> {
    verify_with(&LICENSE_PUBLIC_KEY, &token)
        .map(|p| p.to_string())
        .map_err(|(code, msg)| Error::new(Status::InvalidArg, format!("{code}: {msg}")))
}

/// Decide what the stored license allows right now (always enforced).
#[napi]
pub fn evaluate_license(input: LicenseInput) -> LicenseEvaluation {
    evaluate_with(&LICENSE_PUBLIC_KEY, &input)
}

#[napi(object)]
pub struct CoreInfo {
    pub version: String,
    /// First 16 hex characters of SHA-256 over the embedded public key (to confirm which key a build carries).
    pub key_id: String,
}

#[napi]
pub fn core_info() -> CoreInfo {
    let digest = Sha256::digest(LICENSE_PUBLIC_KEY);
    CoreInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        key_id: digest.iter().take(8).map(|b| format!("{b:02x}")).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;

    const DAY: f64 = 86_400_000.0;
    const KEYS: [&str; 3] = ["billing", "reports_advanced", "pharmacy"];

    fn signing() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn sign(payload: &Value, key: &SigningKey) -> String {
        let body = B64URL.encode(payload.to_string());
        format!("{body}.{}", B64URL.encode(key.sign(body.as_bytes()).to_bytes()))
    }

    fn payload(now: f64) -> Value {
        json!({
            "v": 1, "iid": "inst-1", "lid": "lic-1", "cid": "c", "customerName": "T", "licenseKeyHint": "ABCD",
            "type": "TRIAL", "plan": { "code": "TRIAL", "name": "Trial" }, "status": "ACTIVE", "installationStatus": "ACTIVE",
            "licenseExpiresAt": iso(now + 7.0 * DAY),
            "features": { "billing": { "enabled": true }, "reports_advanced": { "enabled": false },
                          "pharmacy": { "enabled": true, "expiresAt": iso(now + DAY) } },
            "maxDevices": 1, "graceDays": 7, "iat": iso(now), "exp": iso(now + 7.0 * DAY),
        })
    }

    fn eval(p: &Value, now: f64, max_seen: Option<String>) -> LicenseEvaluation {
        let key = signing().verifying_key().to_bytes();
        evaluate_with(&key, &LicenseInput {
            token: Some(sign(p, &signing())),
            installation_id: Some("inst-1".into()),
            max_seen_time: max_seen,
            now,
            feature_keys: KEYS.iter().map(|s| s.to_string()).collect(),
        })
    }

    fn now() -> f64 {
        Utc::now().timestamp_millis() as f64
    }

    #[test]
    fn active_license_and_features() {
        let t = now();
        let r = eval(&payload(t), t, None);
        assert_eq!(r.mode, "ACTIVE");
        assert!(r.can_write);
        assert_eq!(r.features["billing"], true);
        assert_eq!(r.features["reports_advanced"], false);
        assert_eq!(r.features["pharmacy"], true);
        assert!(r.feature_expiry["pharmacy"].is_some());
        // Temporary feature access lapses at its expiry time.
        let later = eval(&payload(t), t + 2.0 * DAY, None);
        assert_eq!(later.features["pharmacy"], false);
    }

    #[test]
    fn tampered_or_foreign_tokens_are_invalid() {
        let t = now();
        let key = signing().verifying_key().to_bytes();
        let token = sign(&payload(t), &signing());
        let (body, sig) = token.split_once('.').unwrap();
        let mut forged = payload(t);
        forged["type"] = json!("PAID");
        let forged = format!("{}.{sig}", B64URL.encode(forged.to_string()));
        assert_eq!(verify_with(&key, &forged).unwrap_err().0, "TOKEN_SIGNATURE_INVALID");
        assert_eq!(verify_with(&key, body).unwrap_err().0, "TOKEN_MALFORMED");
        let other = SigningKey::from_bytes(&[9u8; 32]);
        assert_eq!(verify_with(&key, &sign(&payload(t), &other)).unwrap_err().0, "TOKEN_SIGNATURE_INVALID");

        let mut wrong_install = payload(t);
        wrong_install["iid"] = json!("someone-else");
        let r = eval(&wrong_install, t, None);
        assert_eq!(r.mode, "INVALID");
        assert!(!r.can_write && r.payload_json.is_none() && r.features.values().all(|v| !v));
    }

    #[test]
    fn statuses_in_priority_order() {
        let t = now();
        let with = |k: &str, v: Value| {
            let mut p = payload(t);
            p[k] = v;
            eval(&p, t, None).mode
        };
        assert_eq!(with("installationStatus", json!("DEACTIVATED")), "DEACTIVATED");
        assert_eq!(with("status", json!("REVOKED")), "REVOKED");
        assert_eq!(with("status", json!("SUSPENDED")), "SUSPENDED");
        assert_eq!(with("installationStatus", json!("SUSPENDED")), "SUSPENDED");
        assert_eq!(with("licenseExpiresAt", json!(iso(t - 1000.0))), "EXPIRED");
        assert_eq!(with("exp", json!(iso(t - 1000.0))), "GRACE_EXPIRED");
        assert_eq!(with("licenseExpiresAt", Value::Null), "ACTIVE");
    }

    #[test]
    fn clock_turned_back_is_detected_and_time_seen_moves_forward() {
        let t = now();
        let r = eval(&payload(t), t - 2.0 * DAY, None);
        assert_eq!(r.mode, "CLOCK_TAMPERED");
        assert!(r.store_max_seen_time.is_none());
        let r = eval(&payload(t), t, iso(t + 3.0 * DAY));
        assert_eq!(r.mode, "CLOCK_TAMPERED");
        let r = eval(&payload(t - DAY), t, None);
        assert_eq!(r.mode, "ACTIVE");
        assert_eq!(r.store_max_seen_time, iso(t));
    }

    #[test]
    fn missing_activation_is_unlicensed() {
        let r = evaluate_with(&[0u8; 32], &LicenseInput {
            token: None,
            installation_id: None,
            max_seen_time: None,
            now: now(),
            feature_keys: vec!["billing".into()],
        });
        assert_eq!(r.mode, "UNLICENSED");
        assert_eq!(r.features["billing"], false);
    }

    #[test]
    fn dates_parse_like_javascript() {
        assert_eq!(parse_date("2026-11-02T10:00:00.000Z"), 1_793_613_600_000.0);
        assert_eq!(parse_date("2026-11-02"), 1_793_577_600_000.0);
        assert!(parse_date("not a date").is_nan());
        assert!(js_max(f64::NAN, 1.0).is_nan());
    }
}
