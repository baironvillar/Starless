// The Tauri side of Starless.
//
// Rule that shapes this whole file: **the webview never holds a credential.** It
// asks whether a session exists and gets a boolean and a display name. Tokens,
// cookies and the librespot session itself stay in Rust. If a future bug ever
// needs the frontend to read a token, that is the bug, not the design.

mod auth;
mod crossfade;
// Named `selftest`, never `diagnostic`: the `diagnostic` crate provides the
// `#[diagnostic::on_unimplemented]` attribute that `#[tauri::command]` expands
// to, and a local module of the same name shadows it at the crate root — which
// breaks every command in this file with an error that points nowhere useful.
mod logging;
mod models;
mod playback;
mod report;
mod selftest;
mod settings;
mod spclient;
mod voice;

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use librespot_core::session::Session;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
// The develop channel builds the same updater as the stable one, pointed at
// another manifest. The trait is what hands out that builder.
use tauri_plugin_updater::UpdaterExt;

use playback::{PlaybackState, PlaybackStatus};
use models::{
    Account, DjMix, DjVoiceEvent, JamSession, Lyrics, Playlist, PlaylistDetails, Track,
};

/// The version a report carries, read from the compiled-in crate metadata.
///
/// `Cargo.toml` is one of the three manifests `scripts/version.ts` keeps in step,
/// and CI fails the build if they drift, so this is the version that actually
/// shipped — the same number `tauri.conf.json` compiled into the binary.
pub fn version_line() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ---------------------------------------------------------------------------
// Crash reporting
// ---------------------------------------------------------------------------

/// The Spotify account name, if there is a session.
///
/// Handed to the scrubber so the account is removed by exact value rather than by
/// pattern. Every shape-based rule here is a guess about what identifying text
/// looks like; this is not a guess, it is the thing itself.
fn account_name(state: &State<SessionState>) -> Option<String> {
    let session = state.0.lock().ok()?;
    let name = session.as_ref().map(|s| s.username().to_string())?;
    (!name.is_empty()).then_some(name)
}

/// Did the run before this one end without being closed?
///
/// Read on the first render, before `mark_session_start` has overwritten the
/// marker — that ordering is what makes the answer describe the previous session
/// rather than this one.
#[tauri::command]
fn previous_session_crashed() -> bool {
    report::previous_session_crashed()
}

/// The report as it would be sent, already scrubbed, so the person deciding can
/// read exactly what would leave the machine.
#[tauri::command]
fn crash_report_preview(state: State<SessionState>) -> String {
    report::preview(report::Kind::Crash, "", true, account_name(&state).as_deref())
}

/// Send it. With a token compiled in this creates the issue outright; without one
/// it hands back a pre-filled URL for the caller to open.
///
/// Async, and the send happens on a blocking thread. A Tauri command without
/// `async` runs on the main thread, and this one makes an HTTP request with a
/// twenty second timeout — a frozen window with no explanation is what that looks
/// like, on the one screen where the user is already reporting something broken.
#[tauri::command]
async fn submit_crash_report(app: AppHandle) -> Result<report::ReportOutcome, String> {
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SessionState>();
        report::submit(report::Kind::Crash, "", true, account_name(&state).as_deref())
    })
    .await
    .map_err(|e| {
        log::error!("[crash_report_failed]: {e}");
        "crash_report_failed".to_string()
    })??;

    // Reported or dismissed, this crash is dealt with. Leaving the marker would
    // make the same prompt reappear on every launch from here on.
    report::acknowledge();
    Ok(outcome)
}

/// The same preview, for something the user chose to write rather than a crash.
#[tauri::command]
fn feedback_report_preview(
    message: String,
    attach_log: bool,
    topic: String,
    state: State<SessionState>,
) -> String {
    report::preview(
        report::Kind::from_topic(&topic),
        &message,
        attach_log,
        account_name(&state).as_deref(),
    )
}

/// Send feedback. Same path as a crash report, because "send me this and nothing
/// else" should not be two different buttons with two different disclosure rules.
///
/// Async for the same reason as [`submit_crash_report`]: it is the same HTTP
/// round trip, and it must not run on the thread that draws the window.
#[tauri::command]
async fn submit_feedback(
    app: AppHandle,
    message: String,
    attach_log: bool,
    topic: String,
) -> Result<report::ReportOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SessionState>();
        report::submit(
            report::Kind::from_topic(&topic),
            &message,
            attach_log,
            account_name(&state).as_deref(),
        )
    })
    .await
    .map_err(|e| {
        log::error!("[feedback_report_failed]: {e}");
        "feedback_report_failed".to_string()
    })?
}

/// The user said no, or dealt with it later. Either way: never again.
#[tauri::command]
fn dismiss_crash_report() {
    report::acknowledge();
}

/// A session that is about to end on purpose, announced in advance.
///
/// The updater hands the installer to Windows from inside `downloadAndInstall`
/// and the process is gone before the runner's `Exit` event can be heard, so the
/// marker survives and the next launch greets someone with a crash report about
/// an update that did exactly what it was asked. This is the one clean exit the
/// app can announce before it happens, so it is the one it announces.
///
/// Cheap enough to be a plain command: one file, removed, on the main thread.
#[tauri::command]
fn announce_clean_exit() {
    log::info!("salida anunciada: la actualización se lleva la sesión");
    report::mark_session_end();
}

/// What the webview could not do, written where the log keeps it.
///
/// **A failure in the webview used to live only in the console.** The console
/// is a window nobody opens, and the log —the one thing the app can show and
/// the report can carry— said nothing about it. An update that does not install
/// is the failure a person is most likely to report, and it was the one that
/// left no trace: the button said "the download failed" and nobody could say
/// why.
#[tauri::command]
fn log_frontend_error(message: String) {
    log::error!("webview: {message}");
}

/// The develop channel's manifest, turned into something that can be installed.
///
/// **The same updater, pointed at another door.** The plugin's own `check`
/// reads the endpoint baked into `tauri.conf.json` — the stable channel — and
/// nothing else. The prerelease needs the same machinery (the signature is
/// checked in Rust against the key embedded in this binary, and the download
/// is the same one), but pointed at a manifest we chose.
///
/// **Why this cannot live in the frontend.** An `Update` in the plugin's
/// JavaScript is a handle to a resource that lives in Rust: without the `rid`
/// this command returns, there is nothing to download and nothing to install.
/// A frontend that fetched a manifest and built an `Update` out of the JSON
/// would look like it worked and fail at the download — an install button on
/// screen that installs nothing, which is the exact confusion this row exists
/// to prevent.
///
/// **The door is narrow on purpose.** The endpoint decides what gets installed
/// on this machine, and the webview is not the one that gets to decide that:
/// only a manifest served from this repository's own releases is accepted.
fn is_our_manifest(url: &tauri::Url) -> bool {
    url.host_str() == Some("github.com")
        && url
            .path()
            .starts_with("/baironvillar/Starless/releases/download/")
}

#[derive(serde::Deserialize)]
struct GithubTag {
    name: String,
}

#[derive(serde::Deserialize)]
struct GithubRelease {
    prerelease: bool,
    draft: bool,
    assets: Vec<GithubAsset>,
}

#[derive(serde::Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

/// The GitHub API, with the one header it insists on.
///
/// **Without a `User-Agent` the API answers `403` and nothing else.** The URL
/// is right, the answer is right, and the body says the request was refused
/// before it was read. `reqwest` sends exactly the headers it is told to
/// send, and nobody told it: it does not add one on its own. So a client
/// built without this header asks GitHub a question that is turned down at the
/// door — and the develop channel was asking exactly that question, which is
/// why the button said "GitHub could not be reached" about a GitHub that was
/// perfectly reachable.
fn github_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("starless/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

/// The commit this build was compiled from.
///
/// **It is compiled in, and that is the whole point.** The question "is the
/// public release me?" cannot be answered by asking around: the answer is
/// needed exactly when GitHub is not answering, and an updater that guesses is
/// an updater that offers to install the build somebody is already running —
/// which is what the public 0.5.4 did, forever.
///
/// It is `None` in a build made without a checkout and without the variable
/// set. That is not a failure: it means the app cannot tell the two apart, and
/// it keeps the door open — which is what it did before this existed.
const BUILD_COMMIT: Option<&str> = option_env!("STARLESS_COMMIT");

/// The commit of the newest public release.
///
/// **The release record carries it.** GitHub keeps `target_commitish` on every
/// release: the commit it was cut from. That commit is the build inside the
/// release, so it is the one thing that can say whether the public release is
/// *this* build or another one that happens to carry the same version number.
///
/// **A branch is not a commit.** The field can hold a branch name, and a branch
/// is not a build: comparing it with a sha would say "different" for every
/// release, and the loop would come back every time.
async fn public_release_commit(client: &reqwest::Client) -> Result<Option<String>, String> {
    const REPO: &str = "baironvillar/Starless";

    let response = client
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if is_rate_limited(&response) {
        return Err("rate_limited".to_string());
    }
    if !response.status().is_success() {
        return Ok(None);
    }
    let release: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(release
        .get("target_commitish")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| is_commit_sha(value)))
}

/// Whether a string is a commit sha.
///
/// **Forty hex characters: that is what a commit is.** Anything else is not
/// compared, because a wrong answer here is worse than no answer: it would
/// hide the door back to the public line from the people who need it.
fn is_commit_sha(value: &str) -> bool {
    value.len() == 40 && value.chars().all(|c| c.is_ascii_hexdigit())
}

