//! Spotify Soloist: the way out for an account whose audio keys are refused.
//!
//! The plan, the reasons and what is lost are in `docs/soloist.md`. In short:
//! Soloist is Spotify's own headless Spotify Connect player. It plays where
//! librespot is refused because it is Spotify's, and Starless drives it through
//! its local WebSocket while the library, the queue and everything else stay on
//! librespot's session.
//!
//! **It is only ever offered to an account `keycheck` found refused.** Everyone
//! else plays through librespot and never meets any of this.
//!
//! Three rules shape this module:
//!
//! - **The binary is Spotify's and is never shipped.** Spotify forbids
//!   redistributing it, so it is downloaded from Spotify's CDN when the person
//!   presses the button, and its Authenticode signature has to name Spotify
//!   before it is ever run.
//! - **The key is the person's and never goes back to the webview** (rule 7's
//!   one exception). It comes in once, is kept in the Windows Credential
//!   Manager, and the frontend only learns whether there is one.
//! - **While Soloist plays, librespot's player does not exist.** Soloist opens
//!   its own WASAPI stream, and two clients of one device fight (`AGENTS.md`).

use std::io::{BufRead, BufReader, Read};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::playback::PlaybackStatus;

/// Spotify's published build for this machine. The page that lists them is
/// `developer.spotify.com/documentation/soloist/reference/downloads-and-updates`.
const DOWNLOAD_URL: &str =
    "https://soloist-builds.spotifycdn.com/soloist_release_windows_x86_64.zip";

/// Builds stop working this many days after they were built (exit code 10).
const LIFETIME_DAYS: u64 = 90;

/// Renew this many days before the build expires, so a person never meets an
/// expired build: the new one is fetched quietly and used on the next start.
const RENEW_DAYS: u64 = 14;

/// Soloist's exit code for an expired build.
const EXIT_EXPIRED: i32 = 10;

/// What the frontend hears when anything about Soloist changes.
pub const EVENT: &str = "soloist://status";

/// How long Soloist may take to open its WebSocket before the start counts as
/// failed. It is a local process; past this something is wrong with it.
const START_TIMEOUT: Duration = Duration::from_secs(20);

/// How often the position is pushed while a song plays. Soloist only says when
/// the position's anchor moves (`position_sync`), and the bar needs to move.
const TICK: Duration = Duration::from_millis(500);

/// Everything the webview may know about Soloist. **No key in here, ever.**
#[derive(Debug, Clone, Default, Serialize)]
pub struct SoloistStatus {
    /// The binary is downloaded and its signature checked.
    pub installed: bool,
    /// What `soloist.exe --version` printed, first line.
    pub version: Option<String>,
    /// Days until the build stops working, when it is known.
    pub expires_in_days: Option<i64>,
    /// A key is stored. Never the key itself.
    pub has_key: bool,
    /// The process is up and its WebSocket answered.
    pub running: bool,
    /// Soloist holds a Spotify Connect session: it was picked once from the
    /// official app, and it remembers.
    pub paired: bool,
    /// The name it shows in Spotify's device list, so the setup can say exactly
    /// which one to pick.
    pub device_name: String,
    /// A stable code for the last thing that went wrong, translated by the UI.
    pub error: Option<String>,
}

/// What lives on disk next to the binary, so a restart knows how old it is.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Install {
    version: Option<String>,
    /// When it was downloaded, in seconds since the epoch.
    downloaded_at: u64,
    /// When the build was made, if `--version` said so. Expiry counts from here.
    built_at: Option<u64>,
    /// The last time the CDN was asked for a newer build.
    checked_at: Option<u64>,
}

#[derive(Default)]
pub struct SoloistState(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    child: Option<Arc<Mutex<Child>>>,
    commands: Option<Sender<Value>>,
    status: SoloistStatus,
    playback: Playback,
}

/// What Soloist last said about playback, in its own terms. Turned into a
/// `PlaybackStatus` on every read, so the position moves between events.
#[derive(Default, Clone)]
struct Playback {
    /// The song Starless asked for, as a bare id.
    requested: Option<String>,
    /// The song Soloist says is current, as a bare id.
    current: Option<String>,
    state: String,
    duration_ms: u32,
    position_ms: u64,
    /// Soloist's wall-clock anchor for `position_ms`, epoch milliseconds.
    anchor_ms: u64,
    speed: f64,
    volume: u16,
    /// The requested song was playing and is not any more: it ended, or
    /// Soloist moved on by itself. The queue is Starless's, so this is the
    /// moment to say "finished" and let the frontend pick what comes next.
    finished: bool,
    /// The song was heard playing, so a later `idle` means it ended.
    heard: bool,
    error: Option<String>,
}

// --- Paths --------------------------------------------------------------------

