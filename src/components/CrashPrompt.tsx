import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import type { StringKey } from "../lib/i18n";

type CrashPromptProps = {
  t: Record<StringKey, string>;
};

/**
 * "The last session did not end properly."
 *
 * The prompt exists because of a promise in `PRODUCT.md`: no telemetry, and no
 * telemetry is not a setting. So the app detects the crash on its own, shows
 * exactly what would leave the machine, and waits. `submit_crash_report` is only
 * ever reached by a click.
 *
 * That is why the preview is fetched rather than described. A promise about what
 * gets sent is only worth something if it is the same text that gets sent, and it
 * is: both come from `report::build_report` in Rust, once, scrubbed.
 *
 * Mounted once, at the top of the app, above everything — including the auth
 * gate. A crash report is worth reading before signing in again.
 */
export function CrashPrompt({ t }: CrashPromptProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<boolean>("previous_session_crashed")
      .then((crashed) => {
        if (alive && crashed) setOpen(true);
      })
      // A backend that cannot answer is not a reason to interrupt anyone with a
      // dialog about a crash that may not have happened.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /** Read the report before showing it, so the disclosure is the real thing. */
  const reveal = useCallback(async () => {
    setShowPreview(true);
    if (preview !== null) return;
    try {
      setPreview(await invoke<string>("crash_report_preview"));
    } catch {
      setPreview(t.crashReportUnavailable);
    }
  }, [preview, t]);

  const send = useCallback(async () => {
    setBusy(true);
    try {
      const outcome = await invoke<{ created: boolean; url: string }>("submit_crash_report");
      if (!outcome.created) {
        // No token in this build: the same report, pre-filled, waiting for the
        // user to press create. Nothing was sent — which is the whole point.
        await openUrl(outcome.url);
      }
      setDone(outcome.url);
      setOpen(false);
    } catch (e) {
      setDone(typeof e === "string" ? e : t.crashReportFailed);
    } finally {
      setBusy(false);
    }
  }, [t]);

  const dismiss = useCallback(async () => {
    try {
      await invoke("dismiss_crash_report");
    } finally {
      setOpen(false);
    }
  }, []);

  if (!open) {
    return done ? <Sent url={done} t={t} /> : null;
  }

  return (
    <div className="absolute inset-0 z-40 grid place-items-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
        className="glass flex w-full max-w-[520px] flex-col gap-5 rounded-card px-8 py-8"
      >
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-warn">
            {t.crashKicker}
          </p>
          <h1 className="mt-2 text-[21px] font-semibold tracking-tight">{t.crashTitle}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{t.crashBody}</p>
        </div>

        {/* The disclosure, because "always asking" is worthless if nobody is told
            what the question is. */}
        <div className="rounded-[14px] border border-white/8 bg-white/4">
          <button
            type="button"
            onClick={() => void reveal()}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[12.5px] font-semibold text-ink-muted transition-colors duration-200 hover:text-ink"
            aria-expanded={showPreview}
          >
            {showPreview ? t.crashHideDetail : t.crashShowDetail}
            <span className="text-[11px] text-ink-faint">{t.crashScrubbed}</span>
          </button>

          {showPreview && (
            <div className="max-h-[190px] overflow-auto border-t border-white/8 px-4 py-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-faint">
                {preview ?? t.crashReportUnavailable}
              </pre>
            </div>
          )}
        </div>

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy}
            className="flex-1 rounded-pill bg-accent px-5 py-3 text-[13.5px] font-semibold text-ground transition-opacity duration-200 hover:opacity-90 disabled:opacity-45"
          >
            {busy ? t.crashSending : t.crashSend}
          </button>
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={busy}
            className="rounded-pill border border-white/10 px-5 py-3 text-[13.5px] font-semibold text-ink-muted transition-colors duration-200 hover:text-ink disabled:opacity-45"
          >
            {t.crashDismiss}
          </button>
        </div>

        <p className="text-[11.5px] leading-relaxed text-ink-faint">{t.crashPrivacy}</p>
      </motion.div>
    </div>
  );
}

/**
 * Where the report went.
 *
 * Deliberately a quiet line at the bottom of the window rather than a dialog: the
 * person has already pressed the button and already read the screen, and a modal
 * arriving afterwards to confirm it would only be in the way.
 */
function Sent({ url, t }: { url: string; t: Record<StringKey, string> }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setTimeout(() => setVisible(false), 12_000);
    return () => clearTimeout(id);
  }, []);

  if (!visible) return null;

  return (
    <div className="pointer-events-auto absolute bottom-[136px] left-1/2 z-30 -translate-x-1/2">
      <button
        type="button"
        onClick={() => void openUrl(url)}
        className="glass flex items-center gap-2.5 rounded-pill px-4 py-2.5 text-[12.5px] font-medium text-ink-muted transition-colors duration-200 hover:text-ink"
      >
        <span>{t.crashSent}</span>
        <span className="max-w-[380px] truncate text-ink-faint">{url}</span>
      </button>
    </div>
  );
}
