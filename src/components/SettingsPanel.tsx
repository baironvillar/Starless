import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AudioLines,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FlaskConical,
  ImagePlus,
  Loader2,
  LogOut,
  MessageSquarePlus,
  Palette,
  Pencil,
  RefreshCw,
  Settings2,
  User,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type CSSProperties,
  isValidElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
  applyMenuOpacity,
  applyTheme,
  audioQuality,
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
  MENU_OPACITY_DEFAULT,
  MENU_OPACITY_MAX,
  MENU_OPACITY_MIN,
  menuOpacity,
  normalisation,
  pickBackground,
  saveBackgroundLook,
  theme as savedTheme,
  setAccentColor,
  setAudioQuality,
  setCloseToTray,
  setCrossfadeSeconds,
  setEffect,
  setHistoryEnabled,
  setMenuOpacity,
  setNormalisation,
  setStartWithWindows,
  setTheme,
  signOut,
  startWithWindows,
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
 * How long the hand has to be still before the opacity is applied for real.
 *
 * Not a number about taste. The applied value repaints every glass surface in
 * the window, so applying it on every pointer event is what made the drag
 * heavy; this is the pause after the last movement, which is what "let go"
 * means when the release happens outside the control.
 */
const OPACITY_COMMIT_MS = 150;

