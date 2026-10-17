import { CornerDownLeft, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import type { StringKey } from "../lib/i18n";
import { largestImage, type Track, trackArtists } from "../lib/spotify";

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

/** Lets the input point `aria-activedescendant` at the highlighted row. */
export const SEARCH_MENU_ID = "starless-search-menu";

/**
 * Below this length Spotify answers with whatever it felt like, which reads as a
 * broken search rather than as a result. Until it is reached the menu shows the
 * requirement instead, because a field that swallows the first keystroke in
 * silence is indistinguishable from one that is not connected.
 */
export const MIN_QUERY_LENGTH = 2;

export function searchOptionId(index: number): string {
  return `${SEARCH_MENU_ID}-option-${index}`;
}

type SearchMenuProps = {
  t: Record<StringKey, string>;
  query: string;
  suggestions: Track[];
  /**
   * Songs Spotify returned for this exact query, or `null` while that is still
   * unknown. The two are not the same: `null` means "not answered yet", and
   * treating it as zero would show "no matches" under a search still in flight.
   */
  count: number | null;
  loading: boolean;
  error: string | null;
  /** `-1` is nothing highlighted; `suggestions.length` is the "see all" row. */
  highlighted: number;
  onHighlight: (index: number) => void;
  onPick: (track: Track) => void;
  onSeeAll: () => void;
};

/**
 * The menu that hangs under the search field.
 *
 * It answers "what did you mean" without moving anything. Typing has to stay
 * cheap — the user is still forming a thought — so the songs only appear once a
 * word exists, and the screen they were reading stays exactly where it was.
 * Enter is what turns the question into a destination.
 *
 * A sibling of the top bar, not a child of it. DESIGN.md forbids nesting glass
 * inside glass, and the bar is already glass; this is its own floating surface,
 * so it earns its own blur rather than compounding the bar's.
 *
 * The panel is centred on the window rather than anchored to the field because
 * it is *not* inside the bar's box: it hangs 8px under it and lays out against
 * the app root. Both it and the field use the same `clamp` width and the same
 * centre, so they stay aligned without measuring anything.
 *
 * The rows are the buttons themselves rather than `<li>`s wearing a role: focus
 * never leaves the field here — arrows move a highlight instead — so the options
 * have to be reachable through `aria-activedescendant`, and an option that is not
 * itself interactive is announced as nothing at all.
 */
export function SearchMenu({
  t,
  query,
  suggestions,
  count,
  loading,
  error,
  highlighted,
  onHighlight,
  onPick,
  onSeeAll,
}: SearchMenuProps) {
  const allIndex = suggestions.length;

  return (
    // Centred with layout, not with a transform. `-translate-x-1/2` was the only
    // live transform in the app sitting *above* a `backdrop-filter` element, and the
    // two transient glass surfaces — this menu and the settings panel — were the two
    // that stopped looking like glass in the packaged build while the three bars,
    // which have no transform above them, kept looking right. Whether that is the
    // whole cause is not proven; removing the transform is correct either way, and a
    // flex row does the same job without putting a composited layer between the
    // backdrop and the thing that samples it.
    <div className="pointer-events-none absolute inset-x-0 top-[92px] z-40 flex justify-center">
      <motion.div
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={SPRING}
        role="listbox"
        id={SEARCH_MENU_ID}
        aria-label={t.searchResultsFor.replace("{query}", query)}
        className="glass-overlay pointer-events-auto w-[clamp(180px,30vw,420px)] origin-top overflow-hidden rounded-card py-1.5"
      >
        {/* The empty states live inside the panel rather than replacing it: the
            panel IS the answer, and a field that empties itself the moment it has
            nothing to say makes the search look like it failed. */}
        {query.trim().length < MIN_QUERY_LENGTH && (
          <p className="px-4 py-2 text-[13px] text-ink-faint">{t.searchHint}</p>
        )}

        {loading && suggestions.length === 0 && (
          <p className="flex items-center gap-2.5 px-4 py-2 text-[13px] text-ink-muted">
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            {t.searching}
          </p>
        )}

        {!loading && !error && count === 0 && (
          <p className="px-4 py-2 text-[13px] text-ink-faint">{t.searchNoMatches}</p>
        )}

        {error && <p className="px-4 py-2 text-[13px] text-warn">{error}</p>}

        {suggestions.map((track, index) => {
          const active = highlighted === index;
          const cover = largestImage(track.album?.images);

          return (
            <button
              key={track.id}
              type="button"
              role="option"
              aria-selected={active}
              id={searchOptionId(index)}
              // Without this the field loses focus on mousedown and the menu
              // closes before the click ever arrives.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHighlight(index)}
              onClick={() => onPick(track)}
              className={`flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors duration-150 ${
                active ? "bg-white/10" : "hover:bg-white/6"
              }`}
            >
              {/* Same rule as every cover in the app: real art, or an empty frame.
                  A coloured block here would be the only invented colour on
                  screen. */}
              {cover ? (
                <span className="size-8 shrink-0 overflow-hidden rounded-[8px]">
                  <img src={cover.url} alt="" loading="lazy" className="size-full object-cover" />
                </span>
              ) : (
                <span className="size-8 shrink-0 rounded-[8px] bg-white/8" aria-hidden />
              )}

              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{track.name}</span>
                <span className="block truncate text-[12px] text-ink-muted">
                  {trackArtists(track)}
                </span>
              </span>

              <CornerDownLeft
                className={`size-3.5 shrink-0 transition-opacity duration-150 ${
                  active ? "text-accent opacity-100" : "opacity-0"
                }`}
                strokeWidth={2}
              />
            </button>
          );
        })}

        {count !== 0 && query.trim().length >= MIN_QUERY_LENGTH && (
          <button
            type="button"
            role="option"
            aria-selected={highlighted === allIndex}
            id={searchOptionId(allIndex)}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => onHighlight(allIndex)}
            onClick={onSeeAll}
            className={`mt-1.5 flex w-full items-center gap-2 border-t border-white/8 px-3 py-2.5 text-left transition-colors duration-150 ${
              highlighted === allIndex ? "bg-white/10" : "hover:bg-white/6"
            }`}
          >
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {t.searchSeeAllResults}
            </span>
            {/* The count is real: it is what this query actually returned, not an
                estimate, so there is nothing here to soften. */}
            {count !== null && (
              <span className="tabular shrink-0 text-[12px] text-ink-faint">{count}</span>
            )}
            <CornerDownLeft
              className={`size-3.5 shrink-0 transition-opacity duration-150 ${
                highlighted === allIndex ? "text-accent opacity-100" : "opacity-0"
              }`}
              strokeWidth={2}
            />
          </button>
        )}
      </motion.div>
    </div>
  );
}
