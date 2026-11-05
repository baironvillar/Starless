import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AudioLines,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FlaskConical,
  ImagePlus,
  Loader2,
  LogOut,
  MessageSquarePlus,
  Palette,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  User,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type CSSProperties,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useBack } from "../lib/back";
import { CHANGELOG, PREVIOUS_NOTE } from "../lib/changelog";
import type { Lang, StringKey } from "../lib/i18n";
import { SPRING, SPRING_SHEET } from "../lib/motion";
import {
  ACCENT_DEFAULT,
  type AudioQuality,
  accentColor,
  applyAccentColor,
  applyBackgroundLook,
  applyEffects,
  applySurfaceOpacity,
  applyTheme,
  audioQuality,
  BACKGROUND_DEFAULT,
  BACKGROUND_DIM_MAX,
  CROSSFADE_MAX,
  clearBackground,
  clearHistory,
  closeToTray,
  crossfadeSeconds,
  EFFECTS_DEFAULT,
  EFFECTS_QUIET,
  type EffectName,
  type Effects,
  explain,
  historyEnabled,
  historyKey,
  normalisation,
  pickBackground,
  resetCustomisation,
  SURFACE_OPACITY_DEFAULT,
  SURFACE_OPACITY_MAX,
  SURFACE_OPACITY_MIN,
  saveBackgroundLook,
  theme as savedTheme,
  setAccentColor,
  setAudioQuality,
  setCloseToTray,
  setCrossfadeSeconds,
  setEffect,
  setHistoryEnabled,
  setNormalisation,
  setStartWithWindows,
  setSurfaceOpacity,
  setTheme,
  signOut,
  startWithWindows,
  surfaceOpacity,
  type Theme,
  type Account as UserAccount,
  useBackground,
  useEffectsSettings,
} from "../lib/spotify";
import {
  checkForUpdate,
  checkPrerelease,
  installablePrerelease,
  installableUpdate,
  installPrerelease,
  installUpdate,
  isGoingBack,
  pendingVersion,
  prereleaseState,
  prereleaseVersion,
  subscribePrerelease,
  subscribeUpdate,
  updateState,
} from "../lib/updater";
import {
  appVersion,
  isMobile,
  isPrerelease,
  isPublicBuild,
  subscribePublicBuild,
} from "../lib/version";
import { DevPanel } from "./DevPanel";
import { Select } from "./Select";
import { SmoothSlider } from "./SmoothSlider";

type SettingsPanelProps = {
  lang: Lang;
  t: Record<StringKey, string>;
  /** The signed-in account, so this panel says who is signed in instead of guessing. */
  account: UserAccount | null;
  /**
   * Opens the feedback form, which lives outside the auth gate so it can also be
   * reached by someone the app never let in. This panel is only one of its doors.
   */
  onOpenFeedback: () => void;
  onClose: () => void;
  onLangChange: (lang: Lang) => void;
};

/**
 * The colours offered before the free picker.
 *
 * Every one of them is light enough to carry the dark label, which is the whole
 * point: an accent is a fill under text as often as it is a mark beside text, and
 * a preset that made a button unreadable would be a preset that ships a bug. The
 * shipped chrome comes first and is also how the section gets its default back.
 */
const ACCENT_PRESETS = ["#ff5a36", "#7c6cff", "#3dd6c4", "#f5b83d", "#c4c1c8", "#ff8fb1"];

/**
 * How long the hand has to be still before a look is written to disk: the pause
 * after the last movement, which is what "let go" means when the release happens
 * outside the control.
 */
const OPACITY_COMMIT_MS = 150;

/**
 * How often a look reaches the window while the hand moves, about 15 times a second.
 *
 * **It used to wait for the hand to stop, and that made the sliders a guess:** the
 * panel covered the window, and the window only answered after the fact. Now the
 * panel steps aside and the change has to be seen while it is made. It is limited
 * and not per event because the value repaints the surfaces, and a pointer sends far
 * more events than anybody can see.
 */
const LIVE_APPLY_MS = 66;

/**
 * How long the panel stays away after a slider is let go: just past `LIVE_APPLY_MS`,
 * so the last value lands before it comes back. It was 300, to look at the result,
 * and in the hand that read as a panel slow to answer.
 */
const PEEK_LINGER_MS = 80;

/**
 * Asks the panel to step aside. A context because the sliders are several sections
 * down, and every one of them would otherwise have to be handed it.
 */
const PeekContext = createContext<(peeking: boolean) => void>(() => {});

/**
 * One look, answered on two clocks: the window while the hand moves and the disk
 * once it stops.
 *
 * `pending` says the hand is ahead of the window. A value coming back from the store
 * in that moment is an older one, and must not be drawn over what the hand asks for.
 */
function useLiveCommit<T>(apply: (value: T) => void, save: (value: T) => void) {
  const latest = useRef({ apply, save });
  latest.current = { apply, save };
  const applyTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const lastApply = useRef(0);

  const commit = useMemo(() => {
    const cancel = () => {
      if (applyTimer.current !== null) window.clearTimeout(applyTimer.current);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      applyTimer.current = null;
      saveTimer.current = null;
    };
    return {
      cancel,
      pending: () => saveTimer.current !== null,
      push: (value: T) => {
        if (applyTimer.current !== null) window.clearTimeout(applyTimer.current);
        const run = () => {
          applyTimer.current = null;
          lastApply.current = performance.now();
          latest.current.apply(value);
        };
        const wait = LIVE_APPLY_MS - (performance.now() - lastApply.current);
        if (wait <= 0) run();
        else applyTimer.current = window.setTimeout(run, wait);

        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          saveTimer.current = null;
          latest.current.save(value);
        }, OPACITY_COMMIT_MS);
      },
    };
  }, []);

  // A timeout that outlives the panel writes to a window that is not there anymore.
  useEffect(() => commit.cancel, [commit]);

  return commit;
}

/**
 * A slider whose drag moves the panel out of the way.
 *
 * **The real control stays where it is, invisible with the panel, and this draws a
 * copy.** A child cannot be more opaque than its parent, and taking the control out
 * of the panel would unmount the input under the hand and end the drag. So the input
 * keeps the drag, and the copy sits over it with its track on the same pixels, on
 * its own glass, because it now floats over the app.
 */
function PeekSlider({
  label,
  valueText,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  valueText: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const setPeek = useContext(PeekContext);
  const box = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const linger = useRef<number | null>(null);

  useEffect(() => {
    if (!rect) return;
    const release = () => {
      // One gesture can end twice (a release, then the window losing focus), and a
      // second timer nobody remembers would close the panel over the next drag.
      if (linger.current !== null) return;
      linger.current = window.setTimeout(() => {
        linger.current = null;
        setRect(null);
        setPeek(false);
      }, PEEK_LINGER_MS);
    };
    // On the window: the release can land anywhere, and the alt-tab has no release.
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", release);
    };
  }, [rect, setPeek]);

  useEffect(() => {
    return () => {
      if (linger.current !== null) window.clearTimeout(linger.current);
    };
  }, []);

  return (
    <span
      ref={box}
      className="inline-flex"
      onPointerDownCapture={(event) => {
        if (disabled || event.button !== 0 || !box.current) return;
        if (linger.current !== null) window.clearTimeout(linger.current);
        linger.current = null;
        setRect(box.current.getBoundingClientRect());
        setPeek(true);
      }}
    >
      <SmoothSlider
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={onChange}
        label={label}
        className="w-[180px]"
      />
      {rect &&
        createPortal(
          <div
            inert
            aria-hidden="true"
            className="glass pointer-events-none fixed z-50 rounded-[16px] px-4 pt-3 pb-3 text-ink"
            // 40px is the padding and the line above the track: the track lands on
            // the pixels of the real one, so nothing moves under the hand.
            style={{ left: rect.left - 16, top: rect.top - 40, minWidth: rect.width + 32 }}
          >
            <div className="mb-2 flex h-5 items-center justify-between gap-4 text-[13px] whitespace-nowrap">
              <span className="font-semibold">{label}</span>
              <span className="tabular text-ink-muted">{valueText}</span>
            </div>
            <SmoothSlider
              value={value}
              min={min}
              max={max}
              step={step}
              onChange={() => {}}
              label={label}
              className="w-[180px]"
              heldFromStart
            />
          </div>,
          document.body,
        )}
    </span>
  );
}

/** The way back for one effect, or nothing while it is already what ships. */
function resetEffect<K extends EffectName>(
  effect: Effects,
  change: (name: K, value: Effects[K]) => void,
  name: K,
): (() => void) | undefined {
  return effect[name] === EFFECTS_DEFAULT[name]
    ? undefined
    : () => change(name, EFFECTS_DEFAULT[name]);
}

/**
 * The words of the compare button, and the sign that a row may offer it. Only the
 * customisation provides it: the rest of the settings change nothing on screen.
 */
const CompareContext = createContext<{ compare: string; done: string; reset: string } | null>(null);

/**
 * One control, on its own, with the panel out of the way: on, off, on, looking at
 * the app. What holding the preview button cannot do, because the hand that holds
 * it is the hand that would have to flip the switch.
 *
 * **The scrim catches the click that ends this.** It is clear, and it is there so
 * that click does not land on a song, or on the panel that is still there,
 * invisible. It does not stop the pointer light, which listens on the window.
 *
 * **The control moves here instead of being copied:** the row draws nothing while
 * this is open. Some controls keep their own state, and two of them would disagree
 * as soon as one changed.
 */