const SECTIONS = [
  "sectionGeneral",
  "sectionAudio",
  "sectionAccount",
  "sectionCustom",
  "sectionDiagnostics",
] as const;
type Section = (typeof SECTIONS)[number];

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

  const body = (key: Section) => (
    <>
      {key === "sectionGeneral" && <General t={t} lang={lang} onLangChange={onLangChange} />}
      {key === "sectionAudio" && <Audio t={t} />}
      {key === "sectionAccount" && <Account t={t} account={account} />}
      {key === "sectionCustom" && <Custom t={t} />}
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
    return <PhoneSettings t={t} onClose={onClose} body={body} build={build} />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={SPRING_SHEET}
      className="glass-sheet absolute inset-4 z-40 flex overflow-hidden rounded-card"
      role="dialog"
      aria-modal="true"
      aria-label={t.settingsTitle}
    >
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
        <div className="flex shrink-0 justify-end px-8 pt-8">
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="grid size-9 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
          >
            <X className="size-[18px]" strokeWidth={2} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-8 pb-8">{body(section)}</div>
      </div>
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
}: {
  t: Record<StringKey, string>;
  onClose: () => void;
  body: (key: Section) => React.ReactNode;
  build: React.ReactNode;
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
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING_SHEET}
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
function ThemeSelect({ t }: { t: Record<StringKey, string> }) {
  const [value, setValue] = useState<Theme | null>(null);
  useEffect(() => {
    let alive = true;
    void savedTheme()
      .then((saved) => {
        if (alive) setValue(saved);
      })
      .catch(() => {
        if (alive) setValue("dark");
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Select
      value={value ?? "dark"}
      onChange={(next) => {
        const choice = next as Theme;
        setValue(choice);
        applyTheme(choice);
        void setTheme(choice).catch(() => {});
      }}
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
        <Row label={t.theme}>
          <ThemeSelect t={t} />
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
function Custom({ t }: { t: Record<StringKey, string> }) {
  const [opacity, setOpacity] = useState<number | null>(null);
  const [accent, setAccent] = useState<string | null>(null);
  const commitTimer = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    void menuOpacity()
      .then((value) => {
        if (alive) {
          setOpacity(value);
          applyMenuOpacity(value);
        }
      })
      .catch(() => {
        // A failed read must not strand the control in its loading state. The
        // slider *is* this section, and a slider that never leaves `…` reads as
        // "this does nothing" rather than "the read failed" — which is exactly
        // what happened under plain `vite`, where nothing answers `invoke`.
        if (alive) setOpacity(MENU_OPACITY_DEFAULT);
      });
    return () => {
      alive = false;
    };
  }, []);

  // A timeout that outlives the panel writes to a window that is not there
  // anymore, and the write it was going to do is one nobody asked for twice.
  useEffect(() => {
    return () => {
      if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    };
  }, []);

  /**
   * Two answers, on purpose.
   *
   * **The number, the thumb and the legend answer while the hand moves; the
   * menus wait.** The applied value is `--menu-alpha`, and every glass surface
   * in the app reads it — the settings sheet itself, the queue, the popovers.
   * Moving it repaints all of them, so a drag that moves it repaints half the
   * window on every pointer event. That is what made this control feel heavy,
   * and a faster repaint is not the fix.
   *
   * The legend is a 46x28 gradient that can follow the hand, so the choice is
   * still legible while it is being made — which is the whole reason it is
   * there. The change lands once the hand stops.
   */
  const change = (value: number) => {
    setOpacity(value);
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      applyMenuOpacity(value);
      void setMenuOpacity(value).catch(() => {});
    }, OPACITY_COMMIT_MS);
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

  return (
    <div className="max-w-[620px]">
      <Group>
        <Row label={t.menuOpacity} hint={t.menuOpacityHint}>
          <span className="flex items-center gap-3">
            <span className="min-w-[74px] text-right text-[12px] text-ink-faint tabular">
              {opacity === null ? "…" : `${opacity}%`}
            </span>
            <SmoothSlider
              value={opacity ?? MENU_OPACITY_DEFAULT}
              min={MENU_OPACITY_MIN}
              max={MENU_OPACITY_MAX}
              step={5}
              disabled={opacity === null}
              onChange={change}
              label={t.menuOpacity}
              className="w-[180px]"
            />
            {/*
              The swatch is what makes this control legible while it is being
              dragged. Every surface that actually reads the value is a popover
              sitting outside the panel, and this one is an opaque sheet — so
              without a legend right here the thumb moves and nothing answers.

              It reads its own alpha, not the one the menus read: the legend is
              a gradient over a 46x28 box and can answer at pointer speed, while
              `--menu-alpha` only moves once the hand stops.
            */}
            <span
              aria-hidden="true"
              className="menu-legend"
              style={
                {
                  "--legend-alpha": (opacity ?? MENU_OPACITY_DEFAULT) / 100,
                } as CSSProperties
              }
            />
          </span>
        </Row>
      </Group>
      <p className="mt-4 flex max-w-[520px] justify-between text-[11.5px] text-ink-faint">
        <span>{t.menuOpacitySolid}</span>
        <span>{t.menuOpacityGlass}</span>
      </p>

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
      <div className="mt-9">
        <Group>
          <Row label={t.accentColor} hint={t.accentColorHint}>
            <span className="flex items-center gap-2">
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
      </div>

      <BackgroundSettings t={t} effect={effect} changeEffect={changeEffect} />

      {/*
        The movement under the glass, each one a thing to take back: the light
        that trails the pointer, the pulse on the volume, the bloom and the
        interface's own animation. Applied the moment it is picked, because all
        of them are on screen behind this panel. Quiet mode is not a fifth
        setting: it is on when the other four are off, and writes all four.
      */}
      <div className="mt-9">
        <Group>
          <Row label={t.quietMode} hint={t.quietModeHint}>
            <Toggle
              checked={quiet}
              onChange={(on) =>
                changeAllEffects(
                  on
                    ? EFFECTS_QUIET
                    : {
                        glow: EFFECTS_DEFAULT.glow,
                        beat: EFFECTS_DEFAULT.beat,
                        bloom: EFFECTS_DEFAULT.bloom,
                        motion: EFFECTS_DEFAULT.motion,
                      },
                )
              }
              label={t.quietMode}
            />
          </Row>
          {/* No pointer and no volume control on the phone: these two would do nothing there. */}
          {!isMobile() && (
            <>
              <Row label={t.pointerGlow} hint={t.pointerGlowHint}>
                <Toggle
                  checked={effect.glow === "on"}
                  onChange={(on) => changeEffect("glow", on ? "on" : "off")}
                  label={t.pointerGlow}
                />
              </Row>
              <Row label={t.beatPulse} hint={t.beatPulseHint}>
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
            </>
          )}
          <Row label={t.bloomLight} hint={t.bloomLightHint}>
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
          <Row label={t.uiMotion} hint={t.uiMotionHint}>
            <Toggle
              checked={effect.motion === "on"}
              onChange={(on) => changeEffect("motion", on ? "on" : "off")}
              label={t.uiMotion}
            />
          </Row>
        </Group>
      </div>
    </div>
  );
}

/**
 * The ground behind the glass: the person's own picture, and where the grey
 * light sits over it. Same split as the menu opacity — the sliders' numbers
 * follow the hand, and the window (a blurred photo the size of the screen)
 * changes once the hand stops.
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
  const commitTimer = useRef<number | null>(null);

  // The saved look can arrive after the panel is already open.
  useEffect(() => {
    setDim(background.dim);
    setBlur(background.blur);
  }, [background.dim, background.blur]);

  useEffect(() => {
    return () => {
      if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    };
  }, []);

  const changeLook = (nextDim: number, nextBlur: number) => {
    setDim(nextDim);
    setBlur(nextBlur);
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      applyBackgroundLook(nextDim, nextBlur);
      void saveBackgroundLook(nextDim, nextBlur).catch(() => {});
    }, OPACITY_COMMIT_MS);
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
    <div className="mt-9">
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
        {background.url && (
          <>
            <Row label={t.backgroundDim} hint={t.backgroundDimHint}>
              <span className="flex items-center gap-3">
                <span className="min-w-[40px] text-right text-[12px] text-ink-faint tabular">
                  {dim}%
                </span>
                <SmoothSlider
                  value={dim}
                  min={0}
                  max={BACKGROUND_DIM_MAX}
                  step={5}
                  onChange={(value) => changeLook(value, blur)}
                  label={t.backgroundDim}
                  className="w-[180px]"
                />
              </span>
            </Row>
            <Row label={t.backgroundBlur} hint={t.backgroundBlurHint}>
              <span className="flex items-center gap-3">
                <span className="min-w-[40px] text-right text-[12px] text-ink-faint tabular">
                  {blur}%
                </span>
                <SmoothSlider
                  value={blur}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(value) => changeLook(dim, value)}
                  label={t.backgroundBlur}
                  className="w-[180px]"
                />
              </span>
            </Row>
          </>
        )}
        <Row label={t.bloomShape} hint={t.bloomShapeHint}>
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
        <Row label={t.grain} hint={t.grainHint}>
          <Toggle
            checked={effect.grain === "on"}
            onChange={(on) => changeEffect("grain", on ? "on" : "off")}
            label={t.grain}
          />
        </Row>
      </Group>
    </div>
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

function Group({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-white/8 bg-white/4">{children}</div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  /*
      On the phone a wide control goes under its text, at the whole width: a
      164px select beside a description leaves the description a column of
      three words. A switch is small enough to stay where it is.
  */
  if (isMobile() && !(isValidElement(children) && children.type === Toggle)) {
    return (
      <div className="border-b border-white/8 px-5 py-4 last:border-b-0">
        <p className="text-[13.5px] font-semibold">{label}</p>
        {hint && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{hint}</p>}
        <div className="mt-3 [&_[data-slider]]:w-auto [&_[data-slider]]:flex-1 [&_select]:w-full [&>div]:w-full [&>span]:w-full">
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-6 border-b border-white/8 px-5 py-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold">{label}</p>
        {hint && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
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

function Select({
  value,
  defaultValue,
  onChange,
  options,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => onChange?.(e.target.value)}
        className="min-w-[164px] appearance-none rounded-pill border border-white/14 bg-white/6 py-2.5 pr-10 pl-4 text-[13px] font-medium outline-none transition-colors duration-200 hover:bg-white/10"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-night">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-ink-muted"
        strokeWidth={2}
      />
    </div>
  );
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
