import { ArrowLeftRight, Maximize2, Minimize2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import { formatDuration, type Lyrics, seekPlayback } from "../lib/spotify";
import { isMobile } from "../lib/version";

type LyricsPanelProps = {
  t: Record<StringKey, string>;
  lyrics: Lyrics | undefined;
  loading: boolean;
  /** Already translated by the caller — it knows whether this is "none" or "failed". */
  error: string | null;
  /** Where the song is, in milliseconds. Only meaningful while it plays. */
  positionMs: number;
  playing: boolean;
  title: string;
  artists: string;
  /** The song's id. Part of every row key, and what re-runs the entrance. */
  trackId: string | null;
  /** Desktop only: the phone's lyrics sheet has no room beside the words. */
  coverUrl?: string | null;
  coverSide?: "left" | "right";
  onSwapSide?: () => void;
  /** Full-window, full-screen view of the same panel. Desktop only. */
  cinema?: boolean;
  /** Enters the cinema mode from the heading, or leaves it from its corner. */
  onCinema?: () => void;
  onClose: () => void;
};

/** An instrumental break: the provider marks it with a note, or sends no words. */
const isBreak = (text: string) => text.trim() === "" || text.trim() === "♪";

/** How long the song may play before its first line for the intro to earn dots. */
const INTRO_DOTS_MS = 4000;

/** The desktop anchors the heading and the cover and scrolls only the words. */
const ANCHORED = !isMobile();

/** How long without a pointer, key or wheel before the heading steps back. */
const IDLE_MS = 3000;

/**
 * Three dots for a stretch with no words. They breathe only while that stretch
 * is the one playing; anywhere else they sit still, because a page full of
 * pulsing rows is a page nobody can read.
 */
function BreakDots({ active }: { active: boolean }) {
  return (
    <span aria-hidden="true" className="flex h-[30px] items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`size-2 rounded-full bg-current ${active ? "lyric-dot" : ""}`}
          style={active ? { animationDelay: `${i * 160}ms` } : undefined}
        />
      ))}
    </span>
  );
}

/**
 * How present a line is, by how far it is from the one being sung.
 *
 * Opacity, never colour: the words are the content, and a tinted line reads as a
 * link to something. Three tiers rather than two because the neighbour of the
 * current line is the one the eye reaches for next — dropping it to the same grey
 * as the rest of the verse is what makes a lyrics panel feel like a form instead
 * of something being read.
 *
 * Unsynced lyrics have no current line, so every line sits at the same weight.
 * A page that is all highlight is not a page anybody can read.
 */
function presence(index: number, activeIndex: number): string {
  if (activeIndex < 0) return "opacity-70";
  if (index === activeIndex) return "opacity-100";
  return Math.abs(index - activeIndex) <= 2 ? "opacity-60" : "opacity-35";
}

/**
 * The longest a line's fill may take. The time to the next line includes any
 * instrumental after it, and a fill crawling through a twenty-second solo reads
 * as the words being late, not the song being quiet.
 */
const FILL_MAX_MS = 8000;
/** The last line has no next one to measure against. */
const FILL_LAST_MS = 4000;

/**
 * The line being sung, letter by letter: each one lights up and lifts a few
 * pixels at its turn, then settles back.
 *
 * The provider times lines, not words, so a letter's turn is an even share of
 * the line — `delay = its share − how far in the song already is`. A letter
 * whose turn has passed gets a delay so negative its animation is already over,
 * and `both` holds it lit and settled. Every timing is a CSS animation, so the
 * movement runs on the compositor between the twice-a-second position updates.
 *
 * Letters are grouped by word in `nowrap` spans: each letter is an inline-block
 * (a transform needs a box), and inline-blocks side by side may break anywhere,
 * so without the word around them a line would wrap in the middle of a word.
 * The letters are hidden from screen readers and the text is read once, whole.
 */
