import {
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { SPRING } from "../lib/motion";

/** How many waves can be in the air at once. A fourth kick reuses the oldest ring. */
const WAVES = 3;
/** A kick: the pulse crossing this on the way up. */
const KICK = 0.6;
/** No two waves closer than this, or a roll on the kick reads as a flicker. */
const MIN_GAP_MS = 180;

/**
 * No animation at all.
 *
 * **Under the pointer the slider is not allowed to be late.** A spring that
 * chases the mouse is a lag that grows with the speed of the hand: at the
 * speed of a real drag the thumb ends up a good part of the track behind the
 * cursor, and the control feels like it is sliding on its own instead of
 * being held. So while somebody is dragging, the position *is* the position.
 *
 * The spring is for the values that arrive on their own —a key press, a
 * value that comes back from the backend, a reset— and for those it is what
 * makes the change a glide instead of a jump.
 */
const INSTANT = { duration: 0 } as const;

type SmoothSliderProps = {
  value: number;
  /**
   * The bottom of the range, when it is not zero.
   *
   * **A range that starts somewhere else has to be drawn from that floor.** The
   * fill is the distance the value travelled, not the value: a control whose
   * floor is 55 has nothing filled at 55 and everything filled at 100, and a
   * fill drawn from the value itself would put the thumb in the middle of an
   * empty bar.
   */
  min?: number;
  max: number;
  step?: number;
  disabled?: boolean;
  label: string;
  onChange: (value: number) => void;
  /**
   * The colour of the fill. The player bar is chrome and chrome is ink;
   * Settings is where the accent belongs to the control being set.
   */
  tone?: "ink" | "accent";
  /** The width, as a utility class: the slider fills it. */
  className?: string;
  /**
   * The music's pulse (0–1), when the slider should beat with it: the thumb
   * glows with it and a wave leaves the thumb on every kick. Only the volume
   * passes it.
   */
  pulse?: MotionValue<number>;
};

/**
 * A range input with a native control underneath and a drawing in motion on top.
 *
 * **The input is real and invisible, not replaced.** Keyboard, screen readers
 * and the drag itself are the browser's, which gets them right; only the
 * drawing is ours. The fill and the thumb follow the value on the app's spring,
 * so a step of an arrow key — or a value that arrives a moment later from the
 * backend, like the volume — glides instead of jumping. The thumb grows a
 * little under the pointer and a little more while it is held.
 *
 * **Under the pointer, the drawing follows the pointer.** Two things used to
 * make the thumb trail the mouse, and both were here: the value it drew was
 * the one the backend had last reported, and it got there on a spring. The
 * volume took the whole trip —a command, a file write, an event— before the
 * slider even knew where it was, and a spring that chases a moving target is
 * a lag that grows with the speed of the hand. So the number the person is
 * asking for is the number that is drawn, and the position is not animated
 * while the pointer is down. The native slider this replaced tracked the mouse
 * exactly, and that is the bar it has to clear.
 *
 * It replaces the `.slider` recipe where it is used, and keeps its measures: a
 * 4px track, a 12px thumb and the same 16% white for the empty part.
 */
export function SmoothSlider({
  value,
  min = 0,
  max,
  step = 1,
  disabled = false,
  label,
  onChange,
  tone = "accent",
  className = "w-[180px]",
  pulse,
}: SmoothSliderProps) {
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);

  // Hooks cannot be conditional, so a slider without a pulse beats with a zero.
  const silent = useMotionValue(0);
  const beat = !disabled && pulse ? pulse : silent;
  const glowScale = useTransform(beat, [0, 1], [1, 2.4]);
  const glowOpacity = useTransform(beat, [0, 1], [0, 0.45]);
  const reduced = useReducedMotion();
  const waves = useRef<(HTMLSpanElement | null)[]>([]);
  const next = useRef(0);
  const lastKick = useRef({ value: 0, at: 0 });
  useMotionValueEvent(beat, "change", (value) => {
    const last = lastKick.current;
    const now = performance.now();
    if (!reduced && last.value < KICK && value >= KICK && now - last.at > MIN_GAP_MS) {
      const ring = waves.current[next.current];
      next.current = (next.current + 1) % WAVES;
      last.at = now;
      // transform and opacity only, like everything else that moves here.
      if (ring)
        animate(
          ring,
          { scale: [1, 3.6], opacity: [0.6, 0] },
          { duration: 0.7, ease: [0.23, 1, 0.32, 1] },
        );
    }
    last.value = value;
  });

  /**
   * The value the person is asking for, while they are asking for it.
   *
   * **The drawing follows the pointer, not the answer.** Some of these values
   * come from the backend and the backend is not instant: the volume goes
   * through a command, a file write and an event before it comes back. A
   * slider that draws the answer trails the mouse by that whole trip, and the
   * trail grows with every change the person makes.
   *
   * So the number that is asked for is the number that is drawn, and the app's
   * number takes over when it catches up. The input is bound to this one too:
   * a controlled input whose value does not move is pulled back to the old
   * number by React after every event, and a slider that fights the mouse is
   * worse than a slow one.
   */
  const [asked, setAsked] = useState<number | null>(null);
  const shown = asked ?? value;

  // The app caught up: the two numbers are the same and there is nothing left
  // to remember.
  useEffect(() => {
    if (asked !== null && asked === value) setAsked(null);
  }, [asked, value]);

  const span = max - min;
  const fill = span > 0 ? Math.min(100, Math.max(0, ((shown - min) / span) * 100)) : 0;
  const active = !disabled && (held || hovered);
  const scale = disabled ? 1 : held ? 1.45 : hovered ? 1.25 : 1;
  // The bar thickens under the hand: 4px to 6px, by transform so nothing re-lays out.
  const thick = active ? 1.5 : 1;

  return (
    <span
      className={`relative flex h-4 shrink-0 items-center transition-opacity duration-200 ${
        disabled ? "opacity-45" : ""
      } ${className}`}
    >
      <motion.span
        className="absolute inset-x-0 h-1 rounded-pill bg-white/16"
        initial={false}
        animate={{ scaleY: thick }}
        transition={SPRING}
      />
      {/* The fill and the thumb move by transform, not by `width` and `left`:
          the position ticks twice a second for as long as a song plays, and a
          layout property re-laid out the bar on every frame of every spring. */}
      <motion.span
        className={`absolute inset-x-0 h-1 origin-left rounded-pill ${tone === "accent" ? "bg-accent" : "bg-ink"}`}
        initial={false}
        animate={{ scaleX: fill / 100, scaleY: thick }}
        transition={{ scaleX: held ? INSTANT : SPRING, scaleY: SPRING }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          setAsked(next);
          onChange(next);
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={() => setHeld(true)}
        onPointerUp={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onBlur={() => setHeld(false)}
        aria-label={label}
        className="peer absolute inset-0 z-10 w-full cursor-pointer opacity-0 disabled:cursor-default"
      />
      {/* A full-width track that slides by a percentage of its own width,
          which is the bar's width: the thumb sits at its left edge. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 flex h-3 items-center peer-focus-visible:*:ring-2 peer-focus-visible:*:ring-accent"
        initial={false}
        animate={{ x: `${fill}%` }}
        // **The position follows the pointer; the size does not.** The thumb
        // growing under the hand is a decoration and it springs. The position
        // is the control itself, and it is where the mouse is.
        transition={held ? INSTANT : SPRING}
      >
        {/* The beat: a glow that swells with the pulse, and the waves a kick sends out. */}
        <motion.span
          className="absolute size-3 -translate-x-1/2 rounded-pill bg-ink"
          style={{ scale: glowScale, opacity: glowOpacity }}
        />
        {Array.from({ length: WAVES }, (_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed pool of identical rings, never reordered.
            key={i}
            ref={(el) => {
              waves.current[i] = el;
            }}
            className="absolute size-3 -translate-x-1/2 rounded-pill border border-ink opacity-0"
          />
        ))}
        {/* A frost halo that opens under the hand and widens while held. */}
        <motion.span
          className="absolute size-3 -translate-x-1/2 rounded-pill bg-ink/20"
          initial={false}
          animate={{ scale: held ? 2.8 : hovered && !disabled ? 2.1 : 1, opacity: active ? 1 : 0 }}
          transition={SPRING}
        />
        <motion.span
          className="size-3 -translate-x-1/2 rounded-pill bg-ink shadow-[0_1px_4px_rgb(0_0_0/0.55)]"
          initial={false}
          animate={{ scale }}
          transition={SPRING}
        />
      </motion.span>
    </span>
  );
}
