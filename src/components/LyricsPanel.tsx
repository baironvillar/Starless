import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { StringKey } from "../lib/i18n";
import type { Lyrics } from "../lib/spotify";

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
  onClose: () => void;
};

/**
 * The words, with the song.
 *
 * **It lives in the main surface, not in a panel of its own.** DESIGN.md allows
 * four floating layers and no more, and the queue already claims one of them. A
 * fifth sheet of glass for the words would break the rule the whole layout is
 * built on — and there is a second reason: the lyrics are only worth reading
 * *beside* the transport, and the transport is always on screen.
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
 */
export function LyricsPanel({
  t,
  lyrics,
  loading,
  error,
  positionMs,
  playing,
  title,
  onClose,
}: LyricsPanelProps) {
  const activeRef = useRef<HTMLParagraphElement | null>(null);

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
   */
  const rowKeys = (() => {
    const seen = new Map<string, number>();
    return (lyrics?.lines ?? []).map((line) => {
      const occurrence = seen.get(line.text) ?? 0;
      seen.set(line.text, occurrence + 1);
      return `${occurrence}#${line.text}`;
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
      aria-label={title}
    >
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="truncate text-[13px] font-semibold tracking-wide uppercase text-ink-faint">
          {title}
        </h2>
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
          */}
          <div className="flex flex-col gap-1.5">
            {lyrics.lines.map((line, index) => {
              const active = index === activeIndex;
              // Dimming is opacity, never a colour change: the lyric colour comes
              // from the artwork and a tinted line reads as a link.
              return (
                <p
                  key={rowKeys[index]}
                  ref={active ? activeRef : undefined}
                  className={`text-[19px] leading-snug font-semibold transition-opacity duration-300 ${
                    active ? "text-ink opacity-100" : "text-ink opacity-45"
                  }`}
                >
                  {line.text}
                </p>
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
