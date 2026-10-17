//! Keeping a Web API token on disk and fresh.
//!
//! Two tokens exist in Starless and confusing them is the classic bug in every
//! client of this kind:
//!
//! - **librespot's session token**, which authenticates the *streaming*
//!   connection. librespot owns it, refreshes it itself, and we never see it.
//! - **a Web API token**, which is what `api.spotify.com/v1` requires. This one is
//!   ours, it expires in about an hour, and nobody else will renew it for us.
//!
//! [`super::webapi`] refuses to make a request without a token from here.

use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::auth;

#[derive(Serialize, Deserialize, Clone)]
pub struct StoredToken {
    pub access_token: String,
    /// Long-lived. A refresh token is only ever issued if the original
    /// authorisation asked for offline access, so its absence is normal enough
    /// to handle rather than to panic over.
    #[serde(default)]
    pub refresh_token: String,
    /// Unix seconds.
    ///
    /// librespot's own `OAuthToken.expires_at` is an `Instant`, which counts from
    /// an arbitrary origin and is meaningless once the process restarts. Storing
    /// the remaining lifetime as wall-clock seconds is what survives.
    pub expires_at: u64,
    /// Needed to refresh: the refresh exchange is made *as* this app.
    pub client_id: String,
}

/// Treat a token that is about to expire as already expired. Refreshing at the
/// last moment means racing the request it was supposed to authorise.
const SKEW_SECONDS: u64 = 90;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl StoredToken {
    pub fn from_oauth(token: &librespot_oauth::OAuthToken, client_id: &str) -> Self {
        // `Instant` has no epoch, so take what we can from it: how long is left.
        let remaining = token
            .expires_at
            .saturating_duration_since(Instant::now())
            .as_secs();
        Self {
            access_token: token.access_token.clone(),
            refresh_token: token.refresh_token.clone(),
            expires_at: now_secs() + remaining,
            client_id: client_id.to_string(),
        }
    }

    pub fn is_fresh(&self) -> bool {
        now_secs().saturating_add(SKEW_SECONDS) < self.expires_at
    }
}

/// In-memory cache in front of the file, so a burst of screen loads does not
/// mean a burst of refreshes.
#[derive(Default)]
pub struct TokenState(pub Mutex<Option<StoredToken>>);

impl TokenState {
    pub fn get(&self) -> Option<StoredToken> {
        self.0.lock().ok().and_then(|g| g.clone())
    }

    pub fn set(&self, token: StoredToken) {
        // Write first. If the disk is full or the profile is read-only, that is a
        // real problem the next launch should not inherit silently — and moving
        // the value into the guard before saving would lose it either way.
        let _ = save(&token);
        if let Ok(mut guard) = self.0.lock() {
            *guard = Some(token);
        }
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.0.lock() {
            *guard = None;
        }
        let _ = delete();
    }
}

fn path() -> Result<PathBuf, String> {
    Ok(auth::cache_dir()?.join("web_token.json"))
}

pub fn save(token: &StoredToken) -> Result<(), String> {
    let path = path()?;
    let json = serde_json::to_string_pretty(token)
        .map_err(|e| auth::fail("token_write_failed", e))?;
    std::fs::write(&path, json).map_err(|e| auth::fail("token_write_failed", e))
}

pub fn load() -> Option<StoredToken> {
    let path = path().ok()?;
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn delete() -> Result<(), String> {
    let path = path()?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        // Already gone is the state we wanted.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(auth::fail("token_write_failed", e)),
    }
}

/// A valid token, refreshing it first if the stored one is close to expiry.
///
/// Blocking: the refresh is an HTTP round trip. Call from a blocking thread.
pub fn ensure_fresh(state: &TokenState) -> Result<StoredToken, String> {
    if let Some(token) = state.get() {
        if token.is_fresh() {
            return Ok(token);
        }
        if token.refresh_token.is_empty() {
            // Nothing to renew with. Saying so plainly beats handing back a
            // token that will fail on the next request with a 401.
            return Err("login_expired".to_string());
        }
        let client = librespot_oauth::OAuthClientBuilder::new(
            &token.client_id,
            auth::REDIRECT_URI,
            auth::SCOPES.to_vec(),
        )
        .build()
        .map_err(|e| auth::fail("oauth_unavailable", e))?;
        let refreshed = client
            .refresh_token(&token.refresh_token)
            .map_err(|e| auth::fail("token_refresh_failed", e))?;
        let stored = keep_refresh_token(StoredToken::from_oauth(&refreshed, &token.client_id), &token);
        state.set(stored.clone());
        return Ok(stored);
    }

    // Say so, loudly. This is the one failure whose cause is invisible from
    // outside — no HTTP request happened, so there is nothing in the network and
    // nothing in the UI to explain it. Without this line, "sign in first" on a
    // session that is demonstrably signed in is indistinguishable from a bug in
    // the login flow, which is where two hours went looking in the wrong place.
    log::error!("[not_signed_in]: sin token de Web API en memoria");
    Err("not_signed_in".to_string())
}

/// How long a blocking caller should be allowed to hang before we assume the
/// network is not there. Long enough for a slow AP, short enough that a dead
/// connection does not leave a spinner up forever.
pub const NETWORK_TIMEOUT: Duration = Duration::from_secs(20);

/// Carry the refresh token forward when a refresh response does not include one.
///
/// A refresh exchange is allowed to answer with a bare access token. When it does,
/// the token already on disk is still the live one — Spotify invalidates the old
/// refresh token only when it issues a replacement. Writing the empty answer over
/// it is how this session died once: the refresh succeeded, the app played for an
/// hour, and at the next expiry there was nothing left to renew with. `ensure_fresh`
/// then answered `login_expired` and the only way out was signing in again, which is
/// the one thing nobody should have to do because a clock ran down.
///
/// Split out from [`ensure_fresh`] so it can be tested without a network round trip.
fn keep_refresh_token(fresh: StoredToken, previous: &StoredToken) -> StoredToken {
    if fresh.refresh_token.is_empty() {
        return StoredToken {
            refresh_token: previous.refresh_token.clone(),
            ..fresh
        };
    }
    fresh
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(access: &str, refresh: &str) -> StoredToken {
        StoredToken {
            access_token: access.to_string(),
            refresh_token: refresh.to_string(),
            expires_at: 0,
            client_id: "cliente".to_string(),
        }
    }

    #[test]
    fn a_refresh_without_a_refresh_token_keeps_the_one_on_disk() {
        let out = keep_refresh_token(stored("nuevo", ""), &stored("viejo", "el-bueno"));
        assert_eq!(out.access_token, "nuevo");
        assert_eq!(out.refresh_token, "el-bueno");
    }

    #[test]
    fn a_rotated_refresh_token_replaces_the_old_one() {
        let out = keep_refresh_token(stored("nuevo", "otro"), &stored("viejo", "el-bueno"));
        assert_eq!(out.refresh_token, "otro");
    }

    /// An empty string carried forward is still empty: this only ever preserves,
    /// it never invents a way back into a session that never had one.
    #[test]
    fn nothing_is_invented_when_there_was_nothing_before() {
        let out = keep_refresh_token(stored("nuevo", ""), &stored("viejo", ""));
        assert!(out.refresh_token.is_empty());
    }
}