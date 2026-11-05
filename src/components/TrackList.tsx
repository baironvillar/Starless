import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import {
  type Artist,
  coverImage,
  formatDuration,
  type Track as SpotifyTrack,
  trackRowKeys,
} from "../lib/spotify";
import { isMobile } from "../lib/version";
import { ArtistLine } from "./ArtistLine";
import { PhoneTrackRow } from "./PhoneTrackRow";

const MOBILE = isMobile();

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
  /** The row's extras: the artist's name opens their page. */
  onOpenArtist?: (artist: Artist) => void;
  /** The row's extras: the three dots. Absent and the column is not drawn. */
  trackMenu?: (track: SpotifyTrack) => React.ReactNode;
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
  loading,
  error,
  empty,
  onOpenArtist,
  trackMenu,
}: TrackListProps) {
  const showStatus = Boolean(nowPlayingId) || Boolean(loadingId) || Boolean(onPlay);
  const rowKeys = trackRowKeys(tracks);
  // Header and rows have to agree on the columns or the header drifts one slot to
  // the left of the thing it labels. The dots column is drawn only when the
  // caller asked for the dots, and both sides ask the same question.
  const columns = showStatus
    ? `grid-cols-[minmax(0,1fr)_auto_64px${trackMenu ? "_40px" : ""}]`
    : `grid-cols-[minmax(0,1fr)_64px${trackMenu ? "_40px" : ""}]`;

  return (
    <div className="overflow-hidden rounded-card border border-white/8 bg-white/4">
      <div
        className={`grid items-center gap-4 border-b border-white/8 px-5 py-2.5 ${columns} ${MOBILE ? "hidden" : ""}`}
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
        {trackMenu && <span />}
      </div>

      {loading && <Row className="justify-center py-6 text-[13px] text-ink-faint">{t.loading}</Row>}

      {error && !loading && <Row className="py-6 text-[13px] text-warn-ink">{error}</Row>}

      {!loading && !error && empty && tracks.length === 0 && (
        <Row className="justify-center py-6 text-[13px] text-ink-faint">{empty}</Row>
      )}

      {/*
        The list arrives as one shape.
        *
        * The rows used to come in one at a time, each one thirty milliseconds
        * after the one above it, and the effect was a list of ghosts: half of
        * the table was there and half of it was not, over a background image,
        * for the better part of half a second. A table is not a shelf of tiles
        * — it is one thing, and it should land as one thing.
        *
        * This box mounts when the songs arrive and unmounts when they are
        * gone, so the fade plays exactly when there is something to arrive.
        */}
      {!loading && !error && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={SPRING}>
          {tracks.map((track, index) => {
            const isPlaying = track.id === nowPlayingId;
            const isLoading = track.id === loadingId;
            const isFailed = track.id === failedId;
            const cover = coverImage(track.album?.images);

            if (MOBILE) {
              return (
                <PhoneTrackRow
                  key={rowKeys[index]}
                  track={track}
                  index={index}
                  playing={isPlaying}
                  loading={isLoading}
                  failed={isFailed}
                  onPlay={onPlay}
                  onOpenArtist={onOpenArtist}
                  menu={trackMenu?.(track)}
                />
              );
            }

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
                className={`group grid w-full cursor-pointer items-center gap-4 border-b border-white/8 px-5 py-2.5 text-left transition-colors duration-200 last:border-b-0 hover:bg-white/6 ${columns}`}
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
                    <ArtistLine
                      track={track}
                      onOpenArtist={onOpenArtist}
                      className="truncate text-[12.5px] text-ink-muted"
                    />
                  </div>
                </div>

                {showStatus && (
                  <span className="flex w-[132px] items-center gap-1.5 text-[12px] font-medium text-ink-muted">
                    {isPlaying && <span className="text-live-ink">{t.nowPlaying}</span>}
                    {isLoading && !isPlaying && (
                      <span className="text-accent-ink">{t.loadingPlayback}</span>
                    )}
                    {isFailed && !isPlaying && <span className="text-warn-ink">{t.failed}</span>}
                  </span>
                )}

                <span className="tabular text-right text-[12.5px] text-ink-muted">
                  {formatDuration(track.duration_ms)}
                </span>

                {/* Stops the row's own click: a dot that both opened a menu and
                  started the song is not a control. */}
                {trackMenu?.(track)}
              </motion.div>
            );
          })}
        </motion.div>
      )}

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
function Cover({ cover, alt }: { cover: ReturnType<typeof coverImage>; alt: string }) {
  if (!cover) {
    return <span className="size-10 shrink-0 rounded-[10px] bg-white/8" aria-hidden />;
  }
  return (
    <span className="relative size-10 shrink-0 overflow-hidden rounded-[10px]">
      <img src={cover.url} alt={alt} loading="lazy" className="size-full object-cover" />
    </span>
  );
}
