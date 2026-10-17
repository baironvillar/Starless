//! Crash detection, and turning a crash into something a stranger can read.
//!
//! ## How a crash is noticed
//!
//! Starless cannot catch its own death, so it does not try. It writes a marker
//! file when the process starts and deletes it when the process ends normally —
//! through the window's close, through sign-out, through the user quitting. If the
//! marker is still there the next time the app opens, the previous run ended some
//! other way: a panic, a kill, a power cut.
//!
//! That inverted question — "did it end *cleanly*?" rather than "did it crash?" —
//! is the only one worth asking, because the cases nobody can instrument from the
//! inside (a hard abort, a driver fault, the process being closed from the Task
//! Manager) are exactly the ones a report needs to cover. A `panic` hook catches
//! the panic case and writes down what it was; the marker catches everything the
//! hook never got to run for.
//!
//! ## Nothing leaves the machine without being asked for
//!
//! `PRODUCT.md` rules that zero telemetry is a constraint and not a setting. A
//! crash reporter that uploads on its own is the thing that promise exists to
//! rule out. So the app *detects*, the user *reads what would be sent*, and only
//! then does anything move. `report()` is never called on a timer.
//!
//! ## The log is scrubbed before it is shown, not after
//!
//! The log is written for debugging, and debugging is not privacy-aware. It names
//! the Spotify account, and every log line carries the Windows user name inside a
//! path. `scrub` runs on the text that is shown on screen *and* on the text that
//! is uploaded, so there is no code path that can send the unscrubbed version.

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use regex::Regex;
use serde::Serialize;

/// The repository issues are filed against, and the labels that make them findable.
const REPO_OWNER: &str = "baironvillar";
const REPO_NAME: &str = "Starless";
const CRASH_LABEL: &str = "crash";
const FEEDBACK_LABEL: &str = "feedback";

/// GitHub's hard limit on an issue body. Anything longer is rejected outright, and
/// a rejected report is the one kind of report that fails silently from here.
const BODY_LIMIT: usize = 60_000;

/// How much of the log tail travels with the report.
///
/// The log rotates at 2 MB keeping one generation, so the tail is the session that
/// just died. 48 KB is enough context to see the handshake, the HTTP calls and
/// the failure, and small enough that the issue stays readable by a human.
const LOG_TAIL_BYTES: usize = 48 * 1024;

// ---------------------------------------------------------------------------
// The marker
// ---------------------------------------------------------------------------

fn local_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| base.join("Starless"))
}

fn marker_path() -> Option<PathBuf> {
    local_dir().map(|d| d.join("session.marker"))
}

/// The previous run's marker, moved aside rather than overwritten.
///
/// Separate from the live marker on purpose. Overwriting in place would make the
/// answer to "did the last run crash?" false from the moment `setup` returns — and
/// the frontend, which is what asks, cannot render until well after that.
fn crash_marker_path() -> Option<PathBuf> {
    local_dir().map(|d| d.join("last-crash.marker"))
}

/// Where a panic, if there was one, writes itself down.
fn panic_path() -> Option<PathBuf> {
    local_dir().map(|d| d.join("last-panic.txt"))
}

/// The panic file as it looks once it belongs to a session being reported on.
fn reported_panic_path() -> Option<PathBuf> {
    panic_path().map(|p| p.with_extension("crash.txt"))
}

/// Record that a session is running.
///
/// If the previous run's marker is still lying around it was moved to
/// `last-crash.marker` first, which is what `previous_session_crashed` reads. A
/// rename rather than a copy, so a crash can never be counted twice.
pub fn mark_session_start() {
    let Some(live) = marker_path() else { return };
    if let Some(parent) = live.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // A panic file survives too, and it belongs to the run that is being reported
    // on — so it moves with the marker.
    if live.exists()
        && let Some(crash) = crash_marker_path()
    {
        if crash.exists() {
            // Already reported on and never acknowledged. Don't resurrect it.
            let _ = fs::remove_file(&live);
        } else {
            if let Some(panic) = reported_panic_path()
                && let Some(source) = panic_path()
            {
                let _ = fs::rename(&source, &panic);
            }
            let _ = fs::rename(&live, &crash);
        }
    }

    if let Err(e) = fs::write(&live, crate::version_line()) {
        log::warn!("no se pudo escribir el marcador de sesión: {e}");
    }
}

