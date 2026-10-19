import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AuthGate } from "./components/AuthGate";
import { CrashPrompt } from "./components/CrashPrompt";
import { FeedbackPanel } from "./components/FeedbackPanel";
import { HomeScreen } from "./components/HomeScreen";
import { LibrarySidebar } from "./components/LibrarySidebar";
import { LyricsPanel } from "./components/LyricsPanel";
import { PlayerBar, type RepeatMode } from "./components/PlayerBar";
import { QueuePanel } from "./components/QueuePanel";
import { SearchScreen } from "./components/SearchScreen";
import { SettingsPanel } from "./components/SettingsPanel";
import { TopBar } from "./components/TopBar";
import { TrackList } from "./components/TrackList";
import { UpdateAlert } from "./components/UpdateAlert";
import { type Lang, type StringKey, strings } from "./lib/i18n";
import {
  accentColor,
  applyAccentColor,
  applyMenuOpacity,
  explain,
  keys,
  listCount,
  menuOpacity,
  onPlaybackStatus,
  PLAYLIST_STALE_MS,
  type PlaybackStatus,
  playTrack,
  runSearch,
  type Track,
  trackArtists,
  useAccount,
  useLikedTracks,
  useLyrics,
  usePlaylists,
  usePlaylistTracks,
} from "./lib/spotify";
import { checkForUpdate, pendingVersion, subscribeUpdate, updateState } from "./lib/updater";

/**
 * How many tracks in a row may fail before Starless stops skipping.
 *
 * Skipping on failure with no ceiling is an infinite loop that walks a playlist to
 * its end in milliseconds and then blames the user for the noise. Five in a row
 * means the problem is not any individual track.
 */
const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * How long typing pauses before Spotify is asked.
 *
 * Long enough that a word typed at normal speed is one request, short enough that
 * the menu feels attached to the keyboard rather than trailing behind it.
 */
const SEARCH_DEBOUNCE_MS = 280;

/** Below this, Spotify answers with whatever it felt like, which reads as broken. */
const MIN_QUERY_LENGTH = 2;

/** Songs offered in the menu. More than this and the menu stops being a menu. */
const MAX_SUGGESTIONS = 5;

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

