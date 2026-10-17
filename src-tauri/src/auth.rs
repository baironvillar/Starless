//! Everything about getting a signed-in session.
//!
//! The shape of this module is a consequence of one hard rule: **no credential
//! ever crosses into the webview.** The frontend asks "am I signed in?" and gets
//! a boolean and a display name. It never sees an access token, a refresh token,
//! or the cookie librespot keeps internally.

use std::path::PathBuf;

use librespot_core::{
    authentication::Credentials,
    cache::Cache,
    config::SessionConfig,
    session::Session,
};

/// The client id Starless presents as a *streaming* client.
///
/// This is deliberately **not** the app you registered in the Spotify developer
/// dashboard, and that is the single most important fact in this file.
///
/// Two Spotify services have to accept the client id, and they do not agree on
/// what counts:
///
/// - **login5** (the handshake) requires the client id to be the one the access
///   token was minted by. A mismatch is `INVALID_CREDENTIALS`.
/// - **clienttoken.spotify.com** — which is what unlocks metadata, audio keys
///   and therefore audio at all — rejects client ids registered after Spotify's
///   November 2024 changes with a bare **HTTP 400**, before any token is even
///   considered. A brand-new dashboard app fails here every single time.
///
/// There is no client id that is simultaneously "yours" and old enough, so the
/// streaming identity is borrowed, exactly the way nCspot, spotify-player and
/// friends do it. `65b708073fc0480ea92a077233ca87bd` is nCspot's; it is
/// registered in extended quota mode and predates those changes, which is why
/// `clienttoken` grants it a token where a fresh app gets a 400.
///
/// It is public, not a secret — PKCE needs no client secret — but it belongs to
/// another project, so it is overridable and replaceable:
/// `STARLESS_STREAMING_CLIENT_ID`.
pub const SHARED_CLIENT_ID: &str = "65b708073fc0480ea92a077233ca87bd";
pub const STREAMING_CLIENT_ID_ENV: &str = "STARLESS_STREAMING_CLIENT_ID";

/// The redirect URI registered for [`SHARED_CLIENT_ID`].
///
/// Spotify compares redirect URIs character for character, and we cannot add one
/// to somebody else's dashboard — so borrowing the client id means borrowing its
/// redirect URI too.
///
/// `librespot-oauth` takes the port out of this and binds its callback server to
/// it, so this is a port Starless opens locally, and only during login.
pub const STREAMING_REDIRECT_URI: &str = "http://127.0.0.1:8989/login";

/// `streaming` is the scope that actually unlocks audio. Without it login
/// succeeds and then every track fails to load, which is a far more confusing
/// failure than refusing to log in at all.
///
/// The read scopes came with the Web API and went with it: the library is read
/// through the session, not through a developer app, so nothing asks Spotify for
/// permission to look at playlists anymore.
pub const SCOPES: &[&str] = &["streaming"];

/// Every error leaving this module is a stable kebab-case code, never prose.
///
/// The UI is bilingual, and translating messages that were written in one
/// language is how an app ends up half-translated with error strings that fit no
/// layout. The human-readable version goes to the log file, where only a
/// developer will ever read it.
pub(crate) fn fail(code: &str, detail: impl std::fmt::Display) -> String {
    // Through `log`, not `eprintln!`: `eprintln!` goes straight to stderr and a
    // GUI app has no stderr to go to, so the one place a human might look — the
    // log file — would be the one place the reason never reached.
    log::error!("[{code}]: {detail}");
    code.to_string()
}

/// The client id the streaming session presents. Never fails: there is always a
/// default, because an app that cannot log in at all is worse than one that logs
/// in as somebody else's client.
pub fn streaming_client_id() -> String {
    env_or(STREAMING_CLIENT_ID_ENV).unwrap_or_else(|| SHARED_CLIENT_ID.to_string())
}

fn env_or(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Where librespot keeps its credential cache, so a second launch does not make
/// the user authorise again.
pub fn cache_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .map(|base| base.join("Starless"))
        .ok_or_else(|| fail("no_data_dir", "dirs::data_dir() returned nothing"))
}

/// Open the credential cache. Three slots, one directory: librespot treats them
/// separately, and this keeps the on-disk shape trivial to inspect.
pub fn open_cache() -> Result<Cache, String> {
    let dir = cache_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| fail("cache_unavailable", format!("create_dir_all({}): {e}", dir.display())))?;
    let path = dir.to_string_lossy().to_string();
    Cache::new(Some(path.as_str()), Some(path.as_str()), Some(path.as_str()), None)
        .map_err(|e| fail("cache_unavailable", e))
}

