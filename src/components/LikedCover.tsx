import { useId } from "react";

/**
 * Liked Songs' face, drawn in the logo's language.
 *
 * **The same materials as the Starless mark.** A dark glass plate, the mark's
 * ring with its fading glass gradient, and in the middle a heart lit from
 * inside: the accent under glass, blurred into a glow behind it, with a white
 * specular along its top. Spotify sends no cover for Liked Songs, and the old
 * flat accent square with a black heart was the one surface in the app that
 * looked like it came from somewhere else.
 *
 * **The heart is the accent, read live.** It fills with `--color-accent`, so a
 * colour picked in Settings repaints it with everything else and nothing here
 * has to listen for it. The plate and the ring stay grey on purpose: the
 * accent is the one warm light, as it is in the brand.
 *
 * One drawing for every size it is shown at (36px in the list, the grid tile,
 * 232px at the top of the screen), so the ring stays at the logo's 5% of the
 * width and the heart reads at the smallest of them. `useId` keeps the
 * gradients of two copies on screen from resolving to each other.
 */
export function LikedCover({ className = "" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  const plate = `${id}-plate`;
  const haze = `${id}-haze`;
  const ring = `${id}-ring`;
  const shine = `${id}-shine`;
  const glow = `${id}-glow`;
  const sheen = `${id}-sheen`;

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className={`block size-full ${className}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={plate} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24242C" />
          <stop offset="1" stopColor="#0B0B0F" />
        </linearGradient>
        {/* The accent under the glass: a low warm light the plate sits over. */}
        <radialGradient id={haze} cx="0.5" cy="0.62" r="0.55">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="0.32" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ring} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="0.45" stopColor="#C4C1C8" stopOpacity="0.35" />
          <stop offset="0.75" stopColor="#FFFFFF" stopOpacity="0.08" />
          <stop offset="1" stopColor="#DAD7DD" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={sheen} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.1" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      <rect width="100" height="100" fill={`url(#${plate})`} />
      <rect width="100" height="100" fill={`url(#${haze})`} />
      {/* The sheen on the top half of the glass, as on the app icon. */}
      <rect width="100" height="100" fill={`url(#${sheen})`} />

      <circle cx="50" cy="50" r="36" fill="none" stroke={`url(#${ring})`} strokeWidth="4" />

      <path d={HEART} fill="var(--color-accent)" opacity="0.7" filter={`url(#${glow})`} />
      <path d={HEART} fill="var(--color-accent)" />
      <path d={HEART} fill={`url(#${shine})`} />
      <path d={HEART} fill="none" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="0.8" />
    </svg>
  );
}

const HEART =
  "M50 69 C 50 69, 30 57, 30 43.5 C 30 36, 35.5 31, 42 31 C 45.8 31, 48.6 33.2, 50 36.4 C 51.4 33.2, 54.2 31, 58 31 C 64.5 31, 70 36, 70 43.5 C 70 57, 50 69, 50 69 Z";