/// `%LOCALAPPDATA%\Starless\soloist`: it survives a sign-out, like everything
/// that belongs to the machine rather than to the account (`AGENTS.md`).
fn root() -> Option<PathBuf> {
    crate::paths::data_local_dir().map(|dir| dir.join("Starless").join("soloist"))
}

fn exe_path() -> Option<PathBuf> {
    root().map(|dir| dir.join("bin").join("soloist.exe"))
}

/// The Connect session lives here. It is the account's, so a sign-out removes
/// it while the binary stays.
fn data_dir() -> Option<PathBuf> {
    root().map(|dir| dir.join("data"))
}

fn cache_dir() -> Option<PathBuf> {
    root().map(|dir| dir.join("cache"))
}

fn install_path() -> Option<PathBuf> {
    root().map(|dir| dir.join("install.json"))
}

fn read_install() -> Install {
    install_path()
        .and_then(|path| std::fs::read(path).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn write_install(install: &Install) {
    if let (Some(path), Ok(bytes)) = (install_path(), serde_json::to_vec_pretty(install)) {
        let _ = std::fs::write(path, bytes);
    }
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The name in Spotify's device list. **The computer's name goes in it**: the
/// testers of Spotifast had two machines advertising the same name and had to
/// quit one to pair the other.
fn device_name() -> String {
    match std::env::var("COMPUTERNAME") {
        Ok(name) if !name.trim().is_empty() => format!("Starless ({})", name.trim()),
        _ => "Starless".to_string(),
    }
}

// --- Status ---------------------------------------------------------------------

impl SoloistState {
    fn with<T>(&self, f: impl FnOnce(&mut Inner) -> T) -> Option<T> {
        self.0.lock().ok().map(|mut inner| f(&mut inner))
    }

    /// The status the webview sees, with what is on disk read fresh.
    pub fn status(&self) -> SoloistStatus {
        let install = read_install();
        let installed = exe_path().is_some_and(|path| path.exists());
        let mut status = self.with(|inner| inner.status.clone()).unwrap_or_default();
        status.installed = installed;
        status.version = installed.then_some(install.version.clone()).flatten();
        status.expires_in_days = installed.then(|| expires_in_days(&install));
        status.has_key = key::read().is_some();
        status.device_name = device_name();
        status
    }

    /// Soloist is the one making the sound: it is up and it holds a session.
    pub fn active(&self) -> bool {
        self.with(|inner| inner.status.running && inner.status.paired).unwrap_or(false)
    }

    /// The playback state in the shape the player bar already reads.
    pub fn playback_status(&self) -> PlaybackStatus {
        let playback = self.with(|inner| inner.playback.clone()).unwrap_or_default();
        let playing = playback.state == "playing";
        let mut position = playback.position_ms;
        if playing && playback.anchor_ms > 0 {
            let elapsed = now_ms().saturating_sub(playback.anchor_ms) as f64 * playback.speed;
            position = position.saturating_add(elapsed as u64);
        }
        if playback.duration_ms > 0 {
            position = position.min(u64::from(playback.duration_ms));
        }
        PlaybackStatus {
            available: true,
            track_id: playback.requested.clone().or(playback.current.clone()),
            playing: playing && !playback.finished,
            loading: playback.state == "buffering"
                || (playback.requested.is_some() && !playback.heard && playback.error.is_none()),
            position_ms: position as u32,
            duration_ms: playback.duration_ms,
            real_duration_ms: playback.duration_ms,
            volume: playback.volume,
            finished: playback.finished,
            error: playback.error.clone(),
        }
    }

    fn set_error(&self, code: Option<&str>) {
        self.with(|inner| inner.status.error = code.map(str::to_string));
    }
}

fn expires_in_days(install: &Install) -> i64 {
    // A build downloaded before the date format was known has its version text
    // on disk: read the date from there instead of asking for a new download.
    let born = install
        .built_at
        .or_else(|| install.version.as_deref().and_then(build_date))
        .unwrap_or(install.downloaded_at);
    let ends = born + LIFETIME_DAYS * 86_400;
    (ends as i64 - now_secs() as i64).div_euclid(86_400)
}

fn push(app: &AppHandle) {
    if let Some(state) = app.try_state::<SoloistState>() {
        let _ = app.emit(EVENT, state.status());
    }
}

fn push_playback(app: &AppHandle) {
    if let Some(state) = app.try_state::<SoloistState>() {
        let _ = app.emit("player://status", state.playback_status());
    }
}

// --- Download -------------------------------------------------------------------

/// Download Spotify's build, check that Spotify signed it, and put it in place.
///
/// Blocking: a few megabytes over the network. Call it from a blocking thread.
pub fn download(app: &AppHandle) -> Result<(), String> {
    let root = root().ok_or_else(|| fail("soloist_no_dir", "no hay carpeta local"))?;
    let bin = root.join("bin");
    let staging = root.join("staging");
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| fail("soloist_no_dir", e))?;

    log::info!("soloist: descargando la build de Spotify");
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .user_agent(concat!("Starless/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| fail("soloist_download_failed", e))?;
    let response = client
        .get(DOWNLOAD_URL)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| fail("soloist_download_failed", e))?;
    let bytes = response.bytes().map_err(|e| fail("soloist_download_failed", e))?;

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| fail("soloist_bad_archive", e))?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| fail("soloist_bad_archive", e))?;
        // `enclosed_name` refuses `..` and absolute paths: an archive does not
        // get to write outside the folder it is unpacked into.
        let Some(relative) = entry.enclosed_name() else { continue };
        // The archive may wrap everything in a top folder; only the file names
        // matter, and `soloist.exe` is found wherever it is.
        let Some(name) = relative.file_name() else { continue };
        if entry.is_dir() {
            continue;
        }
        let target = staging.join(name);
        let mut out = std::fs::File::create(&target).map_err(|e| fail("soloist_bad_archive", e))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| fail("soloist_bad_archive", e))?;
    }

    let exe = staging.join("soloist.exe");
    if !exe.exists() {
        return Err(fail("soloist_bad_archive", "el archivo no trae soloist.exe"));
    }
    // **Nothing runs before the signature says Spotify.** Not even `--version`.
    signature::check_spotify(&exe)?;

    let version = read_version(&exe);
    log::info!("soloist: build verificada ({})", version.as_deref().unwrap_or("sin versión"));

    // Swap only after everything checked out: a failed download leaves the
    // build that was working where it was.
    stop(app);
    let _ = std::fs::remove_dir_all(&bin);
    std::fs::rename(&staging, &bin).map_err(|e| fail("soloist_no_dir", e))?;

    let now = now_secs();
    write_install(&Install {
        built_at: version.as_deref().and_then(build_date),
        version,
        downloaded_at: now,
        checked_at: Some(now),
    });
    if let Some(state) = app.try_state::<SoloistState>() {
        state.set_error(None);
    }
    push(app);
    Ok(())
}

