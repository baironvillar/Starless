import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useMemo } from "react";
import { errors, type Lang } from "./i18n";

/**
 * The account's real data, as Spotify sends it.
 *
 * Field names are deliberately left in Spotify's own snake_case. The Rust side
 * does not rename them either, so there is exactly one spelling of every field
 * between the API and the screen, and no rename attribute somewhere that can
 * silently stop matching.
 */
export type Image = {
  url: string;
};

export type Artist = { id: string; name: string };

export type Album = { id: string; name: string; images: Image[] };

export type Track = {
  id: string;
  name: string;
  /** Absent on some responses; never assume it is there. */
  duration_ms: number | null;
  artists: Artist[];
  album: Album | null;
  /** Spotify stopped returning this for apps created after February 2026. */
  popularity: number | null;
  /**
   * Milliseconds since the epoch, and **only when the track came from a playlist**.
   *
   * It is a fact about the row in a list, not about the song: liked songs and
   * search results come from a `Context`, which carries no per-item timestamp, and
   * `null` there is the honest answer rather than a missing one.
   */
  added_at: number | null;
};

export type Playlist = {
  id: string;
  name: string;
  images: Image[];
  owner: { display_name: string | null } | null;
  tracks: { total: number } | null;
  collaborative: boolean;
  /**
   * The description the owner wrote, if there is one.
   *
   * It comes in the same message as the name — the library's attributes — so
   * reading it costs nothing extra. `null` is "the owner wrote nothing", which
   * is not the same as an empty description.
   */
  description: string | null;
  /**
   * Whether the cover is one the owner uploaded.
   *
   * **The one you see does not say.** Spotify builds a cover out of the first
   * four songs when the owner uploads none, and the two look the same in
   * `images`. Only the attributes tell them apart, and without this the
   * details dialog could not offer to take the uploaded one away.
   */
  custom_cover: boolean;
  /**
   * Whether the playlist is public.
   *
   * **It comes from the library, not from the playlist.** The playlist's own
   * attributes carry no visibility at all —`collaborative` and nothing else—,
   * and the flag that says whether this playlist shows up on the account's
   * public profile travels on the library row that points at it.
   */
  is_public: boolean;
};

/**
 * Is this one of Spotify's cards rather than a playlist?
 *
 * The DJ is one: it arrives with Spotify as its owner and **no songs at all** —
 * zero here is not a count, it is the sign that the content lives somewhere else
 * and this playlist is only its name. A Spotify-made playlist that does have
 * songs is a playlist, and it opens like one.
 *
 * The predicate lives here and not in the screen that first needed it, because
 * the second place that needs it is the one that was broken: the rail lists the
 * DJ among the playlists, and opening it from there showed an empty page.
 */
export function isDjCard(playlist: Playlist): boolean {
  return playlist.owner?.display_name === "spotify" && !playlist.tracks?.total;
}

export type Account = {
  id: string;
  display_name: string | null;
  /** `premium`, or something else. The difference is whether audio exists. */
  product: string | null;
  images: Image[];
};

/**
 * The picture to draw for a cover, or `null` when there is none.
 *
 * **This used to pick the largest, and it never did.** It compared `width`, and
 * the backend sent `null` for every image — so the comparison was `0 > 0` on
 * both sides, the `reduce` returned the first element, and the function did
 * exactly the thing its own comment warned against. The comment was right about
 * the risk and wrong about the code.
 *
 * The sizes are gone from both sides now, on purpose: `PictureSize` in
 * `playlist4_external.proto` carries `target_name` and `url` and no dimensions at
 * all, so there was never a real number to compare. Guessing one by parsing
 * `"small"` out of a target name would be a heuristic wearing a measurement's
 * clothes.
 *
 * So this says what it does: the first image offered, which is the one every
 * track and playlist in this app has always shown. When the channel carries real
 * sizes again, comparing them is a two-line change — and it will be a change,
 * not a fix, because the cover this returns today is the cover this always drew.
 */
export function coverImage(images: Image[] | null | undefined): Image | null {
  return images?.[0] ?? null;
}

export function trackArtists(track: Track): string {
  return track.artists.map((a) => a.name).join(", ");
}

export function formatDuration(ms: number | null): string {
  const total = Math.floor((ms ?? 0) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * The day a track joined this playlist, or `null` when the row does not say.
 *
 * **The app's language, not the system's.** The collator above is deliberately
 * locale-`undefined`, and it is right there: an A–Z either respects accents or it
 * does not, and there is no "wrong" shape to get. A date does have shapes —
 * `Aug 17, 2026` against `17 ago 2026` — and Starless has a language switch that
 * already changes every other word on screen. A column left in the system locale
 * under an interface the user just switched is the one line that reads as a
 * different app.
 *
 * `dateStyle: "medium"` is the shortest form that keeps the year: a list you
 * revisit needs to know *which* August a song arrived in.
 */
export function formatAddedAt(ms: number | null, lang: string): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(new Date(ms));
  } catch {
    // A locale this build does not carry falls back to the default one rather
    // than taking the column down.
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(ms));
  }
}

/**
 * How long a whole playlist runs, the way a header says it: `4 hr 44 min`.
 *
 * Built here rather than in the component so the two halves — playlist and liked
 * songs — cannot spell the same duration differently. Minutes are dropped when
 * there are none: `48 min` reads as a length, and `0 hr 48 min` reads as a
 * timestamp.
 */