/// Is there anything on disk that a session could be restored from?
///
/// **The question the login screen actually needs answered.** It used to be
/// answered by "is there a Web API token on disk", which was a proxy for the same
/// question: a machine with nothing saved is what somebody signed out looks like,
/// and one with something saved is what somebody who quit the app looks like.
/// Telling those two apart is the whole reason the field exists — and with the Web
/// API gone there is no token left to be the stand-in, so it asks librespot.
///
/// The `is_dir` guard is not an optimisation. `Cache::new` calls `create_dir_all`,
/// so going through [`open_cache`] on a machine that never logged in would *make*
/// the directory that answering the question is supposed to be checking — and the
/// first check would be measuring the side effect of the check.
pub fn has_cached_credentials() -> bool {
    let Ok(dir) = cache_dir() else {
        return false;
    };
    if !dir.is_dir() {
        return false;
    }
    open_cache().is_ok_and(|cache| cache.credentials().is_some())
}

/// Build a `SessionConfig` for the streaming session.
///
/// **The client id here must be the same one the access token was issued to.
/// This is the single most important line in this file, and getting it wrong is
/// indistinguishable from "this account cannot play music":**
///
/// `librespot_core::login5` builds its request like this:
///
/// ```text
/// let client_id = match OS {
///     "macos" | "windows" => self.session().client_id(),
///     ...
/// };
/// ```
///
/// On Windows the session's own client id is sent *unconditionally*, next to a
/// credential that may have come from somewhere else entirely. So a session
/// presenting Spotify's official desktop id while authenticating with a token
/// minted for our dashboard app is a request that says "app A, proving it is app
/// B". Spotify answers `INVALID_CREDENTIALS` (a `login5.LoginError`, not an
/// audio-key error), every track, forever — and because librespot logs it from a
/// worker thread with no UI attached, the symptom is a click that does nothing.
///
/// The upstream comment above the match says the same thing in its own words:
/// the client id has to be overridden to the one the token came from.
///
/// The device id is set too, because Spotify lists this client in the account's
/// device list and a random one reappears as a new device on every launch.
pub fn session_config(client_id: &str) -> SessionConfig {
    let mut config = SessionConfig::default();
    config.client_id = client_id.to_string();
    config.device_id = "Starless".to_string();
    config
}

/// Start the connection to Spotify's access point in the background.
///
/// librespot's `connect` is the whole authentication handshake and it is async,
/// so it runs on the session's own task spawner rather than on a thread we own.
/// The session is usable — and reports an empty `username()` — until the
/// handshake finishes, which is why callers read the username instead of
/// assuming success.
pub fn start_connect(session: &Session, credentials: Credentials) {
    let owned = session.clone();
    session.spawn(async move {
        if let Err(error) = owned.connect(credentials, true).await {
            log::error!("no se pudo conectar a Spotify: {error}");
        }
    });
}

/// Build a session from whatever is already cached, if anything is.
///
/// The cached credentials were minted for a particular client id, so that id has
/// to be restored with them: see [`session_config`] for why they are inseparable.
pub fn cached_session(cache: &Cache) -> Option<Session> {
    let credentials = cache.credentials()?;
    let client_id = streaming_client_id();
    let session = Session::new(session_config(&client_id), Some(cache.clone()));
    start_connect(&session, credentials);
    Some(session)
}

/// One browser PKCE round trip.
///
/// Blocking: it opens a browser and blocks until the user approves or cancels.
/// Call it from a blocking thread, never from the UI thread.
fn pkce(client_id: &str, redirect_uri: &str) -> Result<librespot_oauth::OAuthToken, String> {
    librespot_oauth::OAuthClientBuilder::new(client_id, redirect_uri, SCOPES.to_vec())
        .open_in_browser()
        .with_custom_message(
            "<!doctype html><meta charset=utf-8>\
             <body style=\"background:#0A0A12;color:#F4F4FA;font:16px system-ui;\
             display:grid;place-items:center;height:100vh;margin:0\">\
             <p>Listo. Vuelve a Starless.</p>",
        )
        .build()
        .map_err(|e| fail("oauth_unavailable", e))?
        .get_access_token()
        .map_err(|e| fail("login_cancelled", e))
}

/// Run the browser exchange and hand back a connecting session.
///
/// **One approval, because there is one identity.** This used to ask twice: one
/// token to play audio and another for the Web API, under a client id of our own.
/// The second one is gone — the library comes from the same session that plays
/// the music, so there is nothing left that needs a second question.
///
/// Blocking. Call it from a blocking thread.
pub fn login_interactively() -> Result<Session, String> {
    let client_id = streaming_client_id();
    let token = pkce(&client_id, STREAMING_REDIRECT_URI)?;

    let cache = open_cache()?;
    let session = Session::new(session_config(&client_id), Some(cache));
    start_connect(
        &session,
        Credentials::with_access_token(token.access_token.clone()),
    );

    Ok(session)
}

/// Drop the cached credentials and invalidate the session.
///
/// librespot decides what a sign-out means, so this is only as strong as the
/// cache it clears: it is not a server-side revocation.
pub fn forget_credentials() -> Result<(), String> {
    let dir = cache_dir()?;
    std::fs::remove_dir_all(&dir).map_err(|e| fail("signout_failed", e))
}