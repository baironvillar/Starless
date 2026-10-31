//! What the person listened to, kept on this machine and nowhere else.
//!
//! **This is not telemetry, and the difference is the whole design.** PRODUCT.md
//! promises that Starless reports usage data to nobody, its author included. A
//! history that never leaves the disk it was written on reports to nobody: it
//! exists so Home can say "your most played" and "keep listening", which Spotify
//! stopped offering to apps like this one. Nothing here opens a socket, and the
//! person can switch it off or delete it from Settings.
//!
//! One play per line of JSON, appended. A line is written once a song has been
//! heard for [`MIN_LISTENED_MS`]; anything shorter was a skip, and counting skips
//! would rank the songs people pass over.
//!
//! Plays older than [`KEEP_DAYS`] are dropped the next time the file is read for
//! stats, so the file stays a few hundred kilobytes for a heavy listener.

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Under this, a song was skipped rather than listened to.
pub const MIN_LISTENED_MS: u32 = 30_000;

/// How far back the file keeps plays. "Últimas 4 semanas" needs 28 days; the
/// rest is slack so a stats window moving forward never finds a hole.
const KEEP_DAYS: i64 = 120;

/// The window "Lo más escuchado" looks at.
const TOP_DAYS: i64 = 28;

const DAY_MS: i64 = 86_400_000;

/// Where the file lives: next to `settings.json`.
fn history_path() -> Option<PathBuf> {
    dirs::data_local_dir().map(|base| base.join("Starless").join("history.jsonl"))
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PlayArtist {
    pub id: String,
    pub name: String,
}

/// What was playing it: a playlist (its id, `liked` for the saved songs) or nothing.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PlayContext {
    pub kind: String,
    pub id: String,
}

/// One song, heard.
///
/// The track is stored whole enough to be played again from Home without asking
/// Spotify for it: id, name, artists, the album's picture and its length.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Play {
    /// Milliseconds since the epoch, when the listening ended.
    pub at: i64,
    pub track_id: String,
    pub name: String,
    pub artists: Vec<PlayArtist>,
    #[serde(default)]
    pub album_id: Option<String>,
    #[serde(default)]
    pub album_name: Option<String>,
    #[serde(default)]
    pub image: Option<String>,
    pub duration_ms: u32,
    /// How long it was actually heard. Paused time does not count.
    pub listened_ms: u32,
    #[serde(default)]
    pub context: Option<PlayContext>,
}

/// Write one play. A play under the minimum, or with history switched off, is dropped.
pub fn record(play: &Play) {
    if !crate::settings::saved_history_enabled() || play.listened_ms < MIN_LISTENED_MS {
        return;
    }
    let Some(path) = history_path() else {
        return;
    };
    if let Some(parent) = path.parent()
        && let Err(e) = fs::create_dir_all(parent)
    {
        log::warn!("no se pudo crear el directorio del historial: {e}");
        return;
    }
    let Ok(line) = serde_json::to_string(play) else {
        return;
    };
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(e) = writeln!(file, "{line}") {
                log::warn!("no se pudo escribir el historial: {e}");
            }
        }
        Err(e) => log::warn!("no se pudo abrir el historial: {e}"),
    }
}

/// Delete everything. Settings' "Borrar historial".
pub fn clear() {
    if let Some(path) = history_path()
        && path.exists()
        && let Err(e) = fs::remove_file(&path)
    {
        log::warn!("no se pudo borrar el historial: {e}");
    }
}