export function formatRuntime(tracks: Pick<Track, "duration_ms">[], lang: string): string {
  const totalMs = tracks.reduce((sum, track) => sum + (track.duration_ms ?? 0), 0);
  const minutes = Math.floor(totalMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} min`;
  return lang === "es" ? `${hours} h ${rest} min` : `${hours} hr ${rest} min`;
}

/**
 * How many songs to show for a list.
 *
 * Counts what was actually loaded, not what Spotify advertises. The advertised
 * total used to come from `playlist.tracks.total`, and the February 2026
 * migration removed that field from `/me/playlists` *and* from
 * `GET /playlists/{id}` — so counting it produced a confident "0 canciones" under
 * a list full of songs.
 *
 * The list is now walked to its end, so this number is exact rather than
 * approximate. A count derived from what is on screen cannot disagree with what
 * is on screen, which is the whole property worth having.
 */
export function listCount(tracks: unknown[]): string {
  return String(tracks.length);
}

/**
 * One React key per row, unique even when the list repeats a song.
 *
 * **`track.id` is not a key.** A playlist may legitimately hold the same song
 * more than once — measured on this account, `Mi playlist n.º 4` answers fifty
 * items carrying forty-six distinct ids — and React's reconciliation with
 * duplicate keys does not merely warn in the console. The losing fibers stay
 * mounted, so when the list underneath them is replaced they keep painting the
 * *previous* list: opening LoL right after n.º 4 put four rows of n.º 4 above
 * LoL's own songs, under a header that said "LoL" and a count that was LoL's.
 * The array was right the whole time. Only the rows were lying.
 *
 * Counting occurrences makes every key unique and keeps it stable for as long as
 * the order holds, which for a playlist is exactly as long as nobody edits it.
 */
export function trackRowKeys(tracks: Pick<Track, "id">[]): string[] {
  const seen = new Map<string, number>();
  return tracks.map((track) => {
    const occurrence = seen.get(track.id) ?? 0;
    seen.set(track.id, occurrence + 1);
    return `${track.id}#${occurrence}`;
  });
}

// --- Playback ---------------------------------------------------------------
//
// The webview never sees audio. These commands move integers around; the PCM
// goes straight from librespot to WASAPI inside Rust.

export type PlaybackStatus = {
  available: boolean;
  trackId: string | null;
  playing: boolean;
  loading: boolean;
  positionMs: number;
  durationMs: number;
  /** 0..=65535, librespot's own scale. */
  volume: number;
  /**
   * The track ran to its end. Not the same as `playing: false` — that also means
   * paused, and only one of the two should move the queue forward.
   */
  finished: boolean;
  error: string | null;
};

/**
 * El DJ: lo que Spotify le fabricó a la cuenta.
 *
 * **El mix y la voz son dos cosas, y las dos se pueden tener.** Las canciones
 * son pistas del catálogo, con su nombre y su audio, y suenan. La narración
 * llega como texto —la frase que el DJ dice— y el audio lo pide el backend al
 * servicio que lo fabrica, para que suene por el mismo dispositivo que la
 * música. Acá queda la frase escrita, que es lo mismo que dijo.
 */
export type DjNarration = {
  /** Quién la dice: "DJ Livi". */
  speaker: string;
  /** La frase, en texto y sin el SSML. */
  line: string;
};

export type DjMix = {
  /** Las canciones que eligió el DJ, en el orden que las eligió. */
  tracks: Track[];
  /**
   * Lo que dice el DJ, por id de canción.
   *
   * **La frase va con su canción, y no suelta.** El DJ abre el tramo con una
   * frase y lo cierra con otra, y el servicio las cuelga de la primera y de
   * la última canción. La que se muestra es la de la que está sonando.
   */
  lines: Record<string, DjNarration>;
};

/**
 * Ask the DJ to say the phrase that belongs to a song.
 *
 * **The phrase is of the song, and it is said before it.** The service hangs
 * the opening phrase on the first song of a stretch and the closing one on the
 * last, and both are said *before* that song —"this stretch ends with The
 * Weeknd" is said, and then The Weeknd plays. So the app keeps the phrases
 * until the song is about to sound: a page arrives two songs before the queue
 * empties, and asking then would be talking over the song that is playing.
 *
 * The answer is the number of the voice, or `null` when the DJ has nothing to
 * say for that song: then the music starts right away. The number is what
 * tells two voices apart —two clicks in a row are two voices, and the one that
 * finished first is not the one the second click is waiting for.
 */
export async function djSpeak(trackId: string): Promise<number | null> {
  return invoke<number | null>("dj_speak", { trackId });
}

/**
 * El DJ terminó de hablar.
 *
 * `id` es el número de la voz, el mismo que volvió en el mix. `done` dice que
 * ya no está sonando: se haya oído entera o la hayan cortado.
 */
export type DjVoiceEvent = {
  id: number;
  done: boolean;
};

/**
 * Ask for the DJ's mix.
 *
 * Not a query hook: this is an action, and the mix changes. The DJ's session
 * has an expiry of its own —`lexicon_expiration_time`— and asking again after
 * it gives a new one.
 */
export async function djMix(playlistId: string): Promise<DjMix> {
  return invoke<DjMix>("dj_mix", { playlistId });
}

/**
 * Ask for the DJ's next page.
 *
 * **This is what makes it a station and not a list.** The cursor lives in the
 * backend —the service's own address for the next page, with its segment and
 * its request— so the webview asks for "the next one" and never handles the
 * path.
 *
 * An empty list is the answer when the DJ is done: the station ends there, and
 * that is a fact about the session, not a failure.
 */
export async function djMore(): Promise<DjMix> {
  return invoke<DjMix>("dj_more");
}

/**
 * Qué se estaba escuchando: el contexto con el que se siembra la radio.
 *
 * **Es un contexto y no una canción suelta.** El autoplay de Spotify pregunta
 * dos cosas: qué se escuchaba —la playlist, la canción— y qué sonó hace
 * poco. Por eso hay dos variantes y no un id suelto: el backend escribe cada
 * contexto como lo entiende el servicio, y el webview no lo hace a mano.
 */
