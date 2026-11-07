import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Download, ExternalLink, KeyRound, Smartphone, Speaker, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import {
  explain,
  type SoloistStatus,
  soloistDownload,
  soloistSetKey,
  soloistStart,
} from "../lib/spotify";

/** Where each person makes their own key (Soloist's authentication page). */
const KEY_PAGE = "https://developer.spotify.com/dashboard/soloist";
/** Spotify's own page for the builds: it asks to be linked, never mirrored. */
const DOWNLOADS_PAGE =
  "https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates";
/** How long to wait for the pairing before naming the likely cause. */
const PAIR_PATIENCE_MS = 60_000;

type SoloistDialogProps = {
  t: Record<StringKey, string>;
  open: boolean;
  /** "intro" is the warning; "steps" is the setup itself. */
  mode: "intro" | "steps";
  status: SoloistStatus | null;
  onSetup: () => void;
  onClose: () => void;
};

/**
 * The way out for an account whose audio keys are refused (`docs/soloist.md`).
 *
 * **One place, three steps, each ticking itself.** The testers of Spotifast lost
 * their way between a download button in Settings, a key from a dashboard and a
 * phone's device picker, with no moment that said "done". Here the three are in
 * one sheet, in order, and each step lights the next one only when it is true —
 * read from what Soloist reports, never from a click that was merely made.
 *
 * **The warning comes first and clears the person.** Whoever sees it pressed
 * play and got nothing; the first sentence says it is not their subscription and
 * not the app, before it asks them to do anything.
 *
 * **The key is typed here and goes to the backend once.** It is never read back:
 * after it is stored the sheet only knows whether there is one.
 */
