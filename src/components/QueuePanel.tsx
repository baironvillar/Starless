import { Play, X } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import {
  formatDuration,
  largestImage,
  type Track,
  trackArtists,
  trackRowKeys,
} from "../lib/spotify";

type QueuePanelProps = {
  t: Record<StringKey, string>;
  /** What the backend is holding, or null when nothing is loaded. */
  playing: Track | null;
  /** In the order it will actually be played. */
  upNext: Track[];
  onPlay: (track: Track) => void;
  onClose: () => void;
};

const SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };

/**
 * Real cover art, or an empty frame — never a generated gradient. See the note on
 * `PlayerBar`'s cover: a colour invented from nothing is a claim that there is
 * artwork there.
 */
function Cover({ track, className }: { track: Track; className: string }) {
  const cover = largestImage(track.album?.images);
  if (!cover) {
    return <span className={`${className} bg-white/8`} aria-hidden />;
  }
  return (
    <span className={`${className} overflow-hidden`}>
      <img src={cover.url} alt="" loading="lazy" className="size-full object-cover" />
    </span>
  );
}

/**
 * The play queue.
 *
 * Docks to the right edge, mirroring the library rail — same inset, same radius,
 * same glass. It used to become a full-bleed sheet below `lg`, on the reasoning
 * that there was no room for a column beside the content: at that width there was
 * room for *this* column, and none of it, because a sheet that covers the window is
 * not a queue you read while the music plays. 240px at the app's own 768px minimum
 * leaves the content 340px, which is narrow, and the close button is right there.
 *
 * Three sections, because the queue is a history as much as a plan: what is sounding,
 * what follows, and what already played. Their order is the only reason to read it
 * top to bottom.
 *
 * "Recently played" is empty until the backend can report it. A filled-in history
 * that was invented would be worse than an honest blank.
 */
export function QueuePanel({ t, playing, upNext, onPlay, onClose }: QueuePanelProps) {
  const rowKeys = trackRowKeys(upNext);

  return (
    <motion.aside
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={SPRING}
      role="dialog"
      aria-label={t.queue}
      className="glass-sheet pointer-events-auto absolute top-[104px] right-5 bottom-[144px] z-30 flex w-[240px] flex-col overflow-hidden rounded-card"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="truncate text-[15px] font-semibold tracking-tight">{t.queue}</h2>
        <motion.button
          type="button"
          onClick={onClose}
          whileTap={{ scale: 0.9 }}
          transition={SPRING}
          aria-label={t.close}
          title={t.close}
          className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
        >
          <X className="size-[17px]" strokeWidth={2} />
        </motion.button>
      </header>

      <div className="flex flex-col gap-5 overflow-y-auto px-2 pb-4">
        <Section label={t.queueNowPlaying}>
          {playing ? <NowPlaying track={playing} /> : <Empty t={t} />}
        </Section>

        <Section label={t.queueNextUp}>
          {upNext.length > 0 ? (
            upNext.map((track, index) => (
              <QueueRow key={rowKeys[index]} track={track} position={index + 1} onPlay={onPlay} />
            ))
          ) : (
            <Empty t={t} />
          )}
        </Section>

        <Section label={t.queueRecentlyPlayed}>
          <Empty t={t} />
        </Section>
      </div>
    </motion.aside>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="px-2 pb-1.5 text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
        {label}
      </h3>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </section>
  );
}

function NowPlaying({ track }: { track: Track }) {
  return (
    <li>
      <div className="flex items-center gap-3 rounded-[14px] bg-white/6 px-2 py-2">
        <span className="relative size-11 shrink-0 rounded-[10px]">
          <Cover track={track} className="absolute inset-0 size-full rounded-[10px]" />
          {/* The same reserved coral that marks the sounding row in the track
              list. One meaning, one colour, everywhere. */}
          <motion.span
            className="absolute bottom-1.5 left-1.5 size-2 rounded-pill bg-live shadow-sm shadow-black/50"
            animate={{ scale: [1, 1.35, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">{track.name}</span>
          <span className="block truncate text-[12.5px] text-ink-muted">{trackArtists(track)}</span>
        </span>
      </div>
    </li>
  );
}

function QueueRow({
  track,
  position,
  onPlay,
}: {
  track: Track;
  position?: number;
  onPlay: (track: Track) => void;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...SPRING, delay: 0.02 * (position ?? 0) }}
    >
      <button
        type="button"
        onClick={() => onPlay(track)}
        className="group flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors duration-200 hover:bg-white/6"
      >
        {position !== undefined ? (
          <span className="tabular w-3 shrink-0 text-[12px] text-ink-faint">{position}</span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <span className="relative size-9 shrink-0 rounded-[9px]">
          <Cover track={track} className="absolute inset-0 size-full rounded-[9px]" />
          <span className="absolute inset-0 grid place-items-center rounded-[9px] bg-ground/55 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <Play className="size-3.5 translate-x-px fill-ink text-ink" strokeWidth={0} />
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{track.name}</span>
          <span className="block truncate text-[12px] text-ink-muted">{trackArtists(track)}</span>
        </span>

        <span className="tabular shrink-0 text-[12px] text-ink-faint">
          {formatDuration(track.duration_ms)}
        </span>
      </button>
    </motion.li>
  );
}

function Empty({ t }: { t: Record<StringKey, string> }) {
  return <li className="px-2 py-1.5 text-[12.5px] text-ink-faint">{t.queueEmpty}</li>;
}
