import { Play, X } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";
import type { StringKey } from "../lib/i18n";
import { SPRING, SPRING_SHEET } from "../lib/motion";
import {
  coverImage,
  type DjNarration,
  formatDuration,
  type Track,
  trackArtists,
  trackRowKeys,
} from "../lib/spotify";
import { useRowWindow } from "../lib/useRowWindow";
import { DjArtwork } from "./DjArtwork";

type QueuePanelProps = {
  t: Record<StringKey, string>;
  /** What the backend is holding, or null when nothing is loaded. */
  playing: Track | null;
  /** In the order it will actually be played. */
  upNext: Track[];
  /**
   * What the DJ said before its first song.
   *
   * **It is text, and the voice is somewhere else.** The narration's audio is
   * asked for by the backend and played through the same output as the music,
   * so the DJ is heard; what comes here is the line, as words, so it can also
   * be read. The two are the same sentence.
   */
  narration?: DjNarration | null;
  /**
   * The DJ, while it is talking.
   *
   * **It takes the "now playing" slot, not a place in the queue.** While the DJ
   * speaks, the panel says what is sounding —the DJ— and says nothing about
   * what comes after: the list of what is next is the spoiler, and the
   * greeting is supposed to be a surprise.
   */
  dj?: { speaker: string | null; line: string | null } | null;
  /**
   * The queue is the DJ's session, not a list.
   *
   * **A station has no "next up".** The DJ keeps choosing, so what is coming
   * is not decided yet, and a panel that shows it is telling the user what
   * the DJ has not said. Spotify, for the DJ, has no such section either.
   */
  station?: boolean;
  /**
   * Whether the player bar is on screen.
   *
   * **The panel stops where the bar begins.** The bar floats over the bottom
   * of the window and spans the whole width, so a queue that kept going down
   * would end up behind it. When the bar is not there, the panel goes down to
   * the window's own inset: that space is the queue's, not empty ground.
   */
  barPresent: boolean;
  onPlay: (track: Track) => void;
  onClose: () => void;
};

/**
 * Real cover art, or an empty frame — never a generated gradient. See the note on
 * `PlayerBar`'s cover: a colour invented from nothing is a claim that there is
 * artwork there.
 */
function Cover({ track, className }: { track: Track; className: string }) {
  const cover = coverImage(track.album?.images);
  if (!cover) {
    return <span className={`${className} bg-white/8`} aria-hidden />;
  }
  return (
    <span className={`${className} overflow-hidden`}>
      <img src={cover.url} alt="" loading="lazy" className="size-full object-cover" />
    </span>
  );
}

/**
 * The play queue.
 *
 * Docks to the right edge, mirroring the library rail — same inset, same radius,
 * same glass. It used to become a full-bleed sheet below `lg`, on the reasoning
 * that there was no room for a column beside the content: at that width there was
 * room for *this* column, and none of it, because a sheet that covers the window is
 * not a queue you read while the music plays. 240px at the app's own 768px minimum
 * leaves the content 340px, which is narrow, and the close button is right there.
 *
 * Two sections, because the queue is a history as much as a plan: what is
 * sounding, and what follows. Their order is the only reason to read it top to
 * bottom.
 *
 * **The DJ's session has one of the two.** What follows is not decided yet when
 * the DJ is choosing, so a station does not get a "next up" section —and a
 * panel that shows it is telling the user what the DJ has not said.
 *
 * "Recently played" is not here yet. The backend cannot report it, and a
 * heading over an empty list is a promise the app cannot keep: the space is
 * better spent on something that is true.
 */
export function QueuePanel({
  t,
  playing,
  upNext,
  narration,
  dj,
  station,
  barPresent,
  onPlay,
  onClose,
}: QueuePanelProps) {
  const rowKeys = trackRowKeys(upNext);
  const nextRef = useRef<HTMLUListElement>(null);
  const { first, last, pitch } = useRowWindow(nextRef, upNext.length);

  return (
    <motion.aside
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={SPRING_SHEET}
      role="dialog"
      aria-label={t.queue}
      className={`glass-sheet pointer-events-auto absolute top-[104px] right-5 ${barPresent ? "bottom-[144px]" : "bottom-5"} z-30 flex w-[240px] flex-col overflow-hidden rounded-card transition-[bottom] duration-300 ease-[var(--ease-glass)]`}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="truncate text-[15px] font-semibold tracking-tight">{t.queue}</h2>
        <motion.button
          type="button"
          onClick={onClose}
          whileTap={{ scale: 0.9 }}
          transition={SPRING_SHEET}
          aria-label={t.close}
          title={t.close}
          className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
        >
          <X className="size-[17px]" strokeWidth={2} />
        </motion.button>
      </header>

      {/* `pr-3` is the gap between the covers and the thumb; see the same note in
          LibrarySidebar. The panel's own padding is on the header above. */}
      <div className="flex flex-col gap-5 overflow-y-auto px-2 pr-3 pb-4">
        {/*
            The DJ's line lives in the "now playing" row while it talks, so the
            block above —which belongs to a song— steps aside. Otherwise the
            same sentence is on screen twice.
        */}
        {!dj && narration && <Narration narration={narration} />}

        <Section label={t.queueNowPlaying}>
          {dj ? (
            <NowPlayingDj dj={dj} t={t} />
          ) : playing ? (
            <NowPlaying track={playing} />
          ) : (
            <Empty t={t} />
          )}
        </Section>

        {/*
            The list of what comes next, and the DJ's session does not have one.

            **The spoiler is the list.** The greeting is meant to be a surprise,
            and a panel that shows the songs of the set before they start is the
            opposite of that. A station has no "next up": the DJ keeps choosing,
            so what comes is not decided yet.
        */}
        {!station && (
          <Section label={t.queueNextUp} listRef={nextRef}>
            {upNext.length > 0 ? (
              <>
                {first > 0 && <li style={{ height: first * pitch }} aria-hidden />}
                {upNext.slice(first, last).map((track, offset) => (
                  <QueueRow
                    key={rowKeys[first + offset]}
                    track={track}
                    position={first + offset + 1}
                    onPlay={onPlay}
                  />
                ))}
                {last < upNext.length && (
                  <li style={{ height: (upNext.length - last) * pitch }} aria-hidden />
                )}
              </>
            ) : (
              <Empty t={t} />
            )}
          </Section>
        )}
      </div>
    </motion.aside>
  );
}

