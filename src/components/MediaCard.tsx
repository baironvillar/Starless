import { Loader2, Play } from "lucide-react";
import { motion } from "motion/react";
import { SPRING } from "../lib/motion";
import { coverImage, type Image } from "../lib/spotify";

type MediaCardProps = {
  title: string;
  /** Artist, owner, year — whatever this particular card is actually about. */
  subtitle?: string | null;
  /**
   * The picture, when the card has one.
   *
   * Optional because the card can have a drawing instead —see `art`— and a card
   * with neither is an empty frame, which is the honest answer for a cover the
   * service did not send.
   */
  imageUrl?: string | null;
  /**
   * The card's own drawing, for the cards that have one instead of a photo.
   *
   * **The DJ is the case, and it is not a decoration.** Spotify draws the card
   * for the DJ —its own blue and its jellyfish— and sends no cover for it, so a
   * card that only knew how to show a picture drew an empty square where the DJ
   * is. The drawing goes in the same place the picture would go: under the
   * button, over the frame, and it never takes the click, which belongs to the
   * card.
   */
  art?: React.ReactNode;
  /**
   * Round for people, square for everything else.
   *
   * A circle is how a face is recognised; rounding an album cover would break the
   * shape the artwork was composed as. One prop rather than two components,
   * because the two differ in nothing else.
   */
  round?: boolean;
  /** Present only where playing is real. Absent means "this card opens something". */
  onPlay?: () => void;
  onOpen?: () => void;
  /**
   * What the card's own button does, for a screen reader.
   *
   * The title is the default because a card that opens something is named by
   * what it opens. A card that *plays* is not: the name of a DJ is "DJ", and a
   * button labelled "DJ" says nothing about what pressing it does.
   */
  openLabel?: string;
  /**
   * Called when the card is approached, to fetch what opening it would need.
   *
   * On the card itself rather than on a wrapper: a `<div>` carrying a mouse
   * handler is a static element pretending to be interactive, and the one thing it
   * could offer a keyboard is prefetch it does not need.
   */
  onPrefetch?: () => void;
  /** A play is on its way: the button becomes a spinner and stops taking clicks. */
  busy?: boolean;
  /**
   * The play button's own label, passed in because this component has no `t`.
   *
   * An `aria-label` is read aloud by a screen reader, which makes it copy like
   * any other string, and PRODUCT.md ships both languages together. Hard-coding
   * "reproducir" here would leave an English build half translated in the one
   * place a blind user is guaranteed to meet.
   */
  playLabel: string;
  /** `Artista`, `Album`, `2026` — the small line above the title. */
  eyebrow?: string;
  /** Width when the card sits on a scrolling shelf instead of a grid. */
  className?: string;
};

/**
 * One card in a grid or on a shelf.
 *
 * The play button is an optional prop rather than always-drawn decoration: an
 * album can be played, but a playlist found in a search usually cannot — Spotify
 * refuses the contents of a playlist the account neither owns nor collaborates on
 * — and a play button that opens a 403 is worse than no button at all. A card
 * with `onPlay` gets the hover button; a card with `onOpen` gets a pointer and a
 * title that says what happens.
 *
 * Nothing here invents a colour for missing artwork. A cover Spotify did not send
 * is an empty frame, and a generated one would be the only invented thing on the
 * screen.
 */
export function MediaCard({
  title,
  subtitle,
  imageUrl,
  art,
  round = false,
  onPlay,
  onOpen,
  openLabel,
  onPrefetch,
  busy = false,
  eyebrow,
  playLabel,
  className = "",
}: MediaCardProps) {
  const interactive = Boolean(onPlay || onOpen);
  const radius = round ? "rounded-full" : "rounded-[10px]";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: 0.02 }}
      whileHover={interactive ? { y: -4 } : undefined}
      onPointerEnter={onPrefetch}
      onFocusCapture={onPrefetch}
      className={`group/card relative ${className}`}
    >
      {/*
        The cover is a real button and the picture sits on top of it.

        Two things force this shape. A `div` with `role="button"` and a click
        handler is a button that does not come with Enter, Space or a focus ring;
        and the play control inside it would be a button nested in a button, which
        is invalid and which browsers resolve in ways nobody designed. So the
        hit area is a button, the artwork is a pointer-transparent layer over it,
        and the play button is a sibling on top of both.
      */}
      <div className={`relative aspect-square overflow-hidden ${radius} bg-white/8`}>
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={openLabel ?? title}
            className="absolute inset-0 size-full cursor-pointer rounded-[inherit] outline-offset-2"
          />
        )}

        {art ? (
          // The drawing is a layer, not a picture: it goes where the picture would
          // go and it lets the click through to the card underneath.
          <span className="pointer-events-none absolute inset-0">{art}</span>
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            className="pointer-events-none absolute inset-0 size-full object-cover transition-transform duration-300 group-hover/card:scale-[1.03]"
          />
        ) : null}

        {/*
          An accent disc floating on a bright cover loses its edge, so it carries its
          own shadow rather than relying on the artwork behind it.
        */}
        {onPlay && (
          <motion.button
            type="button"
            onClick={onPlay}
            disabled={busy}
            whileTap={{ scale: 0.9 }}
            transition={SPRING}
            aria-label={`${playLabel} — ${title}`}
            title={`${playLabel} — ${title}`}
            // Hidden until the card is approached, but still reachable by keyboard.
            // A pending play stays visible: the click registered, and hiding the
            // only feedback the card has would read as a dead button.
            className={`absolute right-2 bottom-2 z-10 grid size-10 place-items-center rounded-pill bg-accent text-on-accent shadow-[0_6px_16px_-4px_rgba(0,0,0,0.8)] transition-opacity duration-200 ${
              busy
                ? "opacity-100"
                : "opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100"
            }`}
          >
            {busy ? (
              <Loader2 className="size-[18px] animate-spin" strokeWidth={2.5} />
            ) : (
              <Play className="size-[18px] translate-x-px fill-current" strokeWidth={0} />
            )}
          </motion.button>
        )}
      </div>

      {eyebrow && (
        <p className="mt-3 truncate text-[11.5px] font-semibold tracking-wide uppercase text-ink-faint">
          {eyebrow}
        </p>
      )}
      <p
        className={`mt-0.5 truncate text-[13.5px] font-semibold transition-colors duration-200 ${
          onOpen ? "group-hover/card:text-accent" : ""
        } ${round ? "text-center" : ""}`}
      >
        {title}
      </p>
      {subtitle && (
        <p className={`truncate text-[12.5px] text-ink-muted ${round ? "text-center" : ""}`}>
          {subtitle}
        </p>
      )}
    </motion.div>
  );
}

/** The picture for a card, or nothing at all — never a stand-in. */
export function cardImage(images: Image[] | null | undefined): string | null {
  return coverImage(images)?.url ?? null;
}