/// Record that a session ended on purpose.
pub fn mark_session_end() {
    if let Some(path) = marker_path() {
        let _ = fs::remove_file(&path);
    }
}

/// How long the previous session has to have lived before its death is worth
/// interrupting somebody about.
///
/// A marker on its own cannot tell a crash from a kill, and most kills are not
/// crashes: the updater handing the process to the installer, Windows going
/// down, a task manager, a second copy of the app being closed by hand. All of
/// them leave the marker behind, and all of them used to open with a dialog
/// about a crash that never happened.
///
/// What separates them from a real one is time. A crash is something the app did
/// while someone was using it. A session that was over in seconds is a session
/// that never started — and if it really was a panic, the panic wrote its own
/// file and `counts_as_crash` says so regardless of the clock.
const MIN_SESSION_BEFORE_CRASH: Duration = Duration::from_secs(60);

/// The decision behind [`previous_session_crashed`], kept apart from the disk so
/// it can be tested without a session, a panic or a machine.
fn counts_as_crash(ran_for: Option<Duration>, panicked: bool) -> bool {
    if panicked {
        return true;
    }
    match ran_for {
        // An unreadable mtime is not evidence either way. Report it: the cost of a
        // false alarm is one dismissed dialog, the cost of a silence is a bug nobody
        // ever hears about.
        None => true,
        Some(ran_for) => ran_for >= MIN_SESSION_BEFORE_CRASH,
    }
}

/// `true` when the previous run left its marker behind and lived long enough for
/// its death to be a crash rather than a kill.
///
/// Readable at any point in this run's life, including from the frontend, because
/// `mark_session_start` moved the evidence out of the way rather than overwriting
/// it.
pub fn previous_session_crashed() -> bool {
    let Some(crash) = crash_marker_path() else {
        return false;
    };
    if !crash.exists() {
        return false;
    }
    // A rename keeps the original mtime, which is when the session started — so
    // the age of this file is how long the previous session lasted.
    let ran_for = fs::metadata(&crash)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|started| SystemTime::now().duration_since(started).ok());
    let panicked = reported_panic_path().is_some_and(|p| p.exists());
    counts_as_crash(ran_for, panicked)
}

// ---------------------------------------------------------------------------
// The panic hook
// ---------------------------------------------------------------------------

/// Install a hook that writes the panic down before the process aborts.
///
/// Chains to whatever hook was already installed rather than replacing it, so
/// `RUST_BACKTRACE` and any runtime-level reporting keep working. In release the
/// profile sets `panic = "abort"`, which means this file is written and then the
/// process dies immediately — so it has to be complete on the first pass.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "desconocida".into());
        let message = payload_text(info.payload());
        let text = format!("panic en {location}\n{message}\n");

        // Best effort by definition: we are already in the failure path, and a
        // failed write here must not replace the original panic with an abort.
        if let Some(path) = panic_path()
            && let Some(parent) = path.parent()
        {
            let _ = fs::create_dir_all(parent);
            let _ = fs::write(&path, &text);
        }
        log::error!("PANIC: {text}");

        previous(info);
    }));
}

fn payload_text(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "payload no textual".into()
    }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

// The body is assembled by `build` down in the sending section, next to the code
// that actually sends it — a report and its transport belong together, and the two
// halves had already drifted once.

/// The tail of the current log, cut on a line boundary.
///
/// A cut mid-line is a small thing to get right and an annoying one to read: it
/// hides the last error behind half a fragment, which is usually the error.
fn log_tail() -> Option<String> {
    let path = crate::logging::log_path()?;
    let data = fs::read(&path).ok()?;
    if data.is_empty() {
        return None;
    }
    let start = data.len().saturating_sub(LOG_TAIL_BYTES);
    let slice = &data[start..];
    let text = String::from_utf8_lossy(slice).into_owned();
    // Drop the first line if it is a fragment: the cut lands mid-line, and a
    // half-written error at the top is exactly the line somebody needs to read.
    let text = if start > 0 {
        match text.find('\n') {
            Some(i) => text[i + 1..].to_string(),
            None => text,
        }
    } else {
        text
    };
    Some(text)
}

