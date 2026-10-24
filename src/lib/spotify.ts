import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useMemo } from "react";

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
export const ACCENT_DEFAULT = "#c9f73c";

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
 * (#c9f73c → #d9ff6b) so the focus ring keeps its relationship to the accent
 * instead of being the one lime thing left on screen after a repaint.
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
  root.setProperty("--color-on-accent", isDark(value) ? "#f4f4fa" : "#0a0a12");
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
 * Mete una canción en una playlist que ya existe.
 *
 * El error que llega es el código de Rust tal cual, y hay tres que no son el
 * mismo problema: `playlist_not_found` es una playlist que no está en la
 * biblioteca —o que no existe—, `add_failed` es un rechazo del servicio, y
 * `network_failed` es que no hubo red. La pantalla los muestra distinto porque
 * las tres cosas dejan la cuenta en un estado distinto: una se arregla
 * eligiendo otra lista, otra se reintenta y la tercera se espera.
 *
 * La revisión de la playlist la lee el backend en el momento de escribir, que
 * es lo único que garantiza que sea la última: el servicio contesta `409` a un
 * cambio cosido contra una revisión vieja.
 *
 * Sin backend no hay nada que agregar: el error es la verdad.
 */
export async function addToPlaylist(playlistId: string, trackId: string): Promise<void> {
  if (!hasBackend()) {
    throw new Error("add_failed");
  }
  await invoke<void>("add_to_playlist", { playlistId, trackId });
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
 * Rust error codes, so a screen can say something true instead of "algo falló".
 * Anything unlisted is reported as-is rather than swallowed: a new code showing
 * up on screen is a signal, not noise.
 */
const API_ERRORS: Record<string, string> = {
  unauthorised: "La sesión venció. Vuelve a entrar.",
  // Deliberately not "your account can't access this". In development mode a 403
  // on a playlist means Spotify will not serve its contents to a third-party app
  // unless the account owns or collaborates on it — which has nothing to do with
  // what the account is allowed to do. Blaming the account sends people looking
  // for a permissions problem that is not theirs to fix.
  forbidden: "Spotify no entrega el contenido de esta playlist a una app en desarrollo.",
  rate_limited: "Spotify está limitando las peticiones. Espera un momento.",
  // A failure that resolves by itself, and the one the app really does retry
  // while the user is still looking at the screen.
  //
  // **It does not say whose fault it is, on purpose.** librespot raises this for
  // a service that is down *and* for a `ConnectionRefused` on this machine — the
  // home network went down — and the two arrive as the same kind. "Spotify está
  // teniendo problemas" is the wrong sentence for someone whose router just
  // rebooted: it sends them off to look for a problem they do not have, in a
  // service they cannot go and check.
  service_unavailable: "No se pudo llegar a Spotify en este momento. Starless sigue reintentando.",
  not_signed_in: "Primero hay que iniciar sesión.",
  login_expired: "La sesión venció. Vuelve a entrar.",
  network_failed: "No se pudo hablar con Spotify.",
  bad_response: "Spotify respondió algo que no entendemos.",
  token_refresh_failed: "No se pudo renovar la sesión. Vuelve a entrar.",
  command_failed: "La operación falló.",
  session_busy: "La sesión está ocupada. Inténtalo de nuevo.",

  // Playback. None of these are edge cases: each one is a reason a click produces
  // nothing, and a click that produces nothing with no explanation is the single
  // worst failure an app can have.
  no_player: "El reproductor todavía no está listo. Inténtalo de nuevo.",
  // The play button with nothing loaded behind it. The app does not press it
  // in this state — the button is disabled when there is no track — but the
  // command can be asked anyway, and the answer has to be a sentence and not a
  // code the user would have to decode.
  no_track: "No hay ninguna canción cargada.",
  audio_device_failed: "No se pudo abrir el dispositivo de audio de Windows.",
  // The player stopped answering. Not a broken song and not a broken
  // connection: the output device stopped consuming, librespot's sink waits
  // for it forever, and the app noticed that the position had stopped moving
  // and went to build another player. The app is doing something about it, so
  // this is what it says while it does.
  audio_stalled: "El audio se trabó. Volviendo a abrir el dispositivo de salida…",
  // Phrased as a fact about this app, not an accusation. The event behind it has
  // at least two very different causes — Spotify refusing to serve the track, and
  // the decoder choking on bytes that were delivered fine — and the status carries
  // no way to tell them apart. Saying "Spotify did not deliver this song" picks
  // one of them and sends the user somewhere the problem is not.
  track_unavailable: "No se pudo reproducir esta canción.",
  // Its own code, not `track_unavailable` wearing a hat. The song was fine: the
  // connection to Spotify was gone, so there was nobody left to ask for the key
  // that decrypts it — and librespot, which never reconnects on its own, answers
  // a missing key by playing the file undecrypted. The decoder then reports
  // ciphertext as an unplayable song. Same event, opposite truth.
  //
  // **This is the end of the road.** The app tries to build the session again
  // on its own, and this is what is left when that does not work: the
  // connection is gone and it could not be brought back.
  connection_lost:
    "Se perdió la conexión con Spotify y no se pudo volver. Cierra y abre Starless para seguir escuchando.",
  // Not a failure yet. The session died and the app is going to build it again
  // — the same credentials, a new connection — and the track that failed goes
  // back on when it is up. Saying "it was lost" here would be a lie about a
  // thing that is still being fixed.
  reconnecting: "Se perdió la conexión con Spotify. Volviendo a conectarse…",
  bad_track_id: "Esa canción no tiene un identificador válido.",
  // Not a failure. Spotify answers 404 when nobody wrote the words down, and that
  // is a fact about the song; saying "could not read" instead would point the user
  // at their own machine when the answer was about the track.
  no_lyrics: "Esta canción no tiene letra.",
  session_dropped: "Se cayó la sesión de reproducción.",

  // Playlist writes. The three that can come out of an "add to playlist" are
  // three different problems: the playlist is not in the library, the service
  // refused the change, and the id was not an id. Saying "it failed" for all
  // three sends the user looking in the wrong place.
  playlist_not_found: "Esa playlist no está en tu biblioteca.",
  add_failed: "No se pudo agregar la canción a la playlist.",
  // These two were emitted by Rust and had no sentence here, so the user read
  // the raw code on screen. They are the two the playlist commands can answer.
  bad_id: "Ese identificador no es válido.",
  no_session: "La sesión no está lista. Inténtalo de nuevo.",
};

/** Best-effort sentence for an error thrown by `invoke`. */
export function explain(error: unknown): string {
  const raw = typeof error === "string" ? error : String(error);
  const code = raw.replace(/^.*?:\s*/, "");
  return API_ERRORS[code] ?? code;
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
