import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlbumScreen } from "./components/AlbumScreen";
import { ArtistScreen } from "./components/ArtistScreen";
import { AuthGate } from "./components/AuthGate";
import { CrashPrompt } from "./components/CrashPrompt";
import { CursorGlow } from "./components/CursorGlow";
import { FeedbackPanel } from "./components/FeedbackPanel";
import { HomeScreen } from "./components/HomeScreen";
import { JamPanel } from "./components/JamPanel";
import { LibrarySidebar } from "./components/LibrarySidebar";
import { LyricsPanel } from "./components/LyricsPanel";
import { NewPlaylistDialog } from "./components/NewPlaylistDialog";
import { PlayerBar, type RepeatMode } from "./components/PlayerBar";
import { PlaylistScreen } from "./components/PlaylistScreen";
import { QueuePanel } from "./components/QueuePanel";
import { SearchScreen } from "./components/SearchScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { TopBar } from "./components/TopBar";
import { TrackList } from "./components/TrackList";
import { UpdateAlert } from "./components/UpdateAlert";
import { type Lang, type StringKey, strings } from "./lib/i18n";
import { SPRING } from "./lib/motion";
import {
  placeOfSong,
  queueWithAdded,
  queueWithListAdded,
  rowPlace,
  upNextTracks,
} from "./lib/queue";
import {
  type Album,
  type Artist,
  accentColor,
  addToPlaylist,
  applyAccentColor,
  applyEffects,
  applyMenuOpacity,
  createPlaylist as createPlaylistCall,
  DEFAULT_TRACK_LIST_PREFS,
  type DjNarration,
  djMix,
  djMore,
  djSpeak,
  effects,
  explain,
  isDjCard,
  type JamSession,
  jamAddToQueue,
  jamJoin,
  jamLeave,
  jamQueue,
  jamStart,
  jamStatus,
  keys,
  type LibrarySort,
  type LibraryView,
  librarySort,
  libraryView,
  listCount,
  menuOpacity,
  onDjVoice,
  onPlaybackStatus,
  PLAYLIST_STALE_MS,
  type PlaybackStatus,
  type Playlist,
  playerStatus,
  playTrack,
  type RadioContext,
  radioMore,
  radioStart,
  SESSION_ERRORS,
  setErrorLanguage,
  setLibrarySort,
  setLibraryView,
  setTrackOrder,
  setTrackView,
  sortPlaylists,
  type Track,
  type TrackListPrefs,
  togglePlayback,
  trackArtists,
  trackListPrefs,
  useAccount,
  useEffectsSettings,
  useLikedTracks,
  useLyrics,
  usePlaylists,
  usePlaylistTracks,
} from "./lib/spotify";
import { checkForUpdate, newerVersion, subscribeUpdate, updateState } from "./lib/updater";
import { useSearch } from "./lib/useSearch";

/**
 * How many tracks in a row may fail before Starless stops skipping.
 *
 * Skipping on failure with no ceiling is an infinite loop that walks a playlist to
 * its end in milliseconds and then blames the user for the noise. Five in a row
 * means the problem is not any individual track.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * What the app is playing, and what came with it.
 *
 * **The DJ is not the only session here.** A playlist is a list and ends where it
 * ends; the DJ keeps choosing, so its queue has to be able to grow while it
 * plays; and the radio does the same, but without a DJ: it is music that keeps
 * coming because it is similar to what was playing. `source` says which of the
 * three this is, and the lines are the DJ's phrases — one per song, because the
 * DJ opens a stretch with one and closes it with another.
 */
type Queue = {
  tracks: Track[];
  lines: Record<string, DjNarration>;
  /**
   * What this queue is.
   *
   * - "list": a list, and it ends where it ends.
   * - "dj": the DJ, which talks and keeps choosing.
   * - "radio": the radio, which keeps playing similar songs and never talks.
   *
   * **The last two are stations**: the queue grows while it plays, and the
   * service is the one that fills it.
   */
  source: "list" | "dj" | "radio";
  /**
   * What the radio was seeded with.
   *
   * **The context, and not the songs.** The radio asks the service what is
   * similar to what was being listened to, and "what was being listened to" is
   * a playlist or a song —not the fifty songs the queue holds. Without this the
   * radio could not be seeded at all.
   */
  context: RadioContext | null;
};

/**
 * How many songs are left before the station asks for more.
 *
 * **Two, and not zero.** The page takes about a second to arrive, and the queue
 * is empty for exactly that second if the app waits until the last song: that
 * silence is the one thing a radio station cannot do. Two songs of margin is
 * a song and a half of music — enough for a request, little enough that the
 * queue does not grow forever.
 */
const DJ_TOP_UP = 2;

/**
 * Cuántas canciones recientes se le cuentan al servicio cuando arranca la radio.
 *
 * **El autoplay pregunta dos cosas:** qué se escuchaba y qué sonó hace poco. Las
 * recientes son eso segundo: las últimas canciones que sonaron, para que las
 * parecidas se parezcan a lo que está sonando y no a lo que sonó hace media
 * hora.
 *
 * **Cinco, y no más.** Es lo que el servicio usa para arrancar la estación, y
 * una lista larga lo hace repetir lo que ya sonó.
 */
const RECENT_FOR_RADIO = 5;

/**
 * Cada cuánto se pregunta por el jam.
 *
 * **El jam no tiene pubsub en librespot**, así que la única forma de saber
 * que alguien se unió es preguntar. Tres segundos es lo que tarda el otro
 * lado en contarse en el jam, y es un viaje por la red que no puede ir cada
 * frame.
 */
const JAM_POLL_MS = 3000;

/**
 * The fade that dissolves the edges of the content area, as a mask.
 *
 * **A mask, and not a gradient painted over the content.** A gradient element
 * would have to sit on top of the card, and then it would also hide the card's
 * rounded bottom corner at the end of the list — the one place where that edge
 * has to be seen whole. A mask does the opposite: it takes the pixels away
 * where there is more list, and leaves them alone where there is not.
 *
 * **Both edges, decided separately.** A scrolled list is cut at the top and at
 * the bottom, and both cuts are the same problem: a row sliced in half, which
 * reads as a rendering fault rather than as "there is more". So each edge gets
 * its own fade, and only when there is really something on that side. A list
 * that fits on the screen has neither, and then there is no mask at all — the
 * card's rounded corners are the best thing on screen and nothing takes them
 * away.
 *
 * **Both spellings, and the standard one last.** These are inline styles, so
 * Lightning CSS never sees them and never collapses the pair into the prefixed
 * one — the failure this repo already paid once with `backdrop-filter`. The two
 * properties are aliases of each other, so whichever one the engine picks, the
 * gradient that ends up painted is the same.
 */
