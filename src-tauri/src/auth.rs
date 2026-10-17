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

/// Optional override for the **Web API** client id. Set it in the environment
/// before launching to get your own API quota instead of the shared one.
pub const CLIENT_ID_ENV: &str = "STARLESS_SPOTIFY_CLIENT_ID";

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
/// redirect URI too. This is why the two flows below do not share a port.
pub const STREAMING_REDIRECT_URI: &str = "http://127.0.0.1:8989/login";

/// The redirect URI for a client id you registered yourself. Must appear,
/// character for character, in your app's dashboard allowlist; a trailing slash
/// is a different URI and the exchange fails with an opaque error.
///
/// `librespot-oauth` takes the port out of this and binds its callback server to
/// it, so this is a port Starless opens locally, and only during login.
pub const REDIRECT_URI: &str = "http://127.0.0.1:8898/login";

/// `streaming` is the scope that actually unlocks audio. Without it login
/// succeeds and then every track fails to load, which is a far more confusing
/// failure than refusing to log in at all.
///
/// The `playlist-modify-*` pair is what lets Starless add a song to a playlist.
/// Read scopes and write scopes are separate grants on Spotify's side: an app
/// approved for `playlist-read-private` can look at a playlist all day and still
/// get a bare `403` the first time the user asks to change one. The 403 arrives at
/// the moment of the click, with no hint that the problem is the login that
/// happened yesterday.
///
/// Adding a scope invalidates the stored grant, so the next launch asks again.
/// That is the honest cost of a permission the user actually granted.
pub const SCOPES: &[&str] = &[
    "streaming",
    "user-read-email",
    "user-read-private",
    "user-library-read",
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-public",
    "playlist-modify-private",
];

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

/// Starless's own client id, for `api.spotify.com`.
///
/// **This one really is ours**, and it is what the Web API runs on. The reason it
/// is pinned in the binary rather than left to an environment variable is that the
/// shared identity is not a viable default: its quota belongs to every other project
/// that borrowed it, and a saturated quota answers `429` to a perfectly valid
/// token. An app that silently depends on someone else's rate limit is an app that
/// breaks on a schedule it does not control.
///
/// Not a secret — PKCE needs no client secret — and overridable with
/// [`CLIENT_ID_ENV`] if you register your own.
pub const OWN_CLIENT_ID: &str = "1eb651591f7f47138047f88a846547b1";

/// The client id for `api.spotify.com`.
///
/// Always present. It is not the streaming identity, and the two are never
/// interchangeable — see [`SHARED_CLIENT_ID`] and [`session_config`].
pub fn api_client_id() -> String {
    env_or(CLIENT_ID_ENV).unwrap_or_else(|| OWN_CLIENT_ID.to_string())
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

/// Run the browser exchanges and hand back a connecting session plus the Web API
/// token that goes with it.
///
/// **The token is returned, not saved.** `TokenState::set` is the one and only
/// place a token enters the app, because it writes the file *and* the in-memory
/// copy in the same step. Saving the file from here instead would leave the cache
/// the API commands actually read empty until the next launch — and the symptom is
/// an app that just logged in successfully and then reports "sign in first" on
/// every request.
///
/// **Two identities, and two browser approvals.** The streaming session has to
/// present a client id that `clienttoken.spotify.com` accepts, and that is not one
/// you can register yourself — see [`SHARED_CLIENT_ID`]. The Web API token is
/// separate and belongs to Starless's own app, so that library calls run on a quota
/// nobody else is spending.
///
/// If the two client ids are made to match — [`STARLESS_STREAMING_CLIENT_ID`]
/// pointed at [`OWN_CLIENT_ID`] — the user is asked exactly once. That is the only
/// case where they are safe to collapse, and it is a debugging affordance, not a
/// supported configuration.
///
/// Blocking. Call it from a blocking thread.
pub fn login_interactively() -> Result<(Session, crate::token::StoredToken), String> {
    let streaming_client_id = streaming_client_id();
    let api_client_id = api_client_id();

    let streaming_token = pkce(&streaming_client_id, STREAMING_REDIRECT_URI)?;

    let cache = open_cache()?;
    let session = Session::new(session_config(&streaming_client_id), Some(cache));
    start_connect(
        &session,
        Credentials::with_access_token(streaming_token.access_token.clone()),
    );

    // Two tokens, two jobs, and they are never interchangeable: the streaming one
    // is the only one that plays audio, the Web API one is the only one on our own
    // quota. Two approvals is the honest cost of that — asking once would mean
    // borrowing the shared quota, and that quota is routinely saturated.
    let web_token = if api_client_id == streaming_client_id {
        crate::token::StoredToken::from_oauth(&streaming_token, &streaming_client_id)
    } else {
        let api_token = pkce(&api_client_id, REDIRECT_URI)?;
        crate::token::StoredToken::from_oauth(&api_token, &api_client_id)
    };

    Ok((session, web_token))
}

/// Drop the cached credentials and invalidate the session.
///
/// librespot decides what a sign-out means, so this is only as strong as the
/// cache it clears: it is not a server-side revocation.
pub fn forget_credentials() -> Result<(), String> {
    let dir = cache_dir()?;
    std::fs::remove_dir_all(&dir).map_err(|e| fail("signout_failed", e))
}