export type RadioContext = { kind: "playlist"; id: string } | { kind: "track"; id: string };

/**
 * Ask for the radio: the songs that are like the ones that were playing.
 *
 * **This is Spotify's autoplay door, with its own protocol.** The backend sends
 * the context and the recent tracks, and the service answers with fifty
 * similar songs and a cursor to keep going.
 *
 * The recent tracks are what the service already played: it does not offer them
 * back, which is why the seed does not have to be filtered out here.
 */
export async function radioStart(context: RadioContext, recentTrackIds: string[]): Promise<DjMix> {
  return invoke<DjMix>("radio_start", { context, recentTrackIds });
}

/**
 * Ask for the radio's next page.
 *
 * **Same as the DJ's, and for the same reason:** the cursor lives in the
 * backend, so the webview asks for "the next one" and never handles the path.
 *
 * An empty list is the answer when the station is done: the radio ends there,
 * and that is a fact about the session, not a failure.
 */
export async function radioMore(): Promise<DjMix> {
  return invoke<DjMix>("radio_more");
}

/**
 * A shared session: the jam.
 *
 * **The jam is not a playlist: it is a session, and the service is not called
 * jam.** It is `social-connect`, and its paths do not say so. The whole
 * protocol —what exists, what does not, and how it was measured— is in
 * `docs/jam.md`.
 *
 * The field names are the service's own, as they come: mostly `snake_case` and
 * one in `camelCase`, which is how the service mixes the two conventions.
 * Renaming one of them would give the same field two names depending on where
 * you looked.
 */
export type JamMember = {
  id: string;
  username: string | null;
  display_name: string | null;
  image_url: string | null;
  /** True when it can drive the playback, and not only listen. */
  is_controlling: boolean;
  is_listening: boolean;
};

export type JamSession = {
  session_id: string;
  /** The code people join with. */
  join_session_token: string | null;
  /** The code as a URI: `spotify:socialsession:<token>`. */
  join_session_uri: string | null;
  /** The joining door, with the service's internal prefix. */
  join_session_url: string | null;
  active: boolean;
  is_session_owner: boolean;
  session_members: JamMember[];
  maxMemberCount: number | null;
};

/**
 * Open a jam.
 *
 * **It is a `GET` that creates it.** The path is called `current_or_new`
 * because it is literal: if there is no session, it opens one —with its join
 * token and its owner— and `activate=true` also activates it. A `POST` on the
 * same path answers `405`: that is not the verb.
 */
export async function jamStart(): Promise<JamSession> {
  return invoke<JamSession>("jam_start");
}

/**
 * Join a jam with its code.
 *
 * **It is a `POST` with a body**, and an empty one is enough: the token in the
 * path is what identifies the session, not the body.
 */
export async function jamJoin(token: string): Promise<JamSession> {
  return invoke<JamSession>("jam_join", { token });
}

/**
 * Read the session, without opening one.
 *
 * **It is the same door that opens a jam, but without activating it.** The
 * jam has no pubsub in librespot —the `dealer` has none— so the only way to
 * learn who joined is to ask now and then.
 *
 * **That door creates a session when there is none**, so the panel asks only
 * while it holds one: if the answer brings a different session, the one it
 * had is gone, and the panel says so instead of adopting the new one.
 */
export async function jamStatus(): Promise<JamSession> {
  return invoke<JamSession>("jam_status");
}

/**
 * The shared queue: the songs the service has written down.
 *
 * **The queue is a list, not a playlist**, and it comes from the list
 * service —which speaks protobuf— and not from the library.
 */
export async function jamQueue(sessionId: string): Promise<Track[]> {
  return invoke<Track[]>("jam_queue", { sessionId });
}

/**
 * Leave the jam.
 *
 * **Leaving and closing are two different doors.** Leaving is a `POST` to
 * `…/sessions/<id>/leave`, and it is the guest's door: it takes the account
 * out of the session and leaves the session alive. Closing —deleting the
 * session— is a `DELETE` to `…/sessions/<id>`, and it belongs to the host:
 * without it, the session stays open on the account that opened it.
 *
 * **The one who presses "leave" on the jam they opened closes the jam for
 * everyone**, and that is why the command does both when the one pressing is
 * the host.
 */
export async function jamLeave(sessionId: string, isOwner: boolean): Promise<void> {
  return invoke<void>("jam_leave", { sessionId, isOwner });
}

/**
 * Add a song to the shared queue.
 *
 * **The shared queue is filled with a player command, not with a list write.**
 * The door is `…/sessions/<id>/commands/from/<device>` and the body is a command
 * whose `endpoint` is `add_to_queue`.
 *
 * The command is the one the desktop client sends, and it is the door that
 * crosses: whoever adds the song, the song lands in the jam's queue and both
 * sides see it in the queue they poll.
 */
export async function jamAddToQueue(sessionId: string, trackId: string): Promise<void> {
  return invoke<void>("jam_add_to_queue", { sessionId, trackId });
}

/**
 * Subscribe to playback events.
 *
 * Called from an effect, not from a hook body: the listener outlives any single
 * render, and re-subscribing on every state change would drop events that land
 * in between.
 */
export function onPlaybackStatus(handler: (status: PlaybackStatus) => void): Promise<UnlistenFn> {
  return listen<PlaybackStatus>("player://status", (event) => handler(event.payload));
}

/**
 * Subscribe to the DJ's voice.
 *
 * The event says that the DJ stopped talking —whether it was heard to the end
 * or cut off— and carries the number of the voice it was about. The number is
 * the whole point: two clicks in a row are two voices, and the one that
 * finished first is not the one the second click is waiting for.
 */
