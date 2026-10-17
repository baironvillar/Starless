import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import {
  type AlbumCard,
  type ArtistCard,
  albumYear,
  type Track,
  useArtistProfile,
} from "../lib/spotify";
import { cardImage, MediaCard } from "./MediaCard";
import { NumberedTrackList } from "./NumberedTrackList";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

/**
 * Placeholders for the six cards the discography will hold.
 *
 * Fixed keys on purpose: these are the same six skeletons every time, they never
 * reorder, and an index-derived key makes React treat a position as an identity.
 */
const SKELETON_KEYS = ["uno", "dos", "tres", "cuatro", "cinco", "seis"] as const;

type ArtistProfileProps = {
  t: Record<StringKey, string>;
  /** What the card in the search list already told us, so the header is instant. */
  artist: ArtistCard;
  nowPlayingId: string | null;
  loadingId: string | null;
  failedId: string | null;
  onPlay: (tracks: Track[], track: Track) => void;
  onPlayAlbum: (album: AlbumCard) => void;
  onBack: () => void;
};

/**
 * One artist, as far as this client can honestly show one.
 *
 * The header is instant because the search result already carried the name and
 * the picture. Everything below it is a second request, and the page says so
 * rather than showing an empty shell.
 *
 * **There is no "Popular" shelf here.** Spotify answers 403 to
 * `/artists/{id}/top-tracks` for any app created after February 2026 and removed
 * the `popularity` field that would let this client rank songs on its own, so a
 * shelf titled "Popular" would be a ranking nobody computed. What is here is what
 * a field-filtered search returns for this artist, in search order, under a heading
 * that says exactly that.
 */
export function ArtistProfile({
  t,
  artist,
  nowPlayingId,
  loadingId,
  failedId,
  onPlay,
  onPlayAlbum,
  onBack,
}: ArtistProfileProps) {
  const profile = useArtistProfile(artist.id);
  const image = cardImage(artist.images);
  const tracks = profile.data?.tracks ?? [];
  const albums = profile.data?.albums ?? [];

  return (
    <div>
      <motion.button
        type="button"
        onClick={onBack}
        whileTap={{ scale: 0.96 }}
        transition={SPRING}
        className="mb-5 inline-flex items-center gap-2 rounded-pill px-3 py-2 text-[13px] font-medium text-ink-muted transition-colors duration-200 hover:bg-white/6 hover:text-ink"
      >
        <ArrowLeft className="size-4" strokeWidth={2} />
        {t.searchBack}
      </motion.button>

      <header className="mb-8 flex flex-col items-center gap-5 text-center sm:flex-row sm:items-end sm:gap-7 sm:text-left">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={SPRING}
          className="size-[180px] shrink-0 overflow-hidden rounded-full bg-white/8 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.9)]"
        >
          {image ? <img src={image} alt="" className="size-full object-cover" /> : null}
        </motion.div>

        <div className="min-w-0">
          <p className="text-[12px] font-semibold tracking-[0.18em] uppercase text-ink-faint">
            {t.artistKind}
          </p>
          <h1 className="mt-1.5 truncate text-[34px] leading-tight font-bold tracking-tight">
            {artist.name}
          </h1>
          <p className="tabular mt-1 text-[13px] text-ink-muted">
            {profile.isLoading
              ? t.loading
              : `${tracks.length} ${t.songs} · ${albums.length} ${t.albumsLower}`}
          </p>
        </div>
      </header>

      {profile.error && (
        <p className="rounded-card border border-white/8 bg-white/4 px-5 py-6 text-center text-[13px] text-warn">
          {t.artistLoadFailed}
        </p>
      )}

      {profile.data && (
        <div className="space-y-8">
          {tracks.length > 0 && (
            <section>
              <h2 className="mb-3 text-[19px] font-semibold tracking-tight">{t.artistSongs}</h2>
              <NumberedTrackList
                tracks={tracks}
                t={t}
                nowPlayingId={nowPlayingId}
                loadingId={loadingId}
                failedId={failedId}
                onPlay={(track) => onPlay(tracks, track)}
                // Every track here belongs to this artist, and mostly to one record.
                // A column repeating the same album name seventeen times is noise.
                showAlbum={new Set(tracks.map((track) => track.album?.id ?? "?")).size > 1}
              />
            </section>
          )}

          {albums.length > 0 && (
            <section>
              <h2 className="mb-3 text-[19px] font-semibold tracking-tight">
                {t.searchTab_albums}
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(158px,1fr))] gap-5">
                {albums.map((album) => (
                  <MediaCard
                    key={album.id}
                    title={album.name}
                    eyebrow={albumYear(album) ?? undefined}
                    subtitle={album.artists.map((a) => a.name).join(", ")}
                    imageUrl={cardImage(album.images)}
                    onPlay={() => onPlayAlbum(album)}
                    playLabel={t.play}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {profile.isLoading &&
        SKELETON_KEYS.map((key) => (
          <div key={key}>
            <div className="aspect-square animate-pulse rounded-[10px] bg-white/6" />
            <div className="mt-3 h-3 w-2/3 animate-pulse rounded-pill bg-white/6" />
          </div>
        ))}
    </div>
  );
}