function SungLine({
  text,
  duration,
  elapsed,
  playing,
}: {
  text: string;
  duration: number;
  elapsed: number;
  playing: boolean;
}) {
  const letters = text.replace(/\s/g, "").length || 1;
  let at = 0;
  return (
    <span data-paused={playing ? undefined : ""} className="lyric-sung">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split(/(\s+)/).map((word, w) => {
          // biome-ignore lint/suspicious/noArrayIndexKey: a line's words never reorder while it is being sung.
          if (/^\s+$/.test(word) || word === "") return <span key={w}>{word}</span>;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
            <span key={w} className="whitespace-nowrap">
              {[...word].map((letter, l) => {
                const delay = (at++ / letters) * duration - elapsed;
                return (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                    key={l}
                    className="lyric-letter"
                    style={{ animationDelay: `${Math.round(delay)}ms` }}
                  >
                    {letter}
                  </span>
                );
              })}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/**
 * The words, with the song.
 *
 * **It lives in the main surface, not in a panel of its own.** DESIGN.md allows
 * four floating layers and no more, and the queue already claims one of them. A
 * fifth sheet of glass for the words would break the rule the whole layout is
 * built on — and there is a second reason: the lyrics are only worth reading
 * *beside* the transport, and the transport is always on screen.
 *
 * **It brings its own heading, and the page's heading steps aside.** They used to
 * both be there: the playlist's name on top, the song's name underneath in this
 * panel, and between them a line counting the songs of a playlist that was no
 * longer on screen — three facts about a song nobody asked about. The heading
 * here uses the app's own recipe for a title and a subtitle, so taking over
 * reads as the page changing its subject rather than as a new surface landing.
 *
 * **The line follows the song when the song has a clock, and nothing moves when
 * it does not.** A lyrics page with no timings is still the lyrics — it just
 * cannot be followed, and auto-scrolling through it to a position that means
 * nothing is the most distracting thing a player can do. So `synced` decides
 * whether the highlight and the scroll exist at all.
 *
 * The scroll is `smooth` and lands the active line in the lower third. Centring
 * it leaves the next line hidden below the fold, and the eye wants to know what
 * comes after the line it is reading.
 *
 * **Every line is a seek.** Clicking one jumps the song there, which is what the
 * words are for: you hear the chorus, want it again, and the line you are reading
 * is the position you already know. A line without a time is disabled rather than
 * hidden — the words still have to be there to be read, and a paragraph that is
 * partly missing is worse than one you cannot click.
 */
export function LyricsPanel({
  t,
  lyrics,
  loading,
  error,
  positionMs,
  playing,
  title,
  artists,
  trackId,
  coverUrl = null,
  coverSide = "left",
  onSwapSide,
  cinema = false,
  onCinema,
  onClose,
}: LyricsPanelProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  /**
   * One key per line, counted by how many times the line already appeared.
   *
   * The same rule as the track lists, for the same reason: a chorus repeats its
   * lines, and React's reconciliation with duplicate keys does not warn and carry
   * on — the losing fibers stay mounted, so the page quietly keeps painting the
   * previous song's words behind the new ones.
   *
   * **Not the array index.** It is stable here only because a song's lines never
   * reorder, and "only because" is not a property worth relying on: the moment
   * anything is inserted, every row after it is a different component and the
   * highlight follows the position instead of the line.
   *
   * **Prefixed with the track.** Two songs that share a line — and "Hello", or
   * any refrain, is shared by most of them — would otherwise hand React the same
   * key for a row that is a different row, and the entrance animation below would
   * not re-run when the song changes: the new song's words would simply arrive
   * already there.
   */
  const rowKeys = (() => {
    const seen = new Map<string, number>();
    return (lyrics?.lines ?? []).map((line) => {
      const occurrence = seen.get(line.text) ?? 0;
      seen.set(line.text, occurrence + 1);
      return `${trackId ?? "?"}#${occurrence}#${line.text}`;
    });
  })();

  /**
   * The index of the line being sung: the last one whose start has already passed.
   *
   * Lines arrive sorted and the scan stops at the first one that starts later, so
   * this costs "how far into the song are we" comparisons rather than the length
   * of the song — twenty-five of them twice a second for a fifty-line lyric, which
   * is nothing, and it stays correct without keeping a cursor across renders that
   * could drift out of step with the playhead.
   */
  const activeIndex = (() => {
    if (!lyrics?.synced) return -1;
    let index = -1;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const start = lyrics.lines[i]?.start_ms;
      if (start == null) continue;
      if (start <= positionMs) index = i;
      else break;
    }
    return index;
  })();

  /**
   * Bring the line being sung to the middle of the words' own box.
   *
   * **Not `scrollIntoView` on the desktop.** It scrolls *every* scrollable
   * ancestor, and an `overflow: hidden` box is still scrollable from script: the
   * app's root is one, so following the song pushed the whole window up — top bar,
   * player and all — and left a band of empty ground under the player. Scrolling
   * the one box that owns the words moves the words and nothing else.
   */
  useEffect(() => {
    if (activeIndex < 0) return;
    const line = activeRef.current;
    const list = listRef.current;
    if (!line) return;
    if (!list) {
      line.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    list.scrollTo({
      top: line.offsetTop - list.clientHeight / 2 + line.offsetHeight / 2,
      behavior: "smooth",
    });
  }, [activeIndex]);

  /**
   * The heading steps back while the song is playing and nobody touches the
   * app, so the words are all there is. Any pointer, key or wheel brings it
   * back at once; a paused song keeps it, because pausing is reaching for it.
   */
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!ANCHORED || !playing) {
      setIdle(false);
      return;
    }
    let timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), IDLE_MS);
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel"] as const;
    for (const name of events) window.addEventListener(name, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, wake);
    };
  }, [playing]);

  /**
   * How long the line being sung lasts, and how far into it the song already is.
   *
   * The provider times lines, not words, so the fill is an estimate: it spreads
   * the line evenly over the time until the next one starts. It is read once,
   * when the line changes, and handed to a CSS animation as a duration and a
   * negative delay — the position only arrives twice a second, and driving the
   * fill from it would move in half-second jumps. Pausing pauses the animation.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the line changing is the event; the position is read at that moment.
  const fill = useMemo(() => {
    const start = lyrics?.lines[activeIndex]?.start_ms;
    if (start == null) return null;
    const next = lyrics?.lines.slice(activeIndex + 1).find((line) => line.start_ms != null);
    const duration = Math.min(
      next?.start_ms != null ? next.start_ms - start : FILL_LAST_MS,
      FILL_MAX_MS,
    );
    return { duration, elapsed: Math.max(0, positionMs - start) };
  }, [activeIndex, lyrics]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className={`${ANCHORED ? "flex h-full flex-col" : "pb-4"} ${cinema && idle ? "cursor-none" : ""}`}
      aria-label={title || t.lyricsTitle}
    >
      {/*
        On the desktop the panel is exactly as tall as the main surface and only
        the words scroll, inside their own box: the heading and the cover stay
        anchored where they are instead of riding up with the lines.
      */}
      {/*
        The cinema mode has no heading: the title goes under the cover, and the
        only control is the way out, in the corner, gone with the heading's own
        idle fade. Esc does the same.
      */}
      {cinema && onCinema && (
        <button
          type="button"
          onClick={onCinema}
          aria-label={t.cinemaExit}
          title={t.cinemaExit}
          className={`absolute top-6 right-6 z-10 rounded-pill p-2.5 text-ink-muted transition-[opacity,color,background-color] duration-700 hover:bg-white/8 hover:text-ink ${
            idle ? "opacity-0" : ""
          }`}
        >
          <Minimize2 className="size-5" />
        </button>
      )}
      <div
        className={`mb-7 flex shrink-0 items-start justify-between gap-6 transition-opacity duration-700 ${
          idle ? "opacity-0" : ""
        } ${cinema ? "hidden" : ""}`}
      >
        <div className="min-w-0">
          <p className="text-[11.5px] font-semibold tracking-[0.12em] uppercase text-ink-faint">
            {t.lyricsTitle}
          </p>
          {title && (
            <h1 className="mt-1 truncate text-[30px] leading-tight font-semibold tracking-tight">
              {title}
            </h1>
          )}
          {artists && <p className="mt-1 truncate text-[13px] text-ink-muted">{artists}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {coverUrl && onSwapSide && (
            <button
              type="button"
              onClick={onSwapSide}
              aria-label={t.coverSideSwap}
              title={t.coverSideSwap}
              className="rounded-pill p-2 text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
            >
              <ArrowLeftRight className="size-4" />
            </button>
          )}
          {onCinema && (
            <button
              type="button"
              onClick={onCinema}
              aria-label={t.cinemaEnter}
              title={t.cinemaEnter}
              className="rounded-pill p-2 text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
            >
              <Maximize2 className="size-4" />
            </button>
          )}
          {/* The desktop closes the words from the player's own lyrics button. */}
          {!ANCHORED && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-pill px-3 py-1.5 text-[12.5px] font-semibold text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
            >
              {t.closeLyrics}
            </button>
          )}
        </div>
      </div>

      {/*
        The cover and the words side by side, on whichever side the person put
        it. The cover stays put beside the words while they scroll in their own
        box, and it is keyed by the picture so a new song fades in rather than
        swapping under the eye.

        Swapping sides glides: both columns carry `layout`, so Motion slides each
        from its old box to its new one on the house spring instead of the two
        jumping across in one frame. `position` on the words, because a scaled
        box of text is a smeared box of text for the length of the slide.
      */}
      <div
        className={`flex gap-10 ${ANCHORED ? "min-h-0 flex-1" : ""} ${
          cinema ? "items-center gap-[6vw]" : "items-start"
        } ${coverSide === "right" ? "flex-row-reverse" : ""}`}
      >
        {coverUrl && (
          <motion.div
            layout
            transition={SPRING}
            className={`shrink-0 ${cinema ? "w-[min(38vw,62vh)]" : "w-[min(30vw,320px)]"}`}
          >
            <motion.img
              key={coverUrl}
              src={coverUrl}
              alt=""
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={SPRING}
              className="aspect-square w-full rounded-card object-cover shadow-[0_24px_60px_rgb(0_0_0/0.45)]"
            />
            {cinema && (
              <div className="mt-6 min-w-0">
                <p className="truncate text-[clamp(22px,2.2vw,34px)] leading-tight font-semibold tracking-tight">
                  {title}
                </p>
                <p className="mt-1 truncate text-[clamp(14px,1.2vw,18px)] text-ink-muted">
                  {artists}
                </p>
              </div>
            )}
          </motion.div>
        )}
        <motion.div
          layout="position"
          transition={SPRING}
          ref={ANCHORED ? listRef : undefined}
          // The edges fade so a line leaves under the heading instead of being
          // cut by it. `relative` makes this box the lines' `offsetParent`, which
          // is what the follow-the-song scroll measures against.
          className={
            ANCHORED
              ? `relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-3 pb-4 ${
                  cinema ? "h-full py-[30vh]" : "max-h-full self-stretch"
                }`
              : "min-w-0 flex-1"
          }
          style={
            ANCHORED
              ? {
                  maskImage:
                    "linear-gradient(to bottom, transparent, #000 32px, #000 calc(100% - 48px), transparent)",
                }
              : undefined
          }
        >
          {loading ? (
            <p className="text-[13px] text-ink-faint">{t.loading}</p>
          ) : error ? (
            <p className="rounded-card border border-white/8 bg-white/4 px-5 py-6 text-center text-[13px] text-ink-faint">
              {error}
            </p>
          ) : !lyrics || lyrics.lines.length === 0 ? (
            <p className="rounded-card border border-white/8 bg-white/4 px-5 py-6 text-center text-[13px] text-ink-faint">
              {t.noLyrics}
            </p>
          ) : (
            <>
              {/*
            The whole list is always rendered and only the highlight moves. A view
            that showed one line at a time would break scrolling, break searching
            with Ctrl+F, and make the words impossible to read ahead of the song —
            which is the thing people actually open lyrics for.

            **No negative margin on this container.** It was here to let the pill
            bleed a few pixels left of the words, and it cost a horizontal
            scrollbar across the bottom of the content area: `<main>` sets
            `overflow-y: auto`, and CSS computes the *other* axis to `auto` too, so
            a child even 24px wider than the box becomes something you can scroll
            sideways. Twelve pixels of alignment is not worth a scrollbar that was
            never asked for.
          */}
              <div className="flex max-w-[42rem] flex-col gap-1">
                {/* The intro before the first line is a break too, with no row of its own. */}
                {lyrics.synced && (lyrics.lines[0]?.start_ms ?? 0) >= INTRO_DOTS_MS && (
                  <span
                    className={`px-3 py-1.5 transition-opacity duration-300 ${
                      activeIndex < 0 ? "opacity-100" : "opacity-35"
                    }`}
                  >
                    <BreakDots active={activeIndex < 0 && playing} />
                  </span>
                )}
                {lyrics.lines.map((line, index) => {
                  const active = index === activeIndex;
                  // Unsynced lyrics come back with every line at `null`: there is no
                  // minute to jump to, so the whole block is a wall of dead buttons.
                  const seekable = line.start_ms != null;
                  return (
                    <button
                      key={rowKeys[index]}
                      type="button"
                      ref={active ? activeRef : undefined}
                      disabled={!seekable}
                      onClick={() => {
                        if (line.start_ms == null) return;
                        void seekPlayback(line.start_ms).catch(() => {});
                      }}
                      /*
                    The words arrive once per song: a 14ms stagger, capped at 24
                    lines so a long verse is not still arriving after the first
                    chorus. Transform only — the opacity of a line belongs to the
                    highlight, and two owners of one property is how a highlight
                    ends up fighting an animation. The cap is why the delay is an
                    inline style: it is per row, and `both` holds the line back
                    until its turn.
                  */
                      style={{ animationDelay: `${Math.min(index, 24) * 14}ms` }}
                      aria-label={
                        seekable ? `${line.text} — ${formatDuration(line.start_ms)}` : undefined
                      }
                      title={seekable ? t.jumpToLine : undefined}
                      className={`lyric-in relative isolate w-fit max-w-full rounded-pill px-3 py-1.5 text-left ${cinema ? "text-[clamp(26px,2.6vw,40px)] leading-[1.35]" : "text-[20px] leading-[1.5]"} font-medium transition-[opacity,background-color] duration-300 ${
                        seekable
                          ? "cursor-pointer hover:bg-white/6 hover:opacity-100"
                          : "cursor-default"
                      } ${presence(index, activeIndex)}`}
                    >
                      {/*
                    The band that travels with the line being sung. A shared
                    layout id is what makes it travel: React unmounts one and
                    mounts the other, and Motion slides and resizes the survivor
                    between the two boxes on the house spring.

                    It is a tint and not a coloured line, because the saturated
                    fills in this app are the accent button and the state marks,
                    and this is neither. `isolate` keeps its `-z-10` inside this
                    element: without a stacking context here it would fall behind
                    the bloom itself.

                    The line is `w-fit`, so the band and the hover tint are as wide
                    as the words and no wider. Pinned to a fixed column they drew
                    a 670px box around a nine-word line, and the empty half of it
                    read as the words sitting off to one side. The pill radius is
                    on the button as well, or the hover fill is a rectangle on a
                    page where the moving line is a stadium.
                  */}
                      {active && (
                        <motion.span
                          layoutId="lyric-cursor"
                          transition={SPRING}
                          className="absolute inset-0 -z-10 rounded-pill bg-white/6"
                          aria-hidden
                        />
                      )}
                      {isBreak(line.text) ? (
                        <BreakDots active={active && playing} />
                      ) : active && fill ? (
                        <SungLine text={line.text} {...fill} playing={playing} />
                      ) : (
                        line.text
                      )}
                    </button>
                  );
                })}
              </div>

              {/*
            Unsynced lyrics say so, once, at the bottom. Silently showing a page
            that cannot follow the song is not an error, but it is worth one line
            so nobody waits for a highlight that was never going to come.
          */}
              {!lyrics.synced && (
                <p className="mt-5 text-[12.5px] text-ink-faint">{t.lyricsNotSynced}</p>
              )}
              {!playing && lyrics.synced && (
                <p className="mt-2 text-[12.5px] text-ink-faint">{t.lyricsPaused}</p>
              )}
            </>
          )}
        </motion.div>
      </div>
    </motion.section>
  );
}