/// Whether GitHub refused because the hourly budget is spent.
///
/// The header is what tells the two apart; the reading of it is
/// [`is_spent_budget`].
fn is_rate_limited(response: &reqwest::Response) -> bool {
    is_spent_budget(
        response.status(),
        response
            .headers()
            .get("x-ratelimit-remaining")
            .and_then(|value| value.to_str().ok()),
    )
}

/// Whether a 403 means the budget is spent, and not something else.
///
/// **A 403 is two different things.** The API answers 403 to a request without
/// a `User-Agent` — a bug that does not go away — and also to a request that
/// used up the hourly budget — a thing that happens. From the outside they
/// look the same: a 403 with a body that says "forbidden" and nothing else.
/// The header `x-ratelimit-remaining` tells them apart: if it says zero, it
/// was not a mistake of the app but an empty purse.
///
/// **The difference is the one the person sees.** "GitHub could not be reached"
/// and "GitHub ran out of queries for this machine" are two different facts,
/// and the second one has an ending: the budget comes back. With the same
/// sentence for both, the button looks broken and only is.
fn is_spent_budget(status: reqwest::StatusCode, remaining: Option<&str>) -> bool {
    status == reqwest::StatusCode::FORBIDDEN && remaining == Some("0")
}

/// The manifest of the newest prerelease that is really published.
///
/// **The tags, not the list of releases.** The list is an index, and an index
/// can be behind: the release exists and the list that points at it is updated
/// a few minutes later, which is exactly when somebody presses the button. The
/// tags are the refs, and they exist from the moment the tag is pushed. So
/// the walk goes through them — newest first — and each one is asked for by
/// name, which is a direct read and not a lookup in a list.
///
/// **A tag without a release is a normal thing to find.** It is a tag that was
/// pushed and whose release is still a draft, and drafts are invisible to
/// everybody but the owner. It is skipped, not treated as a failure.
///
/// The cost is a request per candidate instead of one for everything, and
/// there are sixty requests per hour and per address. This is a button
/// somebody presses, not something the app polls, so the answer is worth
/// more than the request.
async fn find_prerelease_manifest(
    client: &reqwest::Client,
) -> Result<Option<tauri::Url>, String> {
    const REPO: &str = "baironvillar/Starless";

    let response = client
        .get(format!("https://api.github.com/repos/{REPO}/tags?per_page=10"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if is_rate_limited(&response) {
        return Err("rate_limited".to_string());
    }
    let tags: Vec<GithubTag> = response
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    for tag in tags.iter().take(6) {
        let response = client
            .get(format!(
                "https://api.github.com/repos/{REPO}/releases/tags/{}",
                urlencoding::encode(&tag.name)
            ))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        // A tag without a release is a normal thing to find, not a failure.
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            continue;
        }
        if is_rate_limited(&response) {
            return Err("rate_limited".to_string());
        }
        let release: GithubRelease = response
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        if release.draft || !release.prerelease {
            continue;
        }

        let Some(manifest) = release.assets.iter().find(|a| a.name == "latest.json") else {
            continue;
        };
        let Ok(endpoint) = tauri::Url::parse(&manifest.browser_download_url) else {
            continue;
        };
        if !is_our_manifest(&endpoint) {
            return Err("invalid_manifest_url".to_string());
        }
        return Ok(Some(endpoint));
    }

    Ok(None)
}

/// The develop channel, resolved in Rust.
///
/// **Everything the channel needs happens here, and that is not a style
/// choice.** The webview used to ask GitHub for the releases and then fetch
/// the manifest itself, and the second of those never worked: the manifest
/// lives behind a redirect to `release-assets.githubusercontent.com`, and that
/// answer carries no CORS headers, so the browser stopped the request before
/// a byte arrived. From here the manifest is a URL the backend hands to the
/// updater, and Rust has no CORS.
///
/// **The discovery is here for the same reason.** The tags and the releases
/// come from the API, which does allow cross-origin reads — but it allows
/// sixty of them per hour and per address, and a button that a person
/// presses is not the place to spend that budget.
///
/// **The comparison is left to the webview.** The updater is asked for the
/// update whatever the versions say, because "you are already running it" is
/// an answer too, and only the frontend knows what is installed.
#[tauri::command]
async fn check_prerelease_manifest(
    webview: tauri::Webview,
) -> Result<Option<serde_json::Value>, String> {
    let client = github_client()?;
    let Some(endpoint) = find_prerelease_manifest(&client).await? else {
        return Ok(None);
    };

    let updater = webview
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        // The comparison is not this command's business: the webview says
        // what is installed, and "you are already on it" is an answer.
        .version_comparator(|_, _| true)
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else {
        return Ok(None);
    };

    // The fields are read before the update is handed to the resource table:
    // adding it moves it, and a moved value is not a value.
    let current_version = update.current_version.clone();
    let version = update.version.clone();
    let body = update.body.clone();
    let raw_json = update.raw_json.clone();
    // **The webview's table, and not the app's.** They are two different
    // tables: Tauri gives every webview its own, and the plugin's
    // `download_and_install` looks the update up in the one belonging to the
    // webview that asked for it. An update registered in the app's table is a
    // handle to nothing —and that is exactly what the prerelease channel was
    // doing since 0.5.0: the button appeared, the download never started, and
    // the only thing the person was told was "the download failed".
    let rid = webview.resources_table().add(update);

    // The body is left out when there is none: the plugin's `Update` takes an
    // optional string, and a `null` where it expects "absent" is a type error
    // in the webview.
    let mut metadata = serde_json::json!({
        "rid": rid,
        "currentVersion": current_version,
        "version": version,
        "rawJson": raw_json,
    });
    if let Some(body) = body {
        metadata["body"] = serde_json::Value::String(body);
    }
    Ok(Some(metadata))
}

/// The public channel, resolved in Rust, with the comparison left to the
/// webview.
///
/// **The same deal as the develop channel, and for the same reason.** The
/// plugin's own check only answers when the version numbers differ, and the
/// two numbers can be equal while the programs are not: the public 0.5.3 and
/// the develop 0.5.3 are two different builds that carry the same number. A
/// build of `develop` that has never seen the public one is told it is up to
/// date, and the door back to the public line is closed for it.
///
/// The endpoint is not written here: the builder already carries the one from
/// `tauri.conf.json`, and writing it a second time is a second thing to
/// forget. The signature is still the one embedded in the app, because the
/// builder brings it too.
///
/// **And the answer says whether the public release is this very build.** That
/// is what ends the loop: a public release built from `develop` ships the same
/// binary the person is running, and offering to install it is offering to
/// install what is already there —forever, because installing it changes
/// nothing. The two commits are compared, not the two version numbers.
#[derive(Serialize)]
struct PublicChannel {
    /// The public release, when there is one to install.
    update: Option<serde_json::Value>,
    /// Whether the public release is this build.
    same_build: bool,
}

#[tauri::command]
async fn check_public_manifest(webview: tauri::Webview) -> Result<PublicChannel, String> {
    let client = github_client()?;

    // **The comparison is the commit, and the commit is the only thing that
    // tells two builds apart.** The version numbers can be equal while the
    // programs are different; the commits cannot.
    let same_build = match public_release_commit(&client).await {
        Ok(Some(public)) => BUILD_COMMIT == Some(public.as_str()),
        // Without both commits there is nothing to compare, and the door stays
        // open. The door is a feature: the only thing worse than offering it
        // wrongly is not offering it at all.
        _ => false,
    };

    let updater = webview
        .updater_builder()
        // The comparison is not this command's business: the webview says what
        // is installed, and "you are already on it" is an answer.
        .version_comparator(|_, _| true)
        .build()
        .map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    let Some(update) = update else {
        return Ok(PublicChannel {
            update: None,
            same_build,
        });
    };

    // The fields are read before the update is handed to the resource table:
    // adding it moves it, and a moved value is not a value.
    let current_version = update.current_version.clone();
    let version = update.version.clone();
    let body = update.body.clone();
    let raw_json = update.raw_json.clone();
    // **The webview's table, for the same reason as the prerelease one.** The
    // door back to the public line is installed by the same plugin, and the
    // plugin looks the update up where the webview that asked for it keeps
    // its resources.
    let rid = webview.resources_table().add(update);

    let mut metadata = serde_json::json!({
        "rid": rid,
        "currentVersion": current_version,
        "version": version,
        "rawJson": raw_json,
    });
    if let Some(body) = body {
        metadata["body"] = serde_json::Value::String(body);
    }
    Ok(PublicChannel {
        update: Some(metadata),
        same_build,
    })
}

/// Development only: plant a crashed session on disk so the crash flow can be
/// walked without crashing.
///
/// The command stays in the handler list in every build, because `generate_handler!`
/// has no way to drop one entry without building two different closures and
/// boxing the result — a small piece of ceremony that would put a dev tool one
/// careless edit away from a release build. So the guard lives in the body: a
/// release build compiles the planting away entirely and answers with an error, and
/// the button that calls this does not exist in a release frontend either. Two
/// independent gates, because the one that matters is the one that is checked.
#[tauri::command]
fn simulate_crash() -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        report::simulate_crash()
    }
    #[cfg(not(debug_assertions))]
    {
        Err("esto sólo existe en una build de desarrollo".into())
    }
}

/// The live streaming session, if any. `Mutex` because `Session` is not `Sync`.
#[derive(Default)]
pub struct SessionState(Mutex<Option<Session>>);

