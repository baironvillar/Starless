import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { SPRING } from "../lib/motion";

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
  max,
  step = 1,
  disabled = false,
  label,
  onChange,
  tone = "accent",
  className = "w-[180px]",
}: SmoothSliderProps) {
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);

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

  const fill = max > 0 ? Math.min(100, Math.max(0, (shown / max) * 100)) : 0;
  const scale = disabled ? 1 : held ? 1.3 : hovered ? 1.15 : 1;

  return (
    <span
      className={`relative flex h-4 shrink-0 items-center transition-opacity duration-200 ${
        disabled ? "opacity-45" : ""
      } ${className}`}
    >
      <span className="absolute inset-x-0 h-1 rounded-pill bg-white/16" />
      <motion.span
        className={`absolute left-0 h-1 rounded-pill ${tone === "accent" ? "bg-accent" : "bg-ink"}`}
        initial={false}
        animate={{ width: `${fill}%` }}
        transition={held ? INSTANT : SPRING}
      />
      <input
        type="range"
        min={0}
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
      <motion.span
        aria-hidden
        className="pointer-events-none absolute size-3 rounded-pill bg-ink shadow-[0_1px_4px_rgb(0_0_0/0.55)] peer-focus-visible:ring-2 peer-focus-visible:ring-accent"
        style={{ x: "-50%" }}
        initial={false}
        animate={{ left: `${fill}%`, scale }}
        transition={{
          // **The position follows the pointer; the size does not.** The thumb
          // growing under the hand is a decoration and it springs. The
          // position is the control itself, and it is where the mouse is.
          left: held ? INSTANT : SPRING,
          scale: SPRING,
        }}
      />
    </span>
  );
}
