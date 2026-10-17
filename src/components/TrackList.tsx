import { ListPlus } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import {
  formatDuration,
  largestImage,
  type Track as SpotifyTrack,
  trackArtists,
  trackRowKeys,
} from "../lib/spotify";

type TrackListProps = {
  tracks: SpotifyTrack[];
  t: Record<StringKey, string>;
  /** Marks the one row that is sounding. Absent until something actually plays. */
  nowPlayingId?: string | null;
  /** Being fetched and decrypted. Not yet audible, so not yet "now playing". */
  loadingId?: string | null;
  /** Refused. The row says so, in the colour reserved for it. */
  failedId?: string | null;
  onPlay?: (track: SpotifyTrack) => void;
  onAddToPlaylist?: (track: SpotifyTrack) => void;
  loading?: boolean;
  error?: string | null;
  /**
   * Shown when the list loaded fine and genuinely has nothing in it.
   *
   * Separate from `error`, because "this playlist is empty" and "this failed to
   * load" are different facts and collapsing them makes a working playlist look
   * broken.
   */
  empty?: string | null;
};

/**
 * The track list, cut from the settings panel's recipe rather than invented again:
 * one bordered surface, rows separated by a hairline, a label opposite its value,
 * and controls that only reveal themselves on approach. Bare rows on bare
 * background are what made the main area feel busier than the panel does.
 *
 * The status column is conditional. It exists to say what the queue is doing to a
 * track, and when nothing is playing there is nothing to say — an empty column
 * under a header is worse than no column.
 *
 * Every state the backend reports gets a word in this column. A row that was
 * clicked and shows nothing afterwards is indistinguishable from a row that was
 * never clicked, which is why this column carries `failed` and not just the happy
 * paths.
 */
export function TrackList({
  tracks,
  t,
  nowPlayingId,
  loadingId,
  failedId,
  onPlay,
  onAddToPlaylist,
  loading,
  error,
  empty,
}: TrackListProps) {
  const showStatus = Boolean(nowPlayingId) || Boolean(loadingId) || Boolean(onPlay);
  const rowKeys = trackRowKeys(tracks);

  return (
    <div className="overflow-hidden rounded-card border border-white/8 bg-white/4">
      <div
        className={`grid items-center gap-4 border-b border-white/8 px-5 py-2.5 ${
          onAddToPlaylist
            ? showStatus
              ? "grid-cols-[minmax(0,1fr)_auto_auto_64px]"
              : "grid-cols-[minmax(0,1fr)_auto_64px]"
            : showStatus
              ? "grid-cols-[minmax(0,1fr)_auto_64px]"
              : "grid-cols-[minmax(0,1fr)_64px]"
        }`}
      >
        <span className="text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          {t.columnTitle}
        </span>
        {showStatus && (
          <span className="w-[132px] text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
            {t.columnStatus}
          </span>
        )}
        <span className="text-right text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          {t.columnTime}
        </span>
      </div>

      {loading && <Row className="justify-center py-6 text-[13px] text-ink-faint">{t.loading}</Row>}

      {error && !loading && <Row className="py-6 text-[13px] text-warn">{error}</Row>}

      {!loading && !error && empty && tracks.length === 0 && (
        <Row className="justify-center py-6 text-[13px] text-ink-faint">{empty}</Row>
      )}

      {!loading &&
        !error &&
        tracks.map((track, index) => {
          const isPlaying = track.id === nowPlayingId;
          const isLoading = track.id === loadingId;
          const isFailed = track.id === failedId;
          const cover = largestImage(track.album?.images);

          return (
            <motion.div
              key={rowKeys[index]}
              role="button"
              tabIndex={0}
              onClick={() => onPlay?.(track)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPlay?.(track);
                }
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                type: "spring",
                stiffness: 420,
                damping: 32,
                delay: 0.03 * index,
              }}
              className={`group grid w-full cursor-pointer items-center gap-4 border-b border-white/8 px-5 py-2.5 text-left transition-colors duration-200 last:border-b-0 hover:bg-white/6 ${
                onAddToPlaylist
                  ? showStatus
                    ? "grid-cols-[minmax(0,1fr)_auto_auto_64px]"
                    : "grid-cols-[minmax(0,1fr)_auto_64px]"
                  : showStatus
                    ? "grid-cols-[minmax(0,1fr)_auto_64px]"
                    : "grid-cols-[minmax(0,1fr)_64px]"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3.5">
                {showStatus && (
                  <span className="grid size-4 shrink-0 place-items-center">
                    {isPlaying ? (
                      <motion.span
                        className="size-2 rounded-pill bg-live"
                        animate={{ scale: [1, 1.35, 1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      />
                    ) : isLoading ? (
                      <motion.span
                        className="size-2 rounded-pill bg-accent"
                        animate={{ opacity: [1, 0.25, 1] }}
                        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                      />
                    ) : (
                      <span className="size-2 rounded-pill bg-white/16 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                    )}
                  </span>
                )}

                <Cover cover={cover} alt={track.album?.name ?? track.name} />

                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold">{track.name}</p>
                  <p className="truncate text-[12.5px] text-ink-muted">{trackArtists(track)}</p>
                </div>
              </div>

              {showStatus && (
                <span className="flex w-[132px] items-center gap-1.5 text-[12px] font-medium text-ink-muted">
                  {isPlaying && <span className="text-live">{t.nowPlaying}</span>}
                  {isLoading && !isPlaying && (
                    <span className="text-accent">{t.loadingPlayback}</span>
                  )}
                  {isFailed && !isPlaying && <span className="text-warn">{t.failed}</span>}
                </span>
              )}

              {onAddToPlaylist && (
                <button
                  type="button"
                  // The row is the play target, so this must not also fire it.
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToPlaylist(track);
                  }}
                  aria-label={t.addToPlaylist}
                  title={t.addToPlaylist}
                  className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-faint opacity-0 transition-opacity duration-200 group-hover:opacity-100 hover:bg-white/10 hover:text-ink focus-visible:opacity-100"
                >
                  <ListPlus className="size-[16px]" strokeWidth={2} />
                </button>
              )}

              <span className="tabular text-right text-[12.5px] text-ink-muted">
                {formatDuration(track.duration_ms)}
              </span>
            </motion.div>
          );
        })}

      {!loading && !error && tracks.length === 0 && (
        <Row className="justify-center py-6 text-[13px] text-ink-faint">{t.emptyList}</Row>
      )}
    </div>
  );
}

function Row({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`flex border-b border-white/8 px-5 text-left last:border-b-0 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** Real cover art when Spotify gave us one, and never a coloured placeholder in
 *  its place: a grey square reads as "missing" and, in a list, as a bug. */
function Cover({ cover, alt }: { cover: ReturnType<typeof largestImage>; alt: string }) {
  if (!cover) {
    return <span className="size-10 shrink-0 rounded-[10px] bg-white/8" aria-hidden />;
  }
  return (
    <span className="relative size-10 shrink-0 overflow-hidden rounded-[10px]">
      <img src={cover.url} alt={alt} loading="lazy" className="size-full object-cover" />
    </span>
  );
}