/// How long a session may take to appear before the machine counts as signed out.
///
/// **The restore is a thread, and a thread takes a moment.** The session shows up
/// in the slot as soon as the credentials are read from the cache, and the
/// credentials are there —the machine signed in before. Three seconds is a
/// hundred times what the read costs, and it is short enough that a signed-out
/// machine answers at once instead of hanging.
const SESSION_SLOT_WAIT: std::time::Duration = std::time::Duration::from_secs(3);

/// How long the handshake may take before the wait gives up.
///
/// **The handshake is the network talking to Spotify.** A good connection takes
/// half a second; a bad one takes seconds. `auth::connect_now` waits twenty
/// for the same handshake, so twenty is the number the app already believes.
const SESSION_HANDSHAKE_WAIT: std::time::Duration = std::time::Duration::from_secs(20);

impl SessionState {
    /// The session, once it can actually carry a request.
    ///
    /// **A session that exists is not a session that works.** librespot fills the
    /// username in as the last step of the handshake, and until then the spclient
    /// answers "tried to acquire token without stored credentials" — a refusal
    /// that says nothing about the call that asked for it. So the wait is for the
    /// username and not for the slot.
    ///
    /// **The wait lives here and not in the frontend.** The commands used to fail
    /// and the frontend retried them with a backoff: the first retry came four
    /// seconds later, and the library — the first thing anybody looks at — took
    /// five and a half seconds to appear. Waiting costs the milliseconds the
    /// handshake takes and nothing else, and the failure never leaves the
    /// backend at all.
    ///
    /// Blocking: it sleeps. Call it from a blocking thread.
    pub fn ready(&self) -> Result<Session, String> {
        let started = std::time::Instant::now();

        // The session has to exist before it can be ready.
        let session = loop {
            if let Some(session) = self.0.lock().ok().and_then(|guard| guard.clone()) {
                break session;
            }
            if started.elapsed() >= SESSION_SLOT_WAIT {
                return Err("no_session".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        };

        // And then it has to be authenticated.
        let deadline = std::time::Instant::now() + SESSION_HANDSHAKE_WAIT;
        while session.username().is_empty() {
            if std::time::Instant::now() >= deadline {
                return Err("no_session".to_string());
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        Ok(session)
    }
}

/// The session, once it can carry a request.
///
/// **The handle is cloned because the wait happens on another thread.** A
/// `State` borrows the app it came from, and a closure that outlives the
/// function it was written in cannot hold that borrow. The clone is cheap and
/// the wait is where it belongs: a blocking thread, never the main one.
async fn ready_session(app: &AppHandle) -> Result<Session, String> {
    let owned = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = owned.state::<SessionState>();
        state.ready()
    })
    .await
    .map_err(|e| {
        eprintln!("Starless [command_failed]: {e}");
        "command_failed".to_string()
    })?
}

/// Where the DJ's session is, and what it still has to say.
///
/// **The cursor lives in the backend on purpose.** It is the service's own
/// address for the next page —with its segment and its request— and the
/// webview is not the place that has to know how to follow it. One DJ at a
/// time: the account has one, and a second click replaces the first.
///
/// **The phrases are kept by song.** The DJ opens a stretch with one and closes
/// it with another, and the service hangs each of them on a song: the first and
/// the last. They are said *before* that song, so the app has to hold them
/// until the song is about to sound: a page arrives two songs before the queue
/// empties, and saying the phrase then would be talking over the song that is
/// playing.
#[derive(Default)]
pub struct DjState(Mutex<DjSession>);

#[derive(Default)]
struct DjSession {
    /// Where the session continues.
    next: Option<String>,
    /// The phrases the DJ still has to say, by song.
    voices: HashMap<String, crate::voice::VoiceParams>,
    /// The audio that was asked for in advance, by song.
    ///
    /// **Making the audio takes a couple of seconds** —it is another service that
    /// makes it— and the page that brings the phrase arrives five songs before
    /// the queue empties. Asking for it when the page arrives leaves it ready
    /// for the moment the song starts: the DJ takes the turn without a hole in
    /// the middle.
    audio: HashMap<String, Vec<u8>>,
}

/// Where the radio is, and how it continues.
///
/// **The cursor lives in the backend on purpose**, like the DJ's: it is the
/// service's own address for the next page —with its salt and the tracks it
/// already played— and the webview is not the place that has to know how to
/// follow it.
///
/// **And it is a separate state from the DJ's, on purpose.** Both are stations
/// and both keep going, but each one follows its own cursor: if they shared it,
/// the DJ would follow the radio's cursor and the service would answer with the
/// radio's tracks as if they were the DJ's own mix.
#[derive(Default)]
pub struct RadioState(Mutex<RadioSession>);

#[derive(Default)]
struct RadioSession {
    /// Where the station continues.
    next: Option<String>,
}

/// Everything the login screen needs to decide what to show, and nothing else.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    /// There are cached credentials, so a session can be restored without asking.
    ///
    /// This used to be hardcoded `true` — there was always a client id compiled
    /// in — which meant the field carried one piece of information for two readers
    /// and the second one read a lie. It now asks the question it names: a machine
    /// with nothing saved is what somebody signed out looks like, and one with
    /// something saved is what somebody who quit the app looks like. Telling those
    /// two apart is the whole reason this field exists.
    ///
    /// **It says nothing about whether a login is possible.** The streaming client
    /// id is always there, so a login is always possible; `false` is the ordinary
    /// answer on a machine that has never signed in, and the UI must not read it as
    /// "this build cannot log in" — that mistake greys out the only button on the
    /// screen, on exactly the machine that needs it.
    pub configured: bool,
    /// The streaming session exists.
    pub signed_in: bool,
    /// Display name only. Never the account's email, never a token.
    pub username: Option<String>,
    /// A kebab-case error code, never a sentence. See `AuthGate`'s `AUTH_ERRORS`.
    pub detail: Option<String>,
}

#[tauri::command]
fn auth_status(session_state: State<SessionState>) -> AuthStatus {
    let guard = match session_state.0.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return AuthStatus {
                configured: true,
                signed_in: false,
                username: None,
                detail: Some("session_busy".into()),
            };
        }
    };

    let username = guard.as_ref().map(|s| s.username()).unwrap_or_default();

    AuthStatus {
        // Asked of librespot, not assumed. See the field's doc: this answers
        // "is there something to restore", and nothing about whether a login is
        // possible — the streaming client id is always there.
        configured: auth::has_cached_credentials(),
        // librespot fills the username in as the last step of the handshake, so an
        // empty one means "connected to nothing yet", not "no session".
        signed_in: !username.is_empty(),
        username: (!username.is_empty()).then_some(username),
        detail: None,
    }
}