/// The first line of `--version`, the one that names the build.
fn read_version(exe: &Path) -> Option<String> {
    let output = hidden(Command::new(exe)).arg("--version").output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().map(str::trim).find(|line| !line.is_empty()).map(str::to_string)
}

/// The build date in the version text, as epoch seconds.
///
/// **Measured on 1.3.10.51:** `soloist 1.3.10.51 build 1793988108 (20261106)
/// (g19412df6ea) (windows/x86_64)` — the date is the `(YYYYMMDD)` group. The
/// number after `build` looks like a timestamp and is not one (it lands in
/// 2026-11-05 by accident of its size), so it is not read. Without a date the
/// download date stands in, which can only make the expiry look later than it
/// is — and an expired build says so itself with exit code 10.
fn build_date(text: &str) -> Option<u64> {
    text.split(|c: char| c == '(' || c == ')').find_map(|group| {
        let group = group.trim();
        if group.len() != 8 || !group.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        let (y, m, d) = (
            group[0..4].parse::<i64>().ok()?,
            group[4..6].parse::<i64>().ok()?,
            group[6..8].parse::<i64>().ok()?,
        );
        if !(2024..=2100).contains(&y) || !(1..=12).contains(&m) || !(1..=31).contains(&d) {
            return None;
        }
        Some(days_from_civil(y, m, d) as u64 * 86_400)
    })
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Fetch a newer build when this one is close to expiring, at most once a day.
///
/// Quiet on purpose: the person never asked for it, and the build they have
/// still works. A failure here is logged and tried again tomorrow.
pub fn renew_if_due(app: &AppHandle) {
    let install = read_install();
    if !exe_path().is_some_and(|path| path.exists()) {
        return;
    }
    if expires_in_days(&install) > RENEW_DAYS as i64 {
        return;
    }
    if install.checked_at.is_some_and(|at| now_secs().saturating_sub(at) < 86_400) {
        return;
    }
    log::info!("soloist: la build vence pronto, se busca una nueva");
    if let Err(code) = download(app) {
        log::warn!("soloist: no se pudo renovar la build ({code}); se intenta mañana");
        let mut install = read_install();
        install.checked_at = Some(now_secs());
        write_install(&install);
    }
}

// --- The process ----------------------------------------------------------------

/// Start Soloist with the stored key, if everything it needs is in place.
///
/// Returns once the WebSocket answers, or with a code that says why not.
/// Blocking. Call it from a blocking thread.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<SoloistState>();
    if state.with(|inner| inner.status.running).unwrap_or(false) {
        return Ok(());
    }
    let exe = exe_path().filter(|path| path.exists()).ok_or_else(|| "soloist_not_installed".to_string())?;
    let key = key::read().ok_or_else(|| "soloist_no_key".to_string())?;
    let (data, cache) = (data_dir().unwrap_or_default(), cache_dir().unwrap_or_default());
    let _ = std::fs::create_dir_all(&data);
    let _ = std::fs::create_dir_all(&cache);
    // A port file left by a Soloist that died would point at nobody.
    let _ = std::fs::remove_file(data.join("ws.port"));
    let _ = std::fs::remove_file(data.join("ws.addr"));

    let mut command = hidden(Command::new(&exe));
    command
        .arg("--device-name")
        .arg(device_name())
        .arg("--api-key")
        .arg(&key)
        .arg("--data-dir")
        .arg(&data)
        .arg("--cache-dir")
        .arg(&cache)
        // Loopback and a port the system picks: the API has no authentication
        // and no `Origin` check, so it is never reachable from the network and
        // never at a port anybody can guess in advance.
        .arg("--ws")
        .arg("127.0.0.1:0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(volume) = crate::settings::saved_volume() {
        command.arg("--initial-volume").arg(to_percent(volume).to_string());
    }

    let mut child = command.spawn().map_err(|e| fail("soloist_start_failed", e))?;
    // What Soloist prints goes to the log, line by line. The key is an argument
    // and never part of its output, but a line that carries it is dropped anyway.
    for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
                   child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
        .into_iter()
        .flatten()
    {
        let key = key.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                if !line.contains(&key) {
                    log::info!("soloist: {line}");
                }
            }
        });
    }
    let child = Arc::new(Mutex::new(child));
    state.with(|inner| inner.child = Some(child.clone()));

    // Wait for the port, or for the process to give up.
    let started = Instant::now();
    let port = loop {
        if let Some(port) = std::fs::read_to_string(data.join("ws.port"))
            .ok()
            .and_then(|text| text.trim().parse::<u16>().ok())
        {
            break port;
        }
        if let Ok(Some(exit)) = child.lock().map_err(|_| ()).and_then(|mut c| c.try_wait().map_err(|_| ())) {
            state.with(|inner| inner.child = None);
            let code = match exit.code() {
                Some(EXIT_EXPIRED) => "soloist_expired",
                // A bad key, a busy data directory or a bad argument: Soloist
                // says which in the log, and `1` is all its exit code says.
                _ => "soloist_start_failed",
            };
            log::warn!("soloist: salió antes de abrir el WebSocket ({exit})");
            state.set_error(Some(code));
            push(app);
            return Err(code.to_string());
        }
        if started.elapsed() > START_TIMEOUT {
            stop(app);
            state.set_error(Some("soloist_start_failed"));
            push(app);
            return Err("soloist_start_failed".to_string());
        }
        std::thread::sleep(Duration::from_millis(100));
    };

    let (tx, rx) = mpsc::channel::<Value>();
    state.with(|inner| {
        inner.commands = Some(tx);
        inner.status.running = true;
        inner.status.error = None;
    });
    log::info!("soloist: corriendo, WebSocket en 127.0.0.1:{port}");

    // The socket's own thread: it reads events and sends commands.
    let socket_app = app.clone();
    std::thread::spawn(move || run_socket(&socket_app, port, rx));

    // And one that waits for the process to end, to say why.
    let watch_app = app.clone();
    std::thread::spawn(move || watch_exit(&watch_app, child));

    push(app);
    Ok(())
}

