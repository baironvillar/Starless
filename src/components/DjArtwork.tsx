import { useId } from "react";

/**
 * The drawing on the account's DJ card.
 *
 * **The DJ is not a playlist with a cover, and it does not get one.** Spotify's
 * card for the DJ is drawn —its own blue field and its jellyfish— and the
 * service sends no picture for it: the library listing comes back with the
 * owner `spotify` and zero songs, and the cover that the cover-fetcher looks
 * for is not there to find. A card that only knew how to show a picture drew
 * an empty grey square where the DJ is, which is the same square a playlist
 * with a broken cover gets, and the DJ is not a broken playlist.
 *
 * **The colours are the ones the service sends.** The DJ's own metadata carries
 * the palette of its jellyfish —`narration.jellyfish.top.color` `#19E68C`,
 * `.mid.color` `#1ED7BC`, `.bottom.color` `#1E95D7`, and the card's own
 * `home.card.jellyfish_mid_color` `#CB1ED7BC`— and the field is the last of
 * those blues. They are written here as constants because the drawing has to
 * exist *before* the first mix is asked for: the card is what the user clicks,
 * and a card that only looks like a DJ after the DJ has already been started
 * is a card nobody recognises.
 *
 * **What is not here is the animation.** The client this mirrors draws the
 * jellyfish moving, and that movement is a Lottie file that this app does not
 * have and does not pretend to have. What is here is the shape it moves in.
 */
/**
 * The DJ's mark, in a single colour.
 *
 * **The same shape as the drawing, without the colour.** The card on the shelf
 * is artwork, and artwork can be the service's blue and green. A control in
 * the chrome cannot: the chrome stays in ink, and a cyan blob in the player
 * bar would be the loudest thing on screen. What is left is the ring —the
 * shape the DJ is known by— drawn in whatever colour the button is in.
 */
export function DjMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true" focusable="false">
      <circle
        cx="60"
        cy="60"
        r="38"
        fill="none"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
        strokeDasharray="212 27"
        strokeDashoffset="166"
      />
    </svg>
  );
}

export function DjArtwork({ className = "" }: { className?: string }) {
  // The gradient needs an id, and the DJ can be drawn twice —once on the shelf
  // and once in the rail— so the id has to be this one's and not a constant.
  const gradientId = useId();

  return (
    <span className={`absolute inset-0 block bg-[#1e95d7] ${className}`}>
      <svg viewBox="0 0 120 120" className="size-full" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#19e68c" />
            <stop offset="52%" stopColor="#1ed7bc" />
            <stop offset="100%" stopColor="#1e95d7" />
          </linearGradient>
        </defs>
        {/*
          The ring, with the gap at the bottom.

          The gap is the jellyfish's: the shape it is known by is a circle that
          does not quite close. It is cut out of the stroke rather than drawn
          around —a circle with a piece of it painted over— because the gap has
          to follow the gradient, and the gradient is on the stroke.
        */}
        <circle
          cx="60"
          cy="60"
          r="38"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="13"
          strokeLinecap="round"
          strokeDasharray="212 27"
          strokeDashoffset="166"
        />
      </svg>
    </span>
  );
}
