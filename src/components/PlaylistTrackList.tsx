import { Clock, Play } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import {
  type Album,
  type Artist,
  coverImage,
  formatAddedAt,
  formatDuration,
  type Track,
  type TrackListView,
  trackRowKeys,
} from "../lib/spotify";
import { useRowWindow } from "../lib/useRowWindow";
import { ArtistLine } from "./ArtistLine";

/**
 * How tall a row is. `list` carries the cover and puts the artist under the
 * title; `compact` drops the cover and puts both on one line, so a long playlist
 * fits about twice the songs on screen.
 */
export type { TrackListView };

type PlaylistTrackListProps = {
  tracks: Track[];
  view?: TrackListView;
  t: Record<StringKey, string>;
  /** Decides the shape of the date column — see `formatAddedAt`. */
  lang: string;
  nowPlayingId?: string | null;
  loadingId?: string | null;
  failedId?: string | null;
  onPlay: (track: Track) => void;
  loading?: boolean;
  error?: string | null;
  empty?: string | null;
  /** Says nothing matched the search, rather than that the playlist is empty. */
  noMatches?: string | null;
  /** The row's extras: the artist's name opens their page. */
  onOpenArtist?: (artist: Artist) => void;
  /** The row's extras: the album's name opens its page. */
  onOpenAlbum?: (album: Album) => void;
  /** The row's extras: the three dots. Absent and the column is not drawn. */
  trackMenu?: (track: Track) => React.ReactNode;
};

/**
 * How the rows arrive, and — the part that matters — where the stagger stops.
 *
 * Copied from `TrackList` rather than reinvented, and for the reason that copy
 * documents: an uncapped delay makes row 198 wait five seconds at `opacity: 0`,
 * which is a list with holes in it and not an entrance.
 */
const STAGGER_STEP = 0.03;
const STAGGER_CAP = 12;

/**
 * The songs of a playlist, laid out the way the client everyone already knows
 * lays them out.
 *
 * **Five columns, and the album one earns its width here.** `NumberedTrackList`
 * hides the album when every song comes from one record, and hides it by name.
 * That is the wrong trade inside a playlist: a playlist is *made of* several
 * records, and "which one" is half of what you are looking at. Three of the four
 * accounts on this list can answer "I added that in August" without leaving the
 * row, which is the whole point of a row.
 *
 * The date is real and it is per row. `added_at` arrives from
 * `ItemAttributes.timestamp` — see `spclient::playlist_tracks` — and belongs to
 * the *entry in this list*, not to the song: the same song added to three
 * playlists was added three days. When a row has none it says so with a dash
 * instead of borrowing a date from somewhere else, which is the failure mode this
 * column is most able to produce and the one a sort by "date added" would punish.
 *
 * The number is the affordance, and it changes colour rather than moving: the row
 * that is sounding has its number, its title and its equalizer mark in the live
 * accent, so the eye finds the row it is listening to without the row moving.
 */