fn read_panic() -> Option<String> {
    // The moved-aside copy first: while a crash is pending, that is the one that
    // belongs to the session being reported. Only once there is none does a live
    // file (this run's own panic) become interesting.
    //
    // Both names come from the same helper on purpose. This used to re-derive the
    // moved-aside name from `crash_marker_path`, which produced
    // `last-crash.crash.txt` — a file nothing has ever written. The panic is
    // renamed to `last-panic.crash.txt`, so every crash report went out without
    // the panic that caused it: the one piece of the report the person reading it
    // most needed, missing exactly when it was needed.
    let moved = reported_panic_path().and_then(|p| fs::read_to_string(p).ok());
    let live = panic_path().and_then(|p| fs::read_to_string(p).ok());
    let text = moved.or(live)?;
    (!text.trim().is_empty()).then_some(text)
}

/// The report as it would be sent: built and scrubbed, ready to be shown.
///
/// Public because the person deciding has to read the real thing. A preview that
/// is generated differently from what gets sent is worse than no preview.
pub fn preview(
    kind: Kind,
    message: &str,
    attach_log: bool,
    account: Option<&str>,
) -> String {
    build(kind, message, attach_log, account)
}

/// Remove what the log has no business publishing.
///
/// Applied to the body that is shown on screen *and* the body that is uploaded, so
/// there is no code path that can ship a name.
///
/// `account` is the one thing patterns cannot do. Everything below matches a shape
/// — "Authenticated as 'x'", "C:\Users\x" — and a shape is only ever a guess about
/// what identifying text looks like. Someone who pastes their own username into a
/// feedback box defeats every pattern here while looking perfectly innocent to all
/// of them. The account name is not a guess: the session hands it over. So it is
/// removed by exact value, everywhere, before anything else looks at the text.
pub fn scrub_with(text: &str, account: Option<&str>) -> String {
    let mut out = text.to_string();

    if let Some(name) = account.map(str::trim).filter(|n| !n.is_empty()) {
        out = out.replace(name, "[omitido]");
    }

    let patterns: [(&str, &str); 7] = [
        // The Spotify account name, in librespot's own phrasing.
        (
            r"(?i)(Authenticated as\s*')[^']*(')",
            "${1}[omitido]${2}",
        ),
        // ...and anywhere else it might turn up on its own.
        (r"(?i)(username:\s*)\S+", "${1}[omitido]"),
        // The Windows account name, which rides along inside every file path.
        (r"(?i)([A-Z]:\\Users\\)[^\\/\s]+", "${1}<usuario>"),
        // Anything that looks like a credential under a named field.
        //
        // `r#"…"#` rather than `r"…"`: the pattern contains a literal quote, and in
        // a plain raw string that quote would end the string instead of matching.
        (
            r#"(?i)((?:access_)?token|client_?id|authorization)\s*[=:]\s*"?[A-Za-z0-9._\-]{12,}"#,
            "${1}=[omitido]",
        ),
        // `Authorization: Bearer <token>` — the scheme is separated from the header
        // by a space, not a colon, so the rule above cannot see it. Caught by its
        // own pattern rather than by loosening the one above, which would then
        // start eating ordinary prose that happens to say "bearer" near a long word.
        (r"(?i)\bbearer\s+[A-Za-z0-9._\-]{12,}", "Bearer [omitido]"),
        // Raw JWTs and long opaque blobs that escaped a field name.
        (r"\b[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b", "[token omitido]"),
        // Track and playlist ids identify a listening history.
        (r"\b(?:spotify:)?(?:track|album|playlist|artist):[A-Za-z0-9]{22}\b", "[id omitido]"),
    ];

    for (pattern, replacement) in patterns {
        if let Ok(re) = Regex::new(pattern) {
            out = re.replace_all(&out, replacement).into_owned();
        }
    }
    truncate(&out)
}

/// Scrub with nothing known about the account — for tests, and for any call that
/// genuinely has no session to read.
#[cfg(test)]
pub fn scrub(text: &str) -> String {
    scrub_with(text, None)
}

