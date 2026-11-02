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
    crate::paths::data_dir()
        .map(|base| base.join("Starless"))
        .ok_or_else(|| fail("no_data_dir", "paths::data_dir() returned nothing"))
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
    // A phone and a computer on one account are two devices, not one. No
    // space: the jam puts the id in a URL path.
    config.device_id = if cfg!(mobile) { "Starless-Android" } else { "Starless" }.to_string();
    // librespot downloads each track into this folder, and its default is
    // unwritable on a phone. See `paths::temp_dir`.
    config.tmp_dir = crate::paths::temp_dir();
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

/// How long to wait for a session to come up before giving up on it.
///
/// Long enough for a handshake on a slow connection, short enough that a
/// machine with no network does not leave the user looking at a spinner.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

/// A session that is **up**, or the reason there is not one.
///
/// **`connect` is awaited, and that is the whole point.** `Session::connect`
/// returns after the transport with Spotify's access point is established, so
/// awaiting it is the difference between a session that exists and a session
/// that can carry a track. [`start_connect`] throws the result away, which is
/// right for a launch — nobody presses play in the first fifty milliseconds —
/// and wrong for a reconnection, where the very next thing that happens is a
/// track being loaded into it.
///
/// **The credential is the account; the session is not.** librespot invalidates
/// the session for good when the connection drops, and there is no way back
/// into it. The reusable credential Spotify handed out is the thing that
/// survives, and it is what the next launch restores from — so a reconnection
/// is the same door the app already walks through, taken a second time.
///
/// Blocking: it waits for the handshake. Call it from a blocking thread.
pub fn connect_now(cache: &Cache) -> Result<Session, String> {
    let credentials = cache
        .credentials()
        .ok_or_else(|| fail("not_signed_in", "no hay credenciales guardadas"))?;
    let client_id = streaming_client_id();
    let session = Session::new(session_config(&client_id), Some(cache.clone()));

    // The handshake runs on the session's own runtime, so the wait happens on
    // a channel and not on a task of ours: `Session::spawn` is the only way in
    // and the future it takes has to be 'static. The error travels as a
    // string so the channel carries nothing that needs to be `Send` for a
    // reason nobody can see.
    let (tx, rx) = std::sync::mpsc::channel();
    let owned = session.clone();
    session.spawn(async move {
        let outcome = owned.connect(credentials, true).await.map_err(|e| e.to_string());
        let _ = tx.send(outcome);
    });

    match rx.recv_timeout(CONNECT_TIMEOUT) {
        Ok(Ok(())) => {
            log::info!("sesión conectada como {}", session.username());
            Ok(session)
        }
        Ok(Err(error)) => {
            session.shutdown();
            Err(fail("connection_failed", error))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            session.shutdown();
            Err(fail("connection_timeout", "el handshake no terminó a tiempo"))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            session.shutdown();
            Err(fail("connection_failed", "la sesión se cayó durante el handshake"))
        }
    }
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
///
/// `on_browser_done` is called once the browser is done with its part, approved
/// or not. **That is the moment the person is looking at "Listo. Vuelve a
/// Starless." instead of at Starless**, so it is the moment the window has to
/// come back to the front by itself: the alternative is a person who has just
/// authorised everything having to go and fetch a window that is hiding behind
/// the browser.
///
/// `open_url` is the phone's way to the browser; the desktop one is inside
/// `librespot-oauth`.
#[cfg(desktop)]
fn pkce(
    client_id: &str,
    redirect_uri: &str,
    _open_url: impl FnOnce(&str),
    on_browser_done: impl FnOnce() + Send + 'static,
) -> Result<String, String> {
    let token = librespot_oauth::OAuthClientBuilder::new(client_id, redirect_uri, SCOPES.to_vec())
        .open_in_browser()
        .with_custom_message(CALLBACK_PAGE)
        .build()
        .map_err(|e| fail("oauth_unavailable", e))?
        .get_access_token()
        .map_err(|e| fail("login_cancelled", e));

    // Called on the way out, approved or abandoned: the browser is done either
    // way and the app has something to say about it. A cancelled login that
    // leaves the window behind the browser is the same silence as a successful
    // one — the message is just the other kind.
    on_browser_done();

    token.map(|token| token.access_token)
}

/// What the browser shows once Spotify sends the person back.
const CALLBACK_PAGE: &str = "<!doctype html><meta charset=utf-8>\
     <body style=\"background:#08080A;color:#F4F5F7;font:16px system-ui;\
     display:grid;place-items:center;height:100vh;margin:0\">\
     <p>Listo. Vuelve a Starless.</p>";

/// The same PKCE round trip, built here because `librespot-oauth` cannot do it
/// on a phone.
///
/// **It opens the browser with the `open` crate, and `open` does not know
/// Android**: it tries `xdg-open` and its cousins, none exist, and the failure
/// happens on a background thread nobody hears. The URL is only printed to
/// stdout, and its listener then waits for a callback with no timeout — so the
/// login hung forever with the port taken. The crate offers no way to get the
/// URL without opening it, so the phone opens it itself (`open_url`, which is
/// `tauri-plugin-opener` and an Android intent) and listens with a deadline.
///
/// The redirect is the same `127.0.0.1:8989`: the browser runs on the same
/// phone, so the loopback is the app's. See `docs/android.md`.
#[cfg(mobile)]
fn pkce(
    client_id: &str,
    redirect_uri: &str,
    open_url: impl FnOnce(&str),
    on_browser_done: impl FnOnce() + Send + 'static,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::time::{Duration, Instant};

    use base64::Engine;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use rand::Rng;
    use rand::distr::Alphanumeric;
    use sha2::{Digest, Sha256};

    // Long enough to type a password and pass a second factor; short enough
    // that an abandoned login gives the port back.
    const DEADLINE: Duration = Duration::from_secs(300);

    let random = |len: usize| -> String {
        rand::rng().sample_iter(&Alphanumeric).take(len).map(char::from).collect()
    };
    let verifier = random(64);
    let state = random(16);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    let auth_url = url::Url::parse_with_params(
        "https://accounts.spotify.com/authorize",
        &[
            ("response_type", "code"),
            ("client_id", client_id),
            ("redirect_uri", redirect_uri),
            ("scope", &SCOPES.join(" ")),
            ("code_challenge_method", "S256"),
            ("code_challenge", &challenge),
            ("state", &state),
        ],
    )
    .map_err(|e| fail("oauth_unavailable", e))?;

    // Listening before the browser opens: a fast approval must find the port.
    let address = url::Url::parse(redirect_uri)
        .ok()
        .and_then(|u| u.socket_addrs(|| None).ok())
        .and_then(|mut addrs| addrs.pop())
        .ok_or_else(|| fail("oauth_unavailable", "el redirect no tiene puerto"))?;
    let listener = TcpListener::bind(address).map_err(|e| fail("oauth_unavailable", e))?;
    listener.set_nonblocking(true).map_err(|e| fail("oauth_unavailable", e))?;

    open_url(auth_url.as_str());

    let started = Instant::now();
    let mut stream = loop {
        match listener.accept() {
            Ok((stream, _)) => break stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if started.elapsed() > DEADLINE {
                    on_browser_done();
                    return Err(fail("login_cancelled", "nadie volvió del navegador"));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                on_browser_done();
                return Err(fail("login_cancelled", e));
            }
        }
    };
    // The accepted socket inherits non-blocking on some platforms.
    let _ = stream.set_nonblocking(false);

    let mut request_line = String::new();
    BufReader::new(&stream)
        .read_line(&mut request_line)
        .map_err(|e| fail("login_cancelled", e))?;
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\n\r\n{}",
        CALLBACK_PAGE.len(),
        CALLBACK_PAGE
    );
    on_browser_done();

    let path = request_line.split_whitespace().nth(1).unwrap_or_default();
    let callback = url::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|e| fail("login_cancelled", e))?;
    let param = |name: &str| {
        callback
            .query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    // A callback that is not ours is not an approval, whatever it carries.
    if param("state").as_deref() != Some(state.as_str()) {
        return Err(fail("login_cancelled", "el state del callback no coincide"));
    }
    let code = param("code")
        .ok_or_else(|| fail("login_cancelled", param("error").unwrap_or_default()))?;

    #[derive(serde::Deserialize)]
    struct Token {
        access_token: String,
    }
    reqwest::blocking::Client::new()
        .post("https://accounts.spotify.com/api/token")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri),
            ("client_id", client_id),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json::<Token>())
        .map(|token| token.access_token)
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
///
/// `open_url` and `on_browser_done` are handed to the browser round trip: see
/// [`pkce`].
pub fn login_interactively(
    open_url: impl FnOnce(&str),
    on_browser_done: impl FnOnce() + Send + 'static,
) -> Result<Session, String> {
    let client_id = streaming_client_id();
    let access_token = pkce(&client_id, STREAMING_REDIRECT_URI, open_url, on_browser_done)?;

    let cache = open_cache()?;
    let session = Session::new(session_config(&client_id), Some(cache));
    start_connect(&session, Credentials::with_access_token(access_token));

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