function ComparePill({
  label,
  done,
  at,
  onClose,
  children,
}: {
  label: string;
  done: string;
  at: DOMRect;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const setPeek = useContext(PeekContext);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPeek(true);
    box.current?.focus();
    return () => setPeek(false);
  }, [setPeek]);

  useEffect(() => {
    // In the capture phase: Escape also closes the whole panel, from `App`, and this
    // has to end the comparison and leave the panel where it was.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="fixed inset-0 z-[49] cursor-default"
      />
      <div
        ref={box}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className="glass fixed z-50 flex max-w-[calc(100vw-32px)] flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] px-4 py-3 text-ink outline-none"
        // Where the row was, so the hand barely has to travel; pulled back in when
        // the row is near the bottom edge.
        style={{
          top: Math.max(16, Math.min(at.top - 12, window.innerHeight - 96)),
          right: Math.max(16, window.innerWidth - at.right - 16),
        }}
      >
        <span className="text-[13px] font-semibold whitespace-nowrap">{label}</span>
        {children}
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-pill bg-white/10 px-3 text-[13px] font-medium transition-colors duration-200 hover:bg-white/16"
        >
          {done}
        </button>
      </div>
    </>,
    document.body,
  );
}

/**
 * Hold it and the panel is gone; let go and it is back. For what a slider's drag
 * cannot show: a switch, a list, a colour. A hold and not a toggle, because a toggle
 * leaves the panel hidden with nothing on screen that says how to bring it back.
 */
function PeekButton({ t }: { t: Record<StringKey, string> }) {
  const setPeek = useContext(PeekContext);
  const end = () => setPeek(false);
  return (
    <button
      type="button"
      aria-label={t.peekHold}
      title={t.peekHold}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setPeek(true);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onBlur={end}
      onKeyDown={(event) => {
        if ((event.key === " " || event.key === "Enter") && !event.repeat) {
          event.preventDefault();
          setPeek(true);
        }
      }}
      onKeyUp={(event) => {
        if (event.key === " " || event.key === "Enter") end();
      }}
      onContextMenu={(event) => event.preventDefault()}
      className="ml-auto flex h-9 shrink-0 touch-none items-center gap-2 rounded-pill px-3 text-[13px] font-medium text-ink-muted transition-colors duration-200 select-none hover:bg-white/10 hover:text-ink"
    >
      <Eye className="size-4" strokeWidth={2} />
      <span className="hidden sm:inline">{t.peekHold}</span>
    </button>
  );
}

const SECTIONS = [
  "sectionGeneral",
  "sectionAudio",
  "sectionAccount",
  "sectionCustom",
  "sectionDiagnostics",
] as const;
type Section = (typeof SECTIONS)[number];

/**
 * The parts of the customisation.
 *
 * **The section was one long list, and the list was going to keep growing.** The
 * app wants to be personalisable, so the number of options in here only goes up,
 * and a list that only goes up is a list that ends in a scroll. These three are
 * the split that keeps every screen short: how the app looks, what is behind it,
 * and what moves.
 */
const CUSTOM_PARTS = ["customAppearance", "customBackground", "customEffects"] as const;
type CustomPart = (typeof CUSTOM_PARTS)[number];

/**
 * What the person is looking for.
 *
 * **The search lives in the panel and the rows read it.** A search that every
 * row has to be told about is a search that every section has to remember to
 * honour —and the one that forgets is the one that shows the wrong answer. Here
 * the row asks the panel what is being looked for and decides for itself.
 */
const SearchContext = createContext("");

function useSearch(): string {
  return useContext(SearchContext);
}

/**
 * Whether a row is the answer.
 *
 * **Without case and without accents.** The person types "atenuar" and the label
 * says "Atenuar": it is the same word and the keyboard does not care about the
 * tilde. The hint counts too, because some names are only in the explanation.
 */
function matchesSearch(query: string, label: string, hint?: string): boolean {
  const needle = fold(query);
  if (!needle) return true;
  return fold(label).includes(needle) || fold(hint ?? "").includes(needle);
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Settings, as a large floating panel: sections down the left, grouped rows on
 * the right, each row a labelled description with its control opposite.
 */
export function SettingsPanel({
  lang,
  t,
  account,
  onOpenFeedback,
  onClose,
  onLangChange,
}: SettingsPanelProps) {
  const [section, setSection] = useState<Section>("sectionGeneral");
  /**
   * What the person is looking for.
   *
   * **It lives here and not in the rows.** Every row of every section reads it,
   * so a section that forgets to honour it is a section that shows the wrong
   * answer, and the person has no way of knowing that.
   */
  const [query, setQuery] = useState("");
  /**
   * The box with the rows of the section that is on screen.
   *
   * **It is how the panel knows whether the search found anything.** The rows
   * that do not match are not rendered, so what is in the box is what the
   * person is being offered.
   */
  const rowsBox = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState(true);
  /** Which part of the customisation is on screen. */
  const [customPart, setCustomPart] = useState<CustomPart>("customAppearance");
  /** Whether the panel has stepped aside to show the window behind it. */
  const [peek, setPeek] = useState(false);
  const [version, setVersion] = useState<string>("");
  /**
   * Whether this build is a prerelease.
   *
   * **It is not a question with an answer that changes.** It is decided when the
   * bundle is built, so it is a constant and not a state: there is nothing to
   * wait for and nothing that can arrive late.
   */
  const prerelease = isPrerelease();
  /**
   * Whether this build is the one published as the public release.
   *
   * **It is not a constant, and that is the point.** The badge says which
   * line this is, and a build that was compiled from `develop` but published
   * as the public one is on the public line even though the binary says
   * otherwise. The backend compares the commits and the answer arrives after
   * the panel may already be open.
   */
  const publicBuild = useSyncExternalStore(subscribePublicBuild, isPublicBuild, isPublicBuild);

  useEffect(() => {
    void appVersion().then(setVersion);
  }, []);

  /**
   * Whether the search found anything.
   *
   * **It is asked after the rows are drawn, and again when the section
   * changes.** The answer lives in the document: a row that does not match is
   * not rendered, so counting the rows is counting the answers.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rows change with the section, and the section is not read here — it is the trigger.
  useEffect(() => {
    if (query.trim() === "") {
      setFound(true);
      return;
    }
    setFound((rowsBox.current?.querySelectorAll(".setting-row").length ?? 0) > 0);
  }, [query, section]);

  /*
      The parts of the customisation, as tabs under the search.

      **Only the section that has parts shows them.** Personalización grew
      into three screens, and each one is short enough to read without
      scrolling; the other sections are still one screen each, and tabs
      that do not change anything are tabs that lie.

      **The phone gets them too.** The tabs are the way in and the way
      around: without them the phone would show one part of Personalización
      and no way to reach the other two.
  */
  const customTabs = (
    <div className="flex shrink-0 items-center gap-1.5 px-4 pt-3 sm:px-8 sm:pt-4">
      {CUSTOM_PARTS.map((part) => (
        <button
          key={part}
          type="button"
          onClick={() => setCustomPart(part)}
          aria-current={part === customPart ? "page" : undefined}
          className={`rounded-pill px-3.5 py-2 text-[13px] font-medium transition-colors duration-200 ${
            part === customPart
              ? "bg-white/12 text-ink"
              : "text-ink-muted hover:bg-white/6 hover:text-ink"
          }`}
        >
          {t[part]}
        </button>
      ))}
      <PeekButton t={t} />
    </div>
  );

  const body = (key: Section) => (
    <>
      {key === "sectionGeneral" && <General t={t} lang={lang} onLangChange={onLangChange} />}
      {key === "sectionAudio" && <Audio t={t} />}
      {key === "sectionAccount" && <Account t={t} account={account} />}
      {key === "sectionCustom" && (
        <>
          {customTabs}
          <Custom t={t} part={customPart} />
        </>
      )}
      {key === "sectionDiagnostics" && (
        <Diagnostics t={t} version={version} lang={lang} onOpenFeedback={onOpenFeedback} />
      )}
    </>
  );
  /*
      Which build this is, in words.

      **The inverted icon says it too, but only to somebody who knows
      what it means.** Two copies of the app on the same machine look
      the same otherwise, and "which one am I running" is the question
      that comes up exactly when something is wrong. A prerelease says
      so here; a release says nothing, because there is nothing to say.
      And a build that was compiled from `develop` but published as the
      public one says "public", because that is the line it is on.
  */
  const build = (
    <p className="tabular mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
      <span>v{version}</span>
      {prerelease && (
        <span className="rounded-pill bg-accent/15 px-1.5 py-px text-[10.5px] font-semibold tracking-wide uppercase text-accent-ink">
          {publicBuild ? t.publicBadge : t.prereleaseBadge}
        </span>
      )}
    </p>
  );

  if (isMobile()) {
    return (
      <PeekContext.Provider value={setPeek}>
        <PhoneSettings t={t} onClose={onClose} body={body} build={build} peek={peek} />
      </PeekContext.Provider>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 12 }}
      // Opacity and nothing else: the blur fades with it, and `backdrop-filter` is
      // never animated (DESIGN.md, Performance budget).
      animate={{ opacity: peek ? 0 : 1, scale: 1, y: 0 }}
      transition={{ ...SPRING_SHEET, opacity: { duration: 0.16 } }}
      className="glass-sheet absolute inset-4 z-40 flex overflow-hidden rounded-card"
      role="dialog"
      aria-modal="true"
      aria-label={t.settingsTitle}
    >
      <PeekContext.Provider value={setPeek}>
        <nav className="flex w-[236px] shrink-0 flex-col gap-1 border-r border-white/8 p-4">
          <div className="px-2 pt-2 pb-4">
            <h2 className="text-[19px] font-semibold tracking-tight">{t.settingsTitle}</h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">{t.settingsSubtitle}</p>
          </div>

          {SECTIONS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              aria-current={section === key ? "page" : undefined}
              className={`rounded-pill px-3.5 py-2.5 text-left text-[13.5px] font-medium transition-colors duration-200 ${
                section === key
                  ? "bg-white/12 text-ink"
                  : "text-ink-muted hover:bg-white/6 hover:text-ink"
              }`}
            >
              {t[key]}
            </button>
          ))}

          <div className="mt-auto border-t border-white/8 px-2 pt-3">
            <p className="text-[12px] text-ink-muted">{t.savedAutomatically}</p>
            {build}
          </div>
        </nav>

        {/*
          The content column: a header that does not move, and the scroll under it.

          **The close button was inside the scroll**, so it left with the content:
          in the sections long enough to scroll —Personalización, Diagnóstico— the
          way out of the panel disappeared exactly when the person was looking
          for it, and the only way back was to scroll up again.

          A door that closes when you walk towards it is not a door. The button
          now lives in a row of its own, above the scroll, and it stays where it
          is however far down the section goes.
      */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/*
            The header: the search on the left, the way out on the right.

            **The search is here because the options are going to be many.** The
            app wants to be personalisable, so the list of things a person can
            change only grows, and a list that only grows ends in a scroll. The
            search is the other half of the answer: the sub-sections keep each
            screen short, and this finds the one option in a hurry.
        */}
          <div className="flex shrink-0 items-center gap-3 px-8 pt-8">
            {/* The field is capped: a search that runs the whole width of the
              panel reads as an address bar, and the thing that says what is
              behind it —the X, in the corner— loses its neighbour. */}
            <div className="glass-control flex h-9 min-w-0 max-w-[440px] flex-1 items-center gap-2.5 rounded-pill px-4">
              <Search className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.settingsSearch}
                aria-label={t.settingsSearch}
                className="w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.close}
              className="ml-auto grid size-9 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
            >
              <X className="size-[18px]" strokeWidth={2} />
            </button>
          </div>

          {/*
            The parts of the customisation, as tabs under the search.

            **Only the section that has parts shows them.** Personalización grew
            into three screens, and each one is short enough to read without
            scrolling; the other sections are still one screen each, and tabs
            that do not change anything are tabs that lie.
        */}
          {section === "sectionCustom" && !query && customTabs}

          <div className="flex-1 overflow-y-auto px-8 pt-6 pb-8">
            <SearchContext.Provider value={query}>
              <div ref={rowsBox}>
                {section === "sectionGeneral" && (
                  <General t={t} lang={lang} onLangChange={onLangChange} />
                )}
                {section === "sectionAudio" && <Audio t={t} />}
                {section === "sectionAccount" && <Account t={t} account={account} />}
                {section === "sectionCustom" && <Custom t={t} part={customPart} />}
                {section === "sectionDiagnostics" && (
                  <Diagnostics
                    t={t}
                    version={version}
                    lang={lang}
                    onOpenFeedback={onOpenFeedback}
                  />
                )}
              </div>

              {/*
                The search that found nothing.

                **It says so, instead of leaving a blank page.** A search that
                returns silence reads as a broken app, and the person has no way
                of knowing whether the option they are looking for does not
                exist or whether the search is the one that is broken.

                The rows that do not match are not in the document at all, so
                counting them is counting the answers. The CSS can hide a card
                with no rows —`:has()` inside `:not()` is allowed— but it cannot
                do this: the answer is in a sibling, and a `:has()` inside a
                `:has()` is a selector the browsers refuse to parse.
            */}
              {query.trim() !== "" && !found && (
                <p className="px-1 text-[13px] text-ink-faint">{t.settingsNoResults}</p>
              )}
            </SearchContext.Provider>
          </div>
        </div>
      </PeekContext.Provider>
    </motion.div>
  );
}

