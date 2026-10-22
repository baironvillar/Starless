import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import { type Artist, coverImage, explain, type Track, useArtistSongs } from "../lib/spotify";
import { NumberedTrackList } from "./NumberedTrackList";

type ArtistScreenProps = {
  t: Record<StringKey, string>;
  artist: Artist;
  nowPlayingId?: string | null;
  loadingId?: string | null;
  failedId?: string | null;
  onPlay: (tracks: Track[], track: Track) => void;
  onBack: () => void;
};

/**
 * One artist, as far as this client can honestly draw one.
 *
 * **The heading is the promise.** It says what the list below it is — what this
 * app can find for this artist — and not "Popular" or "Discography", because
 * neither of those is a ranking or a catalogue that exists here. See
 * `useArtistSongs`: there is no artist read behind this, it is a search that
 * keeps only the songs whose artist carries the same id.
 *
 * **The picture is a record cover, not a photograph of the person.** The search
 * answers with songs and songs carry album art; there is no artist image on this
 * channel to ask for. Showing a record cover under the artist's name is not the
 * same as showing their face, and the comment here is so nobody later "fixes"
 * it into a portrait that would be a picture of nobody.
 *
 * **There is no discography and no album count.** The same channel that answers
 * `artist_profile` with an empty `albums` array is the one being read now, so a
 * "0 albums" would be this client claiming to know an answer nobody asked it for.
 */
export function ArtistScreen({
  t,
  artist,
  nowPlayingId,
  loadingId,
  failedId,
  onPlay,
  onBack,
}: ArtistScreenProps) {
  const profile = useArtistSongs(artist);
  const tracks = profile.tracks;

  /**
   * The cover of the first song that is actually by this artist.
   *
   * Taken from `tracks` and not from `profile.data`, so a search result that got
   * filtered away cannot contribute a picture to an artist it does not belong
   * to.
   */
  const image = coverImage(tracks[0]?.album?.images);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="pb-4"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 rounded-pill px-1 py-1 text-[13px] font-medium text-ink-muted transition-colors duration-200 hover:text-ink"
      >
        <ArrowLeft className="size-4" strokeWidth={2} />
        {t.back}
      </button>

      <header className="mb-6 flex flex-col items-start gap-5 sm:flex-row sm:items-end sm:gap-7">
        <span className="relative block size-[148px] shrink-0 overflow-hidden rounded-pill bg-white/8 shadow-lg lg:size-[184px]">
          {image ? <img src={image.url} alt="" className="size-full object-cover" /> : null}
        </span>

        <div className="min-w-0">
          <p className="mb-2 text-[13px] font-medium text-ink-muted">{t.artistKind}</p>
          <h1 className="line-clamp-2 text-[30px] leading-[1.12] font-semibold tracking-tight sm:text-[38px] lg:text-[44px]">
            {artist.name}
          </h1>
        </div>
      </header>

      {/*
        The heading above the list, and it is the one claim this screen is allowed
        to make. "Popular" would be a ranking nobody computed; "Todas" would be a
        count nobody took.
      */}
      <h2 className="mb-3 px-1 text-[17px] font-semibold tracking-tight">{t.artistSongsFound}</h2>

      <NumberedTrackList
        tracks={tracks}
        t={t}
        nowPlayingId={nowPlayingId}
        loadingId={loadingId}
        failedId={failedId}
        onPlay={(track) => onPlay(tracks, track)}
        loading={profile.isLoading}
        // Through `explain`, never raw: a screen that says `bad_response` instead
        // of a sentence is the failure this repo keeps listing as a signal.
        error={profile.error ? explain(profile.error) : null}
        empty={t.artistSongsNone}
      />
    </motion.div>
  );
}