export function SoloistDialog({ t, open, mode, status, onSetup, onClose }: SoloistDialogProps) {
  const [busy, setBusy] = useState<"download" | "key" | "start" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [patient, setPatient] = useState(true);

  const installed = status?.installed ?? false;
  const keyed = (status?.has_key ?? false) && (status?.running ?? false);
  const paired = status?.paired ?? false;
  const waitingForPair = installed && keyed && !paired;

  // A fresh sheet does not carry the last attempt's error or a half-typed key.
  useEffect(() => {
    if (!open) return;
    setFailure(null);
    setKey("");
  }, [open]);

  // The pairing has no event for "nothing is coming": after a minute of silence
  // the sheet names the usual cause instead of spinning forever.
  useEffect(() => {
    if (!waitingForPair) {
      setPatient(true);
      return;
    }
    const id = setTimeout(() => setPatient(false), PAIR_PATIENCE_MS);
    return () => clearTimeout(id);
  }, [waitingForPair]);

  // A key that is stored but whose Soloist is not running yet: start it, so the
  // pairing step can listen. This is the path after a restart.
  useEffect(() => {
    if (!open || mode !== "steps" || !status) return;
    if (status.installed && status.has_key && !status.running && busy === null && !failure) {
      setBusy("start");
      soloistStart()
        .catch((error) => setFailure(explain(error)))
        .finally(() => setBusy(null));
    }
  }, [open, mode, status, busy, failure]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busy === null) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  async function download() {
    setBusy("download");
    setFailure(null);
    try {
      await soloistDownload();
    } catch (error) {
      setFailure(explain(error));
    } finally {
      setBusy(null);
    }
  }

  async function checkKey() {
    const value = key.trim();
    if (!value) return;
    setBusy("key");
    setFailure(null);
    try {
      await soloistSetKey(value);
      setKey("");
    } catch (error) {
      setFailure(explain(error));
    } finally {
      setBusy(null);
    }
  }

  const days = status?.expires_in_days ?? null;
  const downloadedLine =
    days === null
      ? null
      : status?.version
        ? t.soloistDownloaded.replace("{version}", status.version).replace("{days}", String(days))
        : t.soloistDownloadedNoVersion.replace("{days}", String(days));

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-6"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && busy === null) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={mode === "intro" ? t.keysRefusedTitle : t.soloistTitle}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING}
            className="glass-overlay flex max-h-[calc(100vh-48px)] w-full max-w-[480px] flex-col gap-4 overflow-y-auto rounded-[18px] p-5"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-accent/15 text-accent-ink">
                <Speaker className="size-4" strokeWidth={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold tracking-tight">
                  {mode === "intro" ? t.keysRefusedTitle : t.soloistTitle}
                </h2>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                  {mode === "intro" ? t.keysRefusedBody : t.soloistIntro}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={busy !== null}
                aria-label={t.soloistClose}
                title={t.soloistClose}
                className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:opacity-35"
              >
                <X className="size-4" strokeWidth={2} />
              </button>
            </div>

            {mode === "intro" ? (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 rounded-pill px-4 text-[13px] font-medium text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink"
                >
                  {t.keysRefusedLater}
                </button>
                <button
                  type="button"
                  onClick={onSetup}
                  className="h-9 rounded-pill bg-accent px-4 text-[13px] font-semibold text-on-accent transition-opacity duration-200 hover:opacity-90"
                >
                  {t.keysRefusedSetup}
                </button>
              </div>
            ) : (
              <>
                <ol className="flex flex-col gap-2.5">
                  {/* 1. The build, from Spotify. */}
                  <Step n={1} title={t.soloistStep1Title} done={installed} active={!installed}>
                    {installed ? (
                      downloadedLine && (
                        <p className="text-[12px] text-ink-muted">{downloadedLine}</p>
                      )
                    ) : (
                      <>
                        <p className="text-[12px] leading-relaxed text-ink-muted">
                          {t.soloistStep1Body}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-3">
                          <PrimaryButton onClick={() => void download()} disabled={busy !== null}>
                            <Download className="size-3.5" strokeWidth={2.2} />
                            {busy === "download" ? t.soloistDownloading : t.soloistDownload}
                          </PrimaryButton>
                          <LinkButton onClick={() => void openUrl(DOWNLOADS_PAGE)}>
                            {t.soloistDownloadsPage}
                          </LinkButton>
                        </div>
                      </>
                    )}
                  </Step>

                  {/* 2. The person's own key. */}
                  <Step n={2} title={t.soloistStep2Title} done={keyed} active={installed && !keyed}>
                    {keyed ? (
                      <p className="text-[12px] text-ink-muted">{t.soloistKeyOk}</p>
                    ) : installed ? (
                      <>
                        <p className="text-[12px] leading-relaxed text-ink-muted">
                          {t.soloistStep2Body}
                        </p>
                        <div className="mt-2.5">
                          <LinkButton onClick={() => void openUrl(KEY_PAGE)}>
                            <KeyRound className="size-3.5" strokeWidth={2.2} />
                            {t.soloistOpenKeyPage}
                          </LinkButton>
                        </div>
                        <form
                          className="mt-2.5 flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void checkKey();
                          }}
                        >
                          <input
                            value={key}
                            onChange={(event) => setKey(event.target.value)}
                            placeholder={t.soloistKeyPlaceholder}
                            disabled={busy !== null}
                            autoComplete="off"
                            spellCheck={false}
                            className="glass-control h-9 min-w-0 flex-1 rounded-pill px-4 font-mono text-[12px] outline-none placeholder:font-sans placeholder:text-ink-faint"
                          />
                          <PrimaryButton type="submit" disabled={busy !== null || !key.trim()}>
                            {busy === "key" ? t.soloistKeyChecking : t.soloistKeyCheck}
                          </PrimaryButton>
                        </form>
                        <p className="mt-2 text-[11px] text-ink-faint">{t.soloistKeyPrivate}</p>
                      </>
                    ) : null}
                  </Step>

                  {/* 3. The pairing, once, from the official app. */}
                  <Step
                    n={3}
                    title={t.soloistStep3Title}
                    done={paired}
                    active={installed && keyed && !paired}
                  >
                    {paired ? (
                      <p className="text-[12px] text-ink-muted">{t.soloistPaired}</p>
                    ) : installed && keyed ? (
                      <>
                        <p className="text-[12px] leading-relaxed text-ink-muted">
                          {t.soloistStep3Body}
                        </p>
                        {/*
                          The device list, drawn: the one row to pick, with the
                          exact name in large type. Picking the wrong row was the
                          first mistake the Spotifast testers made.
                        */}
                        <div className="mt-2.5 flex items-center gap-3 rounded-[12px] border border-accent/40 bg-accent/10 px-3.5 py-3">
                          <Smartphone className="size-4 shrink-0 text-ink-muted" strokeWidth={2} />
                          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                            {status?.device_name}
                          </span>
                          <Speaker className="size-4 shrink-0 text-accent-ink" strokeWidth={2.2} />
                        </div>
                        <p className="mt-2.5 flex items-center gap-2 text-[12px] text-ink-muted">
                          <span className="size-1.5 shrink-0 animate-pulse rounded-pill bg-accent" />
                          {patient ? t.soloistWaiting : t.soloistWaitingLong}
                        </p>
                      </>
                    ) : null}
                  </Step>
                </ol>

                {failure && (
                  <p
                    role="alert"
                    className="rounded-[12px] bg-live/10 px-3.5 py-2.5 text-[12px] text-live-ink"
                  >
                    {failure}
                  </p>
                )}

                {paired && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium">{t.soloistDone}</p>
                    <PrimaryButton onClick={onClose}>{t.soloistClose}</PrimaryButton>
                  </div>
                )}
              </>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** One numbered step: a tick when it is done, its number while it is not. */
function Step({
  n,
  title,
  done,
  active,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <li
      className={`flex gap-3 rounded-[14px] border px-3.5 py-3 transition-colors duration-200 ${
        active ? "border-white/12 bg-white/6" : "border-transparent"
      } ${!done && !active ? "opacity-45" : ""}`}
    >
      <span
        className={`grid size-6 shrink-0 place-items-center rounded-pill text-[11.5px] font-semibold ${
          done
            ? "bg-ok/20 text-ok"
            : active
              ? "bg-accent text-on-accent"
              : "bg-white/10 text-ink-muted"
        }`}
      >
        {done ? <Check className="size-3.5" strokeWidth={2.6} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[13.5px] font-semibold leading-6">{title}</h3>
        {children}
      </div>
    </li>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 shrink-0 items-center gap-2 rounded-pill bg-accent px-4 text-[13px] font-semibold text-on-accent transition-opacity duration-200 hover:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function LinkButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent-ink underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink className="size-3" strokeWidth={2.2} />
    </button>
  );
}