function Section({
  label,
  children,
  listRef,
}: {
  label: string;
  children: React.ReactNode;
  listRef?: React.Ref<HTMLUListElement>;
}) {
  return (
    <section>
      <h3 className="px-2 pb-1.5 text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
        {label}
      </h3>
      <ul ref={listRef} className="flex flex-col gap-0.5">
        {children}
      </ul>
    </section>
  );
}

/**
 * What the DJ said.
 *
 * Above the queue and not inside it, because it is not one of the songs: it is
 * the reason those songs are the ones that are playing. The speaker's name is
 * in the small caps the section labels use, and the line below it is the DJ's
 * own words — which is all that came back from the service, and all this
 * shows.
 */
function Narration({ narration }: { narration: DjNarration }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      aria-label={narration.speaker}
    >
      <h3 className="px-2 pb-1.5 text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
        {narration.speaker}
      </h3>
      <blockquote className="rounded-[14px] bg-white/6 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink-muted">
        {narration.line}
      </blockquote>
    </motion.section>
  );
}

/**
 * The DJ, in the row that says what is sounding.
 *
 * **The same slot the song has, and the same shape.** What is sounding right
 * now is the DJ, so the row shows the DJ: its drawing where the cover goes,
 * its name where the title goes, and the sentence it is saying where the
 * artist goes.
 */
function NowPlayingDj({
  dj,
  t,
}: {
  dj: { speaker: string | null; line: string | null };
  t: Record<StringKey, string>;
}) {
  return (
    <li>
      <div className="flex items-center gap-3 rounded-[14px] bg-white/6 px-2 py-2">
        <span className="relative size-11 shrink-0 overflow-hidden rounded-[10px]">
          <DjArtwork />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">
            {dj.speaker ?? t.djSpeaker}
          </span>
          <span className="block truncate text-[12.5px] text-ink-muted">
            {dj.line ?? t.djSpeaking}
          </span>
        </span>
      </div>
    </li>
  );
}

function NowPlaying({ track }: { track: Track }) {
  return (
    <li>
      <div className="flex items-center gap-3 rounded-[14px] bg-white/6 px-2 py-2">
        <span className="relative size-11 shrink-0 rounded-[10px]">
          <Cover track={track} className="absolute inset-0 size-full rounded-[10px]" />
          {/* The same reserved coral that marks the sounding row in the track
              list. One meaning, one colour, everywhere. */}
          <motion.span
            className="absolute bottom-1.5 left-1.5 size-2 rounded-pill bg-live shadow-sm shadow-black/50"
            animate={{ scale: [1, 1.35, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">{track.name}</span>
          <span className="block truncate text-[12.5px] text-ink-muted">{trackArtists(track)}</span>
        </span>
      </div>
    </li>
  );
}

/** About as many rows as the panel shows when it opens. */
const ENTRANCE_ROWS = 14;

function QueueRow({
  track,
  position,
  onPlay,
}: {
  track: Track;
  position?: number;
  onPlay: (track: Track) => void;
}) {
  return (
    <motion.li
      data-row
      // Only the rows the panel opens onto slide in. With a long playlist every
      // row had its own spring, hundreds at once, and opening the queue dropped
      // to 25 fps for rows nobody could see yet.
      initial={(position ?? 0) <= ENTRANCE_ROWS ? { opacity: 0, x: 8 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...SPRING, delay: 0.02 * (position ?? 0) }}
    >
      <button
        type="button"
        onClick={() => onPlay(track)}
        className="group flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors duration-200 hover:bg-white/6"
      >
        {position !== undefined ? (
          <span className="tabular w-3 shrink-0 text-[12px] text-ink-faint">{position}</span>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        <span className="relative size-9 shrink-0 rounded-[9px]">
          <Cover track={track} className="absolute inset-0 size-full rounded-[9px]" />
          <span className="absolute inset-0 grid place-items-center rounded-[9px] bg-ground/55 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <Play className="size-3.5 translate-x-px fill-ink text-ink" strokeWidth={0} />
          </span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{track.name}</span>
          <span className="block truncate text-[12px] text-ink-muted">{trackArtists(track)}</span>
        </span>

        <span className="tabular shrink-0 text-[12px] text-ink-faint">
          {formatDuration(track.duration_ms)}
        </span>
      </button>
    </motion.li>
  );
}

function Empty({ t }: { t: Record<StringKey, string> }) {
  return <li className="px-2 py-1.5 text-[12.5px] text-ink-faint">{t.queueEmpty}</li>;
}