export function onDjVoice(handler: (event: DjVoiceEvent) => void): Promise<UnlistenFn> {
  return listen<DjVoiceEvent>("dj://voice", (event) => handler(event.payload));
}

/**
 * Subscribe to the music's pulse: 0 between beats, up to 1 on a kick, about
 * thirty times a second while something sounds (see `beat.rs`).
 *
 * **Feed it to a motion value, never to React state.** Thirty renders a second
 * of the player bar is the same trap the volume echo already paid for.
 * `bun run dev` has no backend, so there the pulse simply never arrives.
 */
export function onBeat(handler: (pulse: number) => void): Promise<UnlistenFn> | null {
  if (!hasBackend()) return null;
  return listen<number>("player://beat", (event) => handler(event.payload));
}

export async function playTrack(
  track: Pick<Track, "id" | "duration_ms">,
  positionMs = 0,
): Promise<void> {
  return invoke<void>("play_track", {
    trackId: track.id,
    positionMs,
    durationMs: track.duration_ms ?? 0,
  });
}

export async function togglePlayback(): Promise<void> {
  return invoke<void>("toggle_playback");
}

/**
 * Ask the backend what the player is doing right now.
 *
 * **The events alone are not enough.** `player://status` is emitted when the
 * player does something, and the first thing it does may be never: the DJ
 * speaks through the mixer and the player does not even know. So a frontend
 * that only listens starts with nothing, and "nothing" is read as volume zero
 * —the bar said "muted" while the music was audible.
 *
 * This is the question to ask at startup, before anything is played.
 */
export async function playerStatus(): Promise<PlaybackStatus> {
  return invoke<PlaybackStatus>("player_status");
}

export async function seekPlayback(positionMs: number): Promise<void> {
  return invoke<void>("seek_playback", { positionMs });
}

export async function setVolume(volume: number): Promise<void> {
  return invoke<void>("set_volume", { volume });
}

/*
 * How opaque the menus are, as a percentage. A setting rather than a constant
 * because how far someone is willing to push a translucent surface over their own
 * library is theirs to choose, not the design system's.
 *
 * These three mirror `settings::MENU_OPACITY_*` on purpose. The Rust side clamps
 * whatever arrives, and a slider that could reach a value the backend silently
 * rewrites is a slider that lies about where it is.
 */
export const MENU_OPACITY_MIN = 55;
export const MENU_OPACITY_MAX = 100;
export const MENU_OPACITY_DEFAULT = 55;

/**
 * `bun run dev` is Vite alone: there is no backend, so `invoke` has nothing to
 * call and rejects. That is fine for everything else on the screen — the whole
 * app needs Rust to be useful — but this setting is pure CSS, so it falls back to
 * `localStorage` when there is no bridge.
 *
 * Without this the customiser was dead in exactly the place it is easiest to
 * iterate on: the slider never left its loading state, because the read that
 * enables it never resolved.
 */
const MENU_OPACITY_KEY = "starless:menu-opacity";