/// Stop Soloist. Used on sign-out, on exit, and before a new build is swapped in.
pub fn stop(app: &AppHandle) {
    let Some(state) = app.try_state::<SoloistState>() else { return };
    let child = state.with(|inner| {
        inner.commands = None;
        inner.status.running = false;
        inner.status.paired = false;
        inner.playback = Playback::default();
        inner.child.take()
    });
    if let Some(Some(child)) = child {
        if let Ok(mut child) = child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Stop Soloist and forget everything that was the account's: the key and the
/// Connect session. The binary stays — it is the machine's, not the account's.
pub fn forget(app: &AppHandle) {
    stop(app);
    key::delete();
    if let Some(data) = data_dir() {
        let _ = std::fs::remove_dir_all(data);
    }
    push(app);
}

fn watch_exit(app: &AppHandle, child: Arc<Mutex<Child>>) {
    let exit = loop {
        match child.lock().ok().and_then(|mut c| c.try_wait().ok()) {
            Some(Some(exit)) => break exit,
            Some(None) => std::thread::sleep(Duration::from_millis(500)),
            None => return,
        }
    };
    let Some(state) = app.try_state::<SoloistState>() else { return };
    // A stop we asked for already cleared the slot; only an exit nobody asked
    // for is worth a word.
    let ours = state
        .with(|inner| inner.child.as_ref().is_some_and(|c| Arc::ptr_eq(c, &child)))
        .unwrap_or(false);
    if !ours {
        return;
    }
    log::warn!("soloist: el proceso terminó solo ({exit})");
    let code = if exit.code() == Some(EXIT_EXPIRED) { "soloist_expired" } else { "soloist_stopped" };
    state.with(|inner| {
        inner.child = None;
        inner.commands = None;
        inner.status.running = false;
        inner.status.paired = false;
        inner.status.error = Some(code.to_string());
        inner.playback.error = Some(code.to_string());
    });
    push(app);
    push_playback(app);
}

/// A `Command` that opens no console window.
fn hidden(mut command: Command) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

// --- The WebSocket ----------------------------------------------------------------

fn run_socket(app: &AppHandle, port: u16, commands: Receiver<Value>) {
    let stream = match TcpStream::connect(("127.0.0.1", port)) {
        Ok(stream) => stream,
        Err(error) => {
            log::warn!("soloist: no se pudo abrir el WebSocket: {error}");
            return;
        }
    };
    let _ = stream.set_nodelay(true);
    let (mut socket, _) = match tungstenite::client(format!("ws://127.0.0.1:{port}"), stream) {
        Ok(pair) => pair,
        Err(error) => {
            log::warn!("soloist: el WebSocket no aceptó la conexión: {error}");
            return;
        }
    };
    // Short reads, so the loop can send a command without waiting for an event.
    let _ = socket.get_ref().set_read_timeout(Some(Duration::from_millis(50)));
    let _ = socket.send(tungstenite::Message::text(json!({"type": "command", "command": "get_auth_state"}).to_string()));

    let mut last_tick = Instant::now();
    loop {
        // Commands first: a click is what the person is waiting for.
        loop {
            match commands.try_recv() {
                Ok(command) => {
                    if socket.send(tungstenite::Message::text(command.to_string())).is_err() {
                        return;
                    }
                }
                Err(mpsc::TryRecvError::Empty) => break,
                // The sender went away: Soloist was stopped.
                Err(mpsc::TryRecvError::Disconnected) => {
                    let _ = socket.close(None);
                    return;
                }
            }
        }
        match socket.read() {
            Ok(tungstenite::Message::Text(text)) => {
                if let Ok(event) = serde_json::from_str::<Value>(text.as_str()) {
                    handle_event(app, &event);
                }
            }
            Ok(tungstenite::Message::Close(_)) => return,
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(error) => {
                log::warn!("soloist: el WebSocket se cerró: {error}");
                return;
            }
        }
        // The bar moves between events.
        if last_tick.elapsed() >= TICK {
            last_tick = Instant::now();
            let playing = app
                .try_state::<SoloistState>()
                .and_then(|s| s.with(|i| i.playback.state == "playing"))
                .unwrap_or(false);
            if playing {
                push_playback(app);
            }
        }
    }
}

/// A Spotify URI or id, as a bare id.
fn bare_id(value: &str) -> String {
    value.rsplit(':').next().unwrap_or(value).to_string()
}

/// The id and duration of a playback `item`.
///
/// **The duration is nested, measured on Soloist 1.3.10.51:** the item is
/// `{"uri": "spotify:track:…", "entity_type": "track", "decorations": {…},
/// "playback": {"duration_ms": 242573}}`. Reading it at the top level, as a
/// first guess did, left the bar at 0:00 with the position running.
fn read_item(item: &Value) -> (Option<String>, Option<u32>) {
    let id = item.get("uri").and_then(Value::as_str).map(bare_id);
    let duration = item
        .pointer("/playback/duration_ms")
        .or_else(|| item.get("duration_ms"))
        .and_then(Value::as_u64)
        .map(|ms| ms as u32);
    (id, duration)
}

fn handle_event(app: &AppHandle, event: &Value) {
    let Some(state) = app.try_state::<SoloistState>() else { return };
    let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
    match kind {
        "auth_state" => {
            let paired = event.get("logged_in").and_then(Value::as_bool).unwrap_or(false);
            let was = state.with(|inner| std::mem::replace(&mut inner.status.paired, paired)).unwrap_or(false);
            if paired && !was {
                log::info!("soloist: emparejado, la reproducción pasa a Soloist");
                // Soloist is the one playing now: librespot's player gives the
                // audio device back so the two never hold it at once.
                if let Some(playback) = app.try_state::<crate::playback::PlaybackState>() {
                    crate::playback::shutdown(&playback);
                }
            }
            push(app);
        }
        "playback_state" => {
            state.with(|inner| {
                let p = &mut inner.playback;
                if let Some(status) = event.get("status").and_then(Value::as_str) {
                    apply_status(p, status);
                }
                if let Some(item) = event.get("item") {
                    let (id, duration) = read_item(item);
                    apply_track(p, id);
                    if let Some(duration) = duration {
                        p.duration_ms = duration;
                    }
                }
                if let Some(position) = event.get("position") {
                    apply_position(p, position);
                }
                if let Some(volume) = event.get("volume").and_then(Value::as_u64) {
                    p.volume = from_percent(volume as u16);
                }
            });
            push_playback(app);
        }
        "track_changed" => {
            state.with(|inner| {
                if let Some(item) = event.get("item") {
                    let (id, duration) = read_item(item);
                    apply_track(&mut inner.playback, id);
                    if let Some(duration) = duration {
                        inner.playback.duration_ms = duration;
                    }
                }
            });
            push_playback(app);
        }
        "playback_changed" => {
            if let Some(status) = event.get("status").and_then(Value::as_str) {
                state.with(|inner| apply_status(&mut inner.playback, status));
                push_playback(app);
            }
        }
        "position_sync" => {
            if let Some(position) = event.get("position") {
                state.with(|inner| apply_position(&mut inner.playback, position));
                push_playback(app);
            }
        }
        "volume_changed" => {
            if let Some(volume) = event.get("volume").and_then(Value::as_u64) {
                state.with(|inner| inner.playback.volume = from_percent(volume as u16));
                push_playback(app);
            }
        }
        "error" => {
            let message = event.get("message").and_then(Value::as_str).unwrap_or("");
            log::warn!("soloist: error del WebSocket: {message}");
        }
        _ => {}
    }
}

fn apply_status(p: &mut Playback, status: &str) {
    if status == "playing" && p.requested.is_some() && p.current == p.requested {
        p.heard = true;
        p.error = None;
    }
    // The song that was heard went quiet by itself: it ended.
    if status == "idle" && p.heard && p.requested.is_some() {
        p.finished = true;
    }
    p.state = status.to_string();
}

fn apply_track(p: &mut Playback, id: Option<String>) {
    // Soloist moved on from the song Starless asked for —its own autoplay, or
    // the end of a context—: for Starless that song finished, and what plays
    // next is the queue's decision, not Soloist's.
    if p.heard && p.requested.is_some() && id != p.requested && id.is_some() {
        p.finished = true;
    }
    p.current = id;
}

fn apply_position(p: &mut Playback, position: &Value) {
    if let Some(ms) = position.get("position_ms").and_then(Value::as_u64) {
        p.position_ms = ms;
    }
    p.anchor_ms = position.get("timestamp_ms").and_then(Value::as_u64).unwrap_or_else(now_ms);
    p.speed = position.get("speed").and_then(Value::as_f64).unwrap_or(0.0);
}

/// Starless's volume scale (0..=65535) to Soloist's (0..=100).
fn to_percent(volume: u16) -> u16 {
    ((u32::from(volume) * 100 + 32_767) / 65_535) as u16
}

fn from_percent(percent: u16) -> u16 {
    (u32::from(percent.min(100)) * 65_535 / 100) as u16
}

fn send(app: &AppHandle, command: Value) -> Result<(), String> {
    let state = app.state::<SoloistState>();
    let sender = state.with(|inner| inner.commands.clone()).flatten();
    match sender {
        Some(sender) => sender.send(command).map_err(|_| "soloist_stopped".to_string()),
        None => Err("soloist_stopped".to_string()),
    }
}

// --- What the playback commands call while Soloist is active ----------------------

pub fn play(app: &AppHandle, track_id: &str, position_ms: u32) -> Result<(), String> {
    let id = bare_id(track_id);
    app.state::<SoloistState>().with(|inner| {
        inner.playback = Playback {
            requested: Some(id.clone()),
            volume: inner.playback.volume,
            state: "buffering".to_string(),
            ..Playback::default()
        };
    });
    // `activate` first: the device that was picked once is not necessarily the
    // active one now, and `play` on an inactive device has nowhere to sound.
    send(app, json!({"type": "command", "command": "activate"}))?;
    send(app, json!({"type": "command", "command": "play", "uri": format!("spotify:track:{id}")}))?;
    if position_ms > 0 {
        send(app, json!({"type": "command", "command": "seek", "position_ms": position_ms}))?;
    }
    push_playback(app);
    Ok(())
}

pub fn toggle(app: &AppHandle) -> Result<(), String> {
    let status = app.state::<SoloistState>().playback_status();
    if status.playing {
        send(app, json!({"type": "command", "command": "pause"}))
    } else if status.finished {
        // A song that ended does not resume: it starts again, like librespot's
        // path does from `EndOfTrack`.
        match status.track_id {
            Some(id) => play(app, &id, 0),
            None => Ok(()),
        }
    } else {
        send(app, json!({"type": "command", "command": "play"}))
    }
}

pub fn seek(app: &AppHandle, position_ms: u32) -> Result<(), String> {
    send(app, json!({"type": "command", "command": "seek", "position_ms": position_ms}))
}

pub fn set_volume(app: &AppHandle, volume: u16) {
    app.state::<SoloistState>().with(|inner| inner.playback.volume = volume);
    let _ = send(app, json!({"type": "command", "command": "set_volume", "volume": to_percent(volume)}));
    crate::settings::save_volume(volume);
}

// --- The key ------------------------------------------------------------------------

/// Store the key, then prove it by starting Soloist with it.
///
/// **A refused key is said now, not later.** The testers of Spotifast met a bad
/// key only when nothing played; here the setup answers the paste.
pub fn set_key(app: &AppHandle, value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 || value.chars().any(char::is_whitespace) {
        return Err("soloist_key_invalid".to_string());
    }
    stop(app);
    key::write(value)?;
    match start(app) {
        Ok(()) => Ok(()),
        Err(code) if code == "soloist_start_failed" => {
            // Soloist exits with `1` for a key it does not accept. The stored
            // one goes, so the next start does not try it again.
            key::delete();
            push(app);
            Err("soloist_key_refused".to_string())
        }
        Err(code) => Err(code),
    }
}

fn fail(code: &str, detail: impl std::fmt::Display) -> String {
    log::error!("[{code}]: {detail}");
    code.to_string()
}

#[cfg(windows)]
mod key {
    //! The key in the Windows Credential Manager: encrypted for the user by the
    //! system, outside every file Starless writes, and gone with `delete`.

    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    const TARGET: &str = "Starless/soloist-api-key";

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn write(value: &str) -> Result<(), String> {
        let mut target = wide(TARGET);
        let mut blob = value.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        // SAFETY: every pointer in `credential` points into a buffer that lives
        // until the call returns, and the system copies what it keeps.
        unsafe { CredWriteW(&credential, 0) }.map_err(|e| super::fail("soloist_key_store_failed", e))
    }

    pub fn read() -> Option<String> {
        let target = wide(TARGET);
        let mut found: *mut CREDENTIALW = std::ptr::null_mut();
        // SAFETY: `found` is filled by the system and released with `CredFree`.
        unsafe {
            CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut found).ok()?;
            let credential = &*found;
            let bytes = std::slice::from_raw_parts(
                credential.CredentialBlob,
                credential.CredentialBlobSize as usize,
            );
            let value = String::from_utf8(bytes.to_vec()).ok();
            CredFree(found as *const _);
            value.filter(|v| !v.is_empty())
        }
    }

    pub fn delete() {
        let target = wide(TARGET);
        // SAFETY: a plain call with a buffer that outlives it.
        let _ = unsafe { CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) };
    }
}

