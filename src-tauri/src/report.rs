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

use regex::Regex;
use serde::Serialize;

/// The repository issues are filed against, and the label that makes them findable.
const REPO_OWNER: &str = "baironvillar";
const REPO_NAME: &str = "Starless";
const CRASH_LABEL: &str = "crash";

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
            if let Some(panic) = panic_path()
                && let Some(target) = crash_marker_path().map(|_| panic.with_extension("crash.txt"))
            {
                let _ = fs::rename(&panic, &target);
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

/// `true` when the previous run left its marker behind, which means it did not end
/// on purpose.
///
/// Readable at any point in this run's life, including from the frontend, because
/// `mark_session_start` moved the evidence out of the way rather than overwriting
/// it.
pub fn previous_session_crashed() -> bool {
    crash_marker_path().is_some_and(|p| p.exists())
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

/// What a report needs to be acted on, assembled and scrubbed.
fn build_report() -> String {
    let mut out = String::new();

    out.push_str("## Entorno / Environment\n\n");
    out.push_str(&format!("- Version: `{}`\n", crate::version_line()));
    out.push_str(&format!("- SO: `{}`\n", std::env::consts::OS));
    out.push_str(&format!("- Arquitectura: `{}`\n", std::env::consts::ARCH));

    if let Some(panic) = read_panic() {
        out.push_str("\n## Panic\n\n```\n");
        out.push_str(&panic);
        out.push_str("\n```\n");
    }

    let log = log_tail().unwrap_or_else(|| "(sin log)".into());
    out.push_str("## Log (final de la sesión que murió)\n\n```\n");
    out.push_str(&log);
    out.push_str("\n```\n\n");

    out.push_str("<!-- Enviado desde Starless. El log va recortado y sin datos personales. -->\n");
    scrub(&out)
}

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
    let moved = crash_marker_path()
        .map(|p| p.with_extension("crash.txt"))
        .and_then(|p| fs::read_to_string(p).ok());
    let text = moved.or_else(|| Some(fs::read_to_string(panic_path()?).ok()?))?;
    (!text.trim().is_empty()).then_some(text)
}

/// The report as it would be sent: built and scrubbed, ready to be shown.
///
/// Public because the person deciding has to read the real thing. A preview that
/// is generated differently from what gets sent is worse than no preview.
pub fn preview() -> String {
    build_report()
}

/// Remove what the log has no business publishing.
///
/// Applied to the body that is shown on screen *and* the body that is uploaded, so
/// there is no version of this that ships a name.
pub fn scrub(text: &str) -> String {
    let mut out = text.to_string();

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

/// The title the report gets.
fn title() -> String {
    let version = crate::version_line();
    match read_panic() {
        Some(panic) => {
            let first = panic.lines().next().unwrap_or("panic").trim();
            format!("Crash en {version}: {}", first.chars().take(90).collect::<String>())
        }
        None => format!("Crash en {version}: la sesión anterior terminó sin cerrarse"),
    }
}

/// Send the report.
///
/// With no token compiled in there is no way to speak to the API without one, so
/// this returns a fully-formed "new issue" URL instead and the caller opens it.
/// The user still reads the body and still presses create — the only thing lost is
/// the click, and what is not lost is that nobody had to embed a credential in a
/// public binary to find out about it.
pub fn submit() -> Result<ReportOutcome, String> {
    let body = build_report();
    let title = title();

    let Some(token) = TOKEN else {
        return Ok(ReportOutcome {
            created: false,
            url: browser_url(&title, &body),
        });
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("no se pudo crear el cliente HTTP: {e}"))?;

    let response = client
        .post(format!("https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}/issues"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "starless")
        .json(&IssuePayload {
            title: &title,
            body: &body,
            labels: vec![CRASH_LABEL],
        })
        .send()
        .map_err(|e| format!("no se pudo contactar a GitHub: {e}"))?;

    if !response.status().is_success() {
        let code = response.status();
        let detail = response.text().unwrap_or_default();
        log::error!("GitHub rechazó el reporte: {code} {detail}");
        return Err(format!("GitHub respondió {code}"));
    }

    let issue: CreatedIssue = response
        .json()
        .map_err(|e| format!("respuesta de GitHub ilegible: {e}"))?;

    log::info!("reporte creado: {}", issue.html_url);
    Ok(ReportOutcome {
        created: true,
        url: issue.html_url,
    })
}

/// The same report, as a URL a browser can open.
///
/// GitHub truncates very long query strings, so a log near the size limit is better
/// on its own than crammed into a URL — this is the fallback, not the main path.
fn browser_url(title: &str, body: &str) -> String {
    let body: String = body.chars().take(6_000).collect();
    format!(
        "https://github.com/{REPO_OWNER}/{REPO_NAME}/issues/new?labels={label}&title={title}&body={body}",
        label = urlencoding::encode(CRASH_LABEL),
        title = urlencoding::encode(title),
        body = urlencoding::encode(&body),
    )
}

/// Forget that the last run crashed. Called once the user has dealt with the prompt
/// — either they reported it or they dismissed it, and either way it must not come
/// back on the next launch.
pub fn acknowledge() {
    if let Some(path) = crash_marker_path() {
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(path.with_extension("crash.txt"));
    }
    let _ = fs::remove_file(panic_path().unwrap_or_default());
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