import {
  Check,
  ChevronDown,
  Download,
  Loader2,
  LogOut,
  MessageSquarePlus,
  RefreshCw,
  User,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CHANGELOG, PREVIOUS_NOTE } from "../lib/changelog";
import type { Lang, StringKey } from "../lib/i18n";
import {
  applyMenuOpacity,
  menuOpacity,
  setMenuOpacity,
  signOut,
  type Account as UserAccount,
} from "../lib/spotify";
import { checkForUpdate, installUpdate, subscribeUpdate, updateState } from "../lib/updater";
import { appVersion } from "../lib/version";

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

/** The ends of the opacity slider. The same numbers the backend clamps to. */
const MENU_OPACITY_MIN = 55;
const MENU_OPACITY_MAX = 100;

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

  useEffect(() => {
    void appVersion().then(setVersion);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
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
          <p className="tabular mt-0.5 text-[12px] text-ink-faint">v{version}</p>
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto p-8">
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="ml-auto grid size-9 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
        >
          <X className="size-[18px]" strokeWidth={2} />
        </button>

        {section === "sectionGeneral" && <General t={t} lang={lang} onLangChange={onLangChange} />}
        {section === "sectionAudio" && <Audio t={t} />}
        {section === "sectionAccount" && <Account t={t} account={account} />}
        {section === "sectionCustom" && <Custom t={t} />}
        {section === "sectionDiagnostics" && (
          <Diagnostics t={t} version={version} lang={lang} onOpenFeedback={onOpenFeedback} />
        )}
      </div>
    </motion.div>
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
          <Select
            defaultValue="dark"
            options={[
              { value: "dark", label: t.themeDark },
              { value: "system", label: t.themeSystem },
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

      <Updates t={t} />
    </div>
  );
}

/**
 * "There is a new version", and a button that does it.
 *
 * The whole updater lives here because this is the only place in the app where
 * replacing the app is a sensible thing to ask for. It appears on the settings
 * panel and nowhere else: no badge, no toast, nothing at launch. A music player
 * that interrupts itself to advertise its own maintenance is a music player
 * nobody keeps.
 */
function Updates({ t }: { t: Record<StringKey, string> }) {
  const state = useSyncExternalStore(subscribeUpdate, updateState, updateState);
  const update = state.status === "available" || state.status === "ready" ? state.update : null;

  return (
    <div className="mt-5">
      <Group>
        <Row
          label={t.updatesTitle}
          hint={update ? t.updateAvailable.replace("{version}", update.version) : t.updatesHint}
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
                className="flex items-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-[13px] font-semibold text-ground transition-[filter] duration-200 hover:brightness-110"
              >
                <Download className="size-4" strokeWidth={2} />
                {t.updateInstall}
              </button>
            )}

            {!update && (
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
  return (
    <div className="max-w-[620px]">
      <Group>
        <Row label={t.audioQuality} hint={t.audioQualityHint}>
          <Select
            defaultValue="high"
            options={[
              { value: "low", label: t.qualityLow },
              { value: "normal", label: t.qualityNormal },
              { value: "high", label: t.qualityHigh },
            ]}
          />
        </Row>
        <Row label={t.normalisation} hint={t.normalisationHint}>
          <Toggle />
        </Row>
        <Row label={t.crossfade} hint={t.crossfadeHint}>
          <Toggle />
        </Row>
      </Group>
    </div>
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
 * Where the app stops deciding for the user.
 *
 * One control on purpose: this section earns its place by existing, and the second
 * option is the one that decides what belongs in it.
 */
function Custom({ t }: { t: Record<StringKey, string> }) {
  const [opacity, setOpacity] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void menuOpacity().then((value) => {
      if (alive) setOpacity(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  const change = (value: number) => {
    setOpacity(value);
    // The colour changes with the thumb, not after it is let go: this is a preview
    // of what a choice looks like, so it has to answer while it is being made.
    applyMenuOpacity(value);
    void setMenuOpacity(value);
  };

  return (
    <div className="max-w-[620px]">
      <Group>
        <Row label={t.menuOpacity} hint={t.menuOpacityHint}>
          <span className="flex items-center gap-3">
            <span className="min-w-[74px] text-right text-[12px] text-ink-faint tabular">
              {opacity === null ? "…" : `${opacity}%`}
            </span>
            <input
              type="range"
              min={MENU_OPACITY_MIN}
              max={MENU_OPACITY_MAX}
              step={5}
              value={opacity ?? MENU_OPACITY_MAX}
              disabled={opacity === null}
              onChange={(e) => change(Number(e.target.value))}
              aria-label={t.menuOpacity}
              className="w-[180px] accent-[var(--accent)] disabled:opacity-45"
            />
          </span>
        </Row>
      </Group>
      <p className="mt-4 flex max-w-[520px] justify-between text-[11.5px] text-ink-faint">
        <span>{t.menuOpacitySolid}</span>
        <span>{t.menuOpacityGlass}</span>
      </p>
    </div>
  );
}

function Account({ t, account }: { t: Record<StringKey, string>; account: UserAccount | null }) {
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
        <Row label={t.startWithWindows} hint={t.startWithWindowsHint}>
          <Toggle />
        </Row>
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
              <span className="rounded-pill bg-accent/15 px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase text-accent">
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
          <option key={o.value} value={o.value} className="bg-[#14141f]">
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

function Toggle() {
  const [on, setOn] = useState(false);
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setOn((v) => !v)}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={`relative h-6 w-11 rounded-pill transition-colors duration-200 ${
        on ? "bg-accent" : "bg-white/14"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 520, damping: 34 }}
        className={`absolute top-1 size-4 rounded-pill bg-white shadow-sm ${on ? "right-1" : "left-1"}`}
      />
      {on && (
        <Check className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-ground" />
      )}
    </motion.button>
  );
}
