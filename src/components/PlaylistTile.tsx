import { motion } from "motion/react";

import { SPRING } from "../lib/motion";

type PlaylistTileProps = {
  title: string;
  imageUrl?: string | null;
  /**
   * Stands in for the cover when there is none to show.
   *
   * Liked Songs has no artwork and is not going to get any — Spotify does not send
   * one — so in the grid it gets the accent square it has always had in the row,
   * filling the same tile. That is also why the tile takes a node and not a colour:
   * the accent is already a decision this app made about that one entry, and
   * inventing a picture to fill the gap would be inventing a colour too.
   */
  artwork?: React.ReactNode;
  /** The ring and the tint: this is the one you are looking at right now. */
  active: boolean;
  onOpen: () => void;
  onPrefetch?: () => void;
};

/**
 * One playlist as a cover in the rail's grid view — and Liked Songs with it.
 *
 * **Two columns, and the name underneath, is what 240px allows.** One column is the
 * riel and the rail already has one; three columns leaves 69px, and a playlist name
 * at that width is three dots and a tooltip. Two leaves a 106px cover, which is big
 * enough to recognise the artwork — which is what the artwork is for — and enough
 * room under it for two lines of name, which covers everything except the titles that
 * really are sentences.
 *
 * The name wraps to a second line instead of being cut at one: a truncated title in
 * a grid is worse than a short one, because the grid promises you can see what is
 * there.
 *
 * No song count, same as the row it replaces: the rail is for finding the playlist,
 * and the number is one more line to read past. `Inicio` shows the count because it
 * is there to be read.
 *
 * The whole tile is one `<button>` — same reasoning as `LibrarySidebar`'s rows: a
 * cover with a name under it has no play control to nest, so the tile is the target.
 */
export function PlaylistTile({
  title,
  imageUrl,
  artwork,
  active,
  onOpen,
  onPrefetch,
}: PlaylistTileProps) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      title={title}
      aria-label={title}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: 0.02 }}
      className={`group/tile flex w-full flex-col items-center gap-1.5 rounded-[12px] p-1 transition-colors duration-200 ${
        active ? "bg-white/12" : "hover:bg-white/6"
      }`}
    >
      <span
        className={`relative aspect-square w-full overflow-hidden rounded-[10px] bg-white/8 transition-shadow duration-200 ${
          active ? "ring-2 ring-accent" : ""
        }`}
      >
        {artwork ? (
          // Centred here rather than by the caller: what goes in the square is a
          // drawing, not a layout, and two callers centring it two different ways is
          // two ways for it to sit one pixel off.
          <span className="absolute inset-0 grid place-items-center">{artwork}</span>
        ) : (
          imageUrl && (
            <img
              src={imageUrl}
              alt=""
              loading="lazy"
              className="pointer-events-none absolute inset-0 size-full object-cover transition-transform duration-300 group-hover/tile:scale-[1.03]"
            />
          )
        )}
      </span>

      <span className="line-clamp-2 w-full text-center text-[11.5px] leading-[14px] font-medium">
        {title}
      </span>
    </motion.button>
  );
}
