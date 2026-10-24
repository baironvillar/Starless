import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import { type Album, explain, type Track, useAlbumSongs } from "../lib/spotify";
import { NumberedTrackList } from "./NumberedTrackList";

type AlbumScreenProps = {
  t: Record<StringKey, string>;
  album: Album;
  nowPlayingId?: string | null;
  loadingId?: string | null;
  failedId?: string | null;
  onPlay: (tracks: Track[], track: Track) => void;
  onBack: () => void;
};

/**
 * One album, as far as this client can honestly draw one.
 *
 * **The same bargain as the artist's page, for the same reason.** There is no
 * album read on this channel: what exists is `spotify:search:<query>`, so the
 * page searches the album's name and keeps only the songs whose `album.id`
 * matches. See `useAlbumSongs` — the id is the filter, because "Greatest Hits"
 * is not an identity.
 *
 * **The square picture is the point.** An album's artwork is square and is
 * already on every row below, so drawing it round — the shape a portrait gets —
 * would be inventing a difference between two things that do not have one. The
 * artist page is round because a portrait is round, and an album cover is not.
 *
 * **The year is deliberately absent.** `MetaTrack` carries a release date and the
 * album type does not, so a "2026" here would be read off each song and would be
 * one song's date standing in for the record's. When the channel brings the real
 * one, it comes back with a field and not with a guess.
 */
export function AlbumScreen({
  t,
  album,
  nowPlayingId,
  loadingId,
  failedId,
  onPlay,
  onBack,
}: AlbumScreenProps) {
  const profile = useAlbumSongs(album);
  const tracks = profile.tracks;
  const cover = album.images[0]?.url ?? null;

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
        <span className="relative block size-[148px] shrink-0 overflow-hidden rounded-[14px] bg-white/8 shadow-lg lg:size-[184px]">
          {cover ? <img src={cover} alt="" className="size-full object-cover" /> : null}
        </span>

        <div className="min-w-0">
          <p className="mb-2 text-[13px] font-medium text-ink-muted">{t.albumKind}</p>
          <h1 className="line-clamp-2 text-[30px] leading-[1.12] font-semibold tracking-tight sm:text-[38px] lg:text-[44px]">
            {album.name}
          </h1>
        </div>
      </header>

      <h2 className="mb-3 px-1 text-[17px] font-semibold tracking-tight">{t.albumSongsFound}</h2>

      <NumberedTrackList
        tracks={tracks}
        t={t}
        nowPlayingId={nowPlayingId}
        loadingId={loadingId}
        failedId={failedId}
        onPlay={(track) => onPlay(tracks, track)}
        loading={profile.isLoading}
        error={profile.error ? explain(profile.error) : null}
        empty={t.albumSongsNone}
      />
    </motion.div>
  );
}