/// Put the window back in front of the person.
///
/// **Windows does not hand the foreground to a background process for free.**
/// `SetForegroundWindow` is refused unless the caller owns the foreground, and
/// during a login the browser owns it. `tao` does the work around that: it
/// tries `SetForegroundWindow` first and, when Windows says no, it sends the
/// ALT key to unlock the foreground lock and tries again. The result is a
/// window that comes back on its own even though another program is in front.
///
/// The un-minimize comes first because `tao` refuses to focus a minimized
/// window: raising one does nothing at all, and "the app is running but nothing
/// happened" is the exact silence this is here to avoid.
///
/// From the backend, not from the webview: the window permissions this needs are
/// not in `capabilities/default.json`, and the backend already has the handle.
fn bring_to_front(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Open the browser, wait for the approval, and come back with a session.
///
/// The wait is user-paced — it blocks until they finish in the browser — so it
/// runs on a blocking thread and the window stays responsive the whole time.
#[tauri::command]
async fn begin_login(
    app: AppHandle,
    session_state: State<'_, SessionState>,
) -> Result<AuthStatus, String> {
    // The browser takes the foreground for the approval, and the person is
    // looking at it when it answers "Listo. Vuelve a Starless." — so the window
    // comes back by itself the moment the browser is done, instead of waiting
    // to be clicked.
    let window = app.clone();
    let session = tauri::async_runtime::spawn_blocking(move || {
        auth::login_interactively(move || bring_to_front(&window))
    })
    .await
    .map_err(|e| {
        log::error!("[login_task_failed]: {e}");
        "login_task_failed".to_string()
    })??;

    // Same reasoning as the restore path: the device is opened while the handshake
    // completes, so the first song after signing in is not the thing that pays for it.
    playback::warm_audio_device(&app, session.clone());

    let username = session.username();

    let status = AuthStatus {
        // Read it rather than asserting it. The credentials librespot writes are
        // what the next launch restores from, and the app used to report success
        // without ever checking that the write had happened.
        configured: auth::has_cached_credentials(),
        // The handshake has not finished yet; librespot fills the username in
        // when it does. Reporting success here would be a lie the UI would repeat.
        signed_in: !username.is_empty(),
        username: (!username.is_empty()).then_some(username),
        detail: None,
    };

    // Shut the old session down before installing the new one. Signing in while
    // already signed in used to just overwrite the slot, which left the previous
    // session connected to Spotify's access point with its keepalive running.
    //
    // Two live sessions for one account is not a cosmetic leak: both are competing
    // for the same audio keys, and the loser decodes another session's bytes. What
    // that looks like from the app is a track that streams four and a half megabytes
    // and then dies in the MP3 decoder, reported as "Spotify did not deliver this
    // song" — which sends everyone looking at Spotify instead of here.
    if let Ok(mut guard) = session_state.0.lock() {
        if let Some(previous) = guard.replace(session) {
            log::info!("cierro la sesion anterior antes de instalar la nueva");
            previous.shutdown();
        }
    } else {
        return Err("session_busy".to_string());
    }

    log::info!("login completo: session={}", status.signed_in);
    Ok(status)
}

/// Forget the cached credentials and drop the live session.
#[tauri::command]
fn sign_out(
    app: AppHandle,
    session_state: State<SessionState>,
    playback_state: State<PlaybackState>,
) -> Result<(), String> {
    // Hand the audio device back before dropping the session it was decoding for.
    playback::shutdown(&playback_state);
    if let Ok(mut guard) = session_state.0.lock() {
        if let Some(session) = guard.take() {
            session.shutdown();
        }
    }
    auth::forget_credentials()?;

    // Announce it. The webview used to find out by reloading the whole window, and
    // that reload is exactly what left stale library queries behind: it fired once
    // more between the session dropping and the page going away, cached its
    // `not_signed_in`, and depending on timing either lost that cache or kept it.
    // The gate now listens for this instead of guessing.
    let _ = app.emit(
        "auth://status",
        AuthStatus {
            // The credentials are gone by the time this is emitted, so `false` is
            // read back rather than assumed — `forget_credentials` is what deleted
            // them and it can fail.
            configured: auth::has_cached_credentials(),
            signed_in: false,
            username: None,
            detail: None,
        },
    );
    Ok(())
}

// --- The account's own data -------------------------------------------------

/// Run a library read off the UI thread, against the streaming session.
///
/// **One macro for every command that reads the account's data, and the reason it
/// is one is the shape they share, not that they are alike.** `spclient` makes
/// network trips, and a Tauri command without `async` runs on the main thread — a
/// blocking HTTP call there is thirty seconds of frozen window. So each one hops to
/// `spawn_blocking` first.
///
/// The input is the thing that actually changed: these used to take a Web API
/// access token, and now they take librespot's session. That is why the macro is
/// not a leftover from `webapi_command` — that one is gone, along with the token it
/// refreshed.
///
/// The lock is taken inside the blocking thread and not here: `State` cannot move
/// to a blocking thread, and the session can — but the *wait* for it cannot, so
/// the state is reached through the app handle instead.
///
/// **The wait is the point.** These commands used to fail when they arrived
/// before the handshake, and the frontend retried them with a backoff: the first
/// retry came four seconds later, and the library — the first thing anybody
/// looks at — took five and a half seconds to appear. Now the command waits the
/// half second the handshake takes and answers with the library.
macro_rules! spclient_command {
    ($name:ident, $inner:path, $ty:ty $(, $arg:ident : $arg_ty:ty)*) => {
        #[tauri::command]
        async fn $name(app: AppHandle $(, $arg: $arg_ty)*) -> Result<$ty, String> {
            let started = std::time::Instant::now();
            let result = tauri::async_runtime::spawn_blocking(move || {
                let state = app.state::<SessionState>();
                let session = state.ready()?;
                $inner(&session $(, &$arg)*)
            })
            .await
            .map_err(|e| {
                eprintln!("Starless [command_failed]: {e}");
                "command_failed".to_string()
            })?;

            // **The time is in the log because the time is the complaint.**
            // "Loading the library is slow" is not a bug report anybody can
            // act on; "the library took two and a half seconds" is. The number
            // covers the wait for the session too, so the two costs can be
            // told apart.
            log::info!(
                "spclient: {} tardó {} ms",
                stringify!($name),
                started.elapsed().as_millis()
            );
            Ok(result?)
        }
    };
}

spclient_command!(account, spclient::account, Account);
spclient_command!(my_playlists, spclient::playlists, Vec<Playlist>);
spclient_command!(liked_tracks, spclient::liked_tracks, Vec<Track>);
spclient_command!(playlist_tracks, spclient::playlist_tracks, Vec<Track>, playlist_id: String);
spclient_command!(search_tracks, spclient::search_tracks, Vec<Track>, query: String);
spclient_command!(lyrics, spclient::lyrics, Lyrics, track_id: String);

// El jam: la sesión compartida.
//
// **No es una playlist: es una sesión, y el servicio no se llama jam.** Se
// llama `social-connect`, y sus rutas no lo dicen. El protocolo entero —lo que
// hay, lo que no, y cómo se midió— está en `docs/jam.md`.
//
// Los tres comandos son las tres puertas que se midieron: abrir, entrar y
// cerrar. **Abrir es un `GET` que crea la sesión si no había**, así que el
// botón del panel es el que decide que exista una.
//
// Cada uno salta a un hilo de bloqueo antes de hablar con la red: un comando
// `async` que hace un viaje HTTP en el hilo principal congela la ventana
// treinta segundos.
#[tauri::command]
async fn jam_start(app: AppHandle) -> Result<JamSession, String> {
    let session = ready_session(&app).await?;

    tauri::async_runtime::spawn_blocking(move || spclient::jam_session(&session, true))
        .await
        .map_err(|e| {
            eprintln!("Starless [command_failed]: {e}");
            "command_failed".to_string()
        })?
}

/// Entrar a un jam con su código.
#[tauri::command]
async fn jam_join(app: AppHandle, token: String) -> Result<JamSession, String> {
    let session = ready_session(&app).await?;

    tauri::async_runtime::spawn_blocking(move || spclient::jam_join(&session, &token))
        .await
        .map_err(|e| {
            eprintln!("Starless [command_failed]: {e}");
            "command_failed".to_string()
        })?
}

/// Leer la sesión, sin abrir ninguna.
///
/// **Es la misma puerta que abre la sesión, pero sin activarla.** El jam no
/// tiene pubsub en librespot —el `dealer` no lo tiene—, así que la única
/// forma de saber quién se unió es preguntar cada tanto.
///
/// **La puerta crea la sesión si no hay ninguna**, y por eso el panel la usa
/// solo mientras tiene una sesión en la mano: si la respuesta trae otra
/// sesión, la que tenía ya no está y el panel lo dice en vez de adoptarla.
#[tauri::command]
async fn jam_status(app: AppHandle) -> Result<JamSession, String> {
    let session = ready_session(&app).await?;

    tauri::async_runtime::spawn_blocking(move || spclient::jam_session(&session, false))
        .await
        .map_err(|e| {
            eprintln!("Starless [command_failed]: {e}");
            "command_failed".to_string()
        })?
}

/// La cola compartida del jam: las canciones que el servicio tiene escrita.
///
/// **La cola es una lista**, y se lee por el servicio de listas —que habla
/// protobuf— y no por la biblioteca.
#[tauri::command]
async fn jam_queue(app: AppHandle, session_id: String) -> Result<Vec<Track>, String> {
    let session = ready_session(&app).await?;

    tauri::async_runtime::spawn_blocking(move || spclient::jam_queue(&session, &session_id))
        .await
        .map_err(|e| {
            eprintln!("Starless [command_failed]: {e}");
            "command_failed".to_string()
        })?
}

/// Salir del jam.
///
/// **Salir y cerrar no son la misma puerta.** Salir es un `POST` a
/// `…/sessions/<id>/leave`, y es la puerta de un invitado: lo saca de la
/// sesión y deja la sesión viva. Cerrar —borrar la sesión— es un `DELETE` a
/// `…/sessions/<id>`, y es del anfitrión: sin él, la sesión queda abierta en
/// la cuenta de quien la abrió.
///
/// **El que aprieta "salir" en el jam que él abrió cierra el jam para todos**,
/// y por eso el comando hace las dos cosas cuando quien aprieta es el
/// anfitrión: primero sale, y después la borra. La segunda puede contestar
/// `404` —la sesión ya no está— y eso no es un fallo: es lo que se quería.
#[tauri::command]
async fn jam_leave(app: AppHandle, session_id: String, is_owner: bool) -> Result<(), String> {
    let session = ready_session(&app).await?;

    tauri::async_runtime::spawn_blocking(move || {
        spclient::jam_leave(&session, &session_id)?;

        if is_owner {
            // Si la sesión ya no está, `jam_end` lo cuenta como un aviso.
            if let Err(e) = spclient::jam_end(&session, &session_id) {
                log::warn!("spclient: la sesión {session_id} no se pudo borrar: {e}");
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| {
        eprintln!("Starless [command_failed]: {e}");
        "command_failed".to_string()
    })?
}

// El DJ: las canciones que Spotify le fabricó a la cuenta, y lo que dice al
// empezar.
//
// Es una lectura como las otras, pero por otra puerta: la playlist del DJ está
// vacía y su contenido lo materializa el servicio de las "jellyfish cards".
// Lo que vuelve son las canciones —reproducibles— y la frase del DJ, que
// llega como texto y no como voz.
//
// **Y es una sesión, no una lista.** El DJ sigue: la primera página trae diez
// canciones y un `next_page_url`, y el servicio tiene más. El cursor vive
// acá, en el backend, y no en el frontend: es la dirección interna del
// servicio, y no es cosa del webview.
#[tauri::command]
async fn dj_mix(
    app: AppHandle,
    dj_state: State<'_, DjState>,
    playlist_id: String,
) -> Result<DjMix, String> {
    let session = ready_session(&app).await?;

    // **La sesión del DJ no se reinicia: se sigue.**
    //
    // El primer pedido del servicio devuelve la línea de tiempo *desde el
    // principio*, y siempre arranca por la misma canción: pedirlo otra vez
    // devuelve las mismas —medido, cinco pedidos seguidos y una hora después
    // seguían dando la misma primera—. Lo único que avanza es el cursor, que
    // es la dirección del tramo siguiente. Así que un click nuevo sobre el DJ
    // continúa la sesión abierta en vez de volver al primer tramo, que es lo
    // que hace el cliente de Spotify, donde el DJ nunca vuelve atrás.
    let cursor = dj_state
        .0
        .lock()
        .ok()
        .and_then(|guard| guard.next.clone());
    let follows_cursor = cursor.is_some();
    // La sesión se clona: una copia se la queda el pedido de la página y la
    // otra la voz, que va por su cuenta.
    let for_page = session.clone();
    let page = tauri::async_runtime::spawn_blocking(move || match cursor {
        Some(path) => spclient::station_page(&for_page, &path),
        None => spclient::dj_mix(&for_page, &playlist_id),
    })
    .await
    .map_err(|e| {
        eprintln!("Starless [command_failed]: {e}");
        "command_failed".to_string()
    })??;

    // **La frase es de la canción, y se dice antes que ella.**
    //
    // El servicio cuelga la frase de apertura de la primera canción de un
    // tramo y la de cierre de la última, y las dos se dicen *antes* de esa
    // canción: "así termina este segmento, al ritmo de The Weeknd" se dice, y
    // después suena The Weeknd.
    //
    // Por eso acá no se habla nada: la página llega dos canciones antes de
    // que la cola se vacíe, y decir la frase en este momento sería hablar
    // encima de la canción que está sonando. La frase queda guardada por
    // canción, y el frontend la pide cuando esa canción va a sonar.
    let follows = page.next.is_some();
    let voices = page.voices;
    if let Ok(mut guard) = dj_state.0.lock() {
        // El cursor es lo único que sobrevive al click: la sesión que sigue es
        // la misma, y por eso el click siguiente trae canciones nuevas.
        guard.next = page.next;
        // Las frases y los audios que quedaron de la tanda anterior no le
        // sirven a nadie: la cola se reemplaza entera.
        guard.voices.clear();
        guard.audio.clear();
        for (id, params) in voices.clone() {
            guard.voices.insert(id, params);
        }
    }

    // El audio de las frases se pide ahora y no cuando la canción va a sonar.
    // La primera página también lo pide: no hacerlo dejaba el hole justo en
    // la primera frase de la estación, que es la que nadie espera.
    prefetch_voices(&app, &session, voices);

    log::info!(
        "dj: {} con {} canciones; {}",
        if follows_cursor {
            "siguió la sesión"
        } else {
            "arrancó una sesión"
        },
        page.mix.tracks.len(),
        if follows { "sigue" } else { "es la última" }
    );

    Ok(page.mix)
}

/// El DJ dice la frase que le corresponde a una canción.
///
/// **La frase es de la canción, y se dice antes que ella.** El servicio cuelga
/// la frase de apertura de la primera canción de un tramo y la de cierre de la
/// última, y las dos se dicen *antes* de esa canción. Por eso la app las
/// guarda hasta que la canción va a sonar: pedirlas al llegar la página sería
/// hablar encima de la canción que está sonando.
///
/// La respuesta es el número de la voz, o `None` cuando el DJ no tiene nada
/// que decir para esa canción: entonces la música arranca derecho. El número
/// es lo que distingue dos voces: dos clicks seguidos son dos voces, y la que
/// terminó primero no es la que el segundo click está esperando.
///
/// **Si la voz falla, el DJ sigue sonando.** La voz es un extra sobre una
/// estación que ya funciona; que el servicio de voz no conteste no puede ser
/// motivo para que la música no suene. Por eso el evento va siempre.
#[tauri::command]
async fn dj_speak(
    app: AppHandle,
    dj_state: State<'_, DjState>,
    track_id: String,
) -> Result<Option<u64>, String> {
    let Some(params) = take_voice(&dj_state, &track_id) else {
        return Ok(None);
    };

    let session = ready_session(&app).await?;

    let id = next_voice_id();
    // La bandera se crea acá, no en el hilo: es lo que permite cortar la voz
    // antes de que llegue, y lo que corta la que ya está sonando.
    let stop = voice::begin();

    // **El audio que ya estaba pedido se usa, y no se vuelve a pedir.**
    //
    // Y el que estaba de camino se espera: la frase se pide cuando llega la
    // página y se dice cuando la canción va a sonar, y las dos cosas pueden
    // coincidir. Pedirla otra vez sería hacer dos pedidos por la misma frase.
    let ready = take_audio(&dj_state, &track_id);

    // **La música se calla ahora, y no cuando llegue el audio.**
    //
    // Si siguiera sonando hasta que la voz esté lista, el usuario escucharía
    // un pedazo de la canción que acaba de saltear y recién después al DJ: es
    // la sensación de que la app no lo escuchó. El silencio de un segundo
    // antes de la frase es la pausa del DJ, y es preferible a la canción
    // equivocada.
    if let Err(error) = playback::stop(&app) {
        log::warn!("dj: no se pudo cortar la música: {error}");
    }

    let session = session.clone();
    let app = app.clone();
    std::thread::spawn(move || {
        // **El dispositivo tiene que estar abierto antes de que la voz entre.**
        // La voz sale por el mixer del player, y sin player no hay mixer: el
        // primer click en el DJ de una app que nunca sonó nada sería mudo.
        // Abrir el dispositivo es lo que hace `ensure_player`, y lo hace en
        // este hilo porque tarda.
        playback::ensure_player(&app, &session);

        let spoken = (|| -> Result<bool, String> {
            // Si al usuario ya le alcanzó, ni se pide el audio: el hilo se va
            // sin tocar el player. La canción que el usuario puso hace un
            // segundo está sonando, y cortarla sería dejar al DJ mudo y sin
            // música.
            if stop.load(Ordering::Relaxed) {
                return Ok(false);
            }
            let audio = match ready {
                Some(audio) => audio,
                None => match wait_for_audio(&app, &track_id, &stop) {
                    Some(audio) => audio,
                    None => spclient::dj_voice(&session, &params)?,
                },
            };
            if stop.load(Ordering::Relaxed) {
                return Ok(false);
            }
            let voice = voice::speak(&audio, stop)?;
            Ok(voice.wait())
        })();

        match spoken {
            Ok(true) => log::info!("dj: la voz del DJ terminó de hablar"),
            Ok(false) => log::info!("dj: la voz del DJ se cortó"),
            Err(error) => log::error!("dj: la voz no se pudo poner: {error}"),
        }
        // El evento va siempre, se haya oído o no: el frontend está
        // esperando esta voz, y dejarla esperando sería dejar el DJ mudo.
        let _ = app.emit("dj://voice", DjVoiceEvent { id, done: true });
    });

    Ok(Some(id))
}

/// La frase que el DJ todavía tiene para una canción, y que se lleva.
///
/// Se lleva porque la frase se dice una sola vez: si el DJ la dijera dos
/// veces, la segunda sería la conversación de otro tramo.
fn take_voice(dj_state: &State<'_, DjState>, track_id: &str) -> Option<crate::voice::VoiceParams> {
    let mut guard = dj_state.0.lock().ok()?;
    guard.voices.remove(track_id)
}

/// El audio que ya estaba pedido para una canción, si lo hay.
///
/// Se lleva porque el audio pesa: son trescientos kilobytes por frase, y
/// guardarlos de más no sirve de nada.
fn take_audio(dj_state: &State<'_, DjState>, track_id: &str) -> Option<Vec<u8>> {
    let mut guard = dj_state.0.lock().ok()?;
    guard.audio.remove(track_id)
}

/// El audio que estaba de camino, si llega a tiempo.
///
/// **La frase se pide una sola vez.** Se pide por adelantado —cuando llega la
/// página— y se dice en el momento en que la canción va a sonar, y las dos
/// cosas pueden coincidir. Si el que habla pidiera el audio por su cuenta
/// mientras el otro lo está trayendo, se harían dos pedidos por la misma frase
/// y la segunda respuesta sería la que espera.
///
/// La espera tiene un tope: si el pedido se colgó, se pide acá y la música no
/// espera a un hilo muerto.
fn wait_for_audio(app: &AppHandle, track_id: &str, stop: &AtomicBool) -> Option<Vec<u8>> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if let Some(state) = app.try_state::<DjState>() {
            if let Ok(mut guard) = state.0.lock() {
                if let Some(audio) = guard.audio.remove(track_id) {
                    return Some(audio);
                }
            }
        }
        // El usuario se fue: la frase ya no tiene a quién decirse.
        if stop.load(Ordering::Relaxed) {
            return None;
        }
        if std::time::Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

/// El número de la próxima voz del DJ.
///
/// Es un contador y nada más: sirve para que dos clicks seguidos no se
/// confundan, no para identificar nada fuera de la app.
static VOICE_ID: AtomicU64 = AtomicU64::new(1);

fn next_voice_id() -> u64 {
    VOICE_ID.fetch_add(1, Ordering::Relaxed)
}

/// El audio de las frases del DJ, pedido por adelantado.
///
/// **Fabricarlo tarda un par de segundos** —el servicio que lo hace es otro— y
/// la página que trae la frase llega cinco canciones antes de que la cola se
/// vacíe. Pedirlo cuando la página llega lo deja listo para el momento en que
/// la canción arranca: el DJ toma la posta sin un hole en el medio.
///
/// **Las dos páginas lo piden.** La primera no lo pedía, y por eso la primera
/// frase de la estación era la única que pagaba la espera: la música se cortaba
/// para el DJ y el DJ todavía no estaba. El hole caía siempre en el mismo
/// lugar, y ese lugar es el primero que se escucha.
///
/// Cada frase va en su propio hilo: son peticiones lentas y no tienen que
/// esperarse entre ellas.
fn prefetch_voices(
    app: &AppHandle,
    session: &Session,
    voices: HashMap<String, crate::voice::VoiceParams>,
) {
    for (id, params) in voices {
        let session = session.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            let Ok(audio) = spclient::dj_voice(&session, &params) else {
                return;
            };
            let state = tauri::Manager::state::<DjState>(&app);
            if let Ok(mut guard) = state.0.lock() {
                guard.audio.insert(id, audio);
            }
        });
    }
}

/// La página siguiente del DJ: la estación sigue.
///
/// **Sin cursor no hay página**, y eso no es un error: es el DJ diciendo que se
/// terminó. La respuesta es una lista vacía, que es lo mismo que la app
/// necesita saber para dejar de pedir.
#[tauri::command]
async fn dj_more(
    app: AppHandle,
    dj_state: State<'_, DjState>,
) -> Result<DjMix, String> {
    let path = dj_state
        .0
        .lock()
        .ok()
        .and_then(|guard| guard.next.clone())
        .unwrap_or_default();
    if path.is_empty() {
        return Ok(DjMix {
            tracks: Vec::new(),
            lines: HashMap::new(),
        });
    }

    let session = ready_session(&app).await?;

    // La sesión se clona: una copia se la queda el pedido de la página y la
    // otra el audio que se pide por adelantado.
    let for_page = session.clone();
    let page = tauri::async_runtime::spawn_blocking(move || spclient::station_page(&for_page, &path))
        .await
        .map_err(|e| {
            eprintln!("Starless [command_failed]: {e}");
            "command_failed".to_string()
        })??;

    // Las frases de esta página quedan guardadas por canción, y no se dicen
    // ahora: la página llega dos canciones antes de que la cola se vacíe, y
    // hablar acá sería hablar encima de la canción que está sonando. El DJ
    // las dice cuando la canción va a sonar.
    let voices = page.voices;
    if let Ok(mut guard) = dj_state.0.lock() {
        guard.next = page.next;
        for (id, params) in voices.clone() {
            guard.voices.insert(id, params);
        }
    }

    // El audio de las frases se pide ahora, y no cuando la canción va a sonar.
    prefetch_voices(&app, &session, voices);

    log::info!(
        "dj: la estación pidió la página siguiente y recibió {} canciones",
        page.mix.tracks.len()
    );

    Ok(page.mix)
}

/// La radio: las canciones parecidas a las que se estaban escuchando.
///
/// **Es la puerta del autoplay de Spotify, con su protocolo entero**: el
/// contexto que se escuchaba y las canciones recientes. Con una playlist como
/// contexto, es lo que sigue cuando la lista se acaba; con una canción como
/// contexto, es la radio de esa canción.
///
/// La primera página trae cincuenta canciones y un cursor; las siguientes salen
/// del cursor, con `radio_more`.
#[tauri::command]
async fn radio_start(
    app: AppHandle,
    radio_state: State<'_, RadioState>,
    context: crate::models::RadioContext,
    recent_track_ids: Vec<String>,
) -> Result<crate::models::DjMix, String> {
    let session = ready_session(&app).await?;
    let uri = context.uri();
    let recent: Vec<String> = recent_track_ids
        .iter()
        .map(|id| format!("spotify:track:{id}"))
        .collect();

    let for_page = session.clone();
    let for_uri = uri.clone();
    let page = tauri::async_runtime::spawn_blocking(move || {
        spclient::autoplay(&for_page, &for_uri, &recent)
    })
    .await
    .map_err(|e| {
        eprintln!("Starless [command_failed]: {e}");
        "command_failed".to_string()
    })??;

    // El cursor es lo que sobrevive: la radio sigue.
    if let Ok(mut guard) = radio_state.0.lock() {
        guard.next = page.next;
    }

    log::info!(
        "radio: arrancó con {} canciones para {uri}",
        page.mix.tracks.len()
    );

    Ok(page.mix)
}

/// La radio sigue: la página siguiente de la estación.
///
/// **Sin cursor no hay página siguiente**, y no es un error: la estación se
/// sembró y el servicio no dio más. Se contesta con una lista vacía para que el
/// frontend no tenga que distinguir "no hay más" de "falló".
#[tauri::command]
async fn radio_more(
    app: AppHandle,
    radio_state: State<'_, RadioState>,
) -> Result<crate::models::DjMix, String> {
    let path = radio_state
        .0
        .lock()
        .ok()
        .and_then(|guard| guard.next.clone())
        .unwrap_or_default();
    if path.is_empty() {
        return Ok(crate::models::DjMix {
            tracks: Vec::new(),
            lines: HashMap::new(),
        });
    }

    let session = ready_session(&app).await?;
    let for_page = session.clone();
    let page = tauri::async_runtime::spawn_blocking(move || spclient::station_page(&for_page, &path))
        .await
        .map_err(|e| {
            eprintln!("Starless [command_failed]: {e}");
            "command_failed".to_string()
        })??;

    if let Ok(mut guard) = radio_state.0.lock() {
        guard.next = page.next;
    }

    log::info!(
        "radio: la estación pidió la página siguiente y recibió {} canciones",
        page.mix.tracks.len()
    );

    Ok(page.mix)
}

// Crea una playlist en la biblioteca y la nombra. Devuelve el id nuevo para que
// la pantalla pueda abrirla sin volver a leer toda la biblioteca.
// `create_failed` y `attach_failed` llegan al frente tal cual: una playlist que no
// llegó a crearse y una que existe pero no entró en la biblioteca son dos
// problemas distintos y un mensaje genérico los vuelve el mismo.
spclient_command!(create_playlist, spclient::create_playlist, String, name: String);

// Mete una canción en una playlist que ya existe. Es una escritura y no una
// lectura, así que va por el mismo camino que las demás: la red no puede
// tocar el hilo principal. La revisión de la playlist se lee acá adentro, que
// es lo único que garantiza que sea la última.
spclient_command!(
    add_to_playlist,
    spclient::add_to_playlist,
    (),
    playlist_id: String,
    track_id: String
);

/// Guarda los detalles de una playlist: el nombre, la descripción y la portada.
///
/// **La portada se sube antes de escribirse.** El JPEG va a
/// `image-upload.spotify.com`, el token que contesta se registra contra la
/// playlist, y lo que contesta el registro —el id de la imagen— es lo que
/// viaja en los atributos. Todo eso pasa acá adentro, en un solo comando: el
/// frontend manda la imagen y el nombre, y no queda un estado intermedio en el
/// que la portada esté subida y la playlist sin guardar.
///
/// **Una sola escritura.** El nombre, la descripción y la portada van en el
/// mismo cambio, contra la misma revisión leída: se guardan las tres o no se
/// guarda ninguna.
///
/// **La red no toca el hilo principal.** El comando es `async` y el trabajo
/// blocking va en `spawn_blocking`, como los demás.
#[tauri::command]
async fn update_playlist_details(
    app: AppHandle,
    playlist_id: String,
    details: PlaylistDetails,
    cover: Option<Vec<u8>>,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    // La entrada al comando queda anotada: si una vez se cuelga, el log dice
    // si el comando llegó a arrancar o si lo que se colgó fue el puente.
    log::info!("spclient: update_playlist_details arrancó para {playlist_id}");
    let result = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<SessionState>();
        let session = state.ready()?;

        // La imagen se sube y se registra primero: sin el id de la imagen no
        // hay nada que escribir.
        let picture = match cover {
            Some(jpeg) => Some(spclient::upload_playlist_cover(&session, &playlist_id, &jpeg)?),
            None => None,
        };

        spclient::update_playlist_details(&session, &playlist_id, &details, picture)
    })
    .await
    .map_err(|e| {
        // El panic del hilo blocking también va al log: `eprintln` en una app
        // de ventana se pierde, y un comando que muere sin dejar rastro es un
        // comando que parece colgado.
        log::error!("spclient: update_playlist_details.command_failed: {e}");
        eprintln!("Starless [command_failed]: {e}");
        "command_failed".to_string()
    })?;

    log::info!(
        "spclient: update_playlist_details tardó {} ms",
        started.elapsed().as_millis()
    );
    Ok(result?)
}
// --- Playback --------------------------------------------------------------