export default function App() {
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

  // These only ever run inside `AuthGate`'s children, which means they are never
  // mounted before there is a session — so no hook needs to ask "am I allowed to
  // ask?" before firing.
  const account = useAccount();
  const playlists = usePlaylists();
  const liked = useLikedTracks();

  /**
   * One reader for the updater, so the badge on the Settings button and the row
   * inside Settings can never disagree about whether an update exists.
   */
  const updateStateSnapshot = useSyncExternalStore(subscribeUpdate, updateState, updateState);
  const updateVersion = pendingVersion(updateStateSnapshot);

  const selected = playlists.data?.find((p) => p.id === activeItem);
  const isLiked = activeItem === "liked";
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
   */
  const [queueOverride, setQueueOverride] = useState<Track[] | null>(null);
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

  useEffect(() => {
    const unlisten = onPlaybackStatus(setStatus);
    // The listener is async, so the cleanup has to wait for it — returning a
    // promise from the effect would leave a dangling subscription behind.
    return () => {
      unlisten.then((off) => off());
    };
  }, []);

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

  const onPlay = useCallback((track: Track) => {
    // A deliberate choice clears the advance guard. Without this, replaying the
    // same track by hand would still carry the previous "already handled this
    // ending" mark, and the next finish would be silently ignored.
    advancedRef.current = null;
    setLoadedTrack(track);
    playTrack(track).catch((e) => {
      // A refusal that only reaches the console is a refusal the user never sees.
      // The bar shows whatever `status.error` says; this is the console copy.
      console.error("Starless: no se pudo reproducir", explain(e));
    });
  }, []);

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
   * **This is not the shuffle button.** That one re-picks the next track at
   * random while leaving the list on screen alone, on purpose: a queue panel that
   * reshuffles while somebody is reading it reads as the app having lost the
   * thread. Here the order is decided once, at the moment the user asked for
   * something to play, and then stays still — which is what they mean when they
   * ask for a different queue.
   */
  const playShuffled = useCallback((tracks: Track[], track: Track) => {
    advancedRef.current = null;
    setLoadedTrack(track);
    setQueueOverride(shuffleFrom(tracks, track.id));
    playTrack(track).catch((e) => {
      console.error("Starless: no se pudo reproducir", explain(e));
    });
  }, []);

  // Only once audio is actually flowing. During the load, `loading` is true and
  // the row deliberately shows nothing rather than a dot we cannot justify.
  const nowPlayingId = status?.playing ? status.trackId : null;
  const loadingId = status?.loading ? status.trackId : null;
  const failedId = status?.error ? status.trackId : null;

  /**
   * The queue, in the order it will be played.
   *
   * Shuffle changes the *order*, not the contents: the queue stays the list the
   * user is looking at, and picking from it at random keeps every track that was
   * on screen reachable. Shuffling the array itself would mean the queue panel
   * visibly reshuffles under them, which reads as the app having lost track of
   * what they were looking at rather than as a mode they turned on.
   *
   * `previous` is kept alongside `upNext` so that "back" never has to reconstruct
   * what came before from a list that is only sliced forwards.
   */
  const { previous, upNext } = useMemo(() => {
    const index = status?.trackId
      ? visibleTracks.findIndex((track) => track.id === status.trackId)
      : -1;
    if (index === -1) return { previous: [] as Track[], upNext: visibleTracks };
    return {
      previous: visibleTracks.slice(0, index),
      upNext: visibleTracks.slice(index + 1),
    };
  }, [status?.trackId, visibleTracks]);

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

  const playDirect = useCallback((track: Track) => {
    setLoadedTrack(track);
    playTrack(track).catch((e) => {
      advancedRef.current = null;
      console.error("Starless: no se pudo reproducir", explain(e));
    });
  }, []);

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
  const advance = useCallback(() => {
    if (repeat === "one") {
      const current = status?.trackId
        ? visibleTracks.find((track) => track.id === status.trackId)
        : loadedTrack;
      if (current) {
        playDirect(current);
        return true;
      }
    }

    const next = upNext[0];
    if (next) {
      playDirect(next);
      return true;
    }
    // Out of tracks. Only repeat-all brings the first one back.
    if (repeat === "all" && visibleTracks[0]) {
      playDirect(visibleTracks[0]);
      return true;
    }
    return false;
  }, [repeat, upNext, visibleTracks, loadedTrack, status?.trackId, playDirect]);

  useEffect(() => {
    if (!status?.finished) return;
    const ended = status.trackId;
    if (!ended || advancedRef.current === ended) return;

    advancedRef.current = ended;
    if (!advance()) {
      // Nothing to advance to. Drop the guard so a later track — picked by hand,
      // or arriving from a different list — can still take over cleanly.
      advancedRef.current = null;
    }
  }, [status?.finished, status?.trackId, advance]);

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
   */
  const failures = useRef(0);
  useEffect(() => {
    if (status?.playing) failures.current = 0;
  }, [status?.playing]);

  useEffect(() => {
    if (!status?.error || !status.trackId) return;
    const failed = status.trackId;
    if (advancedRef.current === failed) return;

    failures.current += 1;
    if (failures.current > MAX_CONSECUTIVE_FAILURES) {
      // Enough. Leave the error on screen: it is about the session, not a track.
      advancedRef.current = failed;
      return;
    }

    advancedRef.current = failed;
    if (!advance()) advancedRef.current = null;
  }, [status?.error, status?.trackId, advance]);

  const onNext = useCallback(() => {
    // Pressing "next" is a decision, so it overrides repeat-one the way pressing
    // pause does. Honouring the mode here would make the button useless in it.
    if (repeat === "one") {
      const next = upNext[0];
      if (next) playDirect(next);
      return;
    }
    advance();
  }, [advance, repeat, upNext, playDirect]);

  const onPrevious = useCallback(() => {
    // The Spotify convention, and the one people already have in their fingers:
    // restart the track unless you are near its beginning, then go back. Without
    // the threshold, "previous" on a three-minute song means "skip back" and there
    // is no way to restart what you are listening to.
    const restartAfter = 3_000;
    if ((status?.positionMs ?? 0) > restartAfter && loadedTrack) {
      playDirect(loadedTrack);
      return;
    }
    const back = previous[previous.length - 1];
    if (back) playDirect(back);
    else if (repeat === "all" && visibleTracks[visibleTracks.length - 1]) {
      playDirect(visibleTracks[visibleTracks.length - 1]);
    }
  }, [status?.positionMs, loadedTrack, previous, repeat, visibleTracks, playDirect]);

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
  }, [shuffle, visibleTracks, status?.trackId, loadedTrack]);

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

  /**
   * Search, in two steps: typing offers, Enter commits.
   *
   * `draft` is what the field holds and `committed` is what the screen is
   * showing, and they are deliberately different values. Binding one to the other
   * means the screen is rewritten on every keystroke — the user loses the list
   * they were reading before they have finished typing the word, and has to
   * remember it to get back. Suggestions are cheap enough to show while typing;
   * replacing the screen is a decision, and Enter is how it gets made.
   *
   * And the two ask the same thing — songs — at two different times. They used to
   * ask for different things: the screen wanted albums, artists and playlists as
   * well, because a search for "frank ocean" was four questions and the tabs
   * answered them. The parser on the other side drops the type of whatever it
   * matched, so those extra answers were the same songs under other headings and
   * only the request was bigger.
   *
   * Each answer is kept with the query that produced it. A screen showing results
   * for "chanel" while the field says "frank ocean" is a lie, and matching on the
   * query is what makes that impossible rather than merely unlikely.
   *
   * Deliberately not query hooks: a cache keyed by every intermediate keystroke is
   * a cache nobody benefits from, and a request per keypress is a request per
   * keypress. So the state lives here and the calls sit behind a debounce.
   */
  const [draft, setDraft] = useState("");
  const [committed, setCommitted] = useState("");
  const [suggested, setSuggested] = useState<{ query: string; tracks: Track[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [screen, setScreen] = useState<{ query: string; tracks: Track[] } | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = draft.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggested(null);
      setSearching(false);
      setSearchError(null);
      return;
    }

    let alive = true;
    setSearching(true);
    const id = setTimeout(() => {
      runSearch(trimmed)
        .then((tracks) => {
          if (!alive) return;
          setSuggested({ query: trimmed, tracks });
          setSearchError(null);
        })
        .catch((e) => {
          if (!alive) return;
          setSuggested(null);
          setSearchError(explain(e));
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [draft]);

  /**
   * The results screen's own request, fired by Enter rather than by typing.
   *
   * No debounce here on purpose: by the time this runs the word is already
   * written, so waiting another 280ms would delay a deliberate action for no
   * reason.
   */
  useEffect(() => {
    if (committed.length < MIN_QUERY_LENGTH) return;

    let alive = true;
    runSearch(committed)
      .then((tracks) => {
        if (!alive) return;
        setScreen({ query: committed, tracks });
        setScreenError(null);
      })
      .catch((e) => {
        if (!alive) return;
        setScreen(null);
        setScreenError(explain(e));
      });

    return () => {
      alive = false;
    };
  }, [committed]);

  const draftTrimmed = draft.trim();
  /** Songs that belong to the text as it stands right now, not older answers. */
  const freshDraft = suggested?.query === draftTrimmed ? suggested : null;
  const suggestions = (freshDraft?.tracks ?? []).slice(0, MAX_SUGGESTIONS);
  /** `null` while unknown — which is not the same as "none found". */
  const suggestionCount = freshDraft ? freshDraft.tracks.length : null;

  const onSubmitSearch = useCallback(() => {
    if (draftTrimmed.length < MIN_QUERY_LENGTH) return;
    setCommitted(draftTrimmed);
  }, [draftTrimmed]);

  /**
   * What the main screen is showing.
   *
   * Only the committed query gets a screen, and only when the answer on hand
   * belongs to *it*. Committing while the request is still in flight is normal —
   * it is what Enter feels like — so the mismatch shows as the loading state
   * rather than as someone else's results.
   */
  const showResults = committed.length >= MIN_QUERY_LENGTH;
  const results = screen?.query === committed ? screen.tracks : null;
  const resultsLoading = showResults && results === null && screenError === null;

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
  const mainRef = useRef<HTMLElement>(null);
  // The dependencies are the trigger, not an input: nothing in the body reads
  // them, on purpose. Putting the reset in each navigation handler instead would
  // scatter one decision across four call sites, and the first one missed brings
  // the bug straight back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger, not input
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [activeItem, showResults, lyricsOpen]);

  /**
   * Leaving the results screen, whichever way it is done.
   *
   * The text stays in the field when the user just navigates somewhere else —
   * they did not ask to lose what they typed, only to go away — so Enter brings
   * them straight back.
   *
   * Emptying the field is the one exception: there is no text left to come back
   * to, and a results screen titled after a query nobody can see is a screen
   * about nothing.
   */
  const leaveResults = useCallback(() => setCommitted(""), []);

  const onQueryChange = useCallback((value: string) => {
    setDraft(value);
    if (value.trim().length === 0) setCommitted("");
  }, []);

  /**
   * Play one song and make these songs the queue behind it.
   *
   * The click and the queue are one decision, never two: a play button that
   * starts a track nobody chose to follow is how a player loses the user.
   */
  const playFrom = useCallback(
    (tracks: Track[], track: Track) => {
      setQueueOverride(tracks);
      onPlay(track);
    },
    [onPlay],
  );

  /**
   * A song chosen from the dropdown owes the user a queue too.
   *
   * This called `onPlay` on its own, which starts the track and leaves the queue
   * on whatever was open before. So searching for a song, clicking it in the menu
   * and waiting put the *liked songs* on afterwards — the click said "this song"
   * and the queue said "a different list you are no longer looking at".
   *
   * It also commits the query, so the results screen is what is on screen while
   * that list plays. That is the rule the rest of the app follows — what plays
   * next is something the user can see — and keeping the user on the shelf while a
   * search queue runs would break it.
   */
  const onPickSuggestion = useCallback(
    (track: Track) => {
      const query = freshDraft?.query ?? draft.trim();
      playFrom(freshDraft?.tracks ?? [track], track);
      if (query.length >= MIN_QUERY_LENGTH) setCommitted(query);
      setDraft(query);
    },
    [freshDraft, draft, playFrom],
  );

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
   * The heading, and the line under it.
   *
   * Pulled out of the markup because four nested ternaries in JSX is a wall, and
   * adding the home screen made it a fifth. It is also a claim about the screen:
   * each branch says what is actually on it, including "nothing yet", which is the
   * one that keeps a stalled screen from claiming to hold a library.
   */
  const headerTitle = showResults
    ? t.searchResultsTitle
    : isHome
      ? t.homeTitle
      : isLiked
        ? t.likedSongs
        : (selected?.name ?? t.libraryTitle);

  const headerSubtitle = showResults
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

  return (
    <div className="relative h-full overflow-hidden bg-ground">
      {/*
        Colour bloom.

        Deliberately FIXED, not tinted per album. A per-album tint made the chrome
        unrepeatable — whatever hue the current track happened to be leaked into the
        whole interface, which is how a palette stops being a palette. The warmth
        here is Starless's own.

        Also deliberately STATIC. It never animates. A continuously animating
        backdrop under a blurred surface repaints the blur every frame, which is the
        single most expensive thing this design could do — see DESIGN.md.
      */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            "radial-gradient(130% 90% at 6% 116%, hsl(22 78% 38% / 0.20) 0%, transparent 58%)",
            "radial-gradient(110% 80% at 98% -14%, hsl(78 68% 40% / 0.13) 0%, transparent 60%)",
            "radial-gradient(120% 70% at 46% 124%, hsl(34 72% 36% / 0.14) 0%, transparent 62%)",
            "linear-gradient(to top, rgb(10 10 18 / 0.9) 0%, rgb(10 10 18 / 0.3) 22%, transparent 46%)",
          ].join(", "),
        }}
      />

      <AuthGate t={t} onReport={() => setFeedbackOpen(true)}>
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
          updateVersion={updateVersion}
        />

        <AnimatePresence>
          {libraryOpen && (
            <LibrarySidebar
              t={t}
              account={account.data ?? null}
              playlists={playlists.data ?? []}
              likedCount={liked.data?.length ?? null}
              error={Boolean(playlists.error ?? account.error) && !playlists.isLoading}
              activeId={activeItem}
              collapsed={libraryCollapsed}
              onToggleCollapsed={() => setLibraryCollapsed((v) => !v)}
              onPrefetch={onPrefetchPlaylist}
              onSelect={(id) => {
                setActiveItem(id);
                setActive("navLibrary");
                // A library list is its own queue again: the songs played from a
                // search have nothing to do with the playlist they just opened.
                setQueueOverride(null);
                setLyricsOpen(false);
                leaveResults();
              }}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {queueOpen && (
            <QueuePanel
              t={t}
              playing={status?.trackId ? loadedTrack : null}
              upNext={upNext}
              onPlay={onPlay}
              onClose={() => setQueueOpen(false)}
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

        `overflow-x-hidden` is spelled out because it is not the default and the
        default is a trap: writing only `overflow-y: auto` leaves the horizontal
        axis `visible` in the source, and CSS then *computes* it to `auto`. The box
        could scroll sideways and a single over-wide child put a scrollbar across
        the bottom of the content area, which is not a thing anybody can explain.
      */}
        <main
          ref={mainRef}
          className={`absolute top-[104px] bottom-[144px] overflow-x-hidden overflow-y-auto transition-[left,right] duration-300 ease-[var(--ease-glass)] ${
            libraryOpen ? (libraryCollapsed ? "left-[112px]" : "left-[280px]") : "left-9"
          } ${queueOpen ? "right-[280px]" : "right-9"}`}
        >
          {/*
            The heading belongs to the list, and with the lyrics open there is no
            list. It used to stay anyway: the playlist's name up here, the song's
            name underneath in the panel, and between them a subtitle counting the
            songs of a playlist nobody could see — the same fact twice, in two
            sizes, one of them about something that was not on screen. `LyricsPanel`
            brings its own heading now, cut to the same recipe, so the page changes
            subject instead of repeating itself.
          */}
          {!lyricsOpen && (
            <motion.header
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
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
                onPlay={playFrom}
              />
            ) : (
              <p className="rounded-card border border-white/8 bg-white/4 px-5 py-6 text-center text-[13px] text-ink-faint">
                {resultsLoading ? t.searching : (screenError ?? t.searchNoResults)}
              </p>
            )
          ) : isHome ? (
            <HomeScreen
              t={t}
              playlists={playlists.data ?? []}
              loading={playlists.isLoading}
              error={playlists.error ? explain(playlists.error) : null}
              playlistCount={(playlist) => `${playlist.tracks?.total ?? 0} ${t.songs}`}
              onOpenPlaylist={(playlist) => {
                setActiveItem(playlist.id);
                setActive("navLibrary");
                setQueueOverride(null);
                setLyricsOpen(false);
              }}
              onPrefetch={(playlist) => onPrefetchPlaylist(playlist.id)}
            />
          ) : isLiked ? (
            <TrackList
              tracks={libraryTracks}
              t={t}
              nowPlayingId={nowPlayingId}
              loadingId={loadingId}
              failedId={failedId}
              // The home screen gets a fresh order every time, and the callback
              // takes the list so it can decide one. Playlists below pass `onPlay`
              // and keep the order they were made in.
              onPlay={(track) => playShuffled(libraryTracks, track)}
              loading={liked.isLoading}
              error={liked.error ? explain(liked.error) : null}
            />
          ) : (
            // A playlist the user does not own 404s, and a playlist with no tracks
            // is a real empty state rather than a loading one — both need to say
            // something different from "cargando".
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
              onPlay={(track) => playFrom(libraryTracks, track)}
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
          t={t}
          queueOpen={queueOpen}
          onToggleQueue={() => setQueueOpen((v) => !v)}
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

      {/* Outside the gate on purpose. A report about a crash is worth reading
          before signing in again, and `AuthGate` returns early while it decides
          whether to show a session — anything inside it would simply not be
          mounted on exactly the launch where the crash prompt matters. */}
      <CrashPrompt t={t} />

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