function hasBackend(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function clampOpacity(value: number): number {
  return Math.min(MENU_OPACITY_MAX, Math.max(MENU_OPACITY_MIN, Math.round(value)));
}

export async function menuOpacity(): Promise<number> {
  if (!hasBackend()) {
    // `Number(null)` is 0 and not NaN, so an absent key has to be checked before
    // the number is: otherwise "never chosen" would come back as the floor.
    const raw = window.localStorage.getItem(MENU_OPACITY_KEY);
    const stored = Number(raw);
    return raw !== null && Number.isFinite(stored) ? clampOpacity(stored) : MENU_OPACITY_DEFAULT;
  }
  return invoke<number>("menu_opacity");
}

export async function setMenuOpacity(opacity: number): Promise<void> {
  const value = clampOpacity(opacity);
  if (!hasBackend()) {
    window.localStorage.setItem(MENU_OPACITY_KEY, String(value));
    return;
  }
  return invoke<void>("set_menu_opacity", { opacity: value });
}

/**
 * How many seconds two songs overlap when one ends on its own; 0 is off.
 *
 * Mirrors `crossfade::MAX_SECONDS`. Unlike the opacity there is no
 * `localStorage` fallback: without the backend there is no audio to fade.
 */
export const CROSSFADE_MAX = 12;

export async function crossfadeSeconds(): Promise<number> {
  if (!hasBackend()) return 0;
  return invoke<number>("crossfade_seconds");
}

export async function setCrossfadeSeconds(seconds: number): Promise<void> {
  if (!hasBackend()) return;
  const value = Math.min(CROSSFADE_MAX, Math.max(0, Math.round(seconds)));
  return invoke<void>("set_crossfade_seconds", { seconds: value });
}

/** Drive the CSS variable every overlay reads. No-op before the first paint matters. */
export function applyMenuOpacity(opacity: number): void {
  document.documentElement.style.setProperty("--menu-alpha", String(clampOpacity(opacity) / 100));
}

/**
 * The accent colour, as `#rrggbb`, or `null` when the user never picked one and
 * the one from DESIGN.md stays.
 *
 * Mirrors the opacity path exactly, localStorage included: `bun run dev` has no
 * backend, and a personalisation setting that only works in the packaged build
 * is a setting nobody finds while they are designing it.
 */
const ACCENT_KEY = "starless:accent";

/** The colour DESIGN.md ships. Also what "back to default" writes. */
export const ACCENT_DEFAULT = "#c8ccd4";

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export async function accentColor(): Promise<string | null> {
  if (!hasBackend()) {
    const raw = window.localStorage.getItem(ACCENT_KEY);
    return raw !== null && isHexColor(raw) ? raw.toLowerCase() : null;
  }
  return invoke<string | null>("accent");
}

export async function setAccentColor(color: string): Promise<void> {
  if (!isHexColor(color)) return;
  const value = color.toLowerCase();
  if (!hasBackend()) {
    window.localStorage.setItem(ACCENT_KEY, value);
    return;
  }
  return invoke<void>("set_accent", { color: value });
}

/**
 * Three variables, because one colour cannot stay one hex when it has to work
 * as a fill *and* as the label on top of that fill.
 *
 * The accent itself is the user's. `--color-accent-soft` is the tint the focus
 * outline uses, mixed toward white by the same ratio the shipped pair has
 * (chrome #c8ccd4 → frost #f4f5f7, close enough to the 0.22 mix) so the focus
 * ring keeps its relationship to the accent instead of being the one leftover
 * colour on screen after a repaint.
 *
 * `--color-on-accent` is the foreground for everything filled with the accent —
 * the Inicio button, the play buttons, the primary buttons of every prompt. It
 * is the ground colour or the ink colour depending on how dark the accent is,
 * because the accent is free and a dark one on a dark label is a button nobody
 * can read. That is why the filled buttons say `text-on-accent` and not
 * `text-ground`: the alternative is a colour picker that can produce an
 * invisible button.
 */
export function applyAccentColor(color: string | null): void {
  const root = document.documentElement.style;
  if (!color || !isHexColor(color)) {
    // Remove rather than write the default: `@theme` in index.css is the source
    // of truth for the shipped colour, and duplicating it here would be a
    // second place to keep in sync.
    root.removeProperty("--color-accent");
    root.removeProperty("--color-accent-soft");
    root.removeProperty("--color-on-accent");
    return;
  }
  const value = color.toLowerCase();
  root.setProperty("--color-accent", value);
  root.setProperty("--color-accent-soft", mixToward(value, 0.22));
  root.setProperty("--color-on-accent", isDark(value) ? "#f4f5f7" : "#08080a");
}

/** `amount` of white mixed into `hex`, as `#rrggbb`. */
function mixToward(hex: string, amount: number): string {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return `#${channels
    .map((c) =>
      Math.round(c + (255 - c) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * WCAG relative luminance, and the reason `--color-on-accent` exists.
 *
 * The threshold is 0.45 and not the 0.5 of a contrast formula: the filled
 * surfaces here are large and saturated, and a mid-tone accent at exactly 0.5
 * still reads better with the dark label than with the light one.
 */
function isDark(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2] < 0.45;
}

/**
 * How the library is ordered, and why there are exactly these four.
 *
 * **There is no "recently added" and no "last played", and that is not an omission.**
 * A playlist carries an id, a name, its images, the owner's display name and a track
 * count — see `models.rs`. Not one of those is a date. An order called "recent" built
 * on that would be the order in which the list happened to arrive wearing the label
 * of a fact this app does not have, which is worse than not offering it: the user
 * trusts the label. Spotify's own "Recently added" is a server-side order over a
 * field this session cannot see.
 *
 * So the orders are the four the data can answer honestly.
 */
export const LIBRARY_SORTS = ["name-asc", "name-desc", "creator", "tracks"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

/** Which of the two ways of looking at the shelf is on. */
export const LIBRARY_VIEWS = ["grid", "list"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

export function isLibrarySort(value: string): value is LibrarySort {
  return (LIBRARY_SORTS as readonly string[]).includes(value);
}

export function isLibraryView(value: string): value is LibraryView {
  return (LIBRARY_VIEWS as readonly string[]).includes(value);
}

/** The orders a playlist's songs can be shown in; `custom` is the playlist's own. */
export const PLAYLIST_ORDERS = ["custom", "title", "added", "artist", "album"] as const;
export type PlaylistOrder = (typeof PLAYLIST_ORDERS)[number];

/** How tall a row of a playlist is. */
export const TRACK_LIST_VIEWS = ["list", "compact"] as const;
export type TrackListView = (typeof TRACK_LIST_VIEWS)[number];

/** How every playlist is read: one order, its direction, and the row height. */
export type TrackListPrefs = { order: PlaylistOrder; descending: boolean; view: TrackListView };

export const DEFAULT_TRACK_LIST_PREFS: TrackListPrefs = {
  order: "custom",
  descending: false,
  view: "list",
};

/** Whoever made it, or `null` when the playlist does not say. */
export function playlistCreator(playlist: Playlist): string | null {
  return playlist.owner?.display_name ?? null;
}

function trackCount(playlist: Playlist): number {
  return playlist.tracks?.total ?? 0;
}

/**
 * `undefined` as the locale on purpose: an A–Z that ignores accents is wrong in
 * Spanish and right in English, and the user's language is the one that decides.
 *
 * `numeric` is not a nicety either. Half of this account's shelf is called "Mi
 * playlist n.º 4", and without it the tenth of those sorts between the first and
 * the second.
 */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The order, as a new array. `Array.prototype.sort` rearranges in place, and the
 * array coming out of React Query is the cache's own — sorting it would reorder the
 * cached value under every other screen that reads it.
 */
export function sortPlaylists(playlists: Playlist[], sort: LibrarySort): Playlist[] {
  const sorted = [...playlists];

  switch (sort) {
    case "name-desc":
      sorted.sort((a, b) => byName.compare(b.name, a.name));
      break;

    case "creator":
      sorted.sort((a, b) => {
        const left = playlistCreator(a);
        const right = playlistCreator(b);
        // An absent owner is not a creator who sorts before every real one.
        if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
        // The name breaks the tie, so the order does not shuffle when two people
        // made the same number of playlists.
        return byName.compare(left, right) || byName.compare(a.name, b.name);
      });
      break;

    case "tracks":
      sorted.sort((a, b) => trackCount(b) - trackCount(a) || byName.compare(a.name, b.name));
      break;

    default:
      sorted.sort((a, b) => byName.compare(a.name, b.name));
  }

  return sorted;
}

const LIBRARY_SORT_KEY = "starless:library-sort";
const LIBRARY_VIEW_KEY = "starless:library-view";

/**
 * Both preferences cross to `localStorage` when there is no bridge, for the same
 * reason the accent and the menu opacity do: `bun run dev` is where a setting is
 * easiest to try and the one place it would otherwise be dead.
 */
export async function librarySort(): Promise<LibrarySort> {
  if (!hasBackend()) {
    const raw = window.localStorage.getItem(LIBRARY_SORT_KEY);
    return raw !== null && isLibrarySort(raw) ? raw : "name-asc";
  }
  // Checked on this side too, and the Rust gate is the one that matters — this is
  // the same shape of check on the other side of the bridge, so that a value which
  // somehow is not an order cannot reach a `switch` that has no case for it.
  const value = await invoke<string>("library_sort");
  return isLibrarySort(value) ? value : "name-asc";
}

export async function setLibrarySort(sort: LibrarySort): Promise<void> {
  if (!hasBackend()) {
    window.localStorage.setItem(LIBRARY_SORT_KEY, sort);
    return;
  }
  return invoke<void>("set_library_sort", { sort });
}

export async function libraryView(): Promise<LibraryView> {
  if (!hasBackend()) {
    const raw = window.localStorage.getItem(LIBRARY_VIEW_KEY);
    return raw !== null && isLibraryView(raw) ? raw : "grid";
  }
  const value = await invoke<string>("library_view");
  return isLibraryView(value) ? value : "grid";
}

export async function setLibraryView(view: LibraryView): Promise<void> {
  if (!hasBackend()) {
    window.localStorage.setItem(LIBRARY_VIEW_KEY, view);
    return;
  }
  return invoke<void>("set_library_view", { view });
}

const TRACK_ORDER_KEY = "starless:track-order";
const TRACK_VIEW_KEY = "starless:track-view";

/**
 * The order and the view a playlist opens in. Rust keeps the order as
 * `<order>-<asc|desc>` and refuses one it does not know; this side checks the
 * same shape again before it reaches a `switch`, like `librarySort`.
 */
export async function trackListPrefs(): Promise<TrackListPrefs> {
  const [rawOrder, rawView] = hasBackend()
    ? await Promise.all([invoke<string>("track_order"), invoke<string>("track_view")])
    : [window.localStorage.getItem(TRACK_ORDER_KEY), window.localStorage.getItem(TRACK_VIEW_KEY)];
  const [order, direction] = (rawOrder ?? "").split("-");
  const known = (PLAYLIST_ORDERS as readonly string[]).includes(order);
  return {
    order: known ? (order as PlaylistOrder) : DEFAULT_TRACK_LIST_PREFS.order,
    descending: known && direction === "desc",
    view: (TRACK_LIST_VIEWS as readonly string[]).includes(rawView ?? "")
      ? (rawView as TrackListView)
      : DEFAULT_TRACK_LIST_PREFS.view,
  };
}

export async function setTrackOrder(order: PlaylistOrder, descending: boolean): Promise<void> {
  const value = `${order}-${descending ? "desc" : "asc"}`;
  if (!hasBackend()) {
    window.localStorage.setItem(TRACK_ORDER_KEY, value);
    return;
  }
  return invoke<void>("set_track_order", { order: value });
}

export async function setTrackView(view: TrackListView): Promise<void> {
  if (!hasBackend()) {
    window.localStorage.setItem(TRACK_VIEW_KEY, view);
    return;
  }
  return invoke<void>("set_track_view", { view });
}

/**
 * Crea una playlist y devuelve su id.
 *
 * El error que llega es el código de Rust tal cual, y hay dos que no son el
 * mismo problema: `create_failed` no creó nada, `attach_failed` la creó y existe
 * pero no llegó a la biblioteca. La pantalla los muestra distinto porque las dos
 * cosas dejan la cuenta en un estado distinto y sólo una se arregla reintentando.
 *
 * Sin backend devuelve un id inventado en vez de fallar: es la única forma de que
 * `bun run dev` muestre el diálogo completo sin una sesión detrás.
 */
export async function createPlaylist(name: string): Promise<string> {
  if (!hasBackend()) {
    throw new Error("create_failed");
  }
  return invoke<string>("create_playlist", { name });
}

/**
 * Adds a song to a playlist that already exists.
 *
 * The error that arrives is the Rust code as it is, and there are three that
 * are not the same problem: `playlist_not_found` is a playlist that is not in
 * the library —or that does not exist—, `add_failed` is a refusal from the
 * service, and `network_failed` is that there was no network. The screen shows
 * them apart because the three leave the account in a different state: one is
 * fixed by choosing another list, another is retried and the third is waited
 * out.
 *
 * The playlist's revision is read by the backend at the moment of writing,
 * which is the only thing that guarantees it is the latest one: the service
 * answers `409` to a change stitched against an old revision.
 *
 * Without a backend there is nothing to add: the error is the truth.
 */
export async function addToPlaylist(playlistId: string, trackId: string): Promise<void> {
  if (!hasBackend()) {
    throw new Error("add_failed");
  }
  await invoke<void>("add_to_playlist", { playlistId, trackId });
}

/**
 * How long the details write may take before the webview stops waiting.
 *
 * **It is longer than the backend can take, and that is the point.** The
 * backend bounds every step it takes —the session, the token, the upload, the
 * registration, the revision and the write— at twenty seconds each, so five
 * of them plus the wait for the session is the worst case. A ceiling below
 * that would show a failure while the backend was still working, and the
 * user would press Save again on a write that was about to land.
 */
const DETAILS_DEADLINE = 150_000;

/**
 * A promise with a ceiling.
 *
 * **The timer is cleared either way.** A timer left running keeps the page
 * awake for no reason, and all it would do afterwards is reject a promise
 * nobody is waiting for anymore.
 */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Saves a playlist's details: the name, the description and the cover.
 *
 * **The cover goes as bytes, not as an id.** The id of the image is a thing of
 * the service —the backend uploads the file, registers it and only then fills
 * the id— so it is not something the webview gets to write. What the webview
 * sends is the picture the user chose, and the backend takes it from there.
 *
 * The error that arrives is the Rust code as it is, and there are three that
 * are not the same problem: `details_failed` is a refusal from the service,
 * `upload_failed` is a picture that did not go up —or an image in a format
 * the service does not take—, and `network_failed` is that there was no
 * network. The dialog shows them apart because the first one leaves the
 * playlist as it was and the second one never got that far.
 *
 * **The wait has a ceiling.** The backend bounds every step it takes —the
 * session, the token, the upload, the registration, the revision and the
 * write— so the command always answers; but the bridge between the two sides
 * is not something this file can promise. A request that never comes back
 * would leave the dialog saying "Saving…" for good, and a button that never
 * comes back is worse than one that says it failed. The ceiling sits above
 * what the backend can take —five calls of twenty seconds each, plus the
 * wait for the session— so it never fires while the backend is still working.
 */
export async function savePlaylistDetails(
  playlistId: string,
  details: {
    name?: string;
    description?: string;
    remove_picture?: boolean;
    is_public?: boolean;
  },
  cover?: Uint8Array,
): Promise<void> {
  if (!hasBackend()) {
    throw new Error("details_failed");
  }
  await withDeadline(
    invoke<void>("update_playlist_details", {
      playlistId,
      details,
      cover: cover ? Array.from(cover) : null,
    }),
    DETAILS_DEADLINE,
  );
}

export const keys = {
  account: ["account"] as const,
  playlists: ["playlists"] as const,
  liked: ["liked-tracks"] as const,
  search: (query: string) => ["search", query] as const,
  artistSongs: (artistId: string) => ["artist-songs", artistId] as const,
  albumSongs: (albumId: string) => ["album-songs", albumId] as const,
  playlistTracks: (playlistId: string) => ["playlist-tracks", playlistId] as const,
  lyrics: (trackId: string) => ["lyrics", trackId] as const,
};

/**
 * One line of a song's words.
 *
 * `start_ms` is `null` when the provider sent no clock, which is a different
 * answer from `0`. A lyrics page with no timings sends `"0"` on every line, and
 * reading that as a moment would sit on the first line for the whole song.
 */
export type LyricLine = {
  text: string;
  start_ms: number | null;
};

export type Lyrics = {
  lines: LyricLine[];
  /** True when the lines carry timings and can be followed along. */
  synced: boolean;
};

/**
 * The words to the track that is playing.
 *
 * Disabled with no track for the same reason the playlist hook is: there is no id
 * to ask about, and a request with `null` on the wire is a request about nothing.
 *
 * The cache is generous because lyrics for a given song never change, and the
 * panel is opened and closed constantly — refetching it every time would put one
 * round trip between the user and the words.
 */
export const LYRICS_STALE_MS = 24 * 60 * 60_000;

export function useLyrics(trackId: string | null) {
  return useQuery({
    queryKey: keys.lyrics(trackId ?? ""),
    queryFn: () => invoke<Lyrics>("lyrics", { trackId }),
    enabled: Boolean(trackId),
    staleTime: LYRICS_STALE_MS,
    // "This song has no lyrics" is an answer worth not asking twice.
    retry: false,
  });
}

export function useAccount() {
  return useQuery({
    queryKey: keys.account,
    queryFn: () => invoke<Account>("account"),
    staleTime: 5 * 60_000,
  });
}

export function usePlaylists() {
  return useQuery({
    queryKey: keys.playlists,
    queryFn: () => invoke<Playlist[]>("my_playlists"),
    staleTime: 5 * 60_000,
  });
}

export function useLikedTracks() {
  return useQuery({
    queryKey: keys.liked,
    queryFn: () => invoke<Track[]>("liked_tracks"),
    staleTime: 5 * 60_000,
  });
}

/**
 * The contents of one playlist.
 *
 * Disabled while there is no id, because `null` is the sentinel for "the user is
 * looking at Liked Songs", not the name of a playlist. Firing anyway would put
 * `/playlists//tracks` on the wire and turn a navigation state into a request.
 */
/**
 * How long a playlist's tracks count as fresh.
 *
 * Shared by the query and the prefetch on purpose, and it is the sharing that
 * matters. `prefetchQuery` defaults to `staleTime: 0`, which writes the answer
 * into the cache and immediately marks it stale — so a prefetch does not warm
 * anything, it just makes the next observer refetch. Pass the same number here
 * and the prefetch leaves the data *fresh*, which is the whole point of
 * prefetching.
 *
 * The symptom of getting this wrong is a request storm rather than a wrong
 * list: a playlist past fifty songs costs one round trip per page, so hovering
 * the sidebar re-downloaded every page of it, several times over, in seconds.
 */
export const PLAYLIST_STALE_MS = 5 * 60_000;

export function usePlaylistTracks(playlistId: string | null) {
  return useQuery({
    queryKey: keys.playlistTracks(playlistId ?? ""),
    queryFn: () => invoke<Track[]>("playlist_tracks", { playlistId }),
    enabled: Boolean(playlistId),
    staleTime: PLAYLIST_STALE_MS,
  });
}

/**
 * Search is deliberately not a query hook.
 *
 * The keyboard fires a request per keystroke, and a cache keyed by every
 * intermediate string is a cache nobody benefits from. So the menu calls this
 * behind a debounce and the results screen calls it from Enter.
 *
 * It answers with songs and only songs: the search parser on the other side drops
 * the type of whatever it matched, so asking again for albums, artists or
 * playlists would return the same songs under a different heading.
 */
export async function runSearch(query: string): Promise<Track[]> {
  return invoke<Track[]>("search_tracks", { query });
}

/**
 * One artist's songs — and the honest description of what that is.
 *
 * **This is a search that keeps only the right ones.** There is no artist read
 * behind this screen. What `get_context` answers for `spotify:artist:<id>` was
 * never measured, and the one context this app has proved it reaches —
 * `spotify:search:<query>` — returns whatever Spotify thinks matches the words.
 * So the page asks by name and then throws away everything whose artist list
 * does not carry the same *id*.
 *
 * The id is the part that matters. Matching on the name would keep "The Weeknd"
 * and every other artist whose name happens to contain it; matching on the id
 * keeps Renzo Pikette and nothing else, because the id is the thing that cannot
 * be confused.
 *
 * **Which means the list is not everything by the artist**, and the screen says
 * "what this app can find" instead of "Popular" or "Songs". A page that claims a
 * complete discography behind a result set nobody counted is the same overclaim
 * as a "Popular" shelf with no ranking behind it.
 *
 * Disabled without a name, for the same reason the playlist hook is: there is
 * nothing to ask about, and a request with no query is a request about nothing.
 */
export function useArtistSongs(artist: Artist | null) {
  const query = useQuery({
    queryKey: keys.artistSongs(artist?.id ?? ""),
    queryFn: () => runSearch(artist?.name ?? ""),
    enabled: Boolean(artist?.name),
    staleTime: PLAYLIST_STALE_MS,
  });

  const tracks = useMemo(() => {
    if (!artist) return [];
    return (query.data ?? []).filter((track) =>
      track.artists.some((candidate) => candidate.id === artist.id),
    );
  }, [query.data, artist]);

  return { ...query, tracks };
}

/**
 * One album's songs — the same bargain as [`useArtistSongs`](src/lib/spotify.ts),
 * and for the same reason.
 *
 * Searched by the album's name and then filtered on the album **id**, because a
 * name is not an identity: "Greatest Hits" is thousands of records, and matching
 * on it would hand somebody a shelf of songs from bands they have never heard of.
 * The id is the one thing that cannot be confused with another album.
 *
 * So the heading on that page is what this app finds, not "Every song", and the
 * count is the count of what came back rather than a track total nobody counted.
 */
export function useAlbumSongs(album: Album | null) {
  const query = useQuery({
    queryKey: keys.albumSongs(album?.id ?? ""),
    queryFn: () => runSearch(album?.name ?? ""),
    enabled: Boolean(album?.name),
    staleTime: PLAYLIST_STALE_MS,
  });

  const tracks = useMemo(() => {
    if (!album) return [];
    return (query.data ?? []).filter((track) => track.album?.id === album.id);
  }, [query.data, album]);

  return { ...query, tracks };
}

/**
 * Everything that is only true while signed in.
 *
 * Invalidated together at every auth boundary, because the failure mode is always
 * the same: one query keeps serving data — or an error — that belonged to a
 * previous session. Listing the keys beats invalidating everything, which would
 * also throw away the search cache the user can see on screen.
 */
export const AUTH_KEYS = [keys.account, keys.playlists, keys.liked] as const;

/**
 * Sign out.
 *
 * **No reload.** The reload was here to bring the login screen back, and it is the
 * reason this bug kept coming back.
 *
 * It only *appeared* to work, because it threw away the query cache as a side
 * effect — and that is the part that hurt. Between `sign_out` returning and the
 * reload landing, the queries already mounted in the tree fired one last time,
 * got `not_signed_in`, and cached that error. Depending on timing the reload
 * either wiped it or preserved it: a coin flip, which is what "works on my
 * machine" means.
 *
 * Instead of relying on that, [`AuthGate`](../components/AuthGate) invalidates the
 * cache at the moment it opens the door, so cached data can never outlive the
 * session that authorised it regardless of ordering.
 */
export async function signOut(): Promise<void> {
  return invoke<void>("sign_out");
}

/**
 * The language `explain()` answers in. It has callers outside the tree that
 * gets `t` (hooks, console lines), so `App` sets it once per render instead of
 * every caller passing it in.
 */
let errorLang: Lang = "es";

export function setErrorLanguage(lang: Lang): void {
  errorLang = lang;
}

/** Best-effort sentence for an error thrown by `invoke`. */
export function explain(error: unknown): string {
  const raw = typeof error === "string" ? error : String(error);
  const code = raw.replace(/^.*?:\s*/, "");
  return (errors[errorLang] as Record<string, string>)[code] ?? code;
}

/**
 * The errors that are about the connection or the audio device, and not about
 * the track.
 *
 * **A dead connection and an unplayable song are the same event with
 * opposite meanings.** When the connection to Spotify dies, every track fails
 * exactly the same way, one after another, and the answer the player used to
 * give — skip to the next one — is the wrong answer to the right question: it
 * burns through the queue in seconds and it overwrites the one message that
 * says what is actually wrong.
 *
 * So the codes that mean "the connection" are named here, and the player does
 * not skip on them. It waits, because the app is already building the session
 * again underneath.
 *
 * The two about the audio device belong here for the same reason: the song
 * was fine and the device was not, so a row painted as failed would accuse
 * the song of something it did not do, and skipping would throw away a track
 * the user wanted to hear.
 */
export const SESSION_ERRORS = new Set([
  "connection_lost",
  "session_dropped",
  "reconnecting",
  "audio_stalled",
  "audio_device_failed",
]);
