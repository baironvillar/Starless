import type { Artist, Track } from "../lib/spotify";

type ArtistLineProps = {
  track: Track;
  /**
   * Absent makes this plain text, and that is deliberate: a list that cannot open
   * an artist should say nothing about artists rather than offering a link that
   * goes nowhere.
   */
  onOpenArtist?: (artist: Artist) => void;
  className?: string;
};

/**
 * The artists under a song's title, each one a link to their page.
 *
 * **Every artist is a link, not just the first.** A collaboration has two names
 * on it and both of them are somebody's page; linking only the first would send
 * you to half the credit. `TrackMenu` links the first one instead, because there
 * a menu row can only be one destination.
 *
 * **The click stops where it lands.** The row is itself a button that plays the
 * song, so an artist link that did not stop the event would play a song when
 * somebody asked to read about a person — and the navigation would happen
 * underneath it. That combination is the reason this is its own component rather
 * than a `<span>` with an `onClick` bolted on: the stop belongs here, next to the
 * button that needs it.
 */
export function ArtistLine({ track, onOpenArtist, className = "" }: ArtistLineProps) {
  const names = track.artists.map((artist) => artist.name).join(", ");

  if (!onOpenArtist || track.artists.length === 0) {
    return <p className={className}>{names}</p>;
  }

  return (
    <p className={className}>
      {track.artists.map((artist, index) => (
        <span key={artist.id}>
          {index > 0 && ", "}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenArtist(artist);
            }}
            title={artist.name}
            className="max-w-full truncate text-left align-bottom transition-colors duration-150 hover:text-ink hover:underline"
          >
            {artist.name}
          </button>
        </span>
      ))}
    </p>
  );
}
