import { Play } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import {
  formatDuration,
  largestImage,
  type Track,
  trackArtists,
  trackRowKeys,
} from "../lib/spotify";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

type NumberedTrackListProps = {
  tracks: Track[];
  t: Record<StringKey, string>;
  nowPlayingId?: string | null;
  loadingId?: string | null;
  failedId?: string | null;
  onPlay: (track: Track) => void;
  loading?: boolean;
  error?: string | null;
  empty?: string | null;
  /**
   * Off when every song comes from the same record.
   *
   * The artist's own page is the case that matters: seventeen tracks all reading
   * "Blonde" is a column of noise repeating one word, and hiding it there is not
   * hiding information because the page already says which album it is.
   */
  showAlbum?: boolean;
};

/**
 * A song list that counts itself.
 *
 * The number is the affordance: on hover it becomes a play button, which is what
 * makes "song 3" a thing you can click rather than a label. It sits in the same
 * column as the title, so the eye moves straight from "what number" to "which
 * song" to "play".
 *
 * The album column is the reason this is not [`TrackList`](../components/TrackList):
 * that one is for a playlist the user is inside, where the album is mostly the
 * same album and a status column earns its width. Here the results come from a
 * search that spans four records, and which record a song belongs to is part of
 * what was asked for.
 */
export function NumberedTrackList({
  tracks,
  t,
  nowPlayingId,
  loadingId,
  failedId,
  onPlay,
  loading,
  error,
  empty,
  showAlbum = true,
}: NumberedTrackListProps) {
  const columns = showAlbum ? "minmax(0,1.6fr) minmax(0,1fr) 64px" : "minmax(0,1fr) 64px";
  const rowKeys = trackRowKeys(tracks);

  return (
    <div className="overflow-hidden rounded-card border border-white/8 bg-white/4">
      <div
        className="grid items-center gap-4 border-b border-white/8 px-4 py-2.5"
        style={{ gridTemplateColumns: `40px ${columns}` }}
      >
        <span className="text-right text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          #
        </span>
        <span className="text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          {t.columnTitle}
        </span>
        {showAlbum && (
          <span className="text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
            {t.columnAlbum}
          </span>
        )}
        <span className="text-right text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          {t.columnTime}
        </span>
      </div>

      {loading && <Note>{t.loading}</Note>}
      {error && !loading && <Note tone="warn">{error}</Note>}
      {!loading && !error && empty && tracks.length === 0 && <Note>{empty}</Note>}

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
              onClick={() => onPlay(track)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onPlay(track);
              }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: Math.min(index, 12) * 0.02 }}
              className={`group grid cursor-pointer items-center gap-4 border-b border-white/8 px-4 py-2 text-left transition-colors duration-200 last:border-b-0 hover:bg-white/6 ${
                isPlaying ? "bg-white/6" : ""
              }`}
              style={{ gridTemplateColumns: `40px ${columns}` }}
            >
              <span className="relative grid place-items-center text-right">
                <span
                  className={`text-[13px] tabular ${
                    isFailed ? "text-warn" : "text-ink-faint group-hover:opacity-0"
                  } ${isPlaying || isLoading ? "opacity-0" : ""}`}
                >
                  {index + 1}
                </span>

                {/* The one control on this row, shown exactly where the number was
                    so the hand does not have to travel. */}
                <motion.button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlay(track);
                  }}
                  whileTap={{ scale: 0.88 }}
                  transition={SPRING}
                  aria-label={`${t.play} — ${track.name}`}
                  className={`absolute grid size-8 place-items-center rounded-pill transition-opacity duration-150 ${
                    isPlaying
                      ? "text-live opacity-100"
                      : isFailed
                        ? "text-warn opacity-100 group-hover:opacity-0"
                        : "text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  }`}
                >
                  {isPlaying ? (
                    <span className="size-2 rounded-pill bg-live" />
                  ) : (
                    <Play className="size-4 fill-current" strokeWidth={0} />
                  )}
                </motion.button>

                {isLoading && !isPlaying && (
                  <span className="absolute size-2 animate-pulse rounded-pill bg-accent" />
                )}
              </span>

              <div className="flex min-w-0 items-center gap-3">
                {cover ? (
                  <span className="size-9 shrink-0 overflow-hidden rounded-[8px]">
                    <img src={cover.url} alt="" loading="lazy" className="size-full object-cover" />
                  </span>
                ) : (
                  <span className="size-9 shrink-0 rounded-[8px] bg-white/8" aria-hidden />
                )}
                <div className="min-w-0">
                  <p
                    className={`truncate text-[13.5px] font-semibold ${isPlaying ? "text-accent" : ""}`}
                  >
                    {track.name}
                  </p>
                  <p className="truncate text-[12.5px] text-ink-muted">{trackArtists(track)}</p>
                </div>
              </div>

              {showAlbum && (
                <span className="truncate text-[12.5px] text-ink-muted">
                  {track.album?.name ?? "—"}
                </span>
              )}

              <span className="tabular text-right text-[12.5px] text-ink-muted">
                {formatDuration(track.duration_ms)}
              </span>
            </motion.div>
          );
        })}

      {!loading && !error && tracks.length === 0 && <Note>{t.emptyList}</Note>}
    </div>
  );
}

function Note({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "warn";
}) {
  return (
    <p
      className={`border-b border-white/8 px-5 py-6 text-center text-[13px] last:border-b-0 ${
        tone === "warn" ? "text-warn" : "text-ink-faint"
      }`}
    >
      {children}
    </p>
  );
}