#[cfg(not(windows))]
mod key {
    //! Soloist is offered on Windows only for now: there is no credential store
    //! wired here for anything else, and a key in a plain file is not an option.
    pub fn write(_: &str) -> Result<(), String> {
        Err("soloist_unsupported".to_string())
    }
    pub fn read() -> Option<String> {
        None
    }
    pub fn delete() {}
}

#[cfg(windows)]
mod signature {
    //! Authenticode: the file is signed, the chain is trusted, and the signer is
    //! Spotify. Anything else and the file is deleted before it ever runs.

    use std::path::Path;

    use windows::core::{GUID, PCWSTR};
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::Security::Cryptography::{CertGetNameStringW, CERT_NAME_SIMPLE_DISPLAY_TYPE};
    use windows::Win32::Security::WinTrust::{
        WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData, WinVerifyTrust,
        WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0, WINTRUST_FILE_INFO,
        WTD_CHOICE_FILE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY,
        WTD_UI_NONE,
    };

    pub fn check_spotify(path: &Path) -> Result<(), String> {
        let wide: Vec<u16> = path.as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
        let mut file = WINTRUST_FILE_INFO {
            cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
            pcwszFilePath: PCWSTR(wide.as_ptr()),
            ..Default::default()
        };
        let mut data = WINTRUST_DATA {
            cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
            dwUIChoice: WTD_UI_NONE,
            fdwRevocationChecks: WTD_REVOKE_NONE,
            dwUnionChoice: WTD_CHOICE_FILE,
            Anonymous: WINTRUST_DATA_0 { pFile: &mut file },
            dwStateAction: WTD_STATEACTION_VERIFY,
            ..Default::default()
        };
        let mut action: GUID = WINTRUST_ACTION_GENERIC_VERIFY_V2;

        // SAFETY: `data` and `file` outlive both calls; the state handle the
        // first call opens is closed by the second one on every path.
        let (trusted, signer) = unsafe {
            let result = WinVerifyTrust(HWND::default(), &mut action, &mut data as *mut _ as *mut _);
            let signer = if result == 0 { signer_name(data.hWVTStateData) } else { None };
            data.dwStateAction = WTD_STATEACTION_CLOSE;
            WinVerifyTrust(HWND::default(), &mut action, &mut data as *mut _ as *mut _);
            (result == 0, signer)
        };

        if !trusted {
            let _ = std::fs::remove_file(path);
            return Err(super::fail("soloist_unsigned", "la firma de soloist.exe no es válida"));
        }
        match signer {
            Some(name) if name.starts_with("Spotify") => {
                log::info!("soloist: firmado por {name}");
                Ok(())
            }
            other => {
                let _ = std::fs::remove_file(path);
                Err(super::fail(
                    "soloist_unsigned",
                    format!("soloist.exe está firmado por {:?}, no por Spotify", other),
                ))
            }
        }
    }

