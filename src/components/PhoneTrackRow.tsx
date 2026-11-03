import { motion } from "motion/react";
import { SPRING } from "../lib/motion";
import { type Artist, coverImage, type Track } from "../lib/spotify";
import { ArtistLine } from "./ArtistLine";

/**
 * A song as a row on the phone: the cover, the title over the artist, and the ⋯.
 *
 * The desktop rows are a table —number, title, album, date, time— and in a
 * screen about 360dp wide the table left the title some 40px: one letter of
 * every name. On a phone the row is what the music apps already taught: the
 * title and the artist get the whole width, and the album and the rest live in
 * the ⋯ (DESIGN.md, "The phone"). The column headers go with the columns.
 *
 * The state is said in the title's colour, as on the desktop: the live accent
 * for the song that sounds, the warning ink for one that was refused, and a
 * pulse on the cover while one loads.
 */
export function PhoneTrackRow({
  track,
  index,
  playing,
  loading,
  failed,
  onPlay,
  onOpenArtist,
  menu,
}: {
  track: Track;
  /** Its place in the list: only the first rows come in with a stagger. */
  index: number;
  playing: boolean;
  loading: boolean;
  failed: boolean;
  onPlay?: (track: Track) => void;
  onOpenArtist?: (artist: Artist) => void;
  menu?: React.ReactNode;
}) {
  const cover = coverImage(track.album?.images);
  return (
    <motion.div
      role="button"
      tabIndex={0}
      onClick={() => onPlay?.(track)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        onPlay?.(track);
      }}
      data-row
      initial={index < 12 ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: Math.min(index, 12) * 0.03 }}
      className={`flex items-center gap-3 border-b border-white/8 py-2 pr-1 pl-3 text-left last:border-b-0 active:bg-white/6 ${
        playing ? "bg-white/6" : ""
      }`}
    >
      <span className="relative size-12 shrink-0 overflow-hidden rounded-[9px] bg-white/8">
        {cover && <img src={cover.url} alt="" loading="lazy" className="size-full object-cover" />}
        {loading && !playing && (
          <span className="absolute inset-0 grid place-items-center bg-black/40">
            <span className="size-2 animate-pulse rounded-pill bg-accent" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={`truncate text-[14px] font-semibold ${
            playing ? "text-accent-ink" : failed ? "text-warn-ink" : ""
          }`}
        >
          {track.name}
        </p>
        <ArtistLine
          track={track}
          onOpenArtist={onOpenArtist}
          className="truncate text-[12.5px] text-ink-muted"
        />
      </div>
      {menu}
    </motion.div>
  );
}
