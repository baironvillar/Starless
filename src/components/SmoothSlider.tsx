import { motion } from "motion/react";
import { useState } from "react";
import { SPRING } from "../lib/motion";

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
  const fill = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
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
        transition={SPRING}
      />
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
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
        transition={SPRING}
      />
    </span>
  );
}