    /// The display name of the certificate that signed the file.
    unsafe fn signer_name(state: HANDLE) -> Option<String> {
        // SAFETY: the caller holds the verified state open; every pointer
        // read here is checked for null before it is followed.
        unsafe {
            let provider = WTHelperProvDataFromStateData(state);
            if provider.is_null() {
                return None;
            }
            let signer = WTHelperGetProvSignerFromChain(provider, 0, false, 0);
            if signer.is_null() || (*signer).pasCertChain.is_null() {
                return None;
            }
            let cert = (*(*signer).pasCertChain).pCert;
            let mut buffer = [0u16; 256];
            let len = CertGetNameStringW(cert, CERT_NAME_SIMPLE_DISPLAY_TYPE, 0, None, Some(&mut buffer));
            (len > 1).then(|| String::from_utf16_lossy(&buffer[..len as usize - 1]))
        }
    }
}

#[cfg(not(windows))]
mod signature {
    pub fn check_spotify(_: &std::path::Path) -> Result<(), String> {
        Err("soloist_unsupported".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **The guarantee librespot accounts depend on.** Every playback command
    /// asks `active()` first; for an account that never set Soloist up it has to
    /// say no, or play, pause, seek and volume would go to a player that is not
    /// there. Running without a pairing is not enough either: until Soloist holds
    /// a session there is nothing for it to play.
    #[test]
    fn a_soloist_that_is_not_paired_never_takes_the_playback() {
        let state = SoloistState::default();
        assert!(!state.active());
        state.with(|inner| inner.status.running = true);
        assert!(!state.active());
        state.with(|inner| inner.status.paired = true);
        assert!(state.active());
        state.with(|inner| inner.status.running = false);
        assert!(!state.active());
    }

    #[test]
    fn the_volume_goes_both_ways_without_drifting() {
        for percent in [0u16, 1, 37, 50, 99, 100] {
            assert_eq!(to_percent(from_percent(percent)), percent);
        }
        assert_eq!(to_percent(65_535), 100);
        assert_eq!(to_percent(0), 0);
    }

    #[test]
    fn a_build_date_is_read_from_the_version_text() {
        // The real line, from Soloist 1.3.10.51.
        let at = build_date(
            "soloist 1.3.10.51 build 1793988108 (20261106) (g19412df6ea) (windows/x86_64)",
        )
        .unwrap();
        assert_eq!(at, days_from_civil(2026, 11, 6) as u64 * 86_400);
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert!(build_date("soloist 1.3.10.51 build 1793988108").is_none());
    }

    #[test]
    fn the_duration_is_read_where_soloist_puts_it() {
        // The item as Soloist 1.3.10.51 sends it, trimmed.
        let item = serde_json::json!({
            "uri": "spotify:track:0fea68AdmYNygeTGI4RC18",
            "entity_type": "track",
            "playback": {"duration_ms": 242573, "content_ratings": []}
        });
        assert_eq!(read_item(&item), (Some("0fea68AdmYNygeTGI4RC18".to_string()), Some(242573)));
    }

    #[test]
    fn a_song_that_soloist_left_behind_counts_as_finished() {
        let mut p = Playback { requested: Some("a".into()), ..Default::default() };
        apply_track(&mut p, Some("a".into()));
        apply_status(&mut p, "playing");
        assert!(p.heard && !p.finished);
        apply_track(&mut p, Some("autoplay".into()));
        assert!(p.finished);
    }

    #[test]
    fn a_song_that_went_idle_after_playing_counts_as_finished() {
        let mut p = Playback { requested: Some("a".into()), ..Default::default() };
        apply_track(&mut p, Some("a".into()));
        apply_status(&mut p, "playing");
        apply_status(&mut p, "idle");
        assert!(p.finished);
    }

    #[test]
    fn idle_before_the_song_is_heard_is_not_an_ending() {
        let mut p = Playback { requested: Some("a".into()), ..Default::default() };
        apply_status(&mut p, "idle");
        apply_track(&mut p, Some("other".into()));
        assert!(!p.finished);
    }

    #[test]
    fn a_uri_is_read_as_a_bare_id() {
        assert_eq!(bare_id("spotify:track:42qNWdLKCI41S4uzfamhFM"), "42qNWdLKCI41S4uzfamhFM");
        assert_eq!(bare_id("42qNWdLKCI41S4uzfamhFM"), "42qNWdLKCI41S4uzfamhFM");
    }
}