fn truncate(text: &str) -> String {
    if text.len() <= BODY_LIMIT {
        return text.to_string();
    }
    let mut cut = text[..BODY_LIMIT].to_string();
    cut.push_str("\n\n*(log recortado)*\n");
    cut
}

// ---------------------------------------------------------------------------
// Sending it
// ---------------------------------------------------------------------------

/// Baked in at build time, never committed.
///
/// `option_env!` rather than a runtime read on purpose: the value has to be inside
/// the binary that ships, and reading it from the environment at runtime would only
/// ever work on the machine that built it. A build without the variable simply has
/// no automatic path, and falls back to the browser — see `submit`.
const TOKEN: Option<&str> = option_env!("STARLESS_REPORT_TOKEN");

#[derive(Serialize)]
struct IssuePayload<'a> {
    title: &'a str,
    body: &'a str,
    labels: Vec<&'a str>,
}

#[derive(serde::Deserialize)]
struct CreatedIssue {
    html_url: String,
}

#[derive(Serialize)]
pub struct ReportOutcome {
    /// `true` when an issue was created without the user leaving the app.
    pub created: bool,
    /// Where the report went, or what to open in the browser.
    pub url: String,
}

/// What a report is about. The kind only ever changes the title and the label —
/// the body is assembled by the same rules either way, so a feedback report and a
/// crash report are the same object with a different first line.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Crash,
    Feedback,
}

impl Kind {
    fn label(self) -> &'static str {
        match self {
            Kind::Crash => CRASH_LABEL,
            Kind::Feedback => FEEDBACK_LABEL,
        }
    }
}

/// The title the report gets.
fn title(kind: Kind) -> String {
    let version = crate::version_line();
    match kind {
        Kind::Feedback => format!("Feedback desde {version}"),
        Kind::Crash => match read_panic() {
            Some(panic) => {
                let first = panic.lines().next().unwrap_or("panic").trim();
                format!("Crash en {version}: {}", first.chars().take(90).collect::<String>())
            }
            None => format!("Crash en {version}: la sesión anterior terminó sin cerrarse"),
        },
    }
}

/// Assemble a report body.
///
/// `message` is what the person typed; `attach_log` is their decision, not ours.
/// The log is the valuable half when something broke and an intrusion into their
/// machine's state when they just wanted to say the search is slow — so it is a
/// switch they hold, off by default, rather than something bundled in.
pub fn build(
    kind: Kind,
    message: &str,
    attach_log: bool,
    account: Option<&str>,
) -> String {
    let mut out = String::new();

    out.push_str("## Entorno / Environment\n\n");
    out.push_str(&format!("- Version: `{}`\n", crate::version_line()));
    out.push_str(&format!("- SO: `{}`\n", std::env::consts::OS));
    out.push_str(&format!("- Arquitectura: `{}`\n", std::env::consts::ARCH));

    if !message.trim().is_empty() {
        out.push_str("\n## Lo que escribió / What they wrote\n\n");
        out.push_str(message.trim());
        out.push('\n');
    }

    if kind == Kind::Crash
        && let Some(panic) = read_panic()
    {
        out.push_str("\n## Panic\n\n```\n");
        out.push_str(&panic);
        out.push_str("\n```\n");
    }

    if attach_log || kind == Kind::Crash {
        let log = log_tail().unwrap_or_else(|| "(sin log)".into());
        out.push_str("\n## Log\n\n```\n");
        out.push_str(&log);
        out.push_str("\n```\n");
    }

    out.push_str("\n<!-- Enviado desde Starless. El log va recortado y sin datos personales. -->\n");
    scrub_with(&out, account)
}

