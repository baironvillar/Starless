import {
  Disc3,
  Ellipsis,
  Library,
  ListOrdered,
  MonitorSmartphone,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import type { Lang, StringKey } from "../lib/i18n";
import type { Track } from "../lib/spotify";
import { MIN_QUERY_LENGTH, SEARCH_MENU_ID, SearchMenu, searchOptionId } from "./SearchMenu";
import { WindowControls } from "./WindowControls";

type TopBarProps = {
  lang: Lang;
  t: Record<StringKey, string>;
  active: StringKey;
  libraryOpen: boolean;
  queueOpen: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  /** Enter with nothing highlighted: the typed text becomes a real screen. */
  onSubmitSearch: () => void;
  onPickSuggestion: (track: Track) => void;
  suggestions: Track[];
  /** Songs the current query returned, or `null` while still unknown. */
  suggestionCount: number | null;
  searching: boolean;
  searchError: string | null;
  onNavigate: (key: StringKey) => void;
  onToggleLibrary: () => void;
  onToggleQueue: () => void;
  onLangChange: (lang: Lang) => void;
  onOpenSettings: () => void;
};

const SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };

/**
 * The top bar: floating glass, carrying the whole chrome of the app.
 *
 * Laid out as a three-column grid — `1fr auto 1fr` — so the search field stays
 * optically centred no matter how wide navigation grows. Centring it with
 * absolute positioning would drift the moment a nav pill wrapped.
 *
 * The side columns are `min-w-0 overflow-hidden` on purpose: without that they
 * push their contents through the centre column instead of yielding to it. The
 * row sheds items by breakpoint as it narrows, rather than ever overlapping.
 *
 * It returns a `display: contents` wrapper holding the bar *and* the search menu.
 * The menu is a sibling, not a child, because nesting glass inside glass is
 * forbidden (DESIGN.md) — this stays a separate surface instead of a second blur
 * inside the bar. `contents` gives the wrapper no box of its own, so both
 * children keep positioning themselves against the app root.
 */