export function PlaylistTrackList({
  tracks,
  view = "list",
  t,
  lang,
  nowPlayingId,
  loadingId,
  failedId,
  onPlay,
  loading,
  error,
  empty,
  noMatches,
  onOpenArtist,
  onOpenAlbum,
  trackMenu,
}: PlaylistTrackListProps) {
  const rowKeys = trackRowKeys(tracks);
  const compact = view === "compact";
  const rowsRef = useRef<HTMLDivElement>(null);
  const { first, last, pitch } = useRowWindow(rowsRef, tracks.length, view);
  /**
   * Header and rows share one template string, always. They did not once: the
   * rows gained the album and date columns in one change and the header was left
   * with three labels over a five-column grid, which pushed every label one slot
   * left of the thing it names.
   *
   * The last slot exists only when the caller asked for the three dots. A column
   * with nothing in it — an empty 40px of ground on every row — is not a
   * placeholder, it is a dent in the table.
   */
  const columns = `40px minmax(0,2.4fr) minmax(0,1.2fr) minmax(0,0.9fr) 64px${
    trackMenu ? " 40px" : ""
  }`;

  return (
    <div className="overflow-hidden rounded-card border border-white/8 bg-white/4">
      <div
        className="grid items-center gap-4 border-b border-white/8 px-4 py-2.5"
        style={{ gridTemplateColumns: columns }}
      >
        <span className="text-right text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          #
        </span>
        <span className="text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          {t.columnTitle}
        </span>
        <span className="text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          {t.columnAlbum}
        </span>
        <span className="text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          {t.columnAdded}
        </span>
        <span className="grid justify-end text-ink-faint" title={t.columnTime}>
          <span className="sr-only">{t.columnTime}</span>
          <Clock className="size-4" strokeWidth={2} aria-hidden />
        </span>
        {trackMenu && <span />}
      </div>

      {loading && <Note>{t.loading}</Note>}
      {error && !loading && <Note tone="warn">{error}</Note>}

      {!loading && !error && (
        <div ref={rowsRef}>
          {first > 0 && <div style={{ height: first * pitch }} aria-hidden />}
          {tracks.slice(first, last).map((track, offset) => {
            const index = first + offset;
            const isPlaying = track.id === nowPlayingId;
            const isLoading = track.id === loadingId;
            const isFailed = track.id === failedId;
            const cover = coverImage(track.album?.images);
            const album = track.album;
            const addedAt = formatAddedAt(track.added_at, lang);

            return (
              <motion.div
                key={rowKeys[index]}
                role="button"
                tabIndex={0}
                onClick={() => onPlay(track)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  onPlay(track);
                }}
                data-row
                // Only the rows the list opens onto come in; a row that mounts
                // because the list was scrolled to it is already there.
                initial={index < STAGGER_CAP ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: index * STAGGER_STEP }}
                className={`group grid cursor-pointer items-center gap-4 border-b border-white/8 px-4 ${
                  compact ? "py-1" : "py-2"
                } text-left transition-colors duration-200 last:border-b-0 hover:bg-white/6 ${
                  isPlaying ? "bg-white/6" : ""
                }`}
                style={{ gridTemplateColumns: columns }}
              >
                <span className="relative grid place-items-center text-right">
                  <span
                    className={`tabular text-[13px] ${
                      isFailed
                        ? "text-warn"
                        : isPlaying
                          ? "text-accent"
                          : "text-ink-faint group-hover:opacity-0"
                    } ${isLoading && !isPlaying ? "opacity-0" : ""}`}
                  >
                    {index + 1}
                  </span>

                  {/* In the exact slot the number occupied, so the hand does not have
                    to travel between reading a row and playing it. */}
                  <motion.button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlay(track);
                    }}
                    whileTap={{ scale: 0.88 }}
                    transition={SPRING}
                    aria-label={`${t.play} — ${track.name}`}
                    className={`absolute grid size-7 place-items-center rounded-pill transition-opacity duration-150 ${
                      isPlaying
                        ? "opacity-100"
                        : isFailed
                          ? "text-warn opacity-100 group-hover:opacity-0"
                          : "text-ink opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    }`}
                  >
                    {/* The one thing in the app allowed to breathe forever — and it is
                      the one thing the user is listening for. */}
                    {isPlaying ? (
                      <Equalizer />
                    ) : (
                      <Play className="size-4 fill-current" strokeWidth={0} />
                    )}
                  </motion.button>

                  {isLoading && !isPlaying && (
                    <span className="absolute size-2 animate-pulse rounded-pill bg-accent" />
                  )}
                </span>

                <div className="flex min-w-0 items-center gap-3">
                  {compact ? null : cover ? (
                    <span className="size-9 shrink-0 overflow-hidden rounded-[8px]">
                      <img
                        src={cover.url}
                        alt=""
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    </span>
                  ) : (
                    <span className="size-9 shrink-0 rounded-[8px] bg-white/8" aria-hidden />
                  )}
                  <div className={compact ? "flex min-w-0 items-baseline gap-2" : "min-w-0"}>
                    <p
                      className={`truncate text-[13.5px] font-semibold ${isPlaying ? "text-accent" : ""}`}
                    >
                      {track.name}
                    </p>
                    <ArtistLine
                      track={track}
                      onOpenArtist={onOpenArtist}
                      className="truncate text-[12.5px] text-ink-muted"
                    />
                  </div>
                </div>

                {/*
                The album, as a door.

                **The stop lives here rather than in a shared component**, because
                this column is optional and the row around it is itself a button:
                a click that opened an album and started the song at the same time
                is neither of those things. The artist's line has the same guard,
                one file over, for the same reason.
              */}
                <span className="min-w-0 truncate text-[12.5px] text-ink-muted">
                  {album && onOpenAlbum ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenAlbum(album);
                      }}
                      title={album.name}
                      className="block max-w-full truncate text-left transition-colors duration-150 hover:text-ink hover:underline"
                    >
                      {album.name}
                    </button>
                  ) : (
                    (track.album?.name ?? "—")
                  )}
                </span>

                <span className="min-w-0 truncate text-[12.5px] text-ink-muted">
                  {addedAt ?? "—"}
                </span>

                <span className="tabular text-right text-[12.5px] text-ink-muted">
                  {formatDuration(track.duration_ms)}
                </span>

                {/* The menu stops the row from firing: the dots are a control that
                  happens to sit on a row, and a click that both opened a menu and
                  started the song is not a control at all. */}
                {trackMenu?.(track)}
              </motion.div>
            );
          })}
          {last < tracks.length && (
            <div style={{ height: (tracks.length - last) * pitch }} aria-hidden />
          )}
        </div>
      )}

      {/* Two different empties, said once each. "This playlist has no songs" and
          "your filter hid all of them" are both true at once when a search runs
          over an empty list, and stacking them reads as two opinions instead of
          one screen. */}
      {!loading && !error && tracks.length === 0 && (
        <Note>{noMatches ?? empty ?? t.emptyList}</Note>
      )}
    </div>
  );
}

/**
 * The mark that says which row is sounding.
 *
 * Three bars at three heights, because a single dot is what a spinner looks like
 * and a spinner on a row that is already playing says "working". The animation
 * is the app's only loop, and DESIGN.md allows exactly one.
 *
 * **`scaleY`, not `height`.** Animating the height re-laid out the whole list
 * every frame while a song played, and the app ran at 30 fps for as long as
 * there was music. A transform is drawn by the compositor and costs nothing.
 */
function Equalizer() {
  return (
    <span className="flex h-3.5 items-end gap-[2px]" aria-hidden>
      {[0, 1, 2].map((bar) => (
        <motion.span
          key={bar}
          className="h-full w-[2px] origin-bottom rounded-pill bg-accent"
          animate={{ scaleY: [0.35, 1, 0.55] }}
          transition={{
            duration: 1.1,
            repeat: Infinity,
            ease: "easeInOut",
            delay: bar * 0.18,
          }}
        />
      ))}
    </span>
  );
}

function Note({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "warn";
}) {
  return (
    <p
      className={`border-b border-white/8 px-5 py-6 text-center text-[13px] last:border-b-0 ${
        tone === "warn" ? "text-warn" : "text-ink-faint"
      }`}
    >
      {children}
    </p>
  );
}