/// The player's live state. Polled by the UI rather than pushed for volume and
/// transport; only track and position changes are emitted, as `player://status`.
#[tauri::command]
fn player_status(state: State<PlaybackState>) -> PlaybackStatus {
    state.status()
}

#[tauri::command]
async fn play_track(
    app: AppHandle,
    track_id: String,
    position_ms: Option<u32>,
    duration_ms: Option<u32>,
) -> Result<(), String> {
    // **Poner una canción calla al DJ.** Si el DJ estaba hablando, era para
    // esta canción: cuando el usuario elige otra, la frase que ya no tiene
    // sentido seguir diciendo se corta. Va antes de todo lo demás, y antes de
    // la espera: la frase está de más aunque la canción tarde en arrancar.
    voice::stop();

    // **The wait happens here and not on the main thread.** A click that arrives
    // before the handshake used to fail with "not signed in" —a lie, the user
    // *is* signed in— and now waits for the session to be usable. A wait on the
    // main thread is a frozen window, so the whole thing hops to a blocking
    // thread first.
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<PlaybackState>();
        let session_state = app.state::<SessionState>();
        let session = session_state.ready()?;

        // The audio device is opened here, on the first request to make a sound —
        // not at launch. An app that grabs an output handle before the user has
        // asked for anything is holding a device it has not been given.
        //
        // A dead session does not get a player.
        //
        // `ensure_player` builds one on the session it is given, and a player on a
        // dead session is a player that never plays anything — it would also
        // displace the one the reconnection is about to build, and the two would
        // fight over the audio device.
        if session.is_invalid() {
            // **But the click is not thrown away.**
            //
            // The session died on its own —librespot never reconnects by itself—,
            // and nothing in the app may be rebuilding it: the reconnection exists
            // for a track that *failed*, and a session that dies while the queue
            // is empty never produces a failed track. So the connection was gone
            // for hours, with a window that looked perfectly fine and a DJ that
            // still spoke.
            //
            // A click is the same request a failure makes, and the only one a
            // person can make: the session goes back up and the track that was
            // asked for goes back on with it.
            log::warn!("[connection_lost] la sesión de reproducción ya no está; se reconstruye");
            playback::reconnect_and_play(&app, &track_id, duration_ms.unwrap_or(0))?;
            let _ = app.emit("player://status", state.status());
            return Ok(());
        }

        playback::ensure_player(&app, &session);
        playback::play(
            &state,
            &track_id,
            position_ms.unwrap_or(0),
            duration_ms.unwrap_or(0),
        )?;

        // Push the state we just set. Without this the UI learns nothing until
        // librespot emits something, and on the failure paths it never does —
        // which is why a click could produce no visible change whatsoever.
        let _ = app.emit("player://status", state.status());
        Ok(())
    })
    .await
    .map_err(|e| {
        eprintln!("Starless [command_failed]: {e}");
        "command_failed".to_string()
    })?
}