function fadeMask(above: boolean, below: boolean): string | undefined {
  if (!above && !below) return undefined;

  const stops: string[] = [];
  if (above) stops.push("transparent 0", "#000 44px");
  else stops.push("#000 0");
  if (below) stops.push("#000 calc(100% - 44px)", "transparent 100%");
  else stops.push("#000 100%");

  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

/**
 * The two "a page about one thing" destinations, as one state.
 *
 * An album screen and an artist screen are the same shape with a different name
 * on it, and they are opened from the same row by the same gesture. Modelling
 * them as two states means every navigation has to remember to clear both, and
 * the one that forgets shows a page with nothing behind it.
 */
type Detail = { kind: "artist"; artist: Artist } | { kind: "album"; album: Album };

/**
 * A new order for the queue, with the song that is playing left where it is.
 *
 * Two properties make this usable rather than merely random. The current song
 * does not move, so turning shuffle on is not audible *right now* — it changes
 * what comes after. And the order is decided once and kept, because the queue
 * panel shows the list: an order that was re-drawn on every jump left the panel
 * showing a sequence of songs that were never going to play in that order, and a
 * panel that does not describe the queue is worse than no panel.
 */
function shuffleFrom<T extends { id: string }>(items: T[], currentId?: string | null): T[] {
  const order = [...items];
  // `splice`, not `filter`: a list can hold the same song twice, and filtering by
  // id would take both copies and quietly drop one from the queue.
  const at = currentId ? order.findIndex((item) => item.id === currentId) : -1;
  const current = at >= 0 ? order.splice(at, 1)[0] : undefined;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return current ? [current, ...order] : order;
}

/** Narrow enough that an open library squeezes the content; see `railOnly`. */
const NARROW_QUERY = "(max-width: 999px)";

function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    const query = matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** "Suave" is half the frost, not a dimmer bloom of its own: same light, less of it. */
const BLOOM_OPACITY = { normal: 1, soft: 0.5, off: 0 } as const;

export default function App() {
  const effect = useEffectsSettings();
  const [lang, setLang] = useState<Lang>("es");
  const [active, setActive] = useState<StringKey>("navHome");
  const [libraryOpen, setLibraryOpen] = useState(true);
  /**
   * The library is a strip of covers by default, and this is the whole reason the
   * content has room. 72px of riel versus 240px of names: the playlist's artwork
   * already carries it, and the name is in the header over the list it opens.
   */
  const [libraryCollapsed, setLibraryCollapsed] = useState(true);
  /**
   * Below this width the library is the riel, whatever was chosen.
   *
   * **The content needs the pixels more than the names do.** At 900 px an open
   * library and the queue leave a 340 px column in the middle, and the lyrics
   * are a reading column. The choice is kept, not overwritten: widen the window
   * and the library comes back the way it was.
   */
  const narrow = useNarrowWindow();
  const railOnly = libraryCollapsed || narrow;
  /**
   * The queue is there from the start, the way the library is.
   *
   * A queue you have to go looking for is a queue nobody reads, and the button that
   * opens it sits next to the volume looking like one more control. Nothing else
   * had to change: it already survives navigation, and Escape, the X and the button
   * are the only ways out.
   */
  const [queueOpen, setQueueOpen] = useState(true);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [activeItem, setActiveItem] = useState("liked");
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * The feedback form lives up here, outside `AuthGate`, because the people who
   * most need to write it are exactly the ones the gate never opens for. Settings
   * → Diagnostics is one door to it; the sign-in screen is the other.
   */
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  /**
   * Where the "a page about something" surface is pointed, or `null`.
   *
   * **One state for artists and albums, not two.** They are the same screen with
   * a different name and a different picture, they are opened from the same row,
   * they are closed by the same back button and they both need the scroll reset
   * and the heading suppressed. Two parallel states would be two answers to "is
   * something open right now", and the bug is always the place where one of them
   * forgot to be cleared.
   *
   * **The whole object, not an id.** Each page's header is instant from the two
   * things the row already carried — the name, and the id the filter needs — and
   * a request to look up what the click was handed is a request for nothing.
   */
  const [detail, setDetail] = useState<Detail | null>(null);

  /**
   * The jam: the shared session, and whether its panel is open.
   *
   * **The session lives in the service, and this is only what it last said.** It
   * has no local copy that could drift: the jam is a thing on the account, with
   * its owner and its guests, and the app holds the last answer so the panel
   * has something to draw.
   *
   * **It is not read on open.** The only door that reads a session is the one
   * that also creates it —`current_or_new`—, so opening the panel would leave a
   * jam open on the account of somebody who only wanted to look.
   */
  const [jamOpen, setJamOpen] = useState(false);
  const [jam, setJam] = useState<JamSession | null>(null);
  const [jamBusy, setJamBusy] = useState(false);
  const [jamError, setJamError] = useState<string | null>(null);

  /**
   * The shared queue: the songs the jam has written down.
   *
   * **It is not the local queue.** The local one is this app's, and it is
   * nobody else's business; this one is the jam's, and the other side can put
   * songs in it. It comes from the service, and it is read on its own clock.
   */
  const [jamSongs, setJamSongs] = useState<Track[]>([]);

  /**
   * The head of the shared queue, as of the last poll.
   *
   * **It is a ref and not state because it is not for drawing.** It is how the
   * app knows the queue moved: the first poll only writes it down, and from
   * then on a head that is not the song playing is a song the other side put
   * there.
   */
  const jamHead = useRef<string | null>(null);

  /**
   * The song that is playing, for the poll to compare against.
   *
   * **It is a ref because the poll must not restart when the song changes.**
   * The poll reads it, and a poll that is rebuilt every time a song starts is
   * a poll that asks twice per song.
   */
  const jamPlaying = useRef<string | null>(null);

  /**
   * Open a jam.
   *
   * **The button is what decides that there is a jam.** The service opens one
   * if there is none, so the panel does not create anything by itself: it
   * waits for this.
   */
  const startJam = useCallback(async () => {
    setJamBusy(true);
    setJamError(null);
    try {
      setJam(await jamStart());
    } catch (e) {
      setJamError(explain(e));
    } finally {
      setJamBusy(false);
    }
  }, []);

  /** Join a jam with its code. */
  const joinJam = useCallback(async (token: string) => {
    setJamBusy(true);
    setJamError(null);
    try {
      setJam(await jamJoin(token));
    } catch (e) {
      setJamError(explain(e));
    } finally {
      setJamBusy(false);
    }
  }, []);

  /**
   * Leave the jam.
   *
   * **Leaving and closing are two different doors, and who presses it decides
   * which one opens.** The guest leaves the session and the jam goes on; the
   * host closes it and nobody is in it anymore. A jam that nobody closes stays
   * open on the account of whoever started it, and the next person to open one
   * finds it there.
   */
  const leaveJam = useCallback(async () => {
    if (!jam) return;
    setJamBusy(true);
    setJamError(null);
    try {
      await jamLeave(jam.session_id, jam.is_session_owner);
      setJam(null);
      setJamSongs([]);
      jamHead.current = null;
    } catch (e) {
      setJamError(explain(e));
    } finally {
      setJamBusy(false);
    }
  }, [jam]);

  /**
   * Put a song in the jam's shared queue.
   *
   * **The queue is filled with a command, not with a list write.** The command
   * goes to the session, the session knows whose device it is, and the song
   * lands in the queue that both sides read.
   */
  const addToJam = useCallback(
    async (track: Track) => {
      if (!jam) return;
      setJamBusy(true);
      setJamError(null);
      try {
        await jamAddToQueue(jam.session_id, track.id);
      } catch (e) {
        setJamError(explain(e));
      } finally {
        setJamBusy(false);
      }
    },
    [jam],
  );

  /**
   * Whether the screens should offer to put a song in the jam.
   *
   * **The row only exists while there is a jam to put the song in.** A menu
   * row that is always there and does nothing is worse than no row: it reads
   * as broken.
   */
  const onAddToJam = useMemo(
    () => (jam ? (track: Track) => void addToJam(track) : undefined),
    [jam, addToJam],
  );

  /**
   * How the shelf is ordered and drawn, read once at startup for the same reason the
   * glass and the accent are: the library is the first screen there is, and a shelf
   * that resets to A–Z every launch makes the control look like it does not save.
   *
   * The value is trusted as it arrives — `settings.rs` refuses an order this build
   * does not know in both directions — and `sortPlaylists` falls through to the
   * default anyway, so an unknown one would still land on a real order.
   */
  const [sortOrder, setSortOrder] = useState<LibrarySort>("name-asc");
  const [shelfView, setShelfView] = useState<LibraryView>("grid");

  useEffect(() => {
    let alive = true;
    void librarySort()
      .then((value) => {
        if (alive) setSortOrder(value);
      })
      .catch(() => {});
    void libraryView()
      .then((value) => {
        if (alive) setShelfView(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * The screen changes first and the write follows. A save that fails leaves the user
   * with the shelf they just asked for, which is the thing they will notice; losing
   * it across a restart is not.
   */
  const changeSort = (sort: LibrarySort) => {
    setSortOrder(sort);
    void setLibrarySort(sort).catch(() => {});
  };

  const changeView = (view: LibraryView) => {
    setShelfView(view);
    void setLibraryView(view).catch(() => {});
  };

  // How every playlist is read, kept the same way as the shelf's: the screen
  // changes first, the write follows, and a failed write only costs the restart.
  const [trackPrefs, setTrackPrefs] = useState<TrackListPrefs>(DEFAULT_TRACK_LIST_PREFS);

  useEffect(() => {
    let alive = true;
    void trackListPrefs()
      .then((value) => {
        if (alive) setTrackPrefs(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const changeTrackPrefs = (next: TrackListPrefs) => {
    setTrackPrefs(next);
    if (next.order !== trackPrefs.order || next.descending !== trackPrefs.descending) {
      void setTrackOrder(next.order, next.descending).catch(() => {});
    }
    if (next.view !== trackPrefs.view) void setTrackView(next.view).catch(() => {});
  };

  /**
   * A playlist appears before the library is asked again.
   *
   * The refetch is still the source of truth — a list assembled by hand would
   * need the cover, the track count and the owner that only a read can bring —
   * but the dialog closes on the call succeeding, and a screen that keeps the
   * dialog open for the length of a refetch reads as a failed write.
   *
   * A rejected call is re-thrown for the dialog: it is the only thing on screen
   * that can say "it exists but has no name", which is a different problem from
   * the one where nothing happened.
   *
   * **And the song goes in right after, when there is one.** A playlist created
   * from the "add to playlist" menu that comes out empty is a promise broken
   * in the only place the user could tell — and the song is added with the
   * same command the menu uses, so the revision is read fresh and the write
   * cannot fail for being old.
   */
  const createPlaylist = async (name: string) => {
    const id = await createPlaylistCall(name);
    void queryClient.invalidateQueries({ queryKey: keys.playlists });
    void queryClient.invalidateQueries({ queryKey: keys.liked });

    if (pendingTrack) {
      try {
        await addToPlaylist(id, pendingTrack.id);
      } catch {
        // The playlist exists and is in the library; the song did not go in.
        // The dialog says exactly that, and it does not offer to create a
        // second playlist.
        throw new Error("add_failed");
      }
      void queryClient.invalidateQueries({ queryKey: keys.playlistTracks(id) });
      return;
    }

    setActiveItem(id);
  };

  /**
   * The new-playlist dialog, and the song that is waiting to go into it.
   *
   * Two buttons open it — the rail's "+" and the track menu's "New playlist" —
   * so it lives here, above the two. The track is part of the request: a
   * playlist made from the "add to playlist" menu has to come out with the
   * song in it.
   */
  const [naming, setNaming] = useState(false);
  const [pendingTrack, setPendingTrack] = useState<Track | null>(null);

  const openNaming = useCallback((track?: Track) => {
    setPendingTrack(track ?? null);
    setNaming(true);
  }, []);

  const closeNaming = useCallback(() => {
    setNaming(false);
    setPendingTrack(null);
  }, []);

  // The chosen glass, applied once at startup rather than when the settings panel
  // happens to be opened: the first menu somebody sees is the crash prompt, and it
  // can appear before any of this screen's own buttons are reachable.
  useEffect(() => {
    let alive = true;
    void menuOpacity()
      .then((value) => {
        if (alive) applyMenuOpacity(value);
      })
      // Swallowed on purpose: a read that fails leaves the CSS default standing,
      // which is the opaque menu. Nothing here is worth an unhandled rejection in
      // the console of the one build that has no backend to ask.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // The effects, at startup for the same reason: the bloom is the first thing
  // on screen, and drawing the shipped one before the saved one is a flash.
  useEffect(() => {
    let alive = true;
    void effects()
      .then((value) => {
        if (alive) applyEffects(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * The chosen accent, same reason and same place as the glass: the Home button
   * and the selection mark in the library are on screen before anybody has opened
   * the settings panel, so applying it on open would flash the shipped colour at
   * whoever chose a different one.
   *
   * Applied to three custom properties and not to the stylesheet, so a colour
   * survives a reload without ever being written into the repo.
   */
  useEffect(() => {
    let alive = true;
    void accentColor()
      .then((value) => {
        if (alive) applyAccentColor(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  /**
   * Order modifiers live here, beside the queue they modify. The backend has no
   * opinion about order — it decodes one track at a time and reports when it is
   * done — so putting these in Rust would mean teaching it a queue it does not
   * otherwise have any use for.
   */
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const queryClient = useQueryClient();
  const t = strings[lang];
  setErrorLanguage(lang);

  // These only ever run inside `AuthGate`'s children, which means they are never
  // mounted before there is a session — so no hook needs to ask "am I allowed to
  // ask?" before firing.
  const account = useAccount();
  const playlists = usePlaylists();
  const liked = useLikedTracks();

  /**
   * Sorted once, here, and handed to both surfaces.
   *
   * The rail and the shelf are the same library drawn twice, so an order applied to
   * one of them and not the other would be a bug report with a delay: you pick "por
   * creador" on the rail, walk to Inicio, and the shelf is back in A–Z.
   * `sortPlaylists` copies rather than rearranging, so the cached query value is
   * left alone.
   */
  const orderedPlaylists = useMemo(
    () => sortPlaylists(playlists.data ?? [], sortOrder),
    [playlists.data, sortOrder],
  );

  /**
   * One reader for the updater, so the badge on the Settings button and the row
   * inside Settings can never disagree about whether an update exists.
   */
  const updateStateSnapshot = useSyncExternalStore(subscribeUpdate, updateState, updateState);
  const updateVersion = newerVersion(updateStateSnapshot);

  const selected = playlists.data?.find((p) => p.id === activeItem);
  const isLiked = activeItem === "liked";
  /**
   * El contexto de la playlist que está a la vista.
   *
   * **La radio que sigue a una lista se siembra con la lista.** El servicio
   * necesita saber *qué se escuchaba* para elegir las parecidas, y eso no se
   * deduce de las canciones: la cola puede ser la lista de la pantalla, las
   * canciones guardadas o una mezcla, y cada una quiere su propia radio.
   *
   * **Y es `null` cuando no hay playlist a la vista.** Las canciones guardadas
   * no son una playlist y la radio se siembra con la última canción que sonó.
   */
  const playlistContext = useMemo<RadioContext | null>(
    () => (selected ? { kind: "playlist", id: selected.id } : null),
    [selected],
  );
  /**
   * The shelf you land on, which is not the saved songs.
   *
   * `active` was already the state the top bar moved; nothing read it. The main
   * surface is decided by `activeItem`, so "Inicio" was a highlight on a tab that
   * left the list underneath untouched — which is exactly why the button looked
   * broken. Now it is read here, and the home screen is a screen of its own.
   */
  const isHome = active === "navHome";

  /**
   * `null` means "Liked Songs", which is not a playlist id — passing the literal
   * would put an empty id on the wire and ask Spotify about a playlist that does
   * not exist.
   */
  const playlistTracks = usePlaylistTracks(isLiked ? null : activeItem);

  /**
   * The list the queue walks and the transport navigates.
   *
   * One source for both screens and the queue, so what plays next is always
   * something the user can see on screen. Two separate lists would let the queue
   * drift into tracks that are no longer in front of them, which is how a player
   * ends up playing something nobody chose.
   *
   * `queueOverride` is the one exception, and it is not an exception to the rule —
   * it is the rule applied to a list that is not the library. Playing something
   * from a search result has to make *those songs* the queue; otherwise "next"
   * jumps back into a playlist the user left twenty screens ago, which is exactly
   * the drift described above. It is cleared whenever the user navigates somewhere
   * that defines its own list.
   *
   * **The override carries the DJ's line with it.** The line belongs to the
   * queue that brought it —it is what the DJ says before its own mix— so it
   * lives in the same place, and a queue that replaces it takes the line with
   * it. Two separate states were a way for one DJ's words to stay on screen
   * above another playlist's songs.
   */
  /**
   * Where we are in the queue: the index of the song that is playing.
   *
   * **The index, not the id.** A station can offer the same song twice — the DJ
   * does, and on his side it is not a bug— and looking the current song up by
   * its id finds the *first* copy, which is the one that already played. From
   * there "the next one" is a song from the past: the app jumps backwards, the
   * queue panel lies about what is coming, and pressing next twice lands on
   * the same song. That is the "salta".
   */
  const [queueAt, setQueueAt] = useState(-1);
  /**
   * The same place, readable right now.
   *
   * **A state alone is not enough.** Two clicks in the same breath have to land
   * on two different songs, and the state that the second click reads is still
   * the one of the first: the app would ask for the same song twice. The
   * reference is what the decisions read; the state is what the panel draws.
   */
  const queueAtRef = useRef(-1);
  const moveTo = useCallback((at: number) => {
    queueAtRef.current = at;
    setQueueAt(at);
  }, []);

  /**
   * The song the app is waiting for.
   *
   * **The status can be about a song that is already over.** The user presses
   * next while the old one is still finishing, and the status that comes back
   * says "that one ended": an ending that was already handled. Advancing on it
   * puts a song on top of the one the user just asked for.
   */
  const asked = useRef<string | null>(null);

  /**
   * The number of the last request to make something sound.
   *
   * Every decision to play takes a number, and every asynchronous continuation
   * carries the number it was born with: if the world moved on since then — the
   * user pressed next, picked another song, the DJ's voice finished late — the
   * continuation does nothing at all.
   *
   * **This is what keeps two songs from starting nineteen milliseconds apart.**
   * The DJ's voice is the case that needs it: the phrase is asked for, the
   * answer comes back, and by then the user may have asked for something else.
   * Without the number, the late answer puts a song on top of the one that is
   * already playing.
   */
  const intent = useRef(0);

  const [queue, setQueue] = useState<Queue | null>(null);
  const queueOverride = queue?.tracks ?? null;
  /**
   * The one door into the queue.
   *
   * Everything that sets a queue goes through here, so the lines that came
   * with a queue go with it. The DJ is the one that brings lines.
   */
  const setQueueOverride = useCallback(
    (tracks: Track[] | null, context: RadioContext | null = null) => {
      djLines.current = {};
      // **La cola cambió: el lugar en ella también.** El índice que guardamos
      // era de la cola anterior, y seguir usándolo haría saltar la app a una
      // canción que ya no está donde estaba.
      moveTo(-1);
      setQueue(tracks ? { tracks, lines: {}, source: "list", context } : null);
    },
    [moveTo],
  );
  /**
   * The DJ, while it is being asked for and while it could not be read.
   *
   * Both are about one card —the account has exactly one DJ— so they are two
   * flags rather than a map of playlists. The failure is shown on the card
   * that caused it, which is the only place the user is looking when it
   * happens: a click that does nothing is the bug this whole thing started
   * from.
   */
  const [djBusy, setDjBusy] = useState(false);
  const [djUnavailable, setDjUnavailable] = useState(false);

  /**
   * El DJ está hablando.
   *
   * **La voz va antes que la música.** Cuando el backend pide una tanda que
   * trae narración, corta lo que estuviera sonando, deja que el DJ hable y
   * avisa cuando terminó. La música arranca después, y este estado es lo que
   * pone el icono del DJ abajo a la izquierda mientras pasa.
   *
   * El número es el de la voz: dos clicks seguidos son dos voces, y el que
   * terminó primero no es el que el segundo click está esperando.
   */
  const [djVoice, setDjVoice] = useState<{
    id: number;
    speaker: string | null;
    line: string | null;
  } | null>(null);

  /**
   * La canción que quedó esperando la voz del DJ.
   *
   * Vive en una referencia y no en un estado porque no se dibuja: es lo que el
   * frontend arranca cuando llega el evento de la voz. Si el usuario elige
   * otra cosa mientras tanto, se borra —y con ella la espera—.
   *
   * **Trae el lugar en la cola y el número del pedido.** La canción que arranca
   * cuando la voz termina es la que el DJ presentó, y tiene que arrancar en el
   * lugar en que se pidió: si la cola se movió mientras el DJ hablaba, la
   * canción arranca donde el DJ dijo, no donde la lista esté ahora. Y el
   * número es lo que distingue una voz que todavía cuenta de una que ya no la
   * cuenta.
   */
  const djPending = useRef<{ id: number; track: Track; at: number; intent: number } | null>(null);

  /**
   * La última voz que terminó, para cuando el aviso llega antes que la tanda.
   *
   * El backend puede fallar al pedir el audio y avisar en el mismo instante en
   * que devolvió la tanda: si el frontend todavía no guardó qué voz espera, el
   * aviso se pierde y la música no arranca nunca. El número de la voz siempre
   * es más grande que el de la anterior, así que un número guardado no puede
   * confundirse con una voz nueva.
   */
  const djFinished = useRef<number | null>(null);

  /**
   * Las frases del DJ, por id de canción, y siempre al día.
   *
   * Vive en una referencia y no en un estado porque no se dibuja: lo que la
   * necesita es el momento de poner una canción, y en ese momento la cola
   * puede ser la de un render anterior. Se actualiza en el mismo lugar donde
   * se actualiza la cola.
   */
  const djLines = useRef<Record<string, DjNarration>>({});

  const libraryTracks = isLiked ? (liked.data ?? []) : (playlistTracks.data ?? []);
  const visibleTracks = queueOverride ?? libraryTracks;

  /**
   * What to say when a playlist will not load.
   *
   * A 403 here is almost never a permissions problem with the account — in
   * development mode it is Spotify declining to serve a playlist the account does
   * not own or collaborate on. That is a fact about the playlist, not about you,
   * and the generic "forbidden" sends people looking for a problem they cannot fix.
   */
  const playlistError = !playlistTracks.error
    ? null
    : explain(playlistTracks.error) === explain("forbidden")
      ? t.playlistNotReadable
      : explain(playlistTracks.error);

  // Playback state arrives as events, not as a query. Polling a player that only
  // changes when the user presses something is a timer that never earns its keep.
  const [status, setStatus] = useState<PlaybackStatus | null>(null);
  /**
   * The last track the user asked for.
   *
   * The backend only knows a track id, and the player bar needs a title, an artist
   * and a cover. Keeping the object the click already had is both cheaper and more
   * honest than looking it up again — if the list is stale, the bar shows what was
   * actually played.
   */
  const [loadedTrack, setLoadedTrack] = useState<Track | null>(null);

  /**
   * Whether the bar is on screen.
   *
   * **The window gives the bar its room, and it gives it when the bar
   * arrives.** The bar floats over the bottom of the window, so everything
   * above it has to stop short of it — and when the bar is not there, that
   * space belongs to the content: a band of 144px of empty ground under the
   * library is not breathing room, it is a hole.
   *
   * So the surfaces that float over the content change their bottom inset
   * with the bar: with it, they stop where the bar begins; without it, they
   * go down to the window's own 20px inset. The movement is the same 300ms
   * the panels already use, because the bar arriving and the content moving
   * are one movement and not two.
   *
   * **The rule is the bar's own:** what there is to say — a song, the DJ, or a
   * refusal. The bar and this flag are the same question asked twice, so the
   * answer lives in one place and the bar is told.
   */
  const barPresent = Boolean(loadedTrack || djVoice || status?.error);

  /**
   * The line the DJ is saying right now.
   *
   * **The line belongs to the song it is attached to.** The DJ opens a stretch
   * with one phrase and closes it with another, and the service hangs each of
   * them on a song: the first one and the last one. So what is shown is the
   * line of the song that is sounding — not the last one that arrived, which
   * would leave the words of a song that ended on top of the one that started.
   */
  const narration = useMemo(() => {
    const current = status?.trackId ?? loadedTrack?.id ?? null;
    if (!current || !queue) return null;
    return queue.lines[current] ?? null;
  }, [status?.trackId, loadedTrack?.id, queue]);

  /**
   * Ask what the player is doing, because the events alone leave a hole.
   *
   * `player://status` is emitted when the player does something, and the first
   * thing it does may be never: the DJ talks through the mixer and the player
   * does not know. A frontend that only listens starts with nothing, and
   * "nothing" reads as volume zero —the bar said "muted" and the slider at the
   * minimum while the music was audible at the volume the user had set.
   *
   * The answer is only applied if no event has arrived yet: a question that
   * takes its time must not overwrite a newer truth with an older one.
   */
  useEffect(() => {
    let heard = false;
    const unlisten = onPlaybackStatus((next) => {
      heard = true;
      setStatus(next);
    });
    // The listener is async, so the cleanup has to wait for it — returning a
    // promise from the effect would leave a dangling subscription behind.
    void playerStatus()
      .then((next) => {
        if (!heard) setStatus(next);
      })
      .catch(() => {});
    return () => {
      unlisten.then((off) => off());
    };
  }, []);
  /**
   * El DJ terminó de hablar: la música arranca.
   *
   * **El evento es lo que hace arrancar la música, y no al revés.** El backend
   * corta la canción que estuviera sonando, deja que el DJ hable y recién ahí
   * avisa; el frontend espera ese aviso. Por eso el backend lo emite siempre,
   * se haya oído la voz o no: si la voz falla, el DJ tiene que seguir sonando
   * igual, y el que decide eso es que el aviso llega en los dos casos.
   *
   * El número es lo que evita confundir dos voces: si el evento no es el de la
   * voz que este click está esperando, no se toca nada.
   */
  useEffect(() => {
    const unlisten = onDjVoice((event) => {
      const pending = djPending.current;
      if (!pending || pending.id !== event.id) {
        // No es la voz que este click está esperando: se guarda, por si el
        // aviso llegó antes de que la tanda llegara.
        djFinished.current = event.id;
        return;
      }
      djPending.current = null;
      setDjVoice(null);
      // **La voz que terminó es la que este click estaba esperando.** Si
      // mientras el DJ hablaba el usuario pidió otra cosa, esta ya no manda:
      // lo que se pidió después es lo que suena. Sin esto, la música del DJ
      // arranca encima de la canción que el usuario acaba de elegir.
      if (pending.intent !== intent.current) return;
      asked.current = pending.track.id;
      moveTo(pending.at);
      // La música arranca: es un pedido nuevo, y deja atrás a los que estaban
      // en camino.
      intent.current += 1;
      setLoadedTrack(pending.track);
      playTrack(pending.track).catch((e) => {
        console.error("Starless: no se pudo reproducir el DJ", explain(e));
      });
    });
    return () => {
      unlisten.then((off) => off());
    };
  }, [moveTo]);

  /**
   * The words for whatever is sounding.
   *
   * Keyed on what the backend reports playing, with `loadedTrack` as the fallback:
   * between pressing play and the first status event there is no id from the
   * player yet, and an empty panel for half a second reads as "this song has no
   * lyrics" when it has not even been asked.
   */
  const lyricsTrackId = status?.trackId ?? loadedTrack?.id ?? null;
  const lyrics = useLyrics(lyricsTrackId);

  /**
   * Closing the lyrics returns to whatever was on screen.
   *
   * Opening them swaps the main surface; going back to a hardcoded home would be
   * a worse version of the bug the home button used to have, where a tab moved and
   * the screen underneath did not.
   */
  const closeLyrics = useCallback(() => setLyricsOpen(false), []);

  const onPlay = useCallback(
    (track: Track, at?: number) => {
      // A deliberate choice clears the advance guard. Without this, replaying the
      // same track by hand would still carry the previous "already handled this
      // ending" mark, and the next finish would be silently ignored.
      advancedRef.current = null;
      // **Poner una canción calla al DJ.** La frase que estaba diciendo era para
      // esta otra canción, y seguir escuchándola es una conversación que nadie
      // pidió. El backend también la corta —allá se corta el audio— pero acá se
      // borra la espera: si no, el aviso de "el DJ terminó" haría arrancar la
      // música del DJ encima de la que el usuario acaba de elegir.
      djPending.current = null;
      setDjVoice(null);
      // **Esta es la canción que se espera.** El final que llegue de la
      // anterior ya no cuenta: la app no avanza sobre un final que no es de la
      // canción que está sonando.
      asked.current = track.id;
      moveTo(at ?? visibleTracks.findIndex((item) => item.id === track.id));
      // El pedido nuevo invalida el que estaba en camino: una voz del DJ que
      // estaba por hablar no habla, y la que hable después es otra.
      intent.current += 1;
      setLoadedTrack(track);
      playTrack(track).catch((e) => {
        // A refusal that only reaches the console is a refusal the user never sees.
        // The bar shows whatever `status.error` says; this is the console copy.
        console.error("Starless: no se pudo reproducir", explain(e));
      });
    },
    [moveTo, visibleTracks],
  );

  /**
   * Play one song from the queue panel, and cut the queue where the panel says.
   *
   * **The cut is at the place, not at the song.** The panel knows which row was
   * clicked; looking the song up by its id finds the *first* copy, and a queue can
   * have the same song twice —one account here has a playlist of fifty items and
   * forty-six different ids—. From there "what comes next" is a song from the
   * past, and the panel lies about what is coming.
   */
  const onPlayFromQueue = useCallback(
    (track: Track, row: number) => {
      onPlay(track, rowPlace(queueAt, row));
    },
    [onPlay, queueAt],
  );

  /**
   * Play from a list that is not a playlist, and decide the order now.
   *
   * A playlist is a statement about order, so opening one and playing from it
   * keeps that order. Anything else is not: in the official client, starting from
   * anywhere that is not a playlist puts a random run in the queue, and pressing
   * the same song again gives a different one. Here it was the other way round —
   * the home screen played in list order, so the queue after a track was the same
   * queue forever and the app recommended the same songs forever. That is not a
   * playlist behaving like a playlist, it is a bug wearing the costume of one.
   *
   * **Turning shuffle on reaches this too, and that is not a second thing.** It is
   * the same decision the shuffle button records: shuffle is a mode, and the
   * moment you start playing under that mode the order has to be the shuffled one
   * — `onPlayPlaylist` below. The distinction that used to be drawn here — "this
   * is not the shuffle button" — described a version of `onToggleShuffle` that
   * left the queue alone, and it does not do that any more. Both paths go through
   * `shuffleFrom`, which keeps the song that is starting at the front and puts the
   * randomness behind it.
   */
  const playShuffled = useCallback(
    (tracks: Track[], track: Track, context: RadioContext | null = null) => {
      advancedRef.current = null;
      setLoadedTrack(track);
      setQueueOverride(shuffleFrom(tracks, track.id), context);
      // **La canción que empieza queda adelante.** El orden nuevo la pone
      // primero, y el lugar en la cola tiene que decir lo mismo.
      asked.current = track.id;
      moveTo(0);
      intent.current += 1;
      playTrack(track).catch((e) => {
        console.error("Starless: no se pudo reproducir", explain(e));
      });
    },
    [moveTo, setQueueOverride],
  );

  // Only once audio is actually flowing. During the load, `loading` is true and
  // the row deliberately shows nothing rather than a dot we cannot justify.
  const nowPlayingId = status?.playing ? status.trackId : null;
  const loadingId = status?.loading ? status.trackId : null;
  // A row painted as failed says "this song cannot be played". While the
  // connection is being rebuilt that is not what is happening: the song is
  // fine, it is the road to Spotify that is closed, and the row comes back
  // playing a moment later. The same goes for a device that stopped answering
  // — the song is fine, the sound is what is missing.
  const failedId = status?.error && !SESSION_ERRORS.has(status.error) ? status.trackId : null;

  useEffect(() => {
    jamPlaying.current = nowPlayingId;
  }, [nowPlayingId]);

  /**
   * Keep the jam up to date.
   *
   * **The jam has no pubsub here.** The `dealer` of librespot does not carry
   * it, so the only way to learn that somebody joined is to ask: the session
   * every few seconds, and the shared queue with it.
   *
   * **The session door creates a session when there is none**, so it is asked
   * only while there is one in hand — and if the answer brings another
   * session, the one that was here is gone: the panel says so instead of
   * adopting the new one, which would be a jam nobody opened.
   */
  useEffect(() => {
    const sessionId = jam?.session_id;
    if (!sessionId) return;
    let alive = true;

    const tick = async () => {
      try {
        const [session, queue] = await Promise.all([jamStatus(), jamQueue(sessionId)]);
        if (!alive) return;

        if (session.session_id !== sessionId) {
          setJam(null);
          setJamSongs([]);
          jamHead.current = null;
          return;
        }

        setJam(session);
        setJamSongs(queue);

        // **The head of the shared queue is what the other side put in it.**
        // The first poll only writes it down: the queue starts with a seed
        // that the service fills by itself, and jumping into that would be
        // playing something nobody chose.
        //
        // **A read that comes back empty does not erase the head.** The
        // service answers `Not Found` while the jam has no queue, and that is
        // a moment, not a state: if the head were forgotten there, the app
        // would stop following until the queue changed again —and the queue
        // changing is exactly what it was waiting for.
        const head = queue[0];
        if (head) {
          const before = jamHead.current;
          jamHead.current = head.id;
          if (before !== null && before !== head.id && head.id !== jamPlaying.current) {
            playTrack(head).catch((e) => {
              console.error("Starless: no se pudo seguir la cola del jam", explain(e));
            });
          }
        }
      } catch (e) {
        // A jam that cannot be read right now is not a jam that is over: the
        // next poll asks again.
        console.warn("Starless: no se pudo leer el jam", explain(e));
      }
    };

    const timer = setInterval(() => void tick(), JAM_POLL_MS);
    void tick();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [jam?.session_id]);

  /**
   * The queue, in the order it will be played.
   *
   * Shuffle changes the *order*, not the contents: the queue stays the list the
   * user is looking at, and picking from it at random keeps every track that was
   * on screen reachable. Shuffling the array itself would mean the queue panel
   * visibly reshuffles under them, which reads as the app having lost track of
   * what they were looking at rather than as a mode they turned on.
   *
   * **The cut is at the place, not at the song.** The list can hold the same
   * song twice — the DJ does — and cutting at "the first song with this id"
   * puts the cut in the wrong place: everything after the song that already
   * played is still called "what comes next", and the app walks the queue
   * backwards.
   */
  const upNext = useMemo(
    () => upNextTracks(queueAt, visibleTracks, queueOverride),
    [queueAt, visibleTracks, queueOverride],
  );

  /**
   * How many songs of the station's page are still ahead.
   *
   * **The station's count and the panel's list are not the same question.** The
   * panel shows what comes after the song that is sounding, and before any song
   * is sounding there is nothing to show. The station, on the other hand, has to
   * know how much of *its own* page is left so it can ask for more, and its page
   * exists from the moment the DJ answers — before the first song is even asked
   * for. Asking the panel would make the station fetch a page too early.
   */
  const stationLeft = useMemo(() => {
    if (!queue || queue.source === "list") return 0;
    const total = queue.tracks.length;
    return Math.max(0, total - (queueAt + 1));
  }, [queue, queueAt]);

  /**
   * Advance when a track runs out.
   *
   * The backend reports that a track ended; it does not decide what plays next,
   * because the order is a property of what the user is looking at, not of the
   * decoder. The queue belongs here.
   *
   * `advancedRef` is what makes this fire once instead of on every render that
   * happens to observe a finished status — a track sitting at its last second
   * keeps emitting position events twice a second, and without the guard the
   * queue would be walked off the end in half a second.
   */
  const advancedRef = useRef<string | null>(null);

  const playDirect = useCallback(
    (track: Track, at?: number) => {
      asked.current = track.id;
      moveTo(at ?? visibleTracks.findIndex((item) => item.id === track.id));
      // Un pedido nuevo: lo que estaba en camino deja de mandar.
      intent.current += 1;
      setLoadedTrack(track);
      playTrack(track).catch((e) => {
        advancedRef.current = null;
        console.error("Starless: no se pudo reproducir", explain(e));
      });
    },
    [moveTo, visibleTracks],
  );

  /**
   * Poner una canción de la estación, y dejar que el DJ la presente.
   *
   * **La frase es de la canción, y se dice antes que ella.** El servicio
   * cuelga la frase de apertura de la primera canción de un tramo y la de
   * cierre de la última, y las dos se dicen *antes* de esa canción: "así
   * termina este segmento, al ritmo de The Weeknd" se dice, y después suena
   * The Weeknd.
   *
   * Por eso la frase se pide acá y no cuando llegó la página: la página llega
   * dos canciones antes de que la cola se vacíe, y pedirla entonces sería
   * hablar encima de la canción que está sonando.
   *
   * **Si el DJ no tiene nada que decir para esa canción, la música no
   * espera.** Y si la voz falla, tampoco: la voz es un extra sobre una
   * estación que ya funciona.
   */
  const playStationTrack = useCallback(
    async (track: Track, at: number) => {
      // **Este pedido tiene un número.** La respuesta del backend —la frase que
      // el DJ tiene para esta canción— llega después, y para entonces el
      // usuario puede haber apretado otra vez. Lo que venga de acá pertenece a
      // este pedido: si el número ya no es el último, no se toca nada.
      const mine = ++intent.current;
      // La canción queda en su lugar de la cola desde el pedido, no desde que
      // suena: el DJ la está presentando, y lo que viene después es lo que
      // sigue.
      asked.current = track.id;
      moveTo(at);
      const narration = djLines.current[track.id] ?? null;
      let voice: number | null = null;
      try {
        voice = await djSpeak(track.id);
      } catch (e) {
        console.error("Starless: el DJ no pudo hablar", explain(e));
      }
      // El mundo se movió mientras se pedía la frase: lo que se pidió después
      // manda, y esta canción no arranca.
      if (mine !== intent.current) return;
      if (voice == null) {
        setLoadedTrack(track);
        await playTrack(track);
        return;
      }
      // Si el aviso de "terminó" ya llegó —la voz terminó antes de que el
      // frontend guardara qué espera—, la música arranca derecho: no hay nada
      // que esperar.
      if (djFinished.current === voice) {
        djFinished.current = null;
        setLoadedTrack(track);
        await playTrack(track);
        return;
      }
      // Una voz anterior puede haber quedado esperando, de un click anterior: la
      // última que se pide es la que vale, y la que quedó no se dice dos veces.
      djPending.current = { id: voice, track, at, intent: mine };
      // Lo que falte lo pone la barra, con los textos del idioma de ahora: el
      // estado guarda lo que dijo el servicio y nada más.
      setDjVoice({ id: voice, speaker: narration?.speaker ?? null, line: narration?.line ?? null });
    },
    [moveTo],
  );

  /**
   * Order of decisions when a track ends, and each one is a *different question*:
   *
   * 1. Repeat one — the user asked for this track specifically. Nothing else.
   * 2. Is there anything after it? If not, repeat all wraps.
   *
   * The queue's order is not decided here. Shuffle decides it once, when it is
   * turned on, and the result is what the panel shows — so the next track is
   * `upNext[0]` whether shuffle is on or off, and the two differ only in how the
   * order was arrived at.
   *
   * Wrapping only happens under repeat-all, deliberately: a queue that restarts by
   * itself looks like a bug, and the list the user was scrolling by hand genuinely
   * ran out.
   */
  /**
   * La lista se acabó y la música sigue con lo que se parece.
   *
   * **La radio se siembra con el contexto de lo que se escuchaba** —la playlist
   * que se terminó— y con las últimas canciones que sonaron. Es el protocolo
   * del autoplay de Spotify, entero: el contexto dice qué se escuchaba, y las
   * recientes dicen dónde quedó la conversación.
   *
   * **Las parecidas van detrás de la lista, y la lista no se reescribe.** El
   * orden de lo que ya sonó es el orden en que se escuchó, y la radio es lo que
   * viene después.
   *
   * **Y la primera de las parecidas suena apenas llega.** La lista terminó y
   * la música quedó en el aire: si la radio se escuchara más adelante, el
   * silencio entre las dos sería el hueco que esta función vino a tapar. Por
   * eso la pone ella y no la cola: nadie más va a arrancar la estación.
   */
  const continueWithRadio = useCallback(
    (seed: Track, place: number) => {
      // **El contexto primero.** Lo que se escuchaba es lo que el servicio usa
      // para elegir las parecidas; sin contexto, la radio se sembraría con la
      // última canción y no con la lista.
      const context = queue?.context ?? { kind: "track", id: seed.id };
      const recent = visibleTracks
        .slice(Math.max(0, place - RECENT_FOR_RADIO + 1), place + 1)
        .map((track) => track.id);
      // **Este pedido tiene un número**, como todos los que llegan tarde: si el
      // usuario puso otra cosa mientras se pedía la radio, esta página no se
      // aplica — pondría canciones de una radio que nadie está escuchando.
      //
      // **Y no se incrementa el número:** acá no suena nada, y el número es el
      // de "lo que tiene que sonar". Subirlo dejaría esperando para siempre a
      // una frase del DJ que ya no va a sonar.
      const mine = intent.current;
      radioStart(context, recent)
        .then((mix) => {
          if (mine !== intent.current) return;
          const first = mix.tracks[0];
          if (!first) {
            // **La radio no trajo nada.** No hay estación y no hay a dónde ir:
            // la lista se acabó de verdad.
            console.error("Starless: la radio no trajo canciones");
            return;
          }
          setQueue((current) => {
            if (!current) return current;
            return {
              ...current,
              tracks: [...current.tracks, ...mix.tracks],
              source: "radio",
              context,
            };
          });
          // **La primera parecida arranca en el lugar siguiente al de la
          // lista.** Es lo mismo que haría `advance` si las tuviera delante.
          playDirect(first, place + 1);
        })
        .catch((e) => {
          // **La radio que no arranca no corta la música:** la lista ya terminó
          // y no hay a dónde volver, pero el fallo se dice en la consola y la
          // app sigue como estaba.
          console.error("Starless: la radio no siguió a la lista", explain(e));
        });
    },
    [queue?.context, visibleTracks, playDirect],
  );

  /**
   * La radio está siendo pedida.
   *
   * **La estación no puede pedir más antes de tener la primera página.** La cola
   * de una radio recién arrancada tiene una canción —la que eligió el
   * usuario— y el relleno se dispararía enseguida: el backend todavía no tiene
   * cursor, contesta vacío, y la estación se muere antes de empezar.
   */
  const radioStarting = useRef(false);

  /**
   * Una canción elegida en la búsqueda entra directo a su radio.
   *
   * **Las otras que salieron de la búsqueda no suenan.** El usuario eligió una
   * canción, no una lista: en Spotify, elegir una canción de la búsqueda
   * arranca la radio de esa canción y el resto de los resultados no forma parte
   * de nada. La cola es la canción y nada más.
   *
   * **La canción suena ya y las parecidas llegan detrás.** Pedir la radio antes
   * de sonar haría esperar la música por una llamada de red, y lo que el
   * usuario pidió fue la canción.
   */
  const playRadio = useCallback(
    (track: Track) => {
      advancedRef.current = null;
      // **Poner una canción calla al DJ**, como en cualquier otra decisión de
      // reproducir: la frase que estaba diciendo era para otra canción.
      djPending.current = null;
      setDjVoice(null);
      asked.current = track.id;
      intent.current += 1;
      setLoadedTrack(track);
      // **La cola es la canción elegida y nada más.** Y es una estación desde el
      // primer momento, porque la radio la va a seguir llenando.
      setQueue({
        tracks: [track],
        lines: {},
        source: "radio",
        context: { kind: "track", id: track.id },
      });
      moveTo(0);
      playTrack(track).catch((e) => {
        console.error("Starless: no se pudo reproducir", explain(e));
      });
      // **La radio se pide después, no antes.**
      const mine = intent.current;
      radioStarting.current = true;
      radioStart({ kind: "track", id: track.id }, [track.id])
        .then((mix) => {
          if (mine !== intent.current) return;
          setQueue((current) =>
            current?.source === "radio"
              ? {
                  ...current,
                  // **La semilla no se repite.** El servicio no la devuelve, pero
                  // filtrarla es más barato que confiar en eso.
                  tracks: [track, ...mix.tracks.filter((item) => item.id !== track.id)],
                }
              : current,
          );
        })
        .catch((e) => {
          console.error("Starless: la radio no arrancó", explain(e));
          // **La radio que no arranca no es una falla visible:** la canción
          // sigue sonando y la cola vuelve a ser una lista.
          setQueue((current) =>
            current?.source === "radio" ? { ...current, source: "list" } : current,
          );
        })
        .finally(() => {
          radioStarting.current = false;
        });
    },
    [moveTo],
  );

  /**
   * Dónde está, en la lista a la vista, la canción que terminó.
   *
   * **El lugar recordado se queda viejo cuando la lista cambia.** El usuario
   * abre otra playlist mientras la canción suena: la lista ahora es otra, y el
   * número que decía dónde estaba la canción ya no dice nada de ella. La
   * canción sigue siendo la misma, así que el lugar se busca otra vez — por id,
   * y sólo cuando el lugar recordado no la tiene.
   *
   * **Una canción que no está en la lista no tiene lugar, y la cola vuelve a
   * empezar.** La app no sabe qué debería seguir a una canción que no tiene
   * enfrente, y la lista a la vista es la cola: vuelve a empezar por su
   * primera canción.
   */
  const placeOf = useCallback(
    (songId: string) => placeOfSong(queueAtRef.current, visibleTracks, songId),
    [visibleTracks],
  );

  const advance = useCallback(
    (ended?: string) => {
      // **El lugar de la canción que terminó, y no el que quedó escrito hace un
      // rato.** La lista puede haber cambiado mientras sonaba: el número
      // guardado dice dónde estaba, no dónde está.
      //
      // Sin canción —nada sonando— se usa el lugar recordado: es lo que había
      // antes de que el lugar se resolviera por canción.
      const place = ended ? placeOf(ended) : queueAtRef.current;

      if (repeat === "one") {
        // **La que está sonando es la del lugar**, no la primera con ese id: la
        // cola puede tener la misma canción dos veces.
        const current = visibleTracks[place] ?? loadedTrack;
        if (current) {
          playDirect(current, place);
          return true;
        }
      }

      // **El siguiente es el que sigue en la cola, por lugar y no por nombre.**
      // La cola puede tener la misma canción dos veces —el DJ lo hace— y
      // buscarla por su id encuentra la primera: la que ya sonó. Desde ahí, "el
      // siguiente" es una canción del pasado, y la app salta para atrás.
      const at = place + 1;
      const next = visibleTracks[at];
      if (next) {
        // **La estación pide la canción como la pide el DJ:** primero la frase,
        // si la hay, y después la música. Una lista no tiene frases, y la radio
        // tampoco —la radio es música y nada más—.
        if (queue?.source === "dj") {
          void playStationTrack(next, at);
          return true;
        }
        playDirect(next, at);
        return true;
      }
      // Out of tracks. Only repeat-all brings the first one back.
      if (repeat === "all" && visibleTracks[0]) {
        playDirect(visibleTracks[0], 0);
        return true;
      }
      // **La lista se acabó y la música no se corta.** Spotify sigue con música
      // parecida: la radio se siembra con lo que se estaba escuchando y con las
      // últimas canciones, que es el protocolo del autoplay.
      //
      // **Una radio que se acaba no se vuelve a sembrar.** Si la cola ya era una
      // radio, la estación llegó al final de lo que el servicio tiene y no hay a
      // dónde ir: seguir sembrando sería una radio de la radio, sin fin.
      if (queue?.source !== "radio") {
        const seed = visibleTracks[place] ?? loadedTrack;
        if (seed) {
          continueWithRadio(seed, place);
          return true;
        }
      }
      return false;
    },
    [
      repeat,
      visibleTracks,
      loadedTrack,
      playDirect,
      queue?.source,
      playStationTrack,
      placeOf,
      continueWithRadio,
    ],
  );

  useEffect(() => {
    if (!status?.finished) return;
    const ended = status.trackId;
    if (!ended) return;
    // **El final tiene que ser el de la canción que se está esperando.** El
    // usuario puede apretar siguiente mientras la anterior todavía termina, y
    // el estado que llega dice "esa terminó": un final que ya se atendería.
    // Avanzar sobre él pone una canción encima de la que el usuario acaba de
    // elegir, y la app salta sola.
    if (ended !== asked.current) return;
    if (advancedRef.current === ended) return;

    advancedRef.current = ended;
    if (!advance(ended)) {
      // Nothing to advance to. Drop the guard so a later track — picked by hand,
      // or arriving from a different list — can still take over cleanly.
      advancedRef.current = null;
    }
  }, [status?.finished, status?.trackId, advance]);

  /**
   * Una canción que vuelve a sonar es un final nuevo esperando.
   *
   * **El guard es de finales, no de canciones.** La misma canción puede estar
   * dos veces en la cola —el DJ lo hace, y una cola armada a mano también—, y
   * su segundo final es un segundo final: con el guard guardado por canción,
   * la app lo toma por el primero y la música se para en medio de la cola.
   *
   * El guard se suelta cuando el backend dice que esa canción está sonando
   * otra vez, que es el único momento que dice "es otra vuelta de la misma
   * canción".
   */
  useEffect(() => {
    if (!status?.playing) return;
    if (advancedRef.current === null) return;
    if (advancedRef.current !== status.trackId) return;
    advancedRef.current = null;
  }, [status?.playing, status?.trackId]);

  /**
   * Skip past a track that will not play.
   *
   * A refusal ends the session in most clients, and it ends it here too if we let
   * it: one region-blocked song, one dead CDN URL, one degraded session, and the
   * music stops on a click the user already understood. Skipping is what they were
   * asking for by pressing next — the failure just happened without them.
   *
   * Counted *consecutively*, and only reset when something actually sounds, so a
   * session that cannot play anything at all stops after five tries instead of
   * sprinting through the whole library.
   *
   * **But a dead connection is not a track that will not play.** When the
   * session to Spotify dies, every track fails the same way, one after
   * another, and skipping is the wrong answer twice over: it burns through the
   * queue in seconds — six songs in sixteen seconds, the log said — and each
   * skip overwrites the one message that says what is actually wrong. The
   * backend already tells the two apart, and here the app listens: on a
   * connection failure it waits, because the session is being rebuilt
   * underneath and the track goes back on when it is up.
   *
   * **And a device that stopped answering is not a track that will not play
   * either.** The song is fine — the sound is what is missing, and the
   * backend is opening another player underneath.
   */
  const failures = useRef(0);
  useEffect(() => {
    if (status?.playing) failures.current = 0;
  }, [status?.playing]);

  useEffect(() => {
    if (!status?.error || !status.trackId) return;
    if (SESSION_ERRORS.has(status.error)) return;
    const failed = status.trackId;
    // **El error tiene que ser de la canción que se está esperando.** Uno viejo,
    // de una canción que ya se cambió, no salta nada: la app ya está playing
    // otra cosa y saltar sería poner una tercera encima.
    if (failed !== asked.current) return;
    if (advancedRef.current === failed) return;

    failures.current += 1;
    if (failures.current > MAX_CONSECUTIVE_FAILURES) {
      // Enough. Leave the error on screen: it is about the session, not a track.
      advancedRef.current = failed;
      return;
    }

    advancedRef.current = failed;
    if (!advance(failed)) advancedRef.current = null;
  }, [status?.error, status?.trackId, advance]);

  const onNext = useCallback(() => {
    // **Con el DJ hablando, "siguiente" es "cállate y seguí".**
    //
    // La frase es de la canción que va a sonar, y el usuario la está oyendo
    // antes de que suene: apretar siguiente es decir "no la quiero escuchar",
    // no "pasame otra". Así que la voz se corta —el backend la corta con la
    // misma canción, que es la que la calla— y la canción arranca.
    const pending = djPending.current;
    if (pending) {
      djPending.current = null;
      setDjVoice(null);
      // La canción del DJ suena en el lugar en que el DJ la presentó, no en el
      // que la cola tenga ahora.
      asked.current = pending.track.id;
      moveTo(pending.at);
      // La voz se terminó: lo que estaba en camino deja de mandar.
      intent.current += 1;
      setLoadedTrack(pending.track);
      playTrack(pending.track).catch((e) => {
        console.error("Starless: no se pudo reproducir el DJ", explain(e));
      });
      return;
    }

    // Pressing "next" is a decision, so it overrides repeat-one the way pressing
    // pause does. Honouring the mode here would make the button useless in it.
    if (repeat === "one") {
      const at = queueAtRef.current + 1;
      const next = visibleTracks[at];
      if (next) playDirect(next, at);
      return;
    }
    // **"Siguiente" avanza desde la canción que está sonando**, y esa se
    // resuelve por id: la lista pudo haber cambiado mientras sonaba, y el
    // número guardado dice dónde estaba, no dónde está.
    advance(status?.trackId ?? loadedTrack?.id);
  }, [advance, moveTo, repeat, visibleTracks, playDirect, status?.trackId, loadedTrack]);

  const onPrevious = useCallback(() => {
    // The Spotify convention, and the one people already have in their fingers:
    // restart the track unless you are near its beginning, then go back. Without
    // the threshold, "previous" on a three-minute song means "skip back" and there
    // is no way to restart what you are listening to.
    const restartAfter = 3_000;
    if ((status?.positionMs ?? 0) > restartAfter && loadedTrack) {
      playDirect(loadedTrack, queueAtRef.current);
      return;
    }
    // **Atrás es el lugar anterior de la cola**, y no "la canción anterior por
    // su id": la cola puede tener la misma canción dos veces.
    const at = queueAtRef.current - 1;
    const back = at >= 0 ? visibleTracks[at] : undefined;
    if (back) playDirect(back, at);
    else if (repeat === "all" && visibleTracks[visibleTracks.length - 1]) {
      playDirect(visibleTracks[visibleTracks.length - 1], visibleTracks.length - 1);
    }
  }, [status?.positionMs, loadedTrack, repeat, visibleTracks, playDirect]);

  /**
   * Shuffle decides the order once, here, instead of at every jump.
   *
   * It used to re-pick at random each time a track ended while leaving the queue
   * untouched, so the button lit up, the music did change, and the panel beside it
   * listed the same order as always. From the user's side that is a button that
   * does nothing: the thing on screen contradicts the thing in their ear. Now
   * turning it on produces an order that stays, which is what the panel can show
   * and what "shuffle" means in every client that has a queue panel.
   *
   * Turning it *off* deliberately leaves the order alone. Restoring the original
   * order would jump the song that is playing to wherever it sits in the list,
   * which is an audible change nobody asked for.
   */
  const onToggleShuffle = useCallback(() => {
    const turningOn = !shuffle;
    setShuffle(turningOn);
    if (!turningOn || visibleTracks.length < 2) return;
    setQueueOverride(shuffleFrom(visibleTracks, status?.trackId ?? loadedTrack?.id ?? null));
    // **El orden nuevo deja la canción que suena adelante**, así que el lugar
    // en la cola también es el primero.
    moveTo(0);
  }, [shuffle, visibleTracks, status?.trackId, loadedTrack, setQueueOverride, moveTo]);

  /**
   * Ask once at startup whether there is a newer Starless.
   *
   * It downloads nothing and restarts nothing — it only decides whether the
   * Settings row says "there's a new version". Deliberately after the session is
   * up: the handshake with Spotify is what the user opened the app for, and a
   * round trip to GitHub competing with it would be the one request that could
   * make a fast launch feel slow.
   */
  useEffect(() => {
    const id = setTimeout(() => void checkForUpdate(), 2500);
    return () => clearTimeout(id);
  }, []);

  const mainRef = useRef<HTMLElement | null>(null);

  /**
   * Whether there is more list above or below the fold.
   *
   * **This is what decides whether the edges of the content area dissolve or
   * show the card's edge.** At the end of a list the card's rounded bottom is
   * the best thing on screen and it has to be seen whole; in the middle of one,
   * the same edge is a row sliced in half, and a sliced row reads as a rendering
   * fault rather than as "there is more".
   *
   * So the fade is a thing that is *there when there is more* and *not there when
   * there is not*, and these two booleans are the whole of that decision. It is
   * the difference between a panel that ends and a panel that was cut — and it
   * takes two booleans because a scrolled list is cut at the top and at the
   * bottom at the same time, and each edge answers on its own.
   */
  const [moreBelow, setMoreBelow] = useState(false);
  const [moreAbove, setMoreAbove] = useState(false);

  /**
   * The mask for the edges, or nothing at all.
   *
   * It is built here and not inside the `<main>` so that the two spellings are
   * the same value: a mask written twice with different gradients is a mask
   * that shows whichever side the engine happened to prefer.
   */
  const fade = fadeMask(moreAbove, moreBelow);

  /**
   * The scroll container is measured, not guessed.
   *
   * **This is a callback ref and not an effect on purpose.** The `<main>` lives
   * inside `AuthGate`: on a machine that is not signed in it is not in the DOM
   * yet, so an effect running on mount would find nothing, and the listener it
   * installed would still be missing by the time the library arrived. A callback
   * ref attaches to the element when it actually appears and detaches when it
   * goes.
   *
   * And the `ResizeObserver` watches the *children* rather than the container,
   * because the container never changes size — it is pinned between the top bar
   * and the player — while the content inside it does, every time a playlist
   * arrives, a filter empties the list or the screen underneath is replaced.
   * The scroll listener only hears about scrolling, and a list that just loaded
   * is exactly the case where the answer changed without a scroll.
   */
  const attachMain = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    mainRef.current = el;

    const update = () => {
      const below = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
      setMoreBelow((prev) => (prev === below ? prev : below));
      const above = el.scrollTop > 4;
      setMoreAbove((prev) => (prev === above ? prev : above));
    };

    update();
    el.addEventListener("scroll", update, { passive: true });

    const sizes = new ResizeObserver(update);
    const watch = () => {
      for (const child of Array.from(el.children)) sizes.observe(child);
    };
    watch();

    // A screen swap replaces the children, and the new ones are not being
    // watched yet. This is the one case where the height changes without
    // anything already observed changing size.
    const swaps = new MutationObserver(() => {
      watch();
      update();
    });
    swaps.observe(el, { childList: true });

    return () => {
      el.removeEventListener("scroll", update);
      sizes.disconnect();
      swaps.disconnect();
      // React 19 does not call the ref with `null` when the callback returns a
      // cleanup, so the pointer is cleared here or it would keep aiming at an
      // element that is no longer in the document.
      mainRef.current = null;
    };
  }, []);

  /**
   * Play one song and make these songs the queue behind it.
   *
   * The click and the queue are one decision, never two: a play button that
   * starts a track nobody chose to follow is how a player loses the user.
   *
   * **The context travels with the queue.** The radio that will follow when
   * this list ends is seeded with *what was being listened to* —the playlist—
   * and not with the songs on the screen. Without it, the radio would have to
   * guess, and the only thing it could guess is the last song.
   */
  const playFrom = useCallback(
    (tracks: Track[], track: Track, context: RadioContext | null = null) => {
      setQueueOverride(tracks, context);
      // **El lugar se busca en la lista nueva.** La cola que se acaba de poner
      // es la que va a mandar, y el índice de la canción en ella es lo que
      // después decide qué sigue.
      onPlay(
        track,
        tracks.findIndex((item) => item.id === track.id),
      );
    },
    [onPlay, setQueueOverride],
  );

  /**
   * Que suene el DJ.
   *
   * **El DJ no es una playlist: es una lista que Spotify le fabricó a la
   * cuenta, y su contenido no está en la playlist.** La playlist del DJ llega
   * vacía —cero canciones, dueño `spotify`— porque lo que la llena vive en
   * otra puerta: hay que pedirla.
   *
   * Lo que vuelve son las canciones que eligió el DJ —pistas del catálogo,
   * con nombre y con audio— y la frase que dice. **La frase es texto y voz a
   * la vez**: el backend pide el audio de la narración al servicio que lo
   * fabrica y lo pone en la misma salida que la música, así que lo que dice el
   * DJ se escucha; lo que queda acá es la frase escrita, que es lo mismo que
   * dijo, para que también se pueda leer.
   *
   * **Y la cola es una estación, no una lista.** Cada click abre una sesión
   * nueva —el servicio arma un mix distinto cada vez— y esa sesión sigue: el
   * DJ elige la siguiente tanda cuando la cola se está por vaciar, que es lo
   * que lo separa de una playlist con nombre de DJ.
   */
  const onPlayDj = useCallback(
    async (playlist: Playlist) => {
      setDjUnavailable(false);
      setDjBusy(true);
      try {
        const mix = await djMix(playlist.id);
        if (mix.tracks.length === 0) {
          setDjUnavailable(true);
          return;
        }
        setQueue({
          tracks: mix.tracks,
          lines: mix.lines,
          source: "dj",
          context: null,
        });
        djLines.current = mix.lines;
        advancedRef.current = null;

        // **El DJ presenta la primera canción, y la música espera.**
        //
        // La frase va con su canción, y se dice antes que ella: el backend corta
        // lo que estuviera sonando, deja que el DJ hable y avisa con `dj://voice`.
        // La música arranca con ese aviso, no antes: hablar encima de la canción
        // es exactamente lo que el DJ de Spotify no hace.
        await playStationTrack(mix.tracks[0], 0);
      } catch (e) {
        console.error("Starless: no se pudo reproducir el DJ", e);
        setDjUnavailable(true);
      } finally {
        setDjBusy(false);
      }
    },
    [playStationTrack],
  );

  /**
   * La card del DJ, si la biblioteca la tiene.
   *
   * **El botón de la barra necesita la misma card que la repisa.** La cuenta
   * tiene un DJ y es el mismo en los dos lugares: el botón no busca su propia
   * playlist, usa la que ya está en la biblioteca, así que no puede pedirle al
   * DJ a una cuenta que no lo tiene. Y aparece sólo con la sesión del DJ
   * encima: la barra es cromo y el cromo no anuncia atajos que no aplican.
   */
  const djCard = useMemo(
    () => orderedPlaylists.find((playlist) => isDjCard(playlist)) ?? null,
    [orderedPlaylists],
  );

  /**
   * Pedirle al DJ otra tanda, desde la barra.
   *
   * **Es el mismo camino que la card de la repisa**, y por eso el DJ avanza en
   * vez de empezar de cero: el cursor es del backend y sigue donde estaba.
   */
  const onPlayDjAgain = useCallback(() => {
    if (!djCard) return;
    void onPlayDj(djCard);
  }, [djCard, onPlayDj]);

  /**
   * La estación sigue.
   *
   * **Un DJ que se acaba es una playlist.** El servicio tiene más páginas, y
   * la cola hay que llenarla *antes* de que se vacíe: cuando la cola está
   * vacía la música se corta, y eso es justo lo que una estación no puede
   * hacer.
   *
   * **La radio sigue igual, y por la misma puerta.** Las dos son estaciones y
   * las dos se llenan antes de vaciarse; lo que cambia es de qué servicio se
   * pide la página: el DJ pide la suya y la radio pide la suya, con su cursor.
   *
   * La bandera de "ya estoy pidiendo" está en una referencia y no en un
   * estado: el efecto se vuelve a correr con cada canción, y un estado sería
   * un render de más por cada uno.
   */
  const stationFetching = useRef(false);
  useEffect(() => {
    if (!queue || queue.source === "list") return;
    // **La cuenta es de la estación, no del panel.** El panel no tiene "a
    // continuación" mientras no suena nada, y la estación sí tiene que saber
    // cuánto le queda de su página.
    if (stationLeft > DJ_TOP_UP) return;
    if (stationFetching.current) return;
    // **Una estación que todavía no tiene su primera página no pide una
    // segunda.** Todavía no hay cursor, y una pregunta sin cursor es una
    // estación que se declara terminada.
    if (radioStarting.current) return;

    stationFetching.current = true;
    const source = queue.source;
    const more = source === "dj" ? djMore : radioMore;
    more()
      .then((mix) => {
        if (mix.tracks.length === 0) {
          // La estación dijo que se terminó. Deja de pedir y la cola sigue con
          // lo que tiene.
          setQueue((current) =>
            current && current.source !== "list" ? { ...current, source: "list" } : current,
          );
          return;
        }
        if (source === "dj") djLines.current = { ...djLines.current, ...mix.lines };
        setQueue((current) =>
          current && current.source !== "list"
            ? {
                ...current,
                tracks: [...current.tracks, ...mix.tracks],
                lines: { ...current.lines, ...mix.lines },
              }
            : current,
        );
      })
      .catch((e) => {
        // Una falla aquí no es una canción rota: la estación se queda con lo
        // que ya tiene y sigue sonando.
        console.error("Starless: la estación no pudo seguir", explain(e));
        setQueue((current) =>
          current && current.source !== "list" ? { ...current, source: "list" } : current,
        );
      })
      .finally(() => {
        stationFetching.current = false;
      });
  }, [queue, stationLeft]);

  /**
   * The playlist's big button, in its playing half.
   *
   * **Under shuffle it starts somewhere random, not at the top.** That is the
   * whole difference the shuffle button exists for: it puts the playlist in
   * random and starts nothing, and the next thing the user presses — this one —
   * plays *a* song from it rather than song one. Always starting at the top would
   * make the button contradict the mode sitting lit up right beside it.
   *
   * The queue behind whatever starts is the shuffled order, because `playShuffled`
   * keeps the chosen song at the front and shuffles the rest — so "next" keeps
   * going at random instead of dropping back into the order it was saved in.
   *
   * Declared here because it is `playFrom` under one condition and
   * `playShuffled` under the other, and both of those live above this point.
   */
  const onPlayPlaylist = useCallback(
    (list: Track[]) => {
      if (list.length === 0) return;
      if (!shuffle) {
        playFrom(list, list[0], playlistContext);
        return;
      }
      playShuffled(list, list[Math.floor(Math.random() * list.length)], playlistContext);
    },
    [shuffle, playFrom, playShuffled, playlistContext],
  );

  /**
   * Everything about the search field, the dropdown and the results screen.
   *
   * Declared here rather than above because picking a song out of the menu has
   * to make the queue, and that is `playRadio`: a song out of the search starts
   * its own radio and the other answers do not come along.
   */
  const {
    draft,
    suggestions,
    suggestionCount,
    searching,
    searchError,
    onQueryChange,
    onSubmitSearch,
    onPickSuggestion,
    committed,
    showResults,
    results,
    resultsLoading,
    screenError,
    leaveResults,
  } = useSearch(playRadio);

  /**
   * The area starts at the top of whatever it is now showing.
   *
   * `<main>` is the scroll container and nothing else was moving it, so
   * opening a shorter list while scrolled deep into a longer one landed you
   * partway down the new one: the browser keeps the old offset and clamps it to
   * whatever fits. Leaving row 150 of a 198-song playlist means arriving at row
   * 150 of a 30-song one, with no scrollbar visible to explain why the list
   * starts in the middle.
   *
   * Keyed on *what is being shown* and not on the scroll, so a refetch of the
   * playlist you are reading does not throw away your place — only a genuine
   * change of list does. `showResults` is in here because the results screen
   * replaces the library in the same box, and going back to a playlist is a
   * different list than the one you were reading. `lyricsOpen` is here for the
   * same reason: the words are a different list in the same box, and arriving in
   * the middle of them meant arriving with the song's name already scrolled off.
   */
  // The dependencies are the trigger, not an input: nothing in the body reads
  // them, on purpose. Putting the reset in each navigation handler instead would
  // scatter one decision across four call sites, and the first one missed brings
  // the bug straight back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger, not input
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [activeItem, showResults, lyricsOpen, detail]);

  /**
   * Warm a playlist before it is opened.
   *
   * Opening a playlist costs a network round trip, and hovering the item is a
   * statement of intent that arrives long before the click. This turns the wait
   * into nothing without changing what a click means — no optimistic UI, no
   * half-rendered list, just the answer already being there.
   *
   * The `staleTime` is the load-bearing part. Without it the prefetch writes the
   * answer and marks it stale in the same breath, so the observer that mounts on
   * the click refetches all over again — and every extra hover does it once
   * more. For a playlist past fifty songs that is one request per page, per
   * hover; the log showed a single playlist downloaded six times in ten seconds.
   */
  const onPrefetchPlaylist = useCallback(
    (playlistId: string) => {
      void queryClient.prefetchQuery({
        queryKey: keys.playlistTracks(playlistId),
        queryFn: () => invoke<Track[]>("playlist_tracks", { playlistId }),
        staleTime: PLAYLIST_STALE_MS,
      });
    },
    [queryClient],
  );

  /**
   * Open a row of the rail.
   *
   * **The DJ is a card, and the rail lists it among the playlists.** Clicking it
   * here used to open the playlist screen — an empty page, because the DJ's
   * songs are not in the playlist: they live in another door. From the rail the
   * DJ sounds, exactly as it does from the shelf.
   *
   * The row keeps its own navigation for everything else, including the
   * Spotify-made playlists that do have songs: those open like playlists.
   */
  const onSelectFromRail = useCallback(
    (id: string) => {
      const card = orderedPlaylists.find((playlist) => playlist.id === id);
      if (card && isDjCard(card)) {
        void onPlayDj(card);
        return;
      }
      setActiveItem(id);
      setActive("navLibrary");
      // A library list is its own queue again: the songs played from a
      // search have nothing to do with the playlist they just opened.
      setQueueOverride(null);
      setLyricsOpen(false);
      // Leaving an artist behind here would strand it: this click is
      // navigation, and the artist page is the thing it navigates away
      // from.
      setDetail(null);
      leaveResults();
    },
    [orderedPlaylists, onPlayDj, setQueueOverride, leaveResults],
  );

  const onCycleRepeat = useCallback(() => {
    setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));
  }, []);

  /**
   * Escape backs out of whatever is open.
   *
   * The library is in here for the same reason the other two are, and it was the
   * only way out of a state that had none: below `lg` the sidebar is a sheet, and
   * on a window narrower than the search field there is nothing else to click.
   */
  useEffect(() => {
    if (!settingsOpen && !queueOpen && !libraryOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSettingsOpen(false);
      setQueueOpen(false);
      setLibraryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen, queueOpen, libraryOpen]);

  /**
   * Which main surface is on, and only one of them draws a heading.
   *
   * The playlist screen brought its own — artwork, title, who made it, how long it
   * runs — and the generic header here says two thirds of that again, 30px above
   * a 44px title of the same words. So the header stands down while it is on
   * screen, the same way `LyricsPanel` already made it stand down for the words.
   *
   * `playlistView` is the question "is the thing on screen a playlist"; the
   * second half is whether its *data* is here yet. They are separate because a
   * playlist just created is opened by id before the library has been re-read, and
   * for that moment `selected` is `undefined` — which is why the plain
   * `TrackList` still exists below it as the honest "we have not loaded it yet"
   * answer rather than a screen with no name on it.
   */
  const playlistView = !lyricsOpen && !showResults && !isHome && !isLiked && !detail;
  const playlistScreen = playlistView && selected !== undefined;
  // Liked Songs is drawn by the same screen, so it shares the big button too.
  const likedScreen = !lyricsOpen && !showResults && !isHome && isLiked && !detail;

  /**
   * Is the playlist on screen the one that is sounding? It is what turns the big
   * button into a pause button.
   *
   * **The whole loaded list, not the filtered one.** The filter is a way of
   * reading the playlist, not a different playlist: hiding the song that is
   * playing and showing a Play triangle for it is the button denying what the
   * player bar is doing three centimetres away.
   *
   * `loading` counts as sounding so the button does not flicker back to Play
   * during the second and a half a track spends being fetched.
   */
  const soundingFrom = status?.trackId ?? null;
  const inPlaylist =
    (playlistScreen || likedScreen) &&
    soundingFrom !== null &&
    libraryTracks.some((track) => track.id === soundingFrom);
  const playlistPlaying = inPlaylist && Boolean(status?.playing || status?.loading);

  /**
   * The playlist's big button, in the three states it actually has.
   *
   * Pause, resume, or start — and the middle one is the one that was easy to
   * miss. A triangle that restarts the playlist instead of picking the song back
   * up is the kind of thing that gets a screen called broken: the button looks
   * right, the player bar says the same song is loaded, and pressing it throws
   * the song away. Resuming goes through `playDirect`, which leaves the queue
   * exactly where it is.
   *
   * Declared here because it is all three of `playDirect`, `togglePlayback` and
   * `onPlayPlaylist`, and the question it answers needs `status` — which is why
   * it cannot live in the screen that draws the button.
   */
  const onPlaylistPlayPause = useCallback(
    (list: Track[]) => {
      if (playlistPlaying) {
        void togglePlayback().catch(() => {});
        return;
      }
      if (inPlaylist && loadedTrack) {
        playDirect(loadedTrack);
        return;
      }
      onPlayPlaylist(list);
    },
    [playlistPlaying, inPlaylist, loadedTrack, playDirect, onPlayPlaylist],
  );

  /**
   * Put one song at the end of the queue without touching what is playing.
   *
   * **Appended to the queue, and the queue is the one that exists.** When there
   * is one, that array is the array the queue is walked out of — so the song on
   * screen keeps its index and everything after it shifts down one. That is the
   * only shape that works without a second queue: the queue is derived by
   * slicing one list at the current track, and a separate "pending additions"
   * list would be a second source of truth for what plays next, which is the
   * drift this whole design exists to prevent.
   *
   * **And when there is no queue, the song is the beginning of one — and the list
   * on screen stays behind it.**
   *
   * A queue with no room for anything else is a dead end: the user puts a song in
   * it, plays it, and the queue is over. That is what it used to do — the added
   * song *was* the queue — and it cost the list: the playlist the user was
   * looking at disappeared from the queue the moment one song was added, and
   * after that song there was nothing. The screen said one thing and the player
   * did another.
   *
   * So the song goes first and the list follows it. The queue is the list on
   * screen plus what the user put in it, and it is the same list either way: one
   * source, no drift. The song the user chose plays first, and the playlist
   * continues after it — which is what "I put it in the queue" means when
   * nothing was playing.
   *
   * A duplicate is not deduplicated. A queue is not a set — somebody who adds the
   * same song twice meant to hear it twice, and quietly dropping the second is
   * the app disagreeing with a decision that was made on purpose.
   */
  const onAddToQueue = useCallback(
    (track: Track) => {
      // La cola del DJ sigue siendo la cola del DJ: agregar una canción no
      // borra las frases que la trajeron, ni la convierte en una lista.
      const edit = queueWithAdded(queue?.tracks ?? null, track, visibleTracks, queueAtRef.current);
      setQueue({
        tracks: edit.tracks,
        lines: queue?.lines ?? {},
        source: queue?.source ?? "list",
        context: queue?.context ?? null,
      });
      moveTo(edit.at);
    },
    [queue, visibleTracks, moveTo],
  );

  /**
   * La playlist entera a la cola, y no lo que el filtro dejó a la vista.
   *
   * **Es la misma puerta que la canción, con más canciones.** La cola es un
   * arreglo y esta fila lo agranda con la lista entera: lo que ya está
   * sonando conserva su lugar y lo que viene después se corre. Lo mismo que
   * hace la canción, con treinta en vez de con una.
   *
   * **Y no se deduplica.** Una cola no es un conjunto: el que agrega dos veces
   * la misma canción quiso oírla dos veces, y descartarla en silencio es la
   * app contradiciendo una decisión que se tomó a propósito.
   */
  const onAddListToQueue = useCallback(
    (tracks: Track[]) => {
      if (tracks.length === 0) return;
      const edit = queueWithListAdded(queue?.tracks ?? null, tracks, queueAtRef.current);
      setQueue({
        tracks: edit.tracks,
        lines: queue?.lines ?? {},
        source: queue?.source ?? "list",
        context: queue?.context ?? null,
      });
      moveTo(edit.at);
    },
    [queue, moveTo],
  );

  /**
   * Open an artist or an album, and come back from one.
   *
   * **The queue is left alone.** Reading about a person or a record is not a
   * decision about what plays next, and replacing the queue because somebody
   * clicked a name would mean clicking anything at all rewrites what you were
   * listening to. Same reasoning as the Home button.
   *
   * **Leaving clears it.** `detail` is the only record of where "back" comes
   * from, and a stale one is a back button that goes somewhere nobody asked for.
   */
  const openArtist = useCallback((artist: Artist) => {
    setDetail({ kind: "artist", artist });
    setLyricsOpen(false);
  }, []);

  const openAlbum = useCallback((album: Album) => {
    setDetail({ kind: "album", album });
    setLyricsOpen(false);
  }, []);

  const closeDetail = useCallback(() => setDetail(null), []);

  /**
   * The heading, and the line under it.
   *
   * Pulled out of the markup because four nested ternaries in JSX is a wall, and
   * adding the home screen made it a fifth. It is also a claim about the screen:
   * each branch says what is actually on it, including "nothing yet", which is the
   * one that keeps a stalled screen from claiming to hold a library.
   */
  const headerTitle = detail
    ? detail.kind === "artist"
      ? detail.artist.name
      : detail.album.name
    : showResults
      ? t.searchResultsTitle
      : isHome
        ? t.homeTitle
        : isLiked
          ? t.likedSongs
          : (selected?.name ?? t.libraryTitle);

  const headerSubtitle = detail
    ? detail.kind === "artist"
      ? t.artistKind
      : t.albumKind
    : showResults
      ? results
        ? t.searchResultsFor.replace("{query}", committed)
        : resultsLoading
          ? t.searching
          : (screenError ?? t.searchNoResults)
      : isHome
        ? playlists.data
          ? `${listCount(playlists.data)} ${t.playlists}`
          : t.loading
        : isLiked
          ? liked.data
            ? `${listCount(liked.data)} ${t.songs}`
            : t.loading
          : playlistTracks.data
            ? `${listCount(playlistTracks.data)} ${t.songs}`
            : playlistTracks.isLoading
              ? t.loading
              : t.librarySubtitle;

  /**
   * Put the screen back the way a fresh session finds it.
   *
   * **The view behind the door belonged to the session that just ended.** The
   * gate unmounts its children when it closes, but the state that decides what
   * those children show lives up here — and it survives. So signing out of the
   * settings panel and signing back in brought the settings panel back, whole,
   * on top of the app: the previous session's screen, over the new one.
   *
   * What goes back to its first value is everything *about the account*: where
   * you are, what is open, what is queued, what was playing. What stays is
   * everything *about the person*: the language, the order of the shelf, the
   * glass, the collapsed rail. Those are preferences, and a sign-out does not
   * take preferences away.
   */
  const resetView = useCallback(() => {
    setSettingsOpen(false);
    setLyricsOpen(false);
    setDetail(null);
    setActive("navHome");
    setActiveItem("liked");
    closeNaming();
    setQueueOverride(null);
    leaveResults();
  }, [closeNaming, setQueueOverride, leaveResults]);

  return (
    <div className="relative h-full overflow-hidden bg-ground">
      {/*
        Bloom, in frost only: light on black, like the landing's chrome, so the
        glass has something to show through without bringing hue back.

        These three are static. The one light that moves is CursorGlow, and only
        with the pointer: a backdrop that animates on its own under blurred glass
        repaints the blur every frame — see DESIGN.md.
      */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: BLOOM_OPACITY[effect.bloom],
          background: [
            "radial-gradient(90% 70% at 50% -6%, rgb(237 234 227 / 0.24) 0%, transparent 64%)",
            "radial-gradient(70% 70% at 104% 108%, rgb(196 193 200 / 0.18) 0%, transparent 60%)",
            "radial-gradient(60% 60% at -6% 96%, rgb(237 234 227 / 0.10) 0%, transparent 60%)",
          ].join(", "),
        }}
      />
      {effect.glow === "on" && <CursorGlow />}

      <AuthGate t={t} onReport={() => setFeedbackOpen(true)} onSignedOut={resetView}>
        <TopBar
          t={t}
          active={active}
          libraryOpen={libraryOpen}
          onNavigate={(key) => {
            setActive(key);
            // "Inicio" es un destino, no un resaltado. Antes esto sólo cambiaba
            // `active` y el contenido principal decide mirando `activeItem`, así
            // que marcaba la pestaña y dejaba la playlist abierta en pantalla.
            //
            // No toca `activeItem` ni la cola a propósito: el inicio es una
            // pantalla para mirar, no una lista que define qué sigue. Cambiar la
            // playlist desde acá tiraría la cola de lo que se estaba escuchando
            // sin que nadie lo pidiera.
            setLyricsOpen(false);
            leaveResults();
          }}
          onToggleLibrary={() => setLibraryOpen((v) => !v)}
          query={draft}
          onQueryChange={onQueryChange}
          onSubmitSearch={onSubmitSearch}
          onPickSuggestion={onPickSuggestion}
          suggestions={suggestions}
          suggestionCount={suggestionCount}
          searching={searching}
          searchError={searchError}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenJam={() => {
            setJamOpen((v) => !v);
          }}
          jamActive={jam !== null}
          updateVersion={updateVersion}
        />

        <AnimatePresence>
          {libraryOpen && (
            <LibrarySidebar
              t={t}
              account={account.data ?? null}
              playlists={orderedPlaylists}
              likedCount={liked.data?.length ?? null}
              error={Boolean(playlists.error ?? account.error) && !playlists.isLoading}
              activeId={activeItem}
              collapsed={railOnly}
              barPresent={barPresent}
              onToggleCollapsed={narrow ? undefined : () => setLibraryCollapsed((v) => !v)}
              sort={sortOrder}
              onSortChange={changeSort}
              view={shelfView}
              onViewChange={changeView}
              onPrefetch={onPrefetchPlaylist}
              onNewPlaylist={() => openNaming()}
              onSelect={onSelectFromRail}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {queueOpen && (
            <QueuePanel
              t={t}
              playing={status?.trackId ? loadedTrack : null}
              upNext={upNext}
              narration={narration}
              dj={djVoice}
              station={queue?.source === "dj"}
              barPresent={barPresent}
              onPlay={onPlayFromQueue}
              onClose={() => setQueueOpen(false)}
              onOpenJam={() => setJamOpen(true)}
              jamOpen={jam !== null}
              onAddToJam={(track) => void addToJam(track)}
            />
          )}
        </AnimatePresence>

        {/*
            The jam, next to the queue and not instead of it.

            **Spotify starts a Jam from the queue**, and closing the queue to
            open the Jam is the wrong way round: the two panels answer
            different questions —what is playing here, and who else is
            listening— and both of them are worth having open at the same
            time. When the queue is there, the jam docks to its left.
        */}
        <AnimatePresence>
          {jamOpen && (
            <JamPanel
              t={t}
              session={jam}
              queue={jamSongs}
              busy={jamBusy}
              error={jamError}
              besideQueue={queueOpen}
              onStart={() => void startJam()}
              onJoin={(token) => void joinJam(token)}
              onLeave={() => void leaveJam()}
              onClose={() => setJamOpen(false)}
            />
          )}
        </AnimatePresence>

        {/*
        Main content.

        The insets are not arbitrary: the top bar is 64px tall sitting 20px from
        the ceiling, and the player bar is 104px sitting 20px off the floor, so
        104px / 144px leaves exactly one 20px gap between every glass surface and
        the content it floats over. The library takes 112px as a riel of covers or
        280px with the names, and the queue 280px — 20px of inset, its own width,
        20px of gap — and both of them dock at every width, because the layout that
        fits is the one where nothing is a sheet over the content.

        **The bottom inset has two values, and they follow the bar.** With the
        bar on screen the surfaces stop at 144px, where the bar begins. Without
        it they go down to the window's own 20px: that space belongs to the
        content, and a band of empty ground under the library is a hole, not
        breathing room. The bar arriving and the content moving are one
        movement, so they share the 300ms the panels already use.

        `overflow-x-hidden` is spelled out because it is not the default and the
        default is a trap: writing only `overflow-y: auto` leaves the horizontal
        axis `visible` in the source, and CSS then *computes* it to `auto`. The box
        could scroll sideways and a single over-wide child put a scrollbar across
        the bottom of the content area, which is not a thing anybody can explain.
      */}
        <main
          ref={attachMain}
          // The fade lives on the element that scrolls, and not on a wrapper
          // around the content: a mask on the scroller is pinned to the visible
          // box, so it stays put while the list moves under it. On the content
          // it would travel with the list and fade the wrong edge.
          style={{
            WebkitMaskImage: fade,
            maskImage: fade,
          }}
          // `pr-3` is the air between the shelf and the scrollbar. Chromium draws the
          // thumb inside the padding box, so padding on the right is exactly that
          // gap — and without it the last column of cards ended up touching the
          // thumb, which read as one object instead of two.
          className={`absolute top-[104px] ${barPresent ? "bottom-[144px]" : "bottom-5"} overflow-x-hidden overflow-y-auto pr-3 transition-[left,right,bottom] duration-300 ease-[var(--ease-glass)] ${
            libraryOpen ? (railOnly ? "left-[112px]" : "left-[280px]") : "left-9"
          } ${queueOpen ? "right-[280px]" : "right-9"}`}
        >
          {/*
            The heading belongs to the list, and there are three screens that bring
            their own: the words, the playlist and the artist. It used to stay for
            the lyrics anyway — the playlist's name up here, the song's name
            underneath in the panel, and between them a subtitle counting the songs
            of a playlist nobody could see.
          */}
          {!lyricsOpen && !playlistScreen && !likedScreen && !detail && (
            <motion.header
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SPRING}
              className="mb-5"
            >
              <h1 className="truncate text-[30px] leading-tight font-semibold tracking-tight">
                {headerTitle}
              </h1>
              <p className="tabular mt-1 truncate text-[13px] text-ink-muted">{headerSubtitle}</p>
            </motion.header>
          )}

          {lyricsOpen ? (
            /*
              The words replace the list rather than opening over it. DESIGN.md
              allows four floating layers and the queue already has one, and the
              lyrics are only worth reading with the transport right there — which
              it always is, on the player bar.
            */
            <LyricsPanel
              t={t}
              lyrics={lyrics.data}
              loading={lyrics.isLoading}
              error={lyrics.error ? explain(lyrics.error) : null}
              positionMs={status?.positionMs ?? 0}
              playing={status?.playing ?? false}
              title={loadedTrack?.name ?? ""}
              artists={loadedTrack ? trackArtists(loadedTrack) : ""}
              trackId={lyricsTrackId}
              onClose={closeLyrics}
            />
          ) : showResults ? (
            results ? (
              <SearchScreen
                t={t}
                tracks={results}
                nowPlayingId={nowPlayingId}
                loadingId={loadingId}
                failedId={failedId}
                onPlay={playRadio}
                onOpenArtist={openArtist}
                onAddToQueue={onAddToQueue}
                onNewPlaylist={openNaming}
                onAddToJam={onAddToJam}
              />
            ) : (
              <p className="rounded-card border border-white/8 bg-white/4 px-5 py-6 text-center text-[13px] text-ink-faint">
                {resultsLoading ? t.searching : (screenError ?? t.searchNoResults)}
              </p>
            )
          ) : isHome ? (
            <HomeScreen
              t={t}
              playlists={orderedPlaylists}
              loading={playlists.isLoading}
              error={playlists.error ? explain(playlists.error) : null}
              playlistCount={(playlist) => `${playlist.tracks?.total ?? 0} ${t.songs}`}
              onPlayDj={onPlayDj}
              djBusy={djBusy}
              djUnavailable={djUnavailable}
              onOpenPlaylist={(playlist) => {
                setActiveItem(playlist.id);
                setActive("navLibrary");
                setQueueOverride(null);
                setLyricsOpen(false);
                setDetail(null);
              }}
              onPrefetch={(playlist) => onPrefetchPlaylist(playlist.id)}
            />
          ) : detail ? (
            /*
              A page about one artist or one album, over everything that was on
              screen and with its own back button. It is a destination and not a
              filter: the rail, the queue and the transport all stay exactly where
              they were, because reading about somebody is not a decision about
              what plays next.

              **Both cases share one branch** because they are the same screen —
              same back button, same list, same scroll reset, same heading rule.
              Splitting them here would mean the next thing added to one of them
              has to be remembered for the other.
            */
            detail.kind === "artist" ? (
              <ArtistScreen
                t={t}
                artist={detail.artist}
                nowPlayingId={nowPlayingId}
                loadingId={loadingId}
                failedId={failedId}
                onPlay={playFrom}
                onBack={closeDetail}
              />
            ) : (
              <AlbumScreen
                t={t}
                album={detail.album}
                nowPlayingId={nowPlayingId}
                loadingId={loadingId}
                failedId={failedId}
                onPlay={playFrom}
                onBack={closeDetail}
              />
            )
          ) : isLiked ? (
            /*
              Liked Songs on the playlist's screen, with `playlist={null}`.

              It used to always play shuffled, whatever the shuffle button said.
              Now it follows the one shuffle mode like every playlist does, and
              `playlistContext` is `null` here on purpose: the saved songs are not
              a playlist, so the radio seeds from the last song that played.
            */
            <PlaylistScreen
              t={t}
              lang={lang}
              playlist={null}
              account={account.data ?? null}
              tracks={libraryTracks}
              nowPlayingId={nowPlayingId}
              loadingId={loadingId}
              failedId={failedId}
              onPlay={(list, track) => playFrom(list, track, playlistContext)}
              onShuffle={(list, track) => playShuffled(list, track, playlistContext)}
              onOpenArtist={openArtist}
              onOpenAlbum={openAlbum}
              onAddToQueue={onAddToQueue}
              onNewPlaylist={openNaming}
              onAddToJam={onAddToJam}
              onAddListToQueue={onAddListToQueue}
              prefs={trackPrefs}
              onPrefsChange={changeTrackPrefs}
              shuffle={shuffle}
              onToggleShuffle={onToggleShuffle}
              playing={playlistPlaying}
              onPlayPause={onPlaylistPlayPause}
              loading={liked.isLoading}
              error={liked.error ? explain(liked.error) : null}
              empty={!liked.isLoading ? t.likedEmpty : null}
            />
          ) : playlistScreen && selected ? (
            /*
              The playlist as the client everybody knows draws one: artwork, name,
              who made it, how many songs and how long it runs, then the songs with
              the album and the day each one joined.

              `playFrom` and `playShuffled` both already take the list and the
              song, which is what this screen hands them — and it hands them the
              list *it is showing*, because it can filter and reorder. The screen
              the user is looking at and the queue behind the song are the same
              array, by construction, and not by two props happening to agree.
            */
            <PlaylistScreen
              t={t}
              lang={lang}
              playlist={selected}
              account={account.data ?? null}
              tracks={libraryTracks}
              nowPlayingId={nowPlayingId}
              loadingId={loadingId}
              failedId={failedId}
              onPlay={(list, track) => playFrom(list, track, playlistContext)}
              onShuffle={(list, track) => playShuffled(list, track, playlistContext)}
              onOpenArtist={openArtist}
              onOpenAlbum={openAlbum}
              onAddToQueue={onAddToQueue}
              onNewPlaylist={openNaming}
              onAddToJam={onAddToJam}
              // Los tres puntos de la playlist: la lista entera va a la cola, y
              // los detalles son un diálogo aparte.
              onAddListToQueue={onAddListToQueue}
              prefs={trackPrefs}
              onPrefsChange={changeTrackPrefs}
              // The two controls the playlist shares with the transport, handed the
              // transport's own state and handlers. Two shuffle buttons showing two
              // different answers is the thing this cannot be.
              shuffle={shuffle}
              onToggleShuffle={onToggleShuffle}
              playing={playlistPlaying}
              onPlayPause={onPlaylistPlayPause}
              loading={playlistTracks.isLoading}
              error={playlistError}
              empty={!playlistTracks.isLoading ? t.playlistEmpty : null}
            />
          ) : (
            // A playlist the user does not own 404s, and a playlist with no tracks
            // is a real empty state rather than a loading one — both need to say
            // something different from "cargando". This is also what a playlist
            // shows for the moment between being opened by id and being found in
            // the library, which is exactly the loading state and nothing more.
            <TrackList
              tracks={libraryTracks}
              t={t}
              nowPlayingId={nowPlayingId}
              loadingId={loadingId}
              failedId={failedId}
              // This list defines the queue, and it has to say so *here* as well
              // as when the playlist was opened. `queueOverride` is only cleared
              // on navigation, so playing a song inside the playlist already on
              // screen used to leave the previous queue standing — open a shuffled
              // run from Home, click a song in "LoL", and the songs after it came
              // from the old list. The drift the queue design exists to prevent.
              onPlay={(track) => playFrom(libraryTracks, track, playlistContext)}
              loading={playlistTracks.isLoading}
              error={playlistError}
              empty={!playlistTracks.isLoading ? t.playlistEmpty : null}
            />
          )}

          {account.data && account.data.product !== "premium" && (
            <p className="mt-5 text-[12px] text-warn">{t.premiumRequired}</p>
          )}
        </main>

        <PlayerBar
          track={loadedTrack}
          status={status}
          dj={djVoice}
          present={barPresent}
          onPlayDj={queue?.source === "dj" && djCard ? onPlayDjAgain : undefined}
          djBusy={djBusy}
          t={t}
          queueOpen={queueOpen}
          onToggleQueue={() => {
            setQueueOpen((v) => !v);
            // **Los dos paneles viven en la misma esquina.** El jam y la cola
            // contestan la misma pregunta —qué está sonando y qué sigue— y uno
            // es sobre los demás. Abrir uno cierra al otro: dos paneles
            // superpuestos en el mismo rincón son dos que nadie puede leer.
            setJamOpen(false);
          }}
          lyricsOpen={lyricsOpen}
          onToggleLyrics={() => setLyricsOpen((v) => !v)}
          onPrevious={onPrevious}
          onNext={onNext}
          shuffle={shuffle}
          onToggleShuffle={onToggleShuffle}
          repeat={repeat}
          onCycleRepeat={onCycleRepeat}
        />

        <AnimatePresence>
          {settingsOpen && (
            <SettingsPanel
              lang={lang}
              t={t}
              account={account.data ?? null}
              onOpenFeedback={() => setFeedbackOpen(true)}
              onClose={() => setSettingsOpen(false)}
              onLangChange={setLang}
            />
          )}
        </AnimatePresence>
      </AuthGate>

      {/*
        The new-playlist dialog lives here because two buttons open it: the
        rail's "+" and the track menu's "New playlist". A dialog with two
        owners is a dialog that ends up open twice, and the one that opens
        from the menu has to carry the song with it — a playlist made from
        "add to playlist" comes out with the song in it, or the promise was
        broken in the only place the user could tell.
      */}
      <NewPlaylistDialog t={t} open={naming} onClose={closeNaming} onCreate={createPlaylist} />

      {/* Outside the gate on purpose. A report about a crash is worth reading
          before signing in again, and `AuthGate` returns early while it decides
          whether to show a session — anything inside it would simply not be
          mounted on exactly the launch where the crash prompt matters. */}
      <CrashPrompt t={t} barPresent={barPresent} />

      {/* Also outside the gate, and for a sharper reason: the crash prompt appears
          on a launch where the app may never get past the door, so a report about
          the app not working has to be writable from a screen that is not behind it. */}
      {feedbackOpen && <FeedbackPanel t={t} onClose={() => setFeedbackOpen(false)} />}

      {/* Also outside the gate. An update notice outlives the session it was
          announced in — the whole point of the badge is that it is still there
          once someone signs in — and a notice that is not mounted yet cannot mark
          the Settings button the notice is pointing at. */}
      <UpdateAlert t={t} />
    </div>
  );
}