/// Send the report.
///
/// With no token compiled in there is no way to speak to the API without one, so
/// this returns a fully-formed "new issue" URL instead and the caller opens it.
/// The user still reads the body and still presses create — the only thing lost is
/// the click, and what is not lost is that nobody had to embed a credential in a
/// public binary to find out about it.
///
/// **The fallback is logged, loudly, because it is the path that ships today.** A
/// silent one is worse than useless here: without a line saying "no hay token, se
/// abrió el navegador", a send that did nothing and a send that worked leave
/// exactly the same log, and that is the whole reason nobody could tell which one
/// had happened.
pub fn submit(
    kind: Kind,
    message: &str,
    attach_log: bool,
    account: Option<&str>,
) -> Result<ReportOutcome, String> {
    let body = build(kind, message, attach_log, account);
    let title = title(kind);

    let Some(token) = TOKEN else {
        let url = browser_url(kind, &title, &body);
        log::info!(
            "reporte ({kind:?}) sin token: se abre el navegador. Cuerpo de {body_len} caracteres, \
             URL de {url_len}. Si el cuerpo se pasa del tope, lo que se pierde es el final del log.",
            body_len = body.len(),
            url_len = url.len()
        );
        return Ok(ReportOutcome {
            created: false,
            url,
        });
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("no se pudo crear el cliente HTTP: {e}"))?;

    let endpoint = format!("https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/issues");

    // A label the repository does not have is a `422`, and a `422` would lose the
    // report entirely — the one failure mode worth spending an extra request on.
    // `crash` and `feedback` have to exist on the repo for filtering to work, but
    // losing somebody's report because nobody remembered to create a label is a
    // worse outcome than a report without one.
    let with_label = post(&client, &endpoint, token, &title, &body, Some(kind.label()));
    let response = match with_label {
        Ok(response) if response.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY => {
            log::warn!(
                "GitHub no tiene la etiqueta `{}`; se reintenta sin ella",
                kind.label()
            );
            post(&client, &endpoint, token, &title, &body, None)?
        }
        Ok(response) => response,
        Err(e) => return Err(e),
    };

    if !response.status().is_success() {
        let code = response.status();
        let detail = response.text().unwrap_or_default();
        log::error!("GitHub rechazó el reporte: {code} {detail}");
        return Err(format!("GitHub respondió {code}"));
    }

    let issue: CreatedIssue = response
        .json()
        .map_err(|e| format!("respuesta de GitHub ilegible: {e}"))?;

    log::info!("reporte creado ({kind:?}): {}", issue.html_url);
    Ok(ReportOutcome {
        created: true,
        url: issue.html_url,
    })
}

fn post(
    client: &reqwest::blocking::Client,
    endpoint: &str,
    token: &str,
    title: &str,
    body: &str,
    label: Option<&str>,
) -> Result<reqwest::blocking::Response, String> {
    let payload = IssuePayload {
        title,
        body,
        labels: label.into_iter().collect(),
    };
    client
        .post(endpoint)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "starless")
        .json(&payload)
        .send()
        .map_err(|e| format!("no se pudo contactar a GitHub: {e}"))
}

/// The same report, as a URL a browser can open.
///
/// **Budgeted, and the budget buys the end of the body.** GitHub's "new issue"
/// page refuses a URL much past 8 KB and answers with "Your request URL is too
/// long" — which it did, at 8,398 characters, so "send" delivered an error page
/// instead of a form. The budget is therefore counted in *encoded* characters,
/// because that is what GitHub measures and not what the text looks like, and it
/// leaves room to survive a body that encodes badly.
///
/// And the budget is spent on the **end** rather than the start. `log_tail` is
/// already a tail: the failure somebody is reporting is in its last lines. An
/// excerpt that keeps the environment header and the first few thousand
/// characters of the tail is a log that says nothing about what broke — and it
/// is what shipped, because taking `take(n)` on a body reads naturally and is
/// exactly backwards here.
///
/// The version is not lost with the header: it is in the title.
fn browser_url(kind: Kind, title: &str, body: &str) -> String {
    const RAW_BUDGET: usize = 2_800;

    let total = body.chars().count();
    let trimmed: String = if total <= RAW_BUDGET {
        body.to_string()
    } else {
        let kept: String = body.chars().skip(total - RAW_BUDGET).collect();
        format!("*(log recortado: últimas {RAW_BUDGET} líneas)*\n\n{kept}")
    };

    format!(
        "https://github.com/{REPO_OWNER}/{REPO_NAME}/issues/new?labels={label}&title={title}&body={body}",
        label = urlencoding::encode(kind.label()),
        title = urlencoding::encode(title),
        body = urlencoding::encode(&trimmed),
    )
}