#[tauri::command]
fn toggle_playback(app: tauri::AppHandle, state: State<PlaybackState>) -> Result<(), String> {
    playback::toggle(&app, &state)
}

#[tauri::command]
fn seek_playback(state: State<PlaybackState>, position_ms: u32) -> Result<(), String> {
    playback::seek(&state, position_ms)
}

#[tauri::command]
fn set_volume(state: State<PlaybackState>, volume: u16) {
    playback::set_volume(&state, volume);
}

/// How opaque the menus are, as a percentage. The default is opaque, not 55%.
#[tauri::command]
fn menu_opacity() -> u8 {
    settings::saved_menu_opacity()
}

/// Remember it. Clamped in `settings`, because the value lands in a CSS colour.
#[tauri::command]
fn set_menu_opacity(opacity: u8) {
    settings::save_menu_opacity(opacity);
}

/// How many seconds two songs overlap when one ends on its own; 0 is off.
#[tauri::command]
fn crossfade_seconds() -> u8 {
    settings::saved_crossfade_seconds()
}

/// Remember it, and hand it to the audio thread: it applies from the next song.
#[tauri::command]
fn set_crossfade_seconds(seconds: u8) {
    settings::save_crossfade_seconds(seconds);
    crossfade::set_seconds(u32::from(settings::saved_crossfade_seconds()));
}

