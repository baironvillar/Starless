import { useCallback, useEffect, useState } from "react";
import { explain, runSearch, type Track } from "./spotify";

/**
 * Search, in two steps: typing offers, Enter commits.
 *
 * It was seven `useState` calls and two effects living in the middle of
 * `App`'s body, between the library's scroll reset and the transport's advance
 * logic, with nothing marking where search began and ended. It is its own
 * question with its own state, so it is its own hook now.
 */

/**
 * How long typing pauses before Spotify is asked.
 *
 * Long enough that a word typed at normal speed is one request, short enough that
 * the menu feels attached to the keyboard rather than trailing behind it.
 */
const SEARCH_DEBOUNCE_MS = 280;

/** Below this, Spotify answers with whatever it felt like, which reads as broken. */
export const MIN_QUERY_LENGTH = 2;

/** Songs offered in the menu. More than this and the menu stops being a menu. */
const MAX_SUGGESTIONS = 5;

/** One answer, kept together with the query that produced it. */
type Answer = { query: string; tracks: Track[] };

/**
 * `draft` is what the field holds and `committed` is what the screen is showing,
 * and they are deliberately different values. Binding one to the other means the
 * screen is rewritten on every keystroke — the user loses the list they were
 * reading before they have finished typing the word, and has to remember it to
 * get back. Suggestions are cheap enough to show while typing; replacing the
 * screen is a decision, and Enter is how it gets made.
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
export function useSearch(playRadio: (track: Track) => void) {
  const [draft, setDraft] = useState("");
  const [committed, setCommitted] = useState("");
  const [suggested, setSuggested] = useState<Answer | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Answer | null>(null);
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
   * A song chosen from the dropdown starts its own radio.
   *
   * **The other results do not come along, and that is the point.** The user
   * chose one song: in Spotify, picking a song from the search starts the radio
   * of that song, and the rest of the answers are not a queue. Putting them
   * behind was the bug — nineteen songs the user never chose, queued to play
   * after the one they did.
   *
   * It also commits the query, so the results screen is what is on screen while
   * that radio plays. That is the rule the rest of the app follows — what plays
   * next is something the user can see — and keeping the user on the shelf while a
   * search radio runs would break it.
   */
  const onPickSuggestion = useCallback(
    (track: Track) => {
      const query = freshDraft?.query ?? draft.trim();
      playRadio(track);
      if (query.length >= MIN_QUERY_LENGTH) setCommitted(query);
      setDraft(query);
    },
    [freshDraft, draft, playRadio],
  );

  return {
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
  };
}
