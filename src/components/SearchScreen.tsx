import type { StringKey } from "../lib/i18n";
import type { Track } from "../lib/spotify";
import { NumberedTrackList } from "./NumberedTrackList";

type SearchScreenProps = {
  t: Record<StringKey, string>;
  /** Everything the query answered, in the order it answered it. */
  tracks: Track[];
  nowPlayingId: string | null;
  loadingId: string | null;
  failedId: string | null;
  /** Plays one song and makes these songs the queue that follows. */
  onPlay: (tracks: Track[], track: Track) => void;
};

/**
 * Search results, which is songs.
 *
 * The tabs this screen used to carry are gone because the answers behind them are:
 * the parser drops the type of whatever it matched, so albums, artists and
 * playlists all came back as the same songs wearing a different heading. Four
 * tabs over one list means three of them are always empty and every count beside
 * them is a zero that never moves — worse than saying once what is here.
 */
export function SearchScreen({
  t,
  tracks,
  nowPlayingId,
  loadingId,
  failedId,
  onPlay,
}: SearchScreenProps) {
  /**
   * Alphabetical, because a list of results is a lookup.
   *
   * Search order is not one anybody reads: it clusters near-misses next to exact
   * matches, so the song you were looking for is somewhere in the middle instead
   * of in the place its name says it should be. A list sorted by title answers
   * "which song is called X" the same way every time. `localeCompare` with a
   * numeric option so "Track 2" lands before "Track 10".
   */
  const songs = [...tracks].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
  );

  return (
    // The queue is this list and not the raw answer: what plays next has to be
    // what the user is looking at, and the only list on screen is this one.
    <NumberedTrackList
      tracks={songs}
      t={t}
      nowPlayingId={nowPlayingId}
      loadingId={loadingId}
      failedId={failedId}
      onPlay={(track) => onPlay(songs, track)}
      empty={t.searchNoResults}
    />
  );
}