/// The accent colour the user picked, or `None` for the one DESIGN.md ships.
///
/// It crosses to the webview as a plain string and nothing else: no token, no
/// file path, no way to reach the disk from the value.
#[tauri::command]
fn accent() -> Option<String> {
    settings::saved_accent()
}

/// Remember it. `settings` refuses anything that is not `#rrggbb`, because this
/// value becomes a custom property on `:root` and reaches every element.
#[tauri::command]
fn set_accent(color: String) {
    settings::save_accent(&color);
}

/// How the library is ordered, or the default when nobody has chosen.
///
/// The default comes back from here rather than from the frontend so that "never
/// chosen" is answered in one place: a value that only Rust knows about cannot
/// disagree with a default the frontend also carries.
#[tauri::command]
fn library_sort() -> String {
    settings::saved_library_sort().to_string()
}

/// `settings` refuses any order this build does not know, in both directions.
#[tauri::command]
fn set_library_sort(sort: String) {
    settings::save_library_sort(&sort);
}

#[tauri::command]
fn library_view() -> String {
    settings::saved_library_view().to_string()
}

#[tauri::command]
fn set_library_view(view: String) {
    settings::save_library_view(&view);
}

/// How a playlist's songs are ordered, as `<order>-<asc|desc>`. Same reasoning
/// as `library_sort`: the default is answered here, in one place.
#[tauri::command]
fn track_order() -> String {
    settings::saved_track_order().to_string()
}

#[tauri::command]
fn set_track_order(order: String) {
    settings::save_track_order(&order);
}

#[tauri::command]
fn track_view() -> String {
    settings::saved_track_view().to_string()
}

