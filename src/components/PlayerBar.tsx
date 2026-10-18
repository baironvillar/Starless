import {
  ListOrdered,
  Loader2,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import {
  explain,
  formatDuration,
  largestImage,
  type PlaybackStatus,
  seekPlayback,
  setVolume,
  type Track,
  togglePlayback,
  trackArtists,
} from "../lib/spotify";

/**
 * What "repeat" currently means.
 *
 * `"off"` is the default, and the queue genuinely stops rather than wrapping: a
 * list that quietly starts over reads as "this never ends", which is not what the
 * user asked for when they ran out of a list they were scrolling by hand.
 */
export type RepeatMode = "off" | "all" | "one";

type PlayerBarProps = {
  /** The track the backend is actually holding. Null before anything is played. */
  track: Track | null;
  status: PlaybackStatus | null;
  t: Record<StringKey, string>;
  queueOpen: boolean;
  onToggleQueue: () => void;
  lyricsOpen: boolean;
  onToggleLyrics: () => void;
  onPrevious: () => void;
  onNext: () => void;
  shuffle: boolean;
  onToggleShuffle: () => void;
  repeat: RepeatMode;
  onCycleRepeat: () => void;
};

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

/** Feeds the `--fill` custom property the slider recipe paints its track with. */
function fillStyle(percent: number): React.CSSProperties {
  return { "--fill": `${percent}%` } as React.CSSProperties;
}

/**
 * The floating player bar.
 *
 * Detached from the window edges on purpose — inset on all sides, with a large
 * radius. The radius is the signal that says "this floats"; square corners on a
 * floating surface read as a rendering bug.
 *
 * Three columns — `1fr auto 1fr` — so the transport sits on the optical centre of
 * the window no matter how wide the track title grows. The seek bar lives directly
 * UNDER the transport, not beside it: a progress bar that runs off to one side
 * reads as a separate widget, and the pairing of "what I am hearing" with "how far
 * in I am" only holds when they share a centre.
 *
 * Everything on it reads from the real backend. An idle bar that looks busy is the
 * thing DESIGN.md rules out, and it also hides the one moment that matters here —
 * a refusal has to be visible where the user is already looking.
 *
 * DESIGN.md performance budget: nothing here animates `backdrop-filter`. The bar
 * animates its own transform and opacity only.
 */
export function PlayerBar({
  track,
  status,
  t,
  queueOpen,
  onToggleQueue,
  lyricsOpen,
  onToggleLyrics,
  onPrevious,
  onNext,
  shuffle,
  onToggleShuffle,
  repeat,
  onCycleRepeat,
}: PlayerBarProps) {
  const playing = status?.playing ?? false;
  const loading = status?.loading ?? false;
  const error = status?.error ?? null;

  const position = status?.positionMs ?? 0;
  const duration = status?.durationMs ?? track?.duration_ms ?? 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  // librespot's own scale, not ours. The conversion happens once, here, so nothing
  // downstream has to know that 65535 is a thing.
  const volume = (status?.volume ?? 0) / 65535;
  const muted = volume <= 0.001;

  const busy = loading;
  const idle = !track;

  return (
    <motion.footer
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: 0.08 }}
      className="glass pointer-events-auto absolute inset-x-5 bottom-5 z-20 grid h-[104px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-5 rounded-card px-5"
    >
      {/* What is sounding — or what went wrong */}
      <div className="flex min-w-0 items-center gap-3">
        <Cover track={track} />

        <div className="min-w-0">
          {error ? (
            <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-warn">
              <TriangleAlert className="size-[13px] shrink-0" strokeWidth={2} />
              <span className="truncate">{t.playbackErrorTitle}</span>
            </p>
          ) : (
            <>
              <p className="truncate text-[13.5px] font-semibold">
                {track ? track.name : t.nothingPlaying}
              </p>
              <p className="truncate text-[12.5px] text-ink-muted">
                {track ? trackArtists(track) : t.nothingPlayingHint}
              </p>
            </>
          )}
        </div>

        {/*
            The lyrics button sits on the thing it describes, not in the column of
            transport controls: it is about *this* song, so it belongs where the
            song's name is. Disabled when nothing is playing, because then there is
            no song to ask about — the same rule as the transport.
        */}
        <motion.button
          type="button"
          onClick={onToggleLyrics}
          disabled={idle}
          whileTap={{ scale: 0.9 }}
          transition={SPRING}
          aria-label={lyricsOpen ? t.closeLyrics : t.showLyrics}
          title={lyricsOpen ? t.closeLyrics : t.showLyrics}
          aria-pressed={lyricsOpen}
          className={`ml-1 grid size-9 shrink-0 place-items-center rounded-pill transition-colors duration-200 disabled:pointer-events-none disabled:opacity-35 ${
            lyricsOpen
              ? "bg-accent/15 text-accent"
              : "text-ink-faint hover:bg-white/8 hover:text-ink"
          }`}
        >
          <Mic2 className="size-[16px]" strokeWidth={2} />
        </motion.button>
      </div>

      {/* Transport, with the seek bar beneath it on the same centre axis */}
      <div className="flex w-[clamp(190px,34vw,560px)] flex-col items-center gap-2">
        <div className="flex items-center gap-1">
          {/* Shuffle and repeat flank the transport rather than living in the side
              column: they are modifiers of *what the transport does next*, and
              putting them beside the volume would group them with a control that
              has nothing to do with order. */}
          <TransportToggle
            on={shuffle}
            onClick={onToggleShuffle}
            label={shuffle ? t.shuffleOn : t.shuffle}
            disabled={idle}
          >
            <Shuffle className="size-[15px]" strokeWidth={2} />
          </TransportToggle>

          <motion.button
            type="button"
            onClick={onPrevious}
            disabled={idle}
            whileTap={{ scale: 0.9 }}
            transition={SPRING}
            aria-label={t.previous}
            title={t.previous}
            className="grid size-9 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <SkipBack className="size-[17px] fill-current" strokeWidth={0} />
          </motion.button>

          <motion.button
            type="button"
            onClick={() => void togglePlayback().catch(() => {})}
            disabled={idle || busy}
            whileTap={{ scale: 0.94 }}
            transition={SPRING}
            aria-label={playing ? t.pause : t.play}
            className="mx-1 grid size-11 place-items-center rounded-pill bg-ink text-ground transition-transform duration-150 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-[18px] animate-spin" strokeWidth={2} />
            ) : playing ? (
              <Pause className="size-[18px] fill-current" strokeWidth={0} />
            ) : (
              <Play className="size-[18px] translate-x-px fill-current" strokeWidth={0} />
            )}
          </motion.button>

          <motion.button
            type="button"
            onClick={onNext}
            disabled={idle}
            whileTap={{ scale: 0.9 }}
            transition={SPRING}
            aria-label={t.next}
            title={t.next}
            className="grid size-9 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <SkipForward className="size-[17px] fill-current" strokeWidth={0} />
          </motion.button>

          <TransportToggle
            on={repeat !== "off"}
            onClick={onCycleRepeat}
            label={repeatLabel(repeat, t)}
            disabled={idle}
          >
            {repeat === "one" ? (
              <Repeat1 className="size-[15px]" strokeWidth={2} />
            ) : (
              <Repeat className="size-[15px]" strokeWidth={2} />
            )}
          </TransportToggle>
        </div>

        <div className="flex w-full items-center gap-2.5">
          <span className="tabular w-10 text-right text-[12px] font-medium text-ink-muted">
            {formatDuration(position)}
          </span>
          <input
            type="range"
            className="slider min-w-0 grow"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={Math.min(position, duration || 0)}
            disabled={idle || duration <= 0}
            onChange={(e) => void seekPlayback(Number(e.target.value)).catch(() => {})}
            style={fillStyle(progress * 100)}
            aria-label={t.position}
          />
          <span className="tabular w-10 text-[12px] text-ink-muted">
            {formatDuration(duration)}
          </span>
        </div>

        {/* The refusal, in full, where there is room for it. */}
        {error && (
          <p className="w-full truncate text-center text-[12px] text-warn" title={explain(error)}>
            {explain(error)}
          </p>
        )}
      </div>

      {/* Secondary controls, mirroring the left column's width */}
      <div className="flex min-w-0 items-center justify-end gap-2">
        <button
          type="button"
          onClick={onToggleQueue}
          aria-label={t.queue}
          title={t.queue}
          aria-pressed={queueOpen}
          className={`hidden size-8 shrink-0 place-items-center rounded-pill transition-colors duration-200 hover:bg-white/10 lg:grid ${
            queueOpen ? "bg-white/12 text-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          <ListOrdered className="size-[17px]" strokeWidth={2} />
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void setVolume(muted ? 65535 : 0).catch(() => {})}
            aria-label={muted ? t.mute : t.volume}
            title={muted ? t.mute : t.volume}
            className={`shrink-0 transition-colors duration-200 ${
              muted ? "text-live" : "text-ink-muted hover:text-ink"
            }`}
          >
            {muted ? (
              <VolumeX className="size-[17px]" strokeWidth={2} />
            ) : (
              <Volume2 className="size-[17px]" strokeWidth={2} />
            )}
          </button>
          <input
            type="range"
            className="slider hidden w-20 lg:block"
            min={0}
            max={65535}
            step={128}
            value={status?.volume ?? 0}
            disabled={idle}
            onChange={(e) => void setVolume(Number(e.target.value)).catch(() => {})}
            style={fillStyle(volume * 100)}
            aria-label={t.volume}
          />
        </div>
      </div>
    </motion.footer>
  );
}

/**
 * Repeat cycles through three states, so the label has to say which one it is
 * *now* — not what pressing it will do. A toggle whose meaning depends on hidden
 * state is a toggle people press twice to undo.
 */
function repeatLabel(repeat: RepeatMode, t: Record<StringKey, string>): string {
  if (repeat === "one") return t.repeatOne;
  if (repeat === "all") return t.repeatAll;
  return t.repeat;
}

/**
 * Shuffle and repeat.
 *
 * Active state is the accent, not just a brighter grey: an order modifier is a
 * claim about what happens next, and the user needs to see at a glance whether
 * it is in force. `aria-pressed` carries the same fact to anyone not using the
 * colour.
 */
function TransportToggle({
  on,
  onClick,
  label,
  disabled,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.9 }}
      transition={SPRING}
      aria-label={label}
      title={label}
      aria-pressed={on}
      className={`grid size-9 shrink-0 place-items-center rounded-pill transition-colors duration-200 disabled:pointer-events-none disabled:opacity-35 ${
        on ? "bg-accent/15 text-accent" : "text-ink-faint hover:bg-white/8 hover:text-ink"
      }`}
    >
      {children}
    </motion.button>
  );
}

/**
 * Real cover art, or an empty frame.
 *
 * Never a generated gradient: a colour invented from nothing is a claim that
 * there is artwork there, and DESIGN.md's rule against fabricating evidence
 * applies here too. An empty square reads honestly as "no cover".
 */
function Cover({ track }: { track: Track | null }) {
  const cover = largestImage(track?.album?.images);

  if (!cover) {
    return <span className="size-14 shrink-0 rounded-pill bg-white/6" aria-hidden />;
  }
  return (
    <span className="size-14 shrink-0 overflow-hidden rounded-pill">
      <img src={cover.url} alt="" className="size-full object-cover" />
    </span>
  );
}
