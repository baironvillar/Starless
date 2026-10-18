import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { StringKey } from "../lib/i18n";
import { formatDuration, type Lyrics, seekPlayback } from "../lib/spotify";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

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
  onClose: () => void;
};

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
  onClose,
}: LyricsPanelProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

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

  useEffect(() => {
    if (activeIndex < 0) return;
    // `nearest` and not `center`: a line the user has already scrolled to should
    // not be yanked away because the playhead moved a second.
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeIndex]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="pb-4"
      aria-label={title || t.lyricsTitle}
    >
      <div className="mb-7 flex items-start justify-between gap-6">
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

        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-pill px-3 py-1.5 text-[12.5px] font-semibold text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
        >
          {t.closeLyrics}
        </button>
      </div>

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
                  className={`lyric-in relative isolate w-fit max-w-full rounded-pill px-3 py-1.5 text-left text-[20px] leading-[1.5] font-medium transition-[opacity,background-color] duration-300 ${
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
                  {line.text}
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
    </motion.section>
  );
}