#[tauri::command]
fn set_track_view(view: String) {
    settings::save_track_view(&view);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // **Registered first, on purpose.** The plugin works by holding a lock
        // that the second process cannot take, so it has to exist before anything
        // else in `setup` can fail — otherwise the copy that starts while a crash
        // is being handled sails through to a second session.
        //
        // What the second copy does is exit. What it must not do is reach
        // `setup`: one account, one session. Two of them authenticate with the
        // same credentials, and the one that loses the audio-key race hands its
        // own bytes to the other one's decoder — six tracks burned in fourteen
        // seconds, every one of them reported as a song Spotify would not
        // deliver. See `AGENTS.md`.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            log::info!("segunda instancia: le cedo el lugar a la que ya está");
            bring_to_front(app);
        }))
        .plugin(tauri_plugin_opener::init())
        // The updater only downloads and verifies; *when* it runs is decided by the
        // UI. An app that plays music must not install over itself mid-track, so
        // Starless asks instead — see `update.rs`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(SessionState::default())
        .manage(PlaybackState::default())
        .manage(DjState::default())
        .manage(RadioState::default())
        .setup(|app| {
            // librespot narrates every refusal through `log`, and Starless is a
            // windowed app with no console to narrate into. Both halves matter:
            // without a logger a refusal is invisible, and without a file it is
            // invisible to the user and to us. See `logging`.
            //
            // `RUST_LOG` still wins, e.g. `RUST_LOG=librespot=debug bun run app`.
            logging::init();

            // Order matters here, and it is the whole design. The marker from the
            // previous run is *moved aside* rather than overwritten, so the question
            // "did it end cleanly?" stays answerable from the frontend long after
            // setup has returned — and no race between setup and the first render can
            // swallow a crash.
            //
            // The panic hook goes in before anything else can fail, because the run
            // it is meant to catch is this one.
            report::install_panic_hook();
            report::mark_session_start();

            let handle = app.handle().clone();
            let restore = handle.clone();

            // Restoring the streaming session opens a connection to Spotify, so it
            // happens off the setup thread — the window must appear immediately.
            // No client id is needed here: the session presents Spotify's own.
            tauri::async_runtime::spawn_blocking(move || {
                let Ok(cache) = auth::open_cache() else {
                    return;
                };
                if let Some(session) = auth::cached_session(&cache) {
                    // Open the audio device while the handshake is still finishing.
                    // Nothing is playing yet and nothing is open to a device the
                    // account owns, so the only thing this costs is a handle — and
                    // what it buys is the first song not paying for the device on the
                    // critical path.
                    playback::warm_audio_device(&restore, session.clone());
                    if let Some(state) = restore.try_state::<SessionState>() {
                        if let Ok(mut guard) = state.0.lock() {
                            *guard = Some(session);
                        }
                    }
                }
            });

            // The watchdog that notices when the player stops answering.
            //
            // It lives for the whole session and it is started here, next to
            // the rest of the app's machinery, because it is the app's way of
            // asking a question that the player cannot answer by itself: is the
            // music still moving? A player that is parked inside the audio
            // device is alive as far as `is_invalid` is concerned, and the
            // window looks perfect while the app is deaf.
            playback::watch(handle.clone());

            // **La conexión, cortada a propósito.**
            //
            // Una sesión que se muere sola no se puede reproducir cuando se
            // quiere: Spotify la tira cuando la tira. Y lo que hay alrededor
            // —una sesión muerta con la cola vacía no falla ninguna pista, así
            // que nadie pide la sesión de vuelta, y la app queda muda con una
            // ventana que se ve perfecta— vale más que las líneas que hacen
            // falta para verlo.
            //
            // Se corta después del handshake: cortarla antes sólo probaría que
            // la app no puede conectarse.
            #[cfg(debug_assertions)]
            if playback::kill_session_requested() {
                let killer = handle.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    std::thread::sleep(std::time::Duration::from_secs(8));
                    playback::kill_session(&killer);
                    // **Y ahora lo mismo que hace un clic**, con la sesión
                    // muerta: hay que armar la sesión de nuevo y poner la
                    // pista. Si la música vuelve, la puerta se abre.
                    if let Err(error) =
                        playback::reconnect_and_play(&killer, playback::PROBE_TRACK, 0)
                    {
                        log::error!("[reconnect_failed] la reconexión a mano falló: {error}");
                    }
                });
            }

            // Off the setup thread, and started independently of the restore
            // above: the self-test waits for the session itself.
            // Same shape, different question: what this session can answer on
            // its own. Kept out of the self-test because that one plays music.
            // Before it because both wait for the same session and the self-test
            // takes the handle by value.
            #[cfg(debug_assertions)]
            if spclient::requested() {
                spclient::run_probe(handle.clone());
            }
            #[cfg(debug_assertions)]
            if spclient::shapes_requested() {
                spclient::run_shape_probe(handle.clone());
            }
            #[cfg(debug_assertions)]
            if spclient::pictures_requested() {
                spclient::run_picture_probe(handle.clone());
            }
            #[cfg(debug_assertions)]
            if spclient::home_requested() {
                spclient::run_home_probe(handle.clone());
            }
            #[cfg(debug_assertions)]
            if spclient::create_requested() {
                spclient::run_create_probe(handle.clone());
            }
            // La visibilidad de una playlist: pública o privada. La sonda
            // escribe, así que sólo toca la playlist que el ambiente nombra.
            #[cfg(debug_assertions)]
            if spclient::private_requested() {
                spclient::run_private_probe(handle.clone());
            }
            // La playlist que Spotify fabrica para la cuenta —DJ— es la única
            // que hace preguntas nuevas, y es la que todavía no está
            // resuelta.
            #[cfg(debug_assertions)]
            if spclient::dj_requested() {
                spclient::run_dj_probe(handle.clone());
            }
            // La voz del DJ, de punta a punta y sin que nadie haga clic.
            #[cfg(debug_assertions)]
            if spclient::voice_requested() {
                spclient::run_voice_probe(handle.clone());
            }
            // La radio: la misma puerta del DJ, sembrada con una canción. La
            // pregunta es si el servicio la acepta, y eso no se suppose.
            #[cfg(debug_assertions)]
            if spclient::radio_requested() {
                spclient::run_radio_probe(handle.clone());
            }
            // El jam: la sesión compartida. La puerta se encontró en el cliente
            // de escritorio; lo que falta es si una sesión de streaming la
            // puede usar.
            #[cfg(debug_assertions)]
            if spclient::jam_requested() {
                spclient::run_jam_probe(handle.clone());
            }
            if selftest::requested() {
                selftest::run(handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            begin_login,
            sign_out,
            account,
            my_playlists,
            create_playlist,
            add_to_playlist,
            update_playlist_details,
            liked_tracks,
            playlist_tracks,
            search_tracks,
            lyrics,
            dj_mix,
            dj_more,
            dj_speak,
            jam_start,
            jam_join,
            jam_status,
            jam_queue,
            jam_leave,
            radio_start,
            radio_more,
            player_status,
            play_track,
            toggle_playback,
            seek_playback,
            set_volume,
            menu_opacity,
            set_menu_opacity,
            crossfade_seconds,
            set_crossfade_seconds,
            accent,
            set_accent,
            library_sort,
            set_library_sort,
            library_view,
            set_library_view,
            track_order,
            set_track_order,
            track_view,
            set_track_view,
            previous_session_crashed,
            announce_clean_exit,
            log_frontend_error,
            check_prerelease_manifest,
            check_public_manifest,
            simulate_crash,
            crash_report_preview,
            submit_crash_report,
            dismiss_crash_report,
            feedback_report_preview,
            submit_feedback
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // `build` + `run` instead of the shorthand `.run(context)`, because the
    // shorthand gives no way to hear the app finish — and hearing it finish is the
    // only signal that separates a quit from a crash.
    //
    // `Exit`, not `ExitRequested`: the latter fires on the way in and can still be
    // prevented, so clearing the marker there would mark a crash as a clean exit.
    app.run(|_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            report::mark_session_end();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::find_prerelease_manifest;
    use super::github_client;
    use super::is_our_manifest;
    use super::is_spent_budget;

    /// The develop channel hands the updater a manifest URL and expects an
    /// update behind it. This walks the whole path —the endpoint, the
    /// redirect, the platform key, the signature— against a prerelease that is
    /// really published, because every one of those can be wrong in a way that
    /// only shows up when somebody tries to install it.
    ///
    /// It talks to GitHub, so it is `#[ignore]`d: the build must not depend on
    /// somebody else's network. Run it with `cargo test --lib -- --ignored`.
    #[test]
    #[ignore = "habla con GitHub"]
    fn the_published_prerelease_manifest_is_the_one_we_can_install() {
        // The manifest is what the updater reads, and the updater is the only
        // thing that can install it. This checks the two things it needs to
        // find: this platform's entry, and a signature to check the download
        // against. The download itself is the plugin's, and it is the same one
        // the stable channel uses.
        let response = reqwest::blocking::get(
            "https://github.com/baironvillar/Starless/releases/download/v0.5.1/latest.json",
        )
        .unwrap();
        assert!(response.status().is_success(), "el manifest no se pudo bajar");

        let manifest: serde_json::Value = response.json().unwrap();
        let platform = &manifest["platforms"]["windows-x86_64"];
        assert!(
            platform["signature"]
                .as_str()
                .is_some_and(|signature| !signature.is_empty()),
            "el manifest no trae la firma de esta plataforma"
        );
        assert!(
            platform["url"]
                .as_str()
                .is_some_and(|url| url.contains("releases/assets")),
            "el manifest no trae el instalador de Windows"
        );
    }

    /// The 403 that means "the budget is spent" is not the 403 that means "you
    /// forgot the User-Agent", and the row says a different thing for each.
    #[test]
    fn only_an_empty_purse_is_the_rate_limit() {
        use reqwest::StatusCode;

        // The spent one.
        assert!(is_spent_budget(StatusCode::FORBIDDEN, Some("0")));

        // A 403 with budget left is something else: a request that was refused
        // for a different reason.
        assert!(!is_spent_budget(StatusCode::FORBIDDEN, Some("57")));

        // No header at all: nobody said anything about the budget.
        assert!(!is_spent_budget(StatusCode::FORBIDDEN, None));

        // And no other status is the rate limit, whatever the header says.
        assert!(!is_spent_budget(StatusCode::NOT_FOUND, Some("0")));
        assert!(!is_spent_budget(StatusCode::OK, Some("0")));
    }

    /// The develop channel has to find a prerelease that is really published.
    ///
    /// This is the walk the button does: the tags, then the release of each
    /// tag, until one of them is a prerelease with a manifest. Every step of
    /// it can be wrong in a way that only shows up when somebody presses the
    /// button and nothing happens — the API turned down the request for
    /// lacking a `User-Agent`, the list of releases was behind, the manifest
    /// was not there. The walk is checked against the real repository, so the
    /// answer is not a promise but a fact.
    ///
    /// It talks to GitHub, so it is `#[ignore]`d: the build must not depend on
    /// somebody else's network. Run it with `cargo test --lib -- --ignored`.
    #[test]
    #[ignore = "habla con GitHub"]
    fn the_develop_channel_finds_a_published_prerelease() {
        let client = github_client().expect("no se pudo crear el cliente de GitHub");
        let found = tauri::async_runtime::block_on(find_prerelease_manifest(&client))
            .expect("GitHub no respondió");
        let endpoint = found.expect("no se encontró ninguna prerelease publicada");
        assert!(
            is_our_manifest(&endpoint),
            "el manifest encontrado no es de este repositorio"
        );
    }

    /// The develop channel installs whatever manifest it is pointed at, so the
    /// door accepts this repository's releases and nothing else. A URL that
    /// merely looks like ours —a different host, a sibling repository— is not
    /// ours.
    #[test]
    fn only_our_own_releases_are_accepted() {
        let ours = tauri::Url::parse(
            "https://github.com/baironvillar/Starless/releases/download/v0.5.2/latest.json",
        )
        .unwrap();
        assert!(is_our_manifest(&ours));

        let other_host = tauri::Url::parse("https://example.com/latest.json").unwrap();
        assert!(!is_our_manifest(&other_host));

        let sibling = tauri::Url::parse(
            "https://github.com/baironvillar/Starless-evil/releases/download/v0.5.2/latest.json",
        )
        .unwrap();
        assert!(!is_our_manifest(&sibling));

        let other_repo =
            tauri::Url::parse("https://github.com/alguien/otro/releases/download/v1/latest.json")
                .unwrap();
        assert!(!is_our_manifest(&other_repo));
    }

    /// The update has to be registered where the plugin looks for it.
    ///
    /// **The check is over the source because the real one needs a webview,
    /// and the Tauri feature that builds one breaks the test binary on
    /// Windows.** What it guards is the mistake this app made for five
    /// versions: the update was registered in the *app's* resource table, and
    /// the plugin looks in the *webview's* —two different tables, so the
    /// handle pointed at nothing, the install failed without saying why, and
    /// the prerelease channel never worked.
    ///
    /// The plugin's own commands are the reference: its `check` registers the
    /// update in the webview's table and its `download_and_install` reads it
    /// back from there.
    #[test]
    fn the_update_is_registered_in_the_webviews_table() {
        let source = include_str!("lib.rs");
        // The strings are built here and not written out: a test that says
        // the forbidden thing is itself the forbidden thing.
        let app_table = format!("app.{}()", "resources_table");
        let registration = format!("let rid = webview.{}.add(update);", "resources_table()");

        assert!(
            !source.contains(&app_table),
            "the update has to be registered in the webview's resource table, \
             like the plugin's own commands do. The app's table is a different \
             one, and a handle into it points at nothing.",
        );
        assert_eq!(
            source.matches(&registration).count(),
            2,
            "both channels —the prerelease and the door back to the public \
             line— register the update the same way",
        );
    }
}