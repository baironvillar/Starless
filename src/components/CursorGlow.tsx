import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useEffect } from "react";

/** Wider than the window's short side, so the light reads as a glow and not a spotlight. */
const SIZE = 900;

/**
 * A pool of frost light that trails the pointer, over the static bloom.
 *
 * **This bends a rule of DESIGN.md on purpose, because the user asked for it:**
 * a backdrop that moves under blurred glass makes the glass re-sample. It is
 * kept as cheap as it can be: one fixed-size layer moved by `transform` only
 * (never its gradient or size), outside React's render (motion values), and it
 * only moves while the pointer does. With reduced motion it is not drawn.
 */
export function CursorGlow() {
  const reduced = useReducedMotion();
  const x = useMotionValue(window.innerWidth / 2);
  const y = useMotionValue(window.innerHeight / 3);
  // Soft and a little behind the hand: the light drifts after the pointer.
  const sx = useSpring(x, { stiffness: 70, damping: 20 });
  const sy = useSpring(y, { stiffness: 70, damping: 20 });

  useEffect(() => {
    if (reduced) return;
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [reduced, x, y]);

  if (reduced) return null;

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 rounded-pill will-change-transform"
      style={{
        width: SIZE,
        height: SIZE,
        marginLeft: -SIZE / 2,
        marginTop: -SIZE / 2,
        x: sx,
        y: sy,
        background: "radial-gradient(closest-side, rgb(237 234 227 / 0.16), transparent)",
      }}
    />
  );
}