/// Every play still worth keeping, oldest first. Rewrites the file when it pruned.
fn load(now: i64) -> Vec<Play> {
    let Some(path) = history_path() else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let cutoff = now - KEEP_DAYS * DAY_MS;
    let mut plays = Vec::new();
    let mut dropped = false;
    for line in raw.lines() {
        // A torn last line (the app died mid-write) is skipped, not fatal.
        match serde_json::from_str::<Play>(line) {
            Ok(play) if play.at >= cutoff => plays.push(play),
            _ => dropped = true,
        }
    }
    if dropped {
        let body: String = plays
            .iter()
            .filter_map(|play| serde_json::to_string(play).ok())
            .map(|line| line + "\n")
            .collect();
        if let Err(e) = fs::write(&path, body) {
            log::warn!("no se pudo podar el historial: {e}");
        }
    }
    plays
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct TopTrack {
    pub play: Play,
    pub plays: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct TopArtist {
    pub id: String,
    pub name: String,
    pub plays: u32,
    #[serde(default)]
    pub image: Option<String>,
}

/// Home's history sections, computed in one pass over the file.
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
pub struct HomeStats {
    /// Whether anything was ever recorded: Home shows its first-day card when not.
    pub has_history: bool,
    pub top_tracks: Vec<TopTrack>,
    pub top_artists: Vec<TopArtist>,
    /// The last thing heard from each of the latest distinct sources, newest first.
    pub recent: Vec<Play>,
    /// Minutes heard on each day of this week, Monday first, in the person's time.
    pub week_minutes: Vec<u32>,
    /// Which of `week_minutes` is today.
    pub today_index: usize,
    /// Days in a row, up to today, with at least one play. Yesterday still counts
    /// as "in a row" until today ends, so a streak does not break at breakfast.
    pub streak_days: u32,
}

/// Compute Home from the file. `tz_offset_min` is JavaScript's `getTimezoneOffset()`.
pub fn home_stats(now: i64, tz_offset_min: i32) -> HomeStats {
    compute(&load(now), now, tz_offset_min)
}

fn local_day(at: i64, tz_offset_min: i32) -> i64 {
    (at - i64::from(tz_offset_min) * 60_000).div_euclid(DAY_MS)
}

/// 0 = Monday. The epoch was a Thursday.
fn weekday(day: i64) -> i64 {
    (day + 3).rem_euclid(7)
}

fn compute(plays: &[Play], now: i64, tz_offset_min: i32) -> HomeStats {
    let mut stats = HomeStats {
        has_history: !plays.is_empty(),
        week_minutes: vec![0; 7],
        ..HomeStats::default()
    };
    if plays.is_empty() {
        return stats;
    }

    let today = local_day(now, tz_offset_min);
    let monday = today - weekday(today);
    stats.today_index = weekday(today) as usize;

    let since = now - TOP_DAYS * DAY_MS;
    let mut tracks: HashMap<&str, (u32, &Play)> = HashMap::new();
    let mut artists: HashMap<&str, (u32, &PlayArtist, &Play)> = HashMap::new();
    let mut week_ms = [0u64; 7];
    let mut days = std::collections::BTreeSet::new();

    for play in plays {
        let day = local_day(play.at, tz_offset_min);
        days.insert(day);
        if (monday..=today).contains(&day) {
            week_ms[(day - monday) as usize] += u64::from(play.listened_ms);
        }
        if play.at < since {
            continue;
        }
        // Plays are oldest first, so the last one seen is the freshest copy.
        let entry = tracks.entry(play.track_id.as_str()).or_insert((0, play));
        entry.0 += 1;
        entry.1 = play;
        for artist in &play.artists {
            let entry = artists.entry(artist.id.as_str()).or_insert((0, artist, play));
            entry.0 += 1;
            entry.2 = play;
        }
    }

    stats.week_minutes = week_ms.iter().map(|ms| (ms / 60_000) as u32).collect();

    let mut top: Vec<_> = tracks.into_values().collect();
    // Most plays first; a tie goes to the one heard last.
    top.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.at.cmp(&a.1.at)));
    stats.top_tracks = top
        .into_iter()
        .take(5)
        .map(|(plays, play)| TopTrack { play: play.clone(), plays })
        .collect();

    let mut top: Vec<_> = artists.into_values().collect();
    top.sort_by(|a, b| b.0.cmp(&a.0).then(b.2.at.cmp(&a.2.at)));
    stats.top_artists = top
        .into_iter()
        .take(5)
        .map(|(plays, artist, play)| TopArtist {
            id: artist.id.clone(),
            name: artist.name.clone(),
            plays,
            image: play.image.clone(),
        })
        .collect();

    // One card per source: a playlist once, however many songs of it were heard.
    let mut seen = std::collections::HashSet::new();
    for play in plays.iter().rev() {
        let key = match &play.context {
            Some(context) => format!("{}:{}", context.kind, context.id),
            None => format!("track:{}", play.track_id),
        };
        if seen.insert(key) {
            stats.recent.push(play.clone());
            if stats.recent.len() == 4 {
                break;
            }
        }
    }

    let mut day = if days.contains(&today) { today } else { today - 1 };
    while days.contains(&day) {
        stats.streak_days += 1;
        day -= 1;
    }

    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    // Thursday 1 January 1970 is day 0; 5 January 1970 was a Monday.
    const MONDAY: i64 = 4 * DAY_MS;

    fn play(track: &str, artist: &str, at: i64, context: Option<&str>) -> Play {
        Play {
            at,
            track_id: track.into(),
            name: track.into(),
            artists: vec![PlayArtist { id: artist.into(), name: artist.into() }],
            album_id: None,
            album_name: None,
            image: None,
            duration_ms: 180_000,
            listened_ms: 120_000,
            context: context.map(|id| PlayContext { kind: "playlist".into(), id: id.into() }),
        }
    }

    #[test]
    fn nothing_recorded_is_the_first_day() {
        let stats = compute(&[], MONDAY, 0);
        assert!(!stats.has_history);
        assert_eq!(stats.week_minutes, vec![0; 7]);
    }

    #[test]
    fn ranks_by_plays_then_by_the_latest() {
        let plays = [
            play("a", "x", MONDAY, None),
            play("b", "y", MONDAY + 1, None),
            play("b", "y", MONDAY + 2, None),
            play("c", "x", MONDAY + 3, None),
        ];
        let stats = compute(&plays, MONDAY + DAY_MS, 0);
        let order: Vec<_> = stats.top_tracks.iter().map(|t| t.play.track_id.as_str()).collect();
        assert_eq!(order, ["b", "c", "a"]);
        assert_eq!(stats.top_tracks[0].plays, 2);
        assert_eq!(stats.top_artists[0].id, "x");
        assert_eq!(stats.top_artists[0].plays, 2);
    }

    #[test]
    fn the_week_starts_on_monday_in_local_time() {
        // 23:30 UTC on Monday is Tuesday in UTC+1 (offset -60).
        let late = MONDAY + DAY_MS - 30 * 60_000;
        let stats = compute(&[play("a", "x", late, None)], late, -60);
        assert_eq!(stats.today_index, 1);
        assert_eq!(stats.week_minutes[1], 2);
        assert_eq!(stats.week_minutes[0], 0);
    }

    #[test]
    fn recent_keeps_one_card_per_source() {
        let plays = [
            play("a", "x", MONDAY, Some("p1")),
            play("b", "x", MONDAY + 1, Some("p1")),
            play("c", "x", MONDAY + 2, None),
            play("d", "x", MONDAY + 3, Some("p2")),
        ];
        let stats = compute(&plays, MONDAY + 4, 0);
        let order: Vec<_> = stats.recent.iter().map(|p| p.track_id.as_str()).collect();
        assert_eq!(order, ["d", "c", "b"]);
    }

    #[test]
    fn a_streak_survives_until_today_ends() {
        let plays = [
            play("a", "x", MONDAY, None),
            play("a", "x", MONDAY + DAY_MS, None),
            play("a", "x", MONDAY + 2 * DAY_MS, None),
        ];
        // Thursday morning, nothing yet today: Mon–Wed still count.
        let stats = compute(&plays, MONDAY + 3 * DAY_MS + 3_600_000, 0);
        assert_eq!(stats.streak_days, 3);
        // Friday: Thursday was missed, the streak is gone.
        let stats = compute(&plays, MONDAY + 4 * DAY_MS + 3_600_000, 0);
        assert_eq!(stats.streak_days, 0);
    }

    #[test]
    fn plays_older_than_the_window_do_not_rank() {
        let old = MONDAY;
        let now = old + (TOP_DAYS + 1) * DAY_MS;
        let stats = compute(&[play("a", "x", old, None)], now, 0);
        assert!(stats.has_history);
        assert!(stats.top_tracks.is_empty());
    }
}
