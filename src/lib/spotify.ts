import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
  width: number | null;
  height: number | null;
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
 * An album as a search returns it, which is not the same object as the album a
 * track carries.
 *
 * The track's album is a name and a picture. This one also carries the year — so
 * a card can say "2016" — and the track count, which the per-track album does not
 * have at all.
 */
export type AlbumCard = {
  id: string;
  name: string;
  images: Image[];
  artists: Artist[];
  /** `2016`, or `2016-08-20` when Spotify had the precision for it. */
  release_date: string | null;
  release_date_precision: string | null;
  total_tracks: number | null;
  album_type: string | null;
};

/**
 * The year, and only the year.
 *
 * Mirrors `AlbumCard::year` in Rust, because the two must agree: a card that
 * says 2016 in one place and 2016-08-20 in another is not a rounding detail.
 * Returns `null` for anything that is not a four-digit year rather than
 * rendering half a date.
 */
export function albumYear(album: AlbumCard): string | null {
  const year = album.release_date?.split("-")[0] ?? null;
  return year && /^\d{4}$/.test(year) ? year : null;
}

export type ArtistCard = { id: string; name: string; images: Image[] };

/**
 * An artist, their songs, and a discography that never arrives.
 *
 * There is no `topTracks` here on purpose: Spotify answers 403 to
 * `/artists/{id}/top-tracks` for apps created after February 2026, and removed
 * `popularity` along with it. These songs are real and they are in search order,
 * which is not the same as ranked by popularity, so nothing calls them that.
 *
 * `albums` is part of the answer and is always empty: the channel the library is
 * read through has no way to ask for an artist's albums, so there is no request
 * that could fill it. It is declared because the payload carries it, and nothing
 * renders it — a "0 albums" on screen would be a claim this client cannot make.
 */
export type ArtistProfile = {
  artist: ArtistCard;
  albums: AlbumCard[];
  tracks: Track[];
};

export type Account = {
  id: string;
  display_name: string | null;
  email: string | null;
  /** `premium`, or something else. The difference is whether audio exists. */
  product: string | null;
  images: Image[];
};

/**
 * The largest image offered.
 *
 * Taking `images[0]` looks equivalent and is not: the array is not guaranteed to
 * be sorted by size, so it is a coin flip between a 64px icon and a 640px cover
 * that then gets downscaled anyway.
 */
export function largestImage(images: Image[] | null | undefined): Image | null {
  if (!images?.length) return null;
  return images.reduce((best, image) => ((image.width ?? 0) > (best.width ?? 0) ? image : best));
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

export function accountName(account: Account): string {
  return account.display_name || account.id;
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

export function isPremium(account: Account): boolean {
  return account.product === "premium";
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

export function usePlayback() {
  return useQuery({
    queryKey: ["player"] as const,
    queryFn: () => invoke<PlaybackStatus>("player_status"),
    // The player only changes on a command, so polling it is noise. The
    // `player://status` event is the thing that actually moves the needle.
    staleTime: Infinity,
    refetchInterval: false,
  });
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

export const keys = {
  account: ["account"] as const,
  playlists: ["playlists"] as const,
  liked: ["liked-tracks"] as const,
  search: (query: string) => ["search", query] as const,
  playlistTracks: (playlistId: string) => ["playlist-tracks", playlistId] as const,
  artistProfile: (artistId: string) => ["artist-profile", artistId] as const,
};

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
 * What is on an album, in order.
 *
 * This is what makes a play button on an album card real: it hands back an
 * actual queue instead of a cover that looks tappable.
 */
export async function runAlbumTracks(albumId: string): Promise<Track[]> {
  return invoke<Track[]>("album_tracks", { albumId });
}

export function useArtistProfile(artistId: string | null) {
  return useQuery({
    queryKey: keys.artistProfile(artistId ?? ""),
    queryFn: () => invoke<ArtistProfile>("artist_profile", { artistId }),
    enabled: Boolean(artistId),
    staleTime: 5 * 60_000,
  });
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
export const API_ERRORS: Record<string, string> = {
  unauthorised: "La sesión venció. Vuelve a entrar.",
  // Deliberately not "your account can't access this". In development mode a 403
  // on a playlist means Spotify will not serve its contents to a third-party app
  // unless the account owns or collaborates on it — which has nothing to do with
  // what the account is allowed to do. Blaming the account sends people looking
  // for a permissions problem that is not theirs to fix.
  forbidden: "Spotify no entrega el contenido de esta playlist a una app en desarrollo.",
  rate_limited: "Spotify está limitando las peticiones. Espera un momento.",
  // A transient outage on Spotify's side, not a verdict about the request. Worth
  // its own sentence because it is the one failure that resolves by itself, and
  // the app retries it while you are still looking at the screen.
  service_unavailable:
    "Spotify está teniendo problemas en este momento. Starless sigue reintentando.",
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
  audio_device_failed: "No se pudo abrir el dispositivo de audio de Windows.",
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
  connection_lost:
    "Se perdió la conexión con Spotify y no vuelve sola. Cerrá y abrí Starless para seguir escuchando.",
  bad_track_id: "Esa canción no tiene un identificador válido.",
  session_dropped: "Se cayó la sesión de reproducción.",
};

/** Best-effort sentence for an error thrown by `invoke`. */
export function explain(error: unknown): string {
  const raw = typeof error === "string" ? error : String(error);
  const code = raw.replace(/^.*?:\s*/, "");
  return API_ERRORS[code] ?? code;
}
