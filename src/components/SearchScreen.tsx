import type { StringKey } from "../lib/i18n";
import type { Artist, Track } from "../lib/spotify";
import { NumberedTrackList } from "./NumberedTrackList";
import { TrackMenu } from "./TrackMenu";

type SearchScreenProps = {
  t: Record<StringKey, string>;
  /** Everything the query answered, in the order it answered it. */
  tracks: Track[];
  nowPlayingId: string | null;
  loadingId: string | null;
  failedId: string | null;
  /**
   * Plays one song and starts its radio.
   *
   * **The other results do not become the queue.** The user chose one song, and
   * a song from the search starts the radio of that song —the rest of the
   * answers are not a list the user asked to hear.
   */
  onPlay: (track: Track) => void;
  /** The row's extras, forwarded to the list. See `TrackMenu`. */
  onOpenArtist?: (artist: Artist) => void;
  onAddToQueue: (track: Track) => void;
  /** The row's extras, forwarded to the list. See `TrackMenu`. */
  onNewPlaylist: (track: Track) => void;
  /** The row's extras, forwarded to the list. See `TrackMenu`. */
  onAddToJam?: (track: Track) => void;
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
  onOpenArtist,
  onAddToQueue,
  onNewPlaylist,
  onAddToJam,
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
    // The radio is the queue: what plays next is what the service says is
    // similar, and it is not this list of answers.
    <NumberedTrackList
      tracks={songs}
      t={t}
      nowPlayingId={nowPlayingId}
      loadingId={loadingId}
      failedId={failedId}
      onPlay={onPlay}
      onOpenArtist={onOpenArtist}
      trackMenu={(track) => (
        <TrackMenu
          t={t}
          track={track}
          onOpenArtist={onOpenArtist}
          onAddToQueue={onAddToQueue}
          onNewPlaylist={onNewPlaylist}
          onAddToJam={onAddToJam}
        />
      )}
      empty={t.searchNoResults}
    />
  );
}
