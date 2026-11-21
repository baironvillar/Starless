import { AnimatePresence, motion } from "motion/react";
import type { Background, Effects } from "../lib/spotify";
import { CursorGlow } from "./CursorGlow";

/** "Suave" is half the frost, not a dimmer bloom of its own: same light, less of it. */
const BLOOM_OPACITY = { normal: 1, soft: 0.5, off: 0 } as const;

/**
 * Where the bloom sits. Every shape is the same two greys, Bone and silver, so
 * changing it moves the light and never brings hue back (DESIGN.md). `top` is
 * the one the app shipped with, byte for byte.
 */
const BLOOM_SHAPES = {
  top: [
    "radial-gradient(90% 70% at 50% -6%, rgb(var(--bloom-a) / 0.24) 0%, transparent 64%)",
    "radial-gradient(70% 70% at 104% 108%, rgb(var(--bloom-b) / 0.18) 0%, transparent 60%)",
    "radial-gradient(60% 60% at -6% 96%, rgb(var(--bloom-a) / 0.10) 0%, transparent 60%)",
  ],
  corners: [
    "radial-gradient(65% 65% at -4% -6%, rgb(var(--bloom-a) / 0.22) 0%, transparent 62%)",
    "radial-gradient(65% 65% at 104% 106%, rgb(var(--bloom-b) / 0.20) 0%, transparent 62%)",
  ],
  center: [
    "radial-gradient(60% 55% at 50% 46%, rgb(var(--bloom-a) / 0.16) 0%, transparent 70%)",
    "radial-gradient(110% 90% at 50% 50%, rgb(var(--bloom-b) / 0.07) 0%, transparent 72%)",
  ],
  side: [
    "radial-gradient(55% 95% at -8% 40%, rgb(var(--bloom-a) / 0.24) 0%, transparent 64%)",
    "radial-gradient(40% 60% at 104% 100%, rgb(var(--bloom-b) / 0.10) 0%, transparent 60%)",
  ],
} as const;

/** The blur slider's 0..100 onto pixels. Past 40 the picture is only its colours. */
export const BACKGROUND_BLUR_PX = 40;

/**
 * The ground: the person's picture, the bloom, the grain and the light that follows
 * the pointer, in that order. A component because it is drawn twice — see
 * `EdgeFade`.
 */
export function Ground({
  url,
  background,
  effect,
}: {
  url: string | null;
  background: Background;
  effect: Effects;
}) {
  return (
    <>
      {url && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {/*
            Scaled past the window so the blur has picture to pull from at the
            edges: blurred at its own size, the border fades to the black under
            it and the photo gets a dark frame nobody chose.

            Keyed by the picture so a new song's cover fades in over the last one
            once, instead of snapping. It is a single fade per song, not motion
            under the glass — DESIGN.md's rule is about backdrops that never stop.
          */}
          <AnimatePresence initial={false}>
            <motion.div
              key={url}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0 bg-cover bg-center"
              style={{
                backgroundImage: `url(${url})`,
                filter:
                  background.blur > 0
                    ? `blur(${(background.blur / 100) * BACKGROUND_BLUR_PX}px)`
                    : undefined,
                scale: background.blur > 0 ? 1.08 : 1,
              }}
            />
          </AnimatePresence>
          <div className="absolute inset-0 bg-ground" style={{ opacity: background.dim / 100 }} />
        </div>
      )}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-[var(--dur-panel)]"
        style={{
          opacity: BLOOM_OPACITY[effect.bloom],
          background: BLOOM_SHAPES[effect.shape].join(", "),
        }}
      />
      {effect.grain === "on" && <div aria-hidden="true" className="grain" />}
      {effect.glow === "on" && <CursorGlow />}
    </>
  );
}

/**
 * The fade at the content's top and bottom edges, while the surfaces frost.
 *
 * **The mask cannot do it then.** A mask on `<main>` makes it a backdrop root, so
 * every frosted card and tile inside it would blur nothing, and `index.css` takes
 * the mask away above 6%. That left the list cut in a straight line under the top
 * bar and above the player, between two panels whose corners are round.
 *
 * So the fade is painted over the content instead of cut out of it: a strip at each
 * edge draws the ground again, window-aligned, under a gradient. Where the strip is
 * opaque the content is covered by the same ground that is behind it, which reads
 * exactly like the content fading out. The strips are siblings of `<main>`, so
 * nothing inside it loses its blur. They sit under the rail, the queue and the bars
 * (z-20 and up), which cover the rest of each strip's width.
 *
 * The inner layer moves opposite to its strip with the same transition, so the
 * ground copy stays on the window's pixels while the bottom strip follows the bar.
 */
export function EdgeFade({
  below,
  barPresent,
  left,
  right,
  ...ground
}: {
  below: boolean;
  barPresent: boolean;
  /** The content column's own edges, in px, so the strip never leaves it. */
  left: number;
  right: number;
  url: string | null;
  background: Background;
  effect: Effects;
}) {
  // Only the bottom: the top edge sits under the top bar, whose own surface hides
  // the cut, and a second strip there painted the ground twice in the corners.
  //
  // **The strip is as wide as `<main>`, not the window.** Full width, it also
  // covered the gutters and the rounded corners of the rail and the queue, and the
  // ground drawn over the ground doubles its dim, bloom and grain wherever the
  // gradient is half-opaque: a darker band with nothing under it to hide.
  const slide =
    "transition-[bottom,left,right,opacity] duration-[var(--dur-panel)] ease-[var(--ease-glass)]";
  const bottom = barPresent ? 144 : 20;
  return (
    <div
      aria-hidden="true"
      className={`edge-fade edge-fade-bottom pointer-events-none absolute z-[15] h-11 overflow-hidden ${slide} ${below ? "" : "opacity-0"}`}
      style={{ bottom, left, right }}
    >
      {/*
          **`bg-ground` is the strip's floor, and without it there is no fade.**
          `Ground` is only what sits *on* the window's `bg-ground`: the picture
          (when there is one), the bloom and the grain, all of them translucent
          without a picture. Copied alone, the strip covered nothing, so with no
          picture the list was cut flat over the player. The test in
          `Ground.test.tsx` fixes it.
      */}
      <div
        data-edge-floor=""
        className={`absolute h-screen bg-ground ${slide}`}
        style={{ bottom: -bottom, left: -left, width: "100vw" }}
      >
        <Ground {...ground} />
      </div>
    </div>
  );
}