const SECTION_ICONS: Record<Section, typeof User> = {
  sectionGeneral: Settings2,
  sectionAudio: AudioLines,
  sectionAccount: User,
  sectionCustom: Palette,
  sectionDiagnostics: Activity,
};

/**
 * Settings on the phone: two levels instead of a side column.
 *
 * The desktop's column of sections took more than half a phone's width, so
 * the list is the first screen and a section is the second, entering from the
 * right with a back arrow —the way a phone navigates, so the arrow means what
 * it says. The list does not stay under the section: both layers are on the
 * same glass, and a translucent page over another is two pages read at once.
 * It slides a little to the left and fades, and comes back the same way.
 *
 * The rows and cards inside a section are the panel's own (DESIGN.md, "The
 * phone"); only `Row` changes, which puts a wide control under its text.
 */
function PhoneSettings({
  t,
  onClose,
  body,
  build,
  peek,
}: {
  t: Record<StringKey, string>;
  onClose: () => void;
  body: (key: Section) => React.ReactNode;
  build: React.ReactNode;
  peek: boolean;
}) {
  const [open, setOpen] = useState<Section | null>(null);
  // Back leaves the section for the list, and the list for the app.
  useBack(true, () => (open ? setOpen(null) : onClose()));
  const header = (title: string, onBack: () => void, label: string) => (
    <div className="flex shrink-0 items-center gap-1 px-2 pt-2 pb-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={label}
        className="grid size-10 place-items-center rounded-pill text-ink-muted active:bg-white/10"
      >
        <ChevronLeft className="size-6" strokeWidth={2} />
      </button>
      <h2 className="text-[19px] font-semibold tracking-tight">{title}</h2>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: peek ? 0 : 1, y: 0 }}
      transition={{ ...SPRING_SHEET, opacity: { duration: 0.16 } }}
      className="glass-sheet fixed inset-x-3 top-[max(12px,env(safe-area-inset-top))] bottom-[max(12px,env(safe-area-inset-bottom))] z-40 overflow-hidden rounded-card"
      role="dialog"
      aria-modal="true"
      aria-label={t.settingsTitle}
    >
      <motion.div
        animate={open ? { x: -64, opacity: 0 } : { x: 0, opacity: 1 }}
        transition={SPRING_SHEET}
        className={`absolute inset-0 flex flex-col ${open ? "pointer-events-none" : ""}`}
        aria-hidden={open ? true : undefined}
      >
        {header(t.settingsTitle, onClose, t.close)}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <Group>
            {SECTIONS.map((key) => {
              const Icon = SECTION_ICONS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOpen(key)}
                  className="flex w-full items-center gap-3.5 border-b border-white/8 px-4 py-3.5 text-left last:border-b-0 active:bg-white/6"
                >
                  <Icon className="size-[19px] shrink-0 text-ink-muted" strokeWidth={2} />
                  <span className="flex-1 text-[14.5px] font-medium">{t[key]}</span>
                  <ChevronRight className="size-[18px] shrink-0 text-ink-faint" strokeWidth={2} />
                </button>
              );
            })}
          </Group>
          <div className="mt-4 px-1">
            <p className="text-[12px] text-ink-muted">{t.savedAutomatically}</p>
            {build}
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {open && (
          <motion.div
            key={open}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={SPRING_SHEET}
            className="absolute inset-0 flex flex-col"
          >
            {header(t[open], () => setOpen(null), t.back)}
            <div className="flex-1 overflow-y-auto px-4 pb-6">{body(open)}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * The theme applies the moment it is picked: the whole window is the preview.
 * The read waits for the backend so the control never shows a choice that is
 * not the saved one, and the paint already happened at startup from the cache.
 */
function ThemeSelect({
  t,
  value,
  onChange,
}: {
  t: Record<StringKey, string>;
  value: Theme;
  onChange: (next: Theme) => void;
}) {
  return (
    <Select
      value={value}
      onChange={(next) => onChange(next as Theme)}
      options={[
        { value: "dark", label: t.themeDark },
        { value: "light", label: t.themeLight },
        { value: "system", label: t.themeSystem },
      ]}
    />
  );
}

function General({
  t,
  lang,
  onLangChange,
}: {
  t: Record<StringKey, string>;
  lang: Lang;
  onLangChange: (lang: Lang) => void;
}) {
  return (
    <div className="max-w-[620px]">
      <Group>
        <Row label={t.language}>
          <Select
            value={lang}
            onChange={(v) => onLangChange(v as Lang)}
            options={[
              { value: "es", label: "Español" },
              { value: "en", label: "English" },
            ]}
          />
        </Row>
        <Row label={t.colourMode} hint={t.colourModeHint}>
          <Select
            defaultValue="off"
            options={[
              { value: "off", label: t.colourModeOff },
              { value: "on", label: t.colourModeOn },
            ]}
          />
        </Row>
      </Group>

      {/* A phone has no updater: the system installs the app. */}
      {!isMobile() && (
        <>
          <Updates t={t} />

          <Prerelease t={t} />
        </>
      )}

      <DevPanel t={t} />
    </div>
  );
}

/**
 * "There is a new version", and the button that does it.
 *
 * **This used to be the only place the updater appeared.** The file said so out
 * loud — *no badge, no toast, nothing at launch* — and the reason was good: a
 * music player that advertises its own maintenance is a music player nobody
 * keeps. What it had not accounted for is the person who never opens Settings.
 * The badge and the alert answer that without giving up the reason: the update
 * is announced once, quietly, and **nothing is installed by itself.** The click
 * is still here, still in Settings, still the user's — because Starless is
 * playing and an app that cuts your music to install a patch is an app you turn
 * off.
 */
function Updates({ t }: { t: Record<StringKey, string> }) {
  const state = useSyncExternalStore(subscribeUpdate, updateState, updateState);
  const update = installableUpdate(state);
  const version = pendingVersion(state);
  const simulated = state.status === "simulated";
  // The public release is offered even when it is older: being on a prerelease
  // and wanting the public one is a door, not a mistake.
  const goingBack = update ? isGoingBack(update) : false;
  // The public release and the build that is running can carry the same
  // number —the public 0.5.3 and the develop 0.5.3— and they are two
  // different programs. The row says which one it is offering.
  const sameNumber = update ? update.version === update.currentVersion : false;
  const backHint = sameNumber ? t.updateGoBackSame : t.updateGoBack;
  const backLabel = sameNumber ? t.updateGoBackSameShort : t.updateGoBackShort;

  return (
    <div className="mt-5">
      <Group>
        <Row
          label={t.updatesTitle}
          hint={
            state.status === "installFailed"
              ? t.updateInstallError
              : goingBack
                ? backHint.replace("{version}", version ?? "")
                : version === null
                  ? t.updatesHint
                  : simulated
                    ? t.updateSimulated.replace("{version}", version)
                    : t.updateAvailable.replace("{version}", version)
          }
        >
          <div className="flex items-center gap-2">
            {state.status === "downloading" && (
              <span className="flex items-center gap-2 text-[13px] text-ink-muted">
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                {state.total > 0
                  ? `${Math.round((state.received / state.total) * 100)}%`
                  : t.updateDownloading}
              </span>
            )}

            {update && state.status !== "downloading" && (
              <button
                type="button"
                onClick={() => void installUpdate(update)}
                className="flex items-center gap-2 rounded-pill bg-live px-4 py-2.5 text-[13px] font-semibold text-[#0b0b0f] transition-[filter] duration-200 hover:brightness-110"
              >
                <Download className="size-4" strokeWidth={2} />
                {goingBack ? backLabel.replace("{version}", version ?? "") : t.updateInstall}
              </button>
            )}

            {/* A version with nothing behind it. The button stays unlit and says
                why, because a green "Update" that goes nowhere is the one thing
                worse than no button at all. */}
            {simulated && !update && (
              <span className="flex items-center gap-2 rounded-pill border border-white/14 px-4 py-2.5 text-[13px] font-medium text-ink-faint">
                {t.updateSimulatedShort}
              </span>
            )}

            {!update && !simulated && (
              <button
                type="button"
                onClick={() => void checkForUpdate()}
                disabled={state.status === "checking"}
                className="flex items-center gap-2 rounded-pill border border-white/14 bg-white/6 px-4 py-2.5 text-[13px] font-medium transition-colors duration-200 hover:bg-white/10 disabled:opacity-50"
              >
                {state.status === "checking" ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                ) : (
                  <RefreshCw className="size-4" strokeWidth={2} />
                )}
                {state.status === "current" ? t.updateCurrent : t.updateCheck}
              </button>
            )}
          </div>
        </Row>
      </Group>
    </div>
  );
}

function Audio({ t }: { t: Record<StringKey, string> }) {
  const [crossfade, setCrossfade] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void crossfadeSeconds()
      .then((value) => {
        if (alive) setCrossfade(value);
      })
      // Same reason as the opacity: a failed read must not leave the slider
      // stuck on "…". Off is the honest default.
      .catch(() => {
        if (alive) setCrossfade(0);
      });
    return () => {
      alive = false;
    };
  }, []);

  const changeCrossfade = (value: number) => {
    setCrossfade(value);
    void setCrossfadeSeconds(value).catch(() => {});
  };

  const queryClient = useQueryClient();
  const [keepHistory, setKeepHistory] = useState<boolean | null>(null);
  const [cleared, setCleared] = useState(false);
  useEffect(() => {
    let alive = true;
    void historyEnabled()
      .then((value) => {
        if (alive) setKeepHistory(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const changeHistory = (on: boolean) => {
    setKeepHistory(on);
    void setHistoryEnabled(on).catch(() => {});
  };
  const wipeHistory = () => {
    setCleared(true);
    void clearHistory()
      .then(() => queryClient.invalidateQueries({ queryKey: historyKey }))
      .catch(() => setCleared(false));
  };

  // These two were drawn and did nothing: the select and the switch kept their
  // own state, and every song played at librespot's default 160 kbps. Now
  // they are saved, and the player reads them when it is built.
  const [quality, changeQuality] = useBackendSetting<AudioQuality>(
    audioQuality,
    setAudioQuality,
    "high",
  );
  const [levelled, changeLevelled] = useBackendSetting(normalisation, setNormalisation, false);

  return (
    <div className="max-w-[620px]">
      <Group>
        <Row label={t.audioQuality} hint={t.audioQualityHint}>
          <Select
            value={quality ?? "high"}
            onChange={(value) => changeQuality(value as AudioQuality)}
            options={[
              { value: "low", label: t.qualityLow },
              { value: "normal", label: t.qualityNormal },
              { value: "high", label: t.qualityHigh },
            ]}
          />
        </Row>
        <Row label={t.normalisation} hint={t.normalisationHint}>
          <Toggle checked={levelled ?? false} onChange={changeLevelled} label={t.normalisation} />
        </Row>
        {/*
          A slider and not a switch: 0 is off, so one control says both whether
          it is on and how long. It applies from the next song that ends on its
          own — a click on another song never fades, it plays now.
        */}
        <Row label={t.crossfade} hint={t.crossfadeHint}>
          <span className="flex items-center gap-3">
            <SliderValue
              value={crossfade}
              text={
                crossfade === null
                  ? "…"
                  : crossfade === 0
                    ? t.crossfadeOff
                    : t.crossfadeSeconds.replace("{n}", String(crossfade))
              }
            />
            <SmoothSlider
              value={crossfade ?? 0}
              max={CROSSFADE_MAX}
              disabled={crossfade === null}
              label={t.crossfade}
              onChange={changeCrossfade}
            />
          </span>
        </Row>
      </Group>

      {/*
        The history Home reads (`history.rs`). On this machine only, and the
        person's to switch off or wipe: it is not telemetry because it never
        leaves the disk, and that is only true while it is theirs to delete.
      */}
      <div className="mt-9">
        <Group>
          <Row label={t.historySetting} hint={t.historySettingHint}>
            <Toggle
              checked={keepHistory ?? false}
              onChange={changeHistory}
              label={t.historySetting}
            />
          </Row>
          <Row label={t.clearHistory} hint={cleared ? t.historyCleared : undefined}>
            <button
              type="button"
              onClick={wipeHistory}
              disabled={cleared}
              className="h-9 rounded-pill bg-white/8 px-4 text-[13px] font-semibold transition-colors duration-200 hover:bg-white/12 disabled:opacity-50"
            >
              {t.clearHistory}
            </button>
          </Row>
        </Group>
      </div>
    </div>
  );
}

/**
 * The number next to the crossfade slider, sliding the way the value moved.
 *
 * Up when it grows and down when it shrinks: the label changes with every step
 * of the drag, and a number that swaps in place reads as flicker, while one
 * that rolls reads as the same number counting.
 */
function SliderValue({ value, text }: { value: number | null; text: string }) {
  const previous = useRef(value);
  const direction =
    value !== null && previous.current !== null && value < previous.current ? -1 : 1;
  useEffect(() => {
    previous.current = value;
  }, [value]);

  return (
    <span className="relative grid h-5 min-w-[74px] overflow-hidden text-right text-[12px] text-ink-faint tabular">
      <AnimatePresence initial={false} custom={direction} mode="popLayout">
        <motion.span
          key={text}
          custom={direction}
          variants={{
            enter: (d: number) => ({ y: 10 * d, opacity: 0 }),
            center: { y: 0, opacity: 1 },
            exit: (d: number) => ({ y: -10 * d, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={SPRING}
          className="col-start-1 row-start-1 leading-5"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Who is signed in, and the one button that ends it.
 *
 * Sign-out was a stray icon in the library header for a while. It lives here
 * because it is an account action, not a browsing one — and this section is the
 * only place that can name the account it would end, so the button and its
 * consequence are read together instead of one icon apart from the truth.
 *
 * Still a single click, as it was in the library: asking twice is friction for
 * the common case, and the label says plainly what it does.
 */
/**
 * The prerelease channel: a second row, and nothing else about it changes.
 *
 * **It does not touch the badge.** The badge on the Settings button asks the
 * release channel, and a build of `develop` has no business being the reason
 * somebody gets nagged about maintenance. This is a button somebody goes and
 * presses, which is the same rule the release updater already follows.
 *
 * The row says what is about to happen — it installs over what is running — and
 * says it before the button, not in a dialog afterwards. Installing a develop
 * build replaces the installed app; that is what an update is, and the only
 * reason it was ever a problem is that nobody said it out loud.
 */
function Prerelease({ t }: { t: Record<StringKey, string> }) {
  const state = useSyncExternalStore(subscribePrerelease, prereleaseState, prereleaseState);
  const update = installablePrerelease(state);
  const version = prereleaseVersion(state);

  const hint = (() => {
    switch (state.status) {
      case "available":
      case "ready":
        return t.prereleaseAvailable.replace("{version}", version ?? "");
      case "same":
        return t.prereleaseSame.replace("{version}", version ?? "");
      case "error":
        // The rate limit is a fact with an ending: the budget comes back. It is
        // not the same thing as a GitHub that is not there, and the row says
        // which one it is.
        return state.reason === "rate_limited" ? t.prereleaseRateLimited : t.prereleaseError;
      case "installFailed":
        return t.prereleaseInstallError;
      default:
        return t.prereleaseHint;
    }
  })();

  return (
    <div className="mt-5">
      <Group>
        <Row label={t.prereleaseTitle} hint={hint}>
          <div className="flex items-center gap-2">
            {state.status === "downloading" && (
              <span className="flex items-center gap-2 text-[13px] text-ink-muted">
                <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
                {state.total > 0
                  ? `${Math.round((state.received / state.total) * 100)}%`
                  : t.updateDownloading}
              </span>
            )}

            {update && state.status !== "downloading" && (
              <button
                type="button"
                onClick={() => void installPrerelease(update)}
                className="flex items-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-[13px] font-semibold text-on-accent transition-opacity duration-200 hover:opacity-90"
              >
                <Download className="size-4" strokeWidth={2} />
                {t.prereleaseInstall}
              </button>
            )}

            {!update && state.status !== "downloading" && (
              <button
                type="button"
                onClick={() => void checkPrerelease()}
                disabled={state.status === "checking"}
                className="flex items-center gap-2 rounded-pill border border-white/14 bg-white/6 px-4 py-2.5 text-[13px] font-medium transition-colors duration-200 hover:bg-white/10 disabled:opacity-50"
              >
                {state.status === "checking" ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} />
                ) : (
                  <FlaskConical className="size-4" strokeWidth={2} />
                )}
                {state.status === "checking"
                  ? t.prereleaseChecking
                  : state.status === "none"
                    ? t.prereleaseNone
                    : t.prereleaseCheck}
              </button>
            )}
          </div>
        </Row>
      </Group>
    </div>
  );
}

/**
 * Where the app stops deciding for the user.
 *
 * One control on purpose: this section earns its place by existing, and the second
 * option is the one that decides what belongs in it.
 */
function Custom({ t, part }: { t: Record<StringKey, string>; part: CustomPart }) {
  const [opacity, setOpacity] = useState<number | null>(null);
  const [accent, setAccent] = useState<string | null>(null);
  const opacityCommit = useLiveCommit<number>(applySurfaceOpacity, (value) => {
    void setSurfaceOpacity(value).catch(() => {});
  });
  const [resetStep, setResetStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [resetError, setResetError] = useState<string | null>(null);
  // The controls under this key keep their own copy of what they show (the theme,
  // the look of the picture), so after a reset they are drawn again and read it back.
  const [resets, setResets] = useState(0);
  // Here and not in the select: its row has to know whether there is anything to reset.
  const [themeChoice, setThemeChoice] = useState<Theme>("dark");

  useEffect(() => {
    let alive = true;
    void savedTheme()
      .then((saved) => {
        if (alive) setThemeChoice(saved);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const changeTheme = (next: Theme) => {
    setThemeChoice(next);
    applyTheme(next);
    void setTheme(next).catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    void surfaceOpacity()
      .then((value) => {
        if (alive) {
          setOpacity(value);
          applySurfaceOpacity(value);
        }
      })
      .catch(() => {
        // A failed read must not strand the control in its loading state. The
        // slider *is* this section, and a slider that never leaves `…` reads as
        // "this does nothing" rather than "the read failed" — which is exactly
        // what happened under plain `vite`, where nothing answers `invoke`.
        if (alive) setOpacity(SURFACE_OPACITY_DEFAULT);
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Three answers, on purpose.
   *
   * **The number and the thumb answer at pointer speed, the surfaces about 15 times
   * a second, and the disk once the hand stops.** The applied value is
   * `--surface-alpha`, and every surface in the app reads it, so applying it on every
   * pointer event is what made this control feel heavy. It still has to be seen while
   * it is dragged, and the panel has stepped aside for that, which also takes the
   * biggest surface out of the repaint.
   */
  const change = (value: number) => {
    setOpacity(value);
    opacityCommit.push(value);
  };

  /**
   * Two clicks, because this one takes something back: the picture is a file the
   * person would have to go and find again. A write still waiting on the slider
   * is cancelled first, or it would land on top of the reset.
   */
  const reset = () => {
    opacityCommit.cancel();
    setResetError(null);
    setResetStep("busy");
    void resetCustomisation()
      .then(() => {
        setOpacity(SURFACE_OPACITY_DEFAULT);
        setAccent(null);
        setThemeChoice("dark");
        setResets((count) => count + 1);
      })
      .catch((e) => setResetError(explain(e)))
      .finally(() => setResetStep("idle"));
  };

  // Same answer for the same reason: the panel is the preview of its own choice.
  // The write is not awaited for the same reason the opacity one is not — a slow
  // disk must not make the colour arrive late.
  useEffect(() => {
    let alive = true;
    void accentColor()
      .then((value) => {
        if (alive) setAccent(value);
      })
      .catch(() => {
        if (alive) setAccent(ACCENT_DEFAULT);
      });
    return () => {
      alive = false;
    };
  }, []);

  const changeAccent = (value: string) => {
    setAccent(value);
    applyAccentColor(value);
    void setAccentColor(value).catch(() => {});
  };

  // The ring around the pencil answers "which one is mine?" for a colour that is
  // not one of the six. Without it, picking a custom colour de-selects all six and
  // marks nothing, and the row looks like it forgot what it is showing.
  const isCustom = accent !== null && !ACCENT_PRESETS.includes(accent);

  const effect = useEffectsSettings();
  const changeEffect = <K extends EffectName>(name: K, value: Effects[K]) => {
    applyEffects({ ...effect, [name]: value });
    void setEffect(name, value).catch(() => {});
  };
  const quiet = (Object.keys(EFFECTS_QUIET) as (keyof typeof EFFECTS_QUIET)[]).every(
    (name) => effect[name] === EFFECTS_QUIET[name],
  );
  // Only the movement: `shape` and `grain` stay as the person set them.
  const changeAllEffects = (next: Partial<Effects>) => {
    applyEffects({ ...effect, ...next });
    // One after another: each save reads and rewrites settings.json, and four
    // at once could each overwrite the others with the file as it found it.
    void (async () => {
      for (const name of Object.keys(next) as EffectName[]) {
        await setEffect(name, next[name] as Effects[typeof name]).catch(() => {});
      }
    })();
  };

  // What the quiet mode switch goes back to when it is turned off.
  const moving = {
    glow: EFFECTS_DEFAULT.glow,
    beat: EFFECTS_DEFAULT.beat,
    bloom: EFFECTS_DEFAULT.bloom,
    motion: EFFECTS_DEFAULT.motion,
  };

  /**
   * The three screens of the customisation.
   *
   * **Each one is a grid of cards, and the grid is two columns wide.** The
   * window is wide and the settings were using a third of it: the space was
   * there and the scroll was not necessary. A grid and not columns, because a
   * column balances by height and leaves a hole under the shorter one, and a
   * card that is in the second column says nothing about the one next to it.
   */
  const cards = (which: CustomPart) => {
    if (which === "customBackground") {
      return <BackgroundSettings t={t} effect={effect} changeEffect={changeEffect} />;
    }
    if (which === "customEffects") {
      return (
        <>
          {/*
            The movement under the glass, each one a thing to take back: the light
            that trails the pointer, the pulse on the volume, the bloom and the
            interface's own animation. Applied the moment it is picked, because all
            of them are on screen behind this panel. Quiet mode is not a fifth
            setting: it is on when the other four are off, and writes all four.
          */}
          <Group>
            <Row
              label={t.quietMode}
              hint={t.quietModeHint}
              compare
              onReset={quiet ? () => changeAllEffects(moving) : undefined}
            >
              <Toggle
                checked={quiet}
                onChange={(on) => changeAllEffects(on ? EFFECTS_QUIET : moving)}
                label={t.quietMode}
              />
            </Row>
            <Row
              label={t.pointerGlow}
              hint={t.pointerGlowHint}
              compare
              onReset={resetEffect(effect, changeEffect, "glow")}
            >
              <Toggle
                checked={effect.glow === "on"}
                onChange={(on) => changeEffect("glow", on ? "on" : "off")}
                label={t.pointerGlow}
              />
            </Row>
            <Row
              label={t.beatPulse}
              hint={t.beatPulseHint}
              compare
              onReset={resetEffect(effect, changeEffect, "beat")}
            >
              <Select
                value={effect.beat}
                onChange={(value) => changeEffect("beat", value as Effects["beat"])}
                options={[
                  { value: "strong", label: t.beatStrong },
                  { value: "soft", label: t.beatSoft },
                  { value: "off", label: t.effectOff },
                ]}
              />
            </Row>
          </Group>
          <Group>
            <Row
              label={t.bloomLight}
              hint={t.bloomLightHint}
              compare
              onReset={resetEffect(effect, changeEffect, "bloom")}
            >
              <Select
                value={effect.bloom}
                onChange={(value) => changeEffect("bloom", value as Effects["bloom"])}
                options={[
                  { value: "normal", label: t.bloomNormal },
                  { value: "soft", label: t.bloomSoft },
                  { value: "off", label: t.effectOff },
                ]}
              />
            </Row>
            <Row
              label={t.uiMotion}
              hint={t.uiMotionHint}
              compare
              onReset={resetEffect(effect, changeEffect, "motion")}
            >
              <Toggle
                checked={effect.motion === "on"}
                onChange={(on) => changeEffect("motion", on ? "on" : "off")}
                label={t.uiMotion}
              />
            </Row>
          </Group>
        </>
      );
    }
    return (
      <>
        {/*
            El tema va primero.

            **Es la decisión de la que dependen las demás.** El acento, el
            vidrio, la forma de los controles y hasta el texto de esta ventana se
            leen contra el tema elegido: es lo que hay que mirar antes de
            personalizar nada más. Y estaba en General, que es la sección donde
            vive lo que la app decide —no lo que decide la persona.
        */}
        <Group>
          <Row
            label={t.theme}
            compare
            onReset={themeChoice !== "dark" ? () => changeTheme("dark") : undefined}
          >
            <ThemeSelect t={t} value={themeChoice} onChange={changeTheme} />
          </Row>
        </Group>

        {/*
          The accent is the one colour the user owns outright. It reaches the Inicio
          button, the mark beside the selected playlist, the play buttons and every
          primary action in the app — so the control shows the consequence instead of
          describing it: the swatches *are* the accent, and picking one repaints this
          panel's own controls while the finger is still on it.

          Presets first and the native picker last: the presets are the colours that
          are known to keep a readable label on top of them, and the picker is the
          door for the one that is not.
        */}
        <Group>
          <Row
            label={t.accentColor}
            hint={t.accentColorHint}
            compare
            onReset={
              (accent ?? ACCENT_DEFAULT) !== ACCENT_DEFAULT
                ? () => changeAccent(ACCENT_DEFAULT)
                : undefined
            }
          >
            {/* The swatches are tight on purpose: seven of them plus the wheel
                have to fit next to the label in a card that is half a screen
                wide, and a row that wraps leaves the card looking empty. */}
            <span className="flex items-center gap-1">
              {ACCENT_PRESETS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => changeAccent(hex)}
                  aria-label={hex}
                  aria-pressed={(accent ?? ACCENT_DEFAULT) === hex}
                  style={{ backgroundColor: hex }}
                  className={`size-7 rounded-pill border-2 transition-transform duration-150 hover:scale-105 ${
                    (accent ?? ACCENT_DEFAULT) === hex ? "border-ink" : "border-white/14"
                  }`}
                />
              ))}
              <span className="relative ml-1 size-7 shrink-0">
                <input
                  type="color"
                  value={accent ?? ACCENT_DEFAULT}
                  onChange={(e) => changeAccent(e.target.value)}
                  aria-label={t.accentColorCustom}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                />
                {/* The native control is the invisible one. What shows is this: a
                  wheel of colours with a pencil on it, because a lone colour
                  swatch next to six swatches reads as a seventh colour, and a
                  rounded rectangle reads as a button that is broken. */}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-pill"
                  style={{
                    background:
                      "conic-gradient(#ff5a36, #ffb020, #3ddc97, #4cc9f0, #7aa2ff, #c08bff, #ff8fb1, #ff5a36)",
                  }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-pill bg-black/45"
                />
                <Pencil
                  className="pointer-events-none absolute inset-0 m-auto size-3.5 text-[#fff]"
                  strokeWidth={2}
                />
                {isCustom && (
                  <span
                    aria-hidden="true"
                    className="absolute -inset-[3px] rounded-pill border-2 border-ink"
                  />
                )}
              </span>
            </span>
          </Row>
        </Group>

        {/*
            The opacity is the one control that does not fit in half a column.

            **The number, the slider and the swatch add up to more than a
            column holds,** and a row that does not fit does not get smaller:
            it gets broken. So this card crosses both columns, and the ends of
            the scale —Sólido, Translúcido— sit under the slider, which is the
            thing they are the ends of.
        */}
        <Group span>
          <Row
            label={t.surfaceOpacity}
            hint={t.surfaceOpacityHint}
            onReset={
              opacity !== null && opacity !== SURFACE_OPACITY_DEFAULT
                ? () => change(SURFACE_OPACITY_DEFAULT)
                : undefined
            }
          >
            <span className="flex items-center gap-3">
              <span className="min-w-[74px] text-right text-[12px] text-ink-faint tabular">
                {opacity === null ? "…" : `${opacity}%`}
              </span>
              <span className="flex flex-col gap-1.5">
                <PeekSlider
                  value={opacity ?? SURFACE_OPACITY_DEFAULT}
                  valueText={`${opacity ?? SURFACE_OPACITY_DEFAULT}%`}
                  min={SURFACE_OPACITY_MIN}
                  max={SURFACE_OPACITY_MAX}
                  step={1}
                  disabled={opacity === null}
                  onChange={change}
                  label={t.surfaceOpacity}
                />
                <span className="flex justify-between text-[11.5px] text-ink-faint">
                  <span>{t.surfaceOpacityClear}</span>
                  <span>{t.surfaceOpacitySolid}</span>
                </span>
              </span>
              {/*
                The swatch is what makes this control legible while it is being
                dragged. The surfaces that read the value are behind this sheet,
                so without a legend right here the thumb moves and nothing answers.

                It reads its own alpha, not the one the menus read: the legend is
                a gradient over a 46x28 box and can answer at pointer speed, while
                `--surface-alpha` only moves once the hand stops.
              */}
              <span
                aria-hidden="true"
                className="surface-legend"
                style={
                  {
                    "--legend-alpha": (opacity ?? SURFACE_OPACITY_DEFAULT) / 100,
                  } as CSSProperties
                }
              />
            </span>
          </Row>
        </Group>
      </>
    );
  };

  /**
   * What is on screen.
   *
   * **The search crosses the three parts.** The person who types "atenuar" does
   * not know or care which part that option lives in —they know the word they
   * are looking for. So while there is a search, every part is drawn and the
   * rows that do not match leave; the parts that end up empty leave too.
   */
  const query = useSearch();
  const searching = query.trim() !== "";

  return (
    <CompareContext.Provider
      value={{ compare: t.compare, done: t.compareDone, reset: t.resetCustomisationAction }}
    >
      <div className="max-w-[1120px]">
        <div key={resets} className="not-has-[.setting-row]:hidden">
          {searching ? (
            CUSTOM_PARTS.map((part) => (
              <section key={part} className="not-has-[.setting-row]:hidden mb-8 last:mb-0">
                <h3 className="mb-2.5 px-1 text-[11.5px] font-semibold tracking-[0.12em] uppercase text-ink-faint">
                  {t[part]}
                </h3>
                <div className="grid items-start gap-5 lg:grid-cols-2">{cards(part)}</div>
              </section>
            ))
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-2">{cards(part)}</div>
          )}
        </div>
        {/* Under the parts and not in one of them: it answers for all three. */}
        <div className="mt-5">
          <Group>
            <Row
              label={t.resetCustomisation}
              hint={
                resetError ??
                (resetStep === "idle" ? t.resetCustomisationHint : t.resetCustomisationWarning)
              }
            >
              <span className="flex items-center gap-2">
                {resetStep === "idle" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setResetError(null);
                      setResetStep("confirm");
                    }}
                    className="rounded-pill border border-white/14 bg-white/6 px-4 py-2 text-[13px] font-medium transition-colors duration-200 hover:bg-white/10"
                  >
                    {t.resetCustomisationAction}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={resetStep === "busy"}
                      onClick={() => setResetStep("idle")}
                      className="h-9 rounded-pill px-3 text-[13px] font-medium text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink disabled:opacity-50"
                    >
                      {t.resetCustomisationCancel}
                    </button>
                    <button
                      type="button"
                      disabled={resetStep === "busy"}
                      onClick={reset}
                      className="flex items-center gap-2 rounded-pill bg-accent px-4 py-2 text-[13px] font-semibold text-on-accent transition-opacity duration-200 disabled:opacity-50"
                    >
                      {resetStep === "busy" && <Loader2 className="size-4 animate-spin" />}
                      {t.resetCustomisationConfirm}
                    </button>
                  </>
                )}
              </span>
            </Row>
          </Group>
        </div>
      </div>
    </CompareContext.Provider>
  );
}

/**
 * The ground behind the glass: the person's own picture, and where the grey
 * light sits over it. Same split as the surface opacity: the sliders' numbers
 * follow the hand, the window follows about 15 times a second, and the disk waits
 * for the hand to stop. The step of 5 leaves 20 values at most in a whole sweep,
 * which is what keeps a blurred photo the size of the screen affordable here.
 */
function BackgroundSettings({
  t,
  effect,
  changeEffect,
}: {
  t: Record<StringKey, string>;
  effect: Effects;
  changeEffect: <K extends EffectName>(name: K, value: Effects[K]) => void;
}) {
  const background = useBackground();
  const [dim, setDim] = useState(background.dim);
  const [blur, setBlur] = useState(background.blur);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const lookCommit = useLiveCommit<{ dim: number; blur: number }>(
    (look) => applyBackgroundLook(look.dim, look.blur),
    (look) => {
      void saveBackgroundLook(look.dim, look.blur).catch(() => {});
    },
  );

  // The saved look can arrive after the panel is already open. While the hand is
  // moving, what the store holds is a step behind it, and drawing that would pull
  // the number backwards under the hand.
  useEffect(() => {
    if (lookCommit.pending()) return;
    setDim(background.dim);
    setBlur(background.blur);
  }, [lookCommit, background.dim, background.blur]);

  const changeLook = (nextDim: number, nextBlur: number) => {
    setDim(nextDim);
    setBlur(nextBlur);
    lookCommit.push({ dim: nextDim, blur: nextBlur });
  };

  const pick = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    void pickBackground(file)
      .catch((e) => setError(explain(e)))
      .finally(() => setBusy(false));
  };

  const remove = () => {
    setError(null);
    void clearBackground().catch((e) => setError(explain(e)));
  };

  return (
    <>
      {/*
          The picture and the light over it are one card, and the shape of the
          light is another: the second one is about the app itself and it would
          be a strange neighbour to the button that picks a file.
      */}
      <Group>
        <Row label={t.backgroundImage} hint={error ?? t.backgroundImageHint}>
          <span className="flex items-center gap-2">
            {background.url && (
              <span
                aria-hidden="true"
                className="h-9 w-14 shrink-0 rounded-[8px] border border-white/14 bg-cover bg-center"
                style={{ backgroundImage: `url(${background.url})` }}
              />
            )}
            {/* The native picker is the door; the button is what shows. */}
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                pick(e.target.files?.[0]);
                // Picking the same file twice is a choice too.
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => input.current?.click()}
              className="flex items-center gap-2 rounded-pill border border-white/14 bg-white/6 px-4 py-2 text-[13px] font-medium transition-colors duration-200 hover:bg-white/10 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ImagePlus className="size-4" />
              )}
              {background.url ? t.backgroundImageChange : t.backgroundImagePick}
            </button>
            {background.url && (
              <button
                type="button"
                onClick={remove}
                className="h-9 rounded-pill px-3 text-[13px] font-medium text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
              >
                {t.backgroundImageRemove}
              </button>
            )}
          </span>
        </Row>
        {/*
            The cover sits in this card and not with the effects: it is the same
            layer as the picture, drawn with the same dim and blur, so the two
            sliders below answer for whichever of the two is on screen. Desktop
            only — the phone has no lyrics in the main surface to sit beside.
        */}
        {!isMobile() && (
          <Row
            label={t.coverBackground}
            hint={t.coverBackgroundHint}
            compare
            onReset={resetEffect(effect, changeEffect, "cover")}
          >
            <Select
              value={effect.cover}
              onChange={(value) => changeEffect("cover", value as Effects["cover"])}
              options={[
                { value: "off", label: t.effectOff },
                { value: "lyrics", label: t.coverBackgroundLyrics },
                { value: "always", label: t.coverBackgroundAlways },
              ]}
            />
          </Row>
        )}
        {(background.url || (!isMobile() && effect.cover !== "off")) && (
          <>
            <Row
              label={t.backgroundDim}
              hint={t.backgroundDimHint}
              onReset={
                dim !== BACKGROUND_DEFAULT.dim
                  ? () => changeLook(BACKGROUND_DEFAULT.dim, blur)
                  : undefined
              }
            >
              <span className="flex items-center gap-3">
                <span className="min-w-[40px] text-right text-[12px] text-ink-faint tabular">
                  {dim}%
                </span>
                <PeekSlider
                  value={dim}
                  valueText={`${dim}%`}
                  min={0}
                  max={BACKGROUND_DIM_MAX}
                  step={5}
                  onChange={(value) => changeLook(value, blur)}
                  label={t.backgroundDim}
                />
              </span>
            </Row>
            <Row
              label={t.backgroundBlur}
              hint={t.backgroundBlurHint}
              onReset={
                blur !== BACKGROUND_DEFAULT.blur
                  ? () => changeLook(dim, BACKGROUND_DEFAULT.blur)
                  : undefined
              }
            >
              <span className="flex items-center gap-3">
                <span className="min-w-[40px] text-right text-[12px] text-ink-faint tabular">
                  {blur}%
                </span>
                <PeekSlider
                  value={blur}
                  valueText={`${blur}%`}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(value) => changeLook(dim, value)}
                  label={t.backgroundBlur}
                />
              </span>
            </Row>
          </>
        )}
      </Group>
      <Group>
        <Row
          label={t.bloomShape}
          hint={t.bloomShapeHint}
          compare
          onReset={resetEffect(effect, changeEffect, "shape")}
        >
          <Select
            value={effect.shape}
            onChange={(value) => changeEffect("shape", value as Effects["shape"])}
            options={[
              { value: "top", label: t.bloomShapeTop },
              { value: "corners", label: t.bloomShapeCorners },
              { value: "center", label: t.bloomShapeCenter },
              { value: "side", label: t.bloomShapeSide },
            ]}
          />
        </Row>
        <Row
          label={t.grain}
          hint={t.grainHint}
          compare
          onReset={resetEffect(effect, changeEffect, "grain")}
        >
          <Toggle
            checked={effect.grain === "on"}
            onChange={(on) => changeEffect("grain", on ? "on" : "off")}
            label={t.grain}
          />
        </Row>
      </Group>
    </>
  );
}

function Account({ t, account }: { t: Record<StringKey, string>; account: UserAccount | null }) {
  // The registry decides, not the switch: in a development build nothing is
  // written, so the switch draws what came back and does not move.
  const [atSignIn, setAtSignIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void startWithWindows()
      .then((value) => {
        if (alive) setAtSignIn(value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const changeAtSignIn = (on: boolean) => {
    setAtSignIn(on);
    void setStartWithWindows(on)
      .then(setAtSignIn)
      .catch(() => setAtSignIn(!on));
  };
  const [toTray, changeToTray] = useBackendSetting(closeToTray, setCloseToTray, true);

  return (
    <div className="max-w-[620px]">
      <Group>
        <Row label={t.signedInAs}>
          <span className="flex items-center gap-2.5 text-[13.5px]">
            <span className="grid size-8 place-items-center rounded-pill bg-white/10">
              <User className="size-4 text-ink-muted" strokeWidth={2} />
            </span>
            <span className="font-medium">{account?.display_name || account?.id || t.loading}</span>
            {account?.product && (
              <span className="text-[12.5px] text-ink-muted">
                {account.product === "premium" ? t.planPremium : t.planFree}
              </span>
            )}
          </span>
        </Row>
        {/* Windows' sign-in and its tray; a phone has neither. */}
        {!isMobile() && (
          <>
            <Row label={t.startWithWindows} hint={t.startWithWindowsHint}>
              <Toggle
                checked={atSignIn ?? false}
                onChange={changeAtSignIn}
                label={t.startWithWindows}
              />
            </Row>
            <Row label={t.closeToTray} hint={t.closeToTrayHint}>
              <Toggle checked={toTray ?? true} onChange={changeToTray} label={t.closeToTray} />
            </Row>
          </>
        )}
      </Group>
      <div className="mt-5">
        <button
          type="button"
          onClick={() => void signOut().catch(() => {})}
          className="flex items-center gap-2 rounded-pill border border-white/14 bg-white/6 px-5 py-2.5 text-[13.5px] font-medium text-ink transition-colors duration-200 hover:bg-white/12"
        >
          <LogOut className="size-4 text-ink-muted" strokeWidth={2} />
          {t.signOut}
        </button>
      </div>
    </div>
  );
}

function Diagnostics({
  t,
  version,
  lang,
  onOpenFeedback,
}: {
  t: Record<StringKey, string>;
  version: string;
  lang: Lang;
  onOpenFeedback: () => void;
}) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const facts = [
    { label: t.version, value: `v${version}` },
    { label: t.protocol, value: "librespot 0.8 · rodio/cpal → WASAPI" },
  ];

  return (
    <div className="max-w-[620px]">
      {/* Above the group and above everything: feedback that needs scrolling to
          find is feedback that does not get sent. */}
      <button
        type="button"
        onClick={onOpenFeedback}
        className="mb-3 flex w-full items-center justify-between gap-3 rounded-card border border-white/8 bg-white/4 px-5 py-3.5 text-left transition-colors duration-200 hover:bg-white/6"
      >
        <span className="text-[13.5px] font-semibold">{t.feedbackSend}</span>
        <MessageSquarePlus className="size-4 shrink-0 text-ink-muted" strokeWidth={2} />
      </button>

      <Group>
        {facts.map((f) => (
          <Row key={f.label} label={f.label}>
            <span className="tabular text-[13px] text-ink-muted">{f.value}</span>
          </Row>
        ))}

        {/*
          The changelog expands inside the same group rather than opening a screen.

          Diagnostics is the one place someone lands *because* something is wrong,
          and "which version am I on" and "what changed" are the same question at
          different depths — so the answer belongs under the question, not two
          clicks away from it.
        */}
        <button
          type="button"
          onClick={() => setChangelogOpen((open) => !open)}
          aria-expanded={changelogOpen}
          aria-controls="starless-changelog"
          className="flex w-full items-center gap-6 border-b border-white/8 px-5 py-4 text-left transition-colors duration-200 hover:bg-white/6"
        >
          <span className="min-w-0 flex-1 text-[13.5px] font-semibold">{t.changelogs}</span>
          <ChevronDown
            className={`size-4 shrink-0 text-ink-muted transition-transform duration-200 ${
              changelogOpen ? "rotate-180" : ""
            }`}
            strokeWidth={2}
          />
        </button>

        {changelogOpen && (
          <div
            id="starless-changelog"
            className="border-b border-white/8 px-5 py-5 last:border-b-0"
          >
            <Changelog t={t} lang={lang} />
          </div>
        )}
      </Group>
    </div>
  );
}

/**
 * Every version, newest first.
 *
 * The entries come from a file rather than from anywhere near the network: a
 * changelog that needs a connection to explain an offline app is a changelog
 * that is missing exactly when it is needed.
 */
function Changelog({ t, lang }: { t: Record<StringKey, string>; lang: Lang }) {
  return (
    <div className="space-y-7">
      {CHANGELOG.map((entry) => (
        <section key={entry.version}>
          <div className="flex items-baseline gap-2.5">
            <h3 className="tabular text-[15px] font-semibold">v{entry.version}</h3>
            {!entry.released && (
              <span className="rounded-pill bg-accent/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase text-accent-ink">
                {t.changelogUnreleased}
              </span>
            )}
            {entry.reconstructed && (
              <span className="rounded-pill border border-white/12 px-2 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase text-ink-faint">
                {t.changelogReconstructed}
              </span>
            )}
            {entry.date && <span className="tabular text-[12px] text-ink-faint">{entry.date}</span>}
          </div>

          <div className="mt-3 space-y-3">
            {entry.sections[lang].map((section) => (
              <ChangelogGroup key={section.title} title={section.title} items={section.items} />
            ))}
          </div>

          {/* Shown once, under the oldest entry. Why it is there is the same in
              every version, so repeating it would be noise. */}
          {entry.version === CHANGELOG[CHANGELOG.length - 1]?.version && (
            <p className="mt-3 text-[12px] leading-relaxed text-ink-faint italic">
              {PREVIOUS_NOTE[lang]}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function ChangelogGroup({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className="text-[11.5px] font-semibold tracking-[0.12em] uppercase text-ink-faint">
        {title}
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-[12.5px] leading-relaxed text-ink-muted">
            <span className="mt-[7px] size-1 shrink-0 rounded-pill bg-accent" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A card of settings.
 *
 * **A card with nothing in it is a card that should not be there.** When the
 * search hides every row of a group, the group goes with them: an empty frame
 * with a border around it is a hole in the page, and the person would read it
 * as a setting that is broken. The row marks itself with `setting-row`, and
 * the card asks the browser whether any of them is still standing.
 *
 * `span` is for the card whose control is wider than half a column: it crosses
 * both columns instead of being squeezed into one.
 */
function Group({ children, span }: { children: React.ReactNode; span?: boolean }) {
  return (
    <div
      className={`not-has-[.setting-row]:hidden overflow-hidden rounded-card border border-white/8 bg-white/4 ${
        span ? "lg:col-span-2" : ""
      }`}
    >
      {children}
    </div>
  );
}

function Row({
  label,
  hint,
  compare,
  onReset,
  children,
}: {
  label: string;
  hint?: string;
  /** The control can be flipped with the panel out of the way. Not for sliders: their drag already does it. */
  compare?: boolean;
  /** Takes this one option back to what ships. Passed only while it differs from that. */
  onReset?: () => void;
  children: React.ReactNode;
}) {
  const query = useSearch();
  const words = useContext(CompareContext);
  const [comparing, setComparing] = useState<DOMRect | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const closeCompare = useCallback(() => {
    setComparing(null);
    opener.current?.focus();
  }, []);

  /*
      An icon, and only on the row under the pointer: every row of Effects has one,
      and a column of them would be louder than the switches they are for. The row of
      colours also has no room for a word.
  */
  const compareButton =
    compare && words ? (
      <button
        ref={opener}
        data-row-tool=""
        type="button"
        aria-label={`${words.compare}: ${label}`}
        title={words.compare}
        onClick={() => {
          if (control.current) setComparing(control.current.getBoundingClientRect());
        }}
        className={`grid size-6 shrink-0 place-items-center rounded-pill text-ink-muted transition-[background-color,color,opacity] duration-200 hover:bg-white/10 hover:text-ink focus-visible:opacity-100 ${
          isMobile() ? "" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <Eye className="size-3.5" strokeWidth={2} />
      </button>
    ) : null;
  /*
      Not behind the hover, unlike the eye, and only while there is something to take
      back: a column of them then doubles as the list of what has been changed. It
      disappears under the hand that used it, so the focus moves to the control, or a
      keyboard would land back at the top of the panel.
  */
  const resetButton =
    onReset && words ? (
      <button
        data-row-tool=""
        type="button"
        aria-label={`${words.reset}: ${label}`}
        title={words.reset}
        onClick={() => {
          onReset();
          control.current
            ?.querySelector<HTMLElement>("button:not([data-row-tool]), input")
            ?.focus();
        }}
        className="grid size-6 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
      >
        <RotateCcw className="size-3.5" strokeWidth={2} />
      </button>
    ) : null;
  /*
      Beside the title and out of the flow, not beside the control. In the row with the
      control they took its width: the hint collapsed into a column of two words, a
      select dropped to its own line, and all of it changed the moment an arrow came or
      went. A row has to be the same size whether or not it has been changed.
  */
  const tools =
    resetButton || compareButton ? (
      <span className="absolute top-1/2 left-full ml-1 flex -translate-y-1/2 items-center">
        {resetButton}
        {compareButton}
      </span>
    ) : null;
  const shown = comparing ? null : children;
  const pill =
    comparing && words ? (
      <ComparePill label={label} done={words.done} at={comparing} onClose={closeCompare}>
        {children}
      </ComparePill>
    ) : null;

  /**
   * The row that is not the answer does not exist.
   *
   * **Not "dimmed", not "moved down".** A search that leaves the rows it does
   * not match on screen, in grey, is a search that made the page longer —the
   * opposite of what it was for. The row leaves, and the card it was in leaves
   * with it if it was the last one.
   */
  if (!matchesSearch(query, label, hint)) return null;

  /**
   * The label keeps its width and the control keeps its own.
   *
   * **The control goes below the label only when it does not fit.** A card in
   * one column of the grid is half a screen wide, and a control that does not
   * fit in half a screen cannot be squeezed into it: the label would be left
   * with a column of two letters —"Opacidad / de / los / menús"— and the
   * control would be cut. So the row wraps, and the label takes the whole
   * width when it does.
   *
   * **Not every row in a narrow card stacks.** A card whose control is small
   * —a select, a switch— fits next to its label with room to spare, and
   * forcing it under would leave the card empty: a label in one corner and a
   * control in the other, with nothing in between.
   *
   * **When the control does go under, it goes under the label and not in the
   * other corner.** The label grows to fill the row it is on, so the control
   * lands against it —a row of its own, starting where the text starts.
   *
   * **The title does not break; the control moves.** A title that wraps into
   * two lines beside a control leaves a card where nothing lines up: the text
   * on the left is three lines tall, the control is one, and the hint under
   * the title is three more. So the title keeps its line —and the row pushes
   * the control down when the two do not fit together. A title that is short
   * —"Tema", "Grano"— still sits beside its control.
   *
   * **The label has no width of its own.** It takes what is left, and the
   * only width it insists on is the width of its own title: that is the one
   * thing a row cannot do without. So the row breaks when the title and the
   * control do not fit together, and not before, and not after.
   */
  /*
      On the phone a wide control goes under its text, at the whole width: a
      164px select beside a description leaves the description a column of
      three words. A switch is small enough to stay where it is.
  */
  if (isMobile() && !(isValidElement(children) && children.type === Toggle)) {
    return (
      <div className="border-b border-white/8 px-5 py-4 last:border-b-0">
        <p className="relative w-fit text-[13.5px] font-semibold">
          {label}
          {tools}
        </p>
        {hint && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{hint}</p>}
        <div
          ref={control}
          className="mt-3 [&_[data-slider]]:w-auto [&_[data-slider]]:flex-1 [&_select]:w-full [&>div]:w-full [&>span]:w-full"
        >
          {shown}
        </div>
        {pill}
      </div>
    );
  }
  return (
    <div className="setting-row group flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-white/8 px-5 py-4 last:border-b-0">
      <div className="flex-1">
        <p className="relative w-fit text-[13.5px] font-semibold whitespace-nowrap">
          {label}
          {tools}
        </p>
        {hint && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{hint}</p>}
      </div>
      <div ref={control} className="w-fit shrink-0">
        {shown}
      </div>
      {pill}
    </div>
  );
}

/**
 * A setting that lives in the backend: read once, written on every change.
 *
 * `null` until the read answers, so a control can tell "not known yet" from
 * the default. A failed read falls back to `fallback` — the backend's own
 * default — rather than leaving the control stuck on nothing.
 */
function useBackendSetting<T>(
  read: () => Promise<T>,
  write: (value: T) => Promise<void>,
  fallback: T,
): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null);
  const first = useRef({ read, fallback });
  useEffect(() => {
    let alive = true;
    void first.current
      .read()
      .then((answer) => {
        if (alive) setValue(answer);
      })
      .catch(() => {
        if (alive) setValue(first.current.fallback);
      });
    return () => {
      alive = false;
    };
  }, []);
  const change = (next: T) => {
    setValue(next);
    void write(next).catch(() => {});
  };
  return [value, change];
}

/** Uncontrolled unless `checked` is passed: the audio and account rows are still placeholders. */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked?: boolean;
  onChange?: (on: boolean) => void;
  label?: string;
} = {}) {
  const [own, setOwn] = useState(false);
  const on = checked ?? own;
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => {
        setOwn(!on);
        onChange?.(!on);
      }}
      whileTap={{ scale: 0.94 }}
      transition={SPRING}
      className={`relative h-6 w-11 rounded-pill transition-colors duration-200 ${
        on ? "bg-accent" : "bg-white/14"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
        className={`absolute top-1 size-4 rounded-pill bg-[#fff] shadow-sm ${on ? "right-1" : "left-1"}`}
      />
      {on && (
        <Check className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-on-accent" />
      )}
    </motion.button>
  );
}