export function TopBar({
  lang,
  t,
  active,
  libraryOpen,
  queueOpen,
  query,
  onQueryChange,
  onSubmitSearch,
  onPickSuggestion,
  suggestions,
  suggestionCount,
  searching,
  searchError,
  onNavigate,
  onToggleLibrary,
  onToggleQueue,
  onLangChange,
  onOpenSettings,
}: TopBarProps) {
  /* Search ---------------------------------------------------------------- */

  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** `-1` is "no row"; `suggestions.length` is the "see all" row. */
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const allIndex = suggestions.length;

  // Typing starts a new question, so the previous answer's highlight means
  // nothing: it would point at a row that is now a different song. Adjusting
  // during render rather than in an effect because that is exactly the case React
  // documents it for — no extra render, no stale frame with the old highlight.
  const [askedFor, setAskedFor] = useState(query);
  if (askedFor !== query) {
    setAskedFor(query);
    setHighlight(-1);
    setDismissed(false);
  }

  const trimmed = query.trim();
  // Open as soon as there is anything typed, including a single character: the
  // menu then owns the "not enough yet" message instead of the field eating the
  // keystroke in silence.
  const menuOpen = focused && !dismissed && trimmed.length > 0;

  /**
   * Close when focus leaves the control *and* the menu together.
   *
   * `relatedTarget` is the reliable signal, and `null` is a real answer here:
   * clicking something that cannot hold focus reports null, and that click
   * should close the menu exactly as clicking a button does.
   */
  const onBlur = (event: React.FocusEvent) => {
    if (!rootRef.current?.contains(event.relatedTarget)) setFocused(false);
  };

  /**
   * Arrows walk the menu, Enter commits, Escape backs out.
   *
   * The highlight is a closed loop over `-1 … allIndex`, so it wraps rather than
   * sticking at the ends. Enter means "the highlighted row" when there is one and
   * "all results" when there is not — which is why Escape followed by Enter still
   * does the obvious thing.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      // Arrowing reopens a dismissed menu. The user dismissed that moment, not
      // the field, and doing nothing at all is the one answer that feels broken.
      setDismissed(false);
      event.preventDefault();
      setHighlight((index) => ((index + 2) % (allIndex + 2)) - 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => (index <= -1 ? allIndex : index - 1));
      return;
    }
    if (event.key === "Escape") {
      setDismissed(true);
      setHighlight(-1);
      return;
    }
    if (event.key !== "Enter") return;

    event.preventDefault();
    const picked = suggestions[highlight];
    if (highlight >= 0 && picked) onPickSuggestion(picked);
    else if (trimmed.length >= MIN_QUERY_LENGTH) onSubmitSearch();
    setHighlight(-1);
    setDismissed(true);
  };

  /** Clearing keeps the caret in the field: it is one query being rewritten. */
  const onClear = () => {
    onQueryChange("");
    setHighlight(-1);
    setDismissed(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={rootRef} className="contents">
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        onBlur={onBlur}
        className="glass pointer-events-auto absolute inset-x-5 top-5 z-20 grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-4 rounded-card px-4"
        // With `decorations: false` there is no title bar left, so this row is
        // what moves the window. `"deep"` rather than bare so the whole bar
        // drags, not only the few pixels that are the bar itself and nothing
        // else; every control below opts back out with `"false"`.
        data-tauri-drag-region="deep"
      >
        {/* Home, then the library toggle that controls the sidebar below */}
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <motion.button
            type="button"
            onClick={() => onNavigate("navHome")}
            whileTap={{ scale: 0.92 }}
            transition={SPRING}
            aria-label={t.navHome}
            aria-current={active === "navHome" ? "page" : undefined}
            data-tauri-drag-region={false}
            className="grid size-10 shrink-0 place-items-center rounded-pill bg-accent text-ground transition-[filter] duration-200 hover:brightness-110"
          >
            <Disc3 className="size-[18px] text-ground" strokeWidth={2.5} />
          </motion.button>

          <span className="h-6 w-px shrink-0 bg-white/10" />

          <motion.button
            type="button"
            onClick={onToggleLibrary}
            whileTap={{ scale: 0.97 }}
            transition={SPRING}
            aria-label={libraryOpen ? t.hideLibrary : t.showLibrary}
            aria-pressed={libraryOpen}
            title={libraryOpen ? t.hideLibrary : t.showLibrary}
            data-tauri-drag-region={false}
            className={`hidden min-w-0 items-center gap-2.5 rounded-pill py-2 pr-3.5 pl-2.5 text-[13.5px] font-medium transition-colors duration-200 lg:flex ${
              libraryOpen
                ? "bg-white/12 text-ink"
                : "text-ink-muted hover:bg-white/6 hover:text-ink"
            }`}
          >
            <Library className="size-4 shrink-0" strokeWidth={2} />
            <span className="truncate">{t.navLibrary}</span>
          </motion.button>
        </div>

        {/* Centred search */}
        <div
          className="glass-control flex h-10 w-[clamp(180px,30vw,420px)] items-center gap-2.5 rounded-pill px-4"
          data-tauri-drag-region={false}
        >
          <Search className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={onKeyDown}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            // A combobox, not a bare text field: the menu is a real listbox and
            // the highlight is announced rather than only seen.
            role="combobox"
            aria-expanded={menuOpen}
            aria-controls={SEARCH_MENU_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              menuOpen && highlight >= 0 ? searchOptionId(highlight) : undefined
            }
            className="w-full min-w-0 bg-transparent text-[13.5px] outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
          />
          {/* Clearing is a single click rather than a select-all and a backspace.
              A field that can only be emptied one character at a time is a field
              you have to look at while you use it. */}
          {query.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              aria-label={t.clearSearch}
              title={t.clearSearch}
              className="grid size-5 shrink-0 place-items-center rounded-pill text-ink-faint transition-colors duration-200 hover:bg-white/10 hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          )}
        </div>

        {/* Secondary actions */}
        <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden">
          <IconButton label={t.queue} onClick={onToggleQueue} active={queueOpen}>
            <ListOrdered className="size-[17px]" strokeWidth={2} />
          </IconButton>
          <IconButton label={t.device} className="hidden xl:grid">
            <MonitorSmartphone className="size-[17px]" strokeWidth={2} />
          </IconButton>

          <span className="mx-1 hidden h-6 w-px shrink-0 bg-white/10 lg:block" />

          <IconButton label={t.navSettings} onClick={onOpenSettings}>
            <SlidersHorizontal className="size-[17px]" strokeWidth={2} />
          </IconButton>
          <IconButton label={t.more} className="hidden xl:grid">
            <Ellipsis className="size-[17px]" strokeWidth={2} />
          </IconButton>

          <span className="mx-1 hidden h-6 w-px shrink-0 bg-white/10 lg:block" />

          <fieldset
            aria-label={t.language}
            className="glass-control m-0 hidden shrink-0 rounded-pill border-0 p-0.5 sm:flex"
            data-tauri-drag-region={false}
          >
            {(["es", "en"] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => onLangChange(code)}
                aria-pressed={lang === code}
                className={`rounded-pill px-2 py-1 text-[12px] font-semibold tracking-wide uppercase transition-colors duration-200 ${
                  lang === code ? "bg-accent text-ground" : "text-ink-muted"
                }`}
              >
                {code}
              </button>
            ))}
          </fieldset>

          {/*
            Last in the row, against the edge.

            The window has `decorations: false`, so this *is* the title bar and
            there is nowhere else for it to live. Windows convention puts these on
            the right, so that is where they are — and being last also means they
            are the hardest to hit by accident.
          */}
          <span className="mx-1.5 h-6 w-px shrink-0 bg-white/10" />
          <WindowControls t={t} />
        </div>
      </motion.header>

      {/*
        The menu is mounted outside the bar's own box and, deliberately, outside
        its glass. It is centred on the window with the same `clamp` width the
        field uses, so the two stay aligned without measuring anything.
      */}
      <AnimatePresence>
        {menuOpen && (
          <SearchMenu
            t={t}
            query={trimmed}
            suggestions={suggestions}
            count={suggestionCount}
            loading={searching}
            error={searchError}
            highlighted={highlight}
            onHighlight={setHighlight}
            onPick={onPickSuggestion}
            onSeeAll={onSubmitSearch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  active = false,
  className = "",
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      data-tauri-drag-region={false}
      whileTap={{ scale: 0.9 }}
      transition={SPRING}
      aria-label={label}
      title={label}
      aria-pressed={onClick ? active : undefined}
      className={`grid size-9 shrink-0 place-items-center rounded-pill transition-colors duration-200 hover:bg-white/10 hover:text-ink ${
        active ? "bg-white/12 text-ink" : "text-ink-muted"
      } ${className}`}
    >
      {children}
    </motion.button>
  );
}