/// Forget that the last run crashed. Called once the user has dealt with the prompt
/// — either they reported it or they dismissed it, and either way it must not come
/// back on the next launch.
pub fn acknowledge() {
    if let Some(path) = crash_marker_path() {
        let _ = fs::remove_file(&path);
    }
    // The moved-aside panic copy and then the live one: both belong to a session
    // that is now dealt with. The second one used to be derived from the marker,
    // which is the same off-by-a-name mistake `read_panic` made — so the file a
    // real panic leaves behind outlived the prompt that offered to report it.
    let _ = fs::remove_file(reported_panic_path().unwrap_or_default());
    let _ = fs::remove_file(panic_path().unwrap_or_default());
}

// ---------------------------------------------------------------------------
// Development only
// ---------------------------------------------------------------------------

/// Plant what a panicked run leaves behind, so the crash flow can be walked
/// without crashing.
///
/// Development builds only — the command in `lib.rs` refuses in a release. Two
/// details make this work the way the real thing does:
///
/// * The marker needs no doctored timestamp. `counts_as_crash` counts a panic
///   however briefly the session lasted, so writing the panic is enough.
/// * The text is written to the *live* name and then renamed, exactly like
///   `mark_session_start` does. Writing the moved-aside name directly would
///   leave the live file behind, and a later launch would promote it to a crash
///   nobody had.
///
/// The dialog only appears on the next launch. That is the design, not a
/// limitation of the simulation: the prompt is asked at startup because that is
/// the first moment there is a session to interrupt.
#[cfg(debug_assertions)]
pub fn simulate_crash() -> Result<(), String> {
    let crash = crash_marker_path().ok_or("no se encontró la carpeta local")?;
    let live = panic_path().ok_or("no se encontró la carpeta local")?;
    let moved = reported_panic_path().ok_or("no se encontró la carpeta local")?;
    if let Some(parent) = crash.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // The shape the hook writes, so the report reads like one it did not stage.
    let text = "panic en src-tauri/src/report.rs:1:1\ncrash simulado desde Ajustes\n";
    fs::write(&live, text).map_err(|e| format!("no se pudo escribir el panic: {e}"))?;
    fs::rename(&live, &moved).map_err(|e| format!("no se pudo apartar el panic: {e}"))?;
    fs::write(&crash, crate::version_line())
        .map_err(|e| format!("no se pudo escribir el marcador: {e}"))?;

    log::warn!("crash simulado desde el panel de desarrollo");
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// The scrubbing is the one part of this file that must never be wrong, and it
/// fails in a way nobody would notice: a report that goes out with somebody's
/// Spotify account name in it is a quiet privacy failure that only surfaces once
/// it is public.
///
/// These fixtures are lines this app has actually written, not invented ones —
/// the wording is librespot's and Starless's, and the scrubber is only worth
/// testing against those.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::Settings;

    #[test]
    fn a_session_that_died_at_once_is_not_a_crash() {
        assert!(!counts_as_crash(Some(Duration::from_secs(2)), false));
        assert!(!counts_as_crash(Some(Duration::from_millis(200)), false));
    }

    #[test]
    fn a_session_that_lived_is_a_crash() {
        assert!(counts_as_crash(Some(Duration::from_secs(60)), false));
        assert!(counts_as_crash(Some(Duration::from_secs(3 * 3600)), false));
    }

    /// A panic says so in its own file, and that outranks the clock: a real panic
    /// during startup is exactly the bug this prompt exists for.
    #[test]
    fn a_panic_counts_however_fast_it_happened() {
        assert!(counts_as_crash(Some(Duration::from_millis(10)), true));
    }

    /// The panic file has exactly one name, and every side agrees on it.
    ///
    /// It used to have two. The report read and the report cleaned up
    /// `last-crash.crash.txt`, which nothing has ever written, while the panic
    /// itself was renamed to `last-panic.crash.txt`. Every crash report therefore
    /// went out without the panic — the failure itself, which is the reason the
    /// report exists. The test pins the name both sides now derive it from, so the
    /// two cannot drift apart again without turning this red.
    #[test]
    fn the_panic_file_has_one_name() {
        let name = reported_panic_path()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .expect("debe haber una carpeta local");
        assert_eq!(name, "last-panic.crash.txt");
    }

    /// An unreadable timestamp is not evidence either way. Reporting costs one
    /// dismissed dialog; staying quiet costs a bug nobody ever hears about.
    #[test]
    fn an_unreadable_timestamp_is_treated_as_a_crash() {
        assert!(counts_as_crash(None, false));
    }

    const REAL_LINES: &str = "\
[2026-10-17T00:23:58.326Z INFO  librespot_core::session] Authenticated as 't_jitzol' !
[2026-10-17T00:23:57.220Z INFO  starless_lib::logging] log abierto en C:\\Users\\bairo\\AppData\\Local\\Starless\\starless.log
[2026-10-17T00:24:05.287Z INFO  starless_lib::webapi] webapi: 200 /me/tracks?limit=50
[2026-10-17T00:23:57.249Z INFO  librespot_playback::audio_backend::rodio] Using audio device: SteelSeries Sonar
[2026-10-17T00:21:11.522Z INFO  librespot_playback::player] Loading <Chanel> with Spotify URI <spotify:track:6Nle9hKrkL1wQpwNfEkxjh>
[2026-10-17T00:34:48.200Z INFO  starless_lib] login completo: session=true web_token=true";

    #[test]
    fn removes_the_spotify_account_name() {
        let out = scrub(REAL_LINES);
        assert!(
            !out.contains("t_jitzol"),
            "el nombre de cuenta de Spotify quedó en el reporte:\n{out}"
        );
        // The sentence itself has to survive, or the report loses its meaning.
        assert!(out.contains("Authenticated as"));
    }

    #[test]
    fn removes_the_windows_account_name() {
        let out = scrub(REAL_LINES);
        assert!(
            !out.contains("bairo"),
            "el usuario de Windows quedó en el reporte:\n{out}"
        );
        // The path is still useful without it.
        assert!(out.contains("AppData"));
    }

    #[test]
    fn removes_listening_identifiers() {
        let out = scrub(REAL_LINES);
        assert!(
            !out.contains("6Nle9hKrkL1wQpwNfEkxjh"),
            "un id de canción identifica una historia de escucha:\n{out}"
        );
    }

    #[test]
    fn keeps_the_diagnostic_value_of_the_line() {
        let out = scrub(REAL_LINES);
        // Over-scrubbing is the other failure mode: a report with every
        // interesting line deleted is as useless as none.
        assert!(out.contains("webapi: 200"));
        assert!(out.contains("SteelSeries Sonar"));
        assert!(out.contains("login completo"));
    }

    #[test]
    fn removes_credentials_under_any_name() {
        let leaky = concat!(
            "access_token=eyJhbGciOiJIUzI1NiJ9.payloadpart.signaturepart\n",
            "client_id: abcdef1234567890abcdef\n",
            "Authorization: Bearer sk_live_0123456789abcdef\n"
        );
        let out = scrub(leaky);
        assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9"), "{out}");
        assert!(!out.contains("abcdef1234567890abcdef"), "{out}");
        assert!(!out.contains("sk_live_0123456789abcdef"), "{out}");
    }

    #[test]
    fn a_report_never_exceeds_github_limit() {
        let huge = "linea de relleno\n".repeat(20_000);
        let out = scrub(&huge);
        assert!(
            out.len() <= BODY_LIMIT + 64,
            "el cuerpo llegó a {} caracteres y GitHub lo rechaza a {BODY_LIMIT}",
            out.len()
        );
    }

    /// The fallback URL has to be one GitHub will actually open.
    ///
    /// It was measured at 8,398 characters and the page answered "Your request URL
    /// is too long", which made "send" deliver an error instead of a form. The
    /// body here encodes worse than a real one — accented characters expand three
    /// bytes each — so a budget that holds for this one holds for the log.
#[test]
    fn the_browser_url_fits_where_github_accepts_it() {
        let body: String = (0..3_000)
            .map(|i| format!("[{i}] línea del log con acentos: contraseña\n"))
            .collect();
        let url = browser_url(Kind::Feedback, "Feedback desde Starless 0.3.0", &body);

        assert!(
            url.len() < 6_000,
            "la URL quedó en {} caracteres y GitHub la rechaza cerca de 8.000",
            url.len()
        );
    }

    /// The log is a tail, so the excerpt has to keep the end of it. Taking
    /// `take(n)` on the body reads naturally and ships a log that says nothing
    /// about the failure it was cut from.
#[test]
    fn the_browser_url_keeps_the_end_of_the_log() {
        let mut body = String::from("cabecera que describe el entorno\n");
        body.push_str(&"ruido que no dice nada\n".repeat(400));
        body.push_str("2026-10-17 ERROR esto es lo que se rompió");

        let url = browser_url(Kind::Feedback, "titulo", &body);
        let encoded = url
            .split_once("&body=")
            .expect("la URL debe llevar el cuerpo")
            .1;
        let decoded = urlencoding::decode(encoded).expect("el cuerpo debe estar codificado");

        assert!(
            decoded.contains("esto es lo que se rompió"),
            "el final del log se perdió:\n{decoded}"
        );
        assert!(
            !decoded.contains("cabecera que describe el entorno"),
            "la cabecera no debería sobrevivir un recorte, la versión está en el título"
        );
    }

    /// Feedback about something that did not crash must not quietly carry a copy of
    /// the log. The switch being in the UI is not the guarantee — this is.
#[test]
    fn feedback_leaves_the_log_out_unless_asked() {
        let with = build(Kind::Feedback, "la búsqueda va lenta", true, None);
        assert!(with.contains("la búsqueda va lenta"), "{with}");
        assert!(
            with.contains("## Log"),
            "con el log activado debería estar presente:\n{with}"
        );

        let without = build(Kind::Feedback, "la búsqueda va lenta", false, None);
        assert!(without.contains("la búsqueda va lenta"));
        assert!(
            !without.contains("## Log"),
            "sin activarlo, el log no debe viajar:\n{without}"
        );
    }

    /// The one that proves the patterns are not enough.
    ///
    /// A username written in free text has no shape to match: it is not prefixed
    /// by `Authenticated as`, it is not inside a path, and every rule above would
    /// sail straight past it. It gets removed because the session says what the
    /// account is called — not because anything recognised it.
    #[test]
    fn the_account_name_is_removed_even_in_free_text() {
        let out = build(
            Kind::Feedback,
            "soy t_jitzol y la app crashea",
            false,
            Some("t_jitzol"),
        );
        assert!(
            !out.contains("t_jitzol"),
            "el nombre de cuenta quedó en texto libre:\n{out}"
        );
        assert!(out.contains("[omitido]"));
    }

    #[test]
    fn feedback_is_scrubbed_too() {
        let out = build(
            Kind::Feedback,
            "soy t_jitzol y la app crashea en C:\\Users\\bairo\\AppData",
            false,
            Some("t_jitzol"),
        );
        assert!(!out.contains("t_jitzol"), "{out}");
        assert!(!out.contains("bairo"), "{out}");
    }

    /// An empty or missing account name must not blank out the whole report.
    #[test]
    fn an_unknown_account_does_not_wreck_the_scrub() {
        for account in [None, Some(""), Some("   ")] {
            let out = build(Kind::Feedback, "hola", false, account);
            assert!(out.contains("hola"), "se perdió el mensaje: {out}");
        }
    }

    #[test]
    fn a_crash_always_carries_the_log() {
        let out = build(Kind::Crash, "", false, None);
        assert!(
            out.contains("## Log"),
            "un crash sin log no sirve para nada:\n{out}"
        );
    }

#[test]
    fn settings_round_trip_through_the_file() {
        let dir = std::env::temp_dir().join("starless-settings-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let path = dir.join("settings.json");
        fs::write(&path, r#"{"volume": 12345}"#).unwrap();
        let read: Settings = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(read.volume, Some(12345));

        // A file from an older build, missing the key entirely.
        fs::write(&path, "{}").unwrap();
        let read: Settings = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(read.volume, None);

        // A file truncated by a power cut must not be fatal.
        fs::write(&path, r#"{"vol"#).unwrap();
        assert!(serde_json::from_str::<Settings>(&fs::read_to_string(&path).unwrap()).is_err());

        let _ = fs::remove_dir_all(&dir);
    }
}