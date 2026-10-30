import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import { type ReportOutcome, reportErrorText } from "../lib/reports";

/**
 * How long the confirmation is on screen before the panel gets out of the way.
 *
 * Long enough to read "Enviado" and register that something happened; short enough
 * that the panel is not still there when the attention has already moved on. It
 * used to wait for a click on "Cerrar", which made a finished form look like a
 * form that had failed: the user had sent it, and the only thing left on screen
 * was the button they had just used.
 */
const CLOSE_AFTER_MS = 1600;

/**
 * What the person is telling us. It only changes the title and the labels on
 * GitHub, but it is what lets the tracker be read as "problems" and "ideas"
 * instead of one pile called feedback.
 */
type Topic = "bug" | "idea" | "other";

const TOPICS: { topic: Topic; label: StringKey }[] = [
  { topic: "bug", label: "feedbackTopicBug" },
  { topic: "idea", label: "feedbackTopicIdea" },
  { topic: "other", label: "feedbackTopicOther" },
];

type FeedbackPanelProps = {
  t: Record<StringKey, string>;
  onClose: () => void;
};

/**
 * Saying something when nothing crashed.
 *
 * A crash prompt only catches the failures that end the process. The far more
 * common complaint — the search is slow, a playlist takes three attempts, the
 * window is the wrong size — never trips it, and today it can only be raised by
 * remembering to go to GitHub. So this is the other half: a place to write it
 * down from inside the app.
 *
 * **The log is off by default, and that is the whole design.** Attaching it is
 * useful when something broke and a disclosure of someone's machine state when
 * they simply wanted to say a screen feels slow. It is their switch, not ours.
 * `PRODUCT.md` promises no telemetry, and a default-on log attached to a "send
 * feedback" button is the kind of thing that promise is written to rule out.
 *
 * Same disclosure as a crash report, same send path, same scrubbing. One rule for
 * everything that leaves the machine.
 */
export function FeedbackPanel({ t, onClose }: FeedbackPanelProps) {
  const [message, setMessage] = useState("");
  // "Other" first, not "problem": a preselected "problem" would file every idea
  // nobody re-labelled as a bug.
  const [topic, setTopic] = useState<Topic>("other");
  const [attachLog, setAttachLog] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The pending close, so closing the panel by hand does not leave a timer behind
   * that fires into an app that is no longer showing this form.
   */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const empty = message.trim().length === 0;

  /** Fetch the body on demand rather than guessing what it contains. */
  const reveal = useCallback(async () => {
    setShowPreview(true);
    try {
      setPreview(await invoke<string>("feedback_report_preview", { message, attachLog, topic }));
    } catch {
      setPreview(t.crashReportUnavailable);
    }
  }, [message, attachLog, topic, t]);

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    // An empty report with no log says nothing, so it is not sent. What it used
    // to do was worse: the button was simply disabled, with nothing on screen
    // saying why, and a button that does nothing is indistinguishable from a
    // button that is broken. Saying it is also the only way to tell the two apart
    // from the log later.
    if (empty && !attachLog) {
      setError(t.feedbackEmpty);
      setBusy(false);
      return;
    }
    try {
      const outcome = await invoke<ReportOutcome>("submit_feedback", {
        message,
        attachLog,
        topic,
      });
      // Without the relay this is a pre-filled browser page, not a send. Opening
      // it is the honest fallback: the report is the user's to press create on.
      if (!outcome.created) await openUrl(outcome.url);
      setSent(outcome.url);
      // Only after the browser is handed the pre-filled page: closing first would
      // unmount the panel this promise is still standing on.
      closeTimer.current = setTimeout(onClose, CLOSE_AFTER_MS);
    } catch (e) {
      setError(reportErrorText(e, t));
    } finally {
      setBusy(false);
    }
  }, [message, attachLog, topic, empty, onClose, t]);

  // The tint is the point, not the decoration. This form opens over whatever is
  // on screen — the library, a settings panel, the sign-in screen — and DESIGN.md
  // forbids glass inside glass: the card's own blur would be sampling another
  // blurred surface, which costs twice and reads worse than either. A flat veil
  // puts plain colour behind the glass, which is what the recipe is built for.
  // It also swallows the clicks underneath, which an invisible overlay should
  // never leave ambiguous.
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ground/72 px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="glass-overlay flex max-h-full w-full max-w-[560px] flex-col gap-5 overflow-auto rounded-card px-8 py-8"
      >
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-accent">
            {t.feedbackKicker}
          </p>
          <h1 className="mt-2 text-[21px] font-semibold tracking-tight">{t.feedbackTitle}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{t.feedbackBody}</p>
        </div>

        {/*
          Three choices in one control, with the selection sliding between them:
          it is one question with three answers, not three buttons.
        */}
        <fieldset className="flex gap-1 rounded-pill border border-white/8 bg-white/4 p-1">
          <legend className="sr-only">{t.feedbackTopic}</legend>
          {TOPICS.map(({ topic: option, label }) => (
            <label
              key={option}
              className={`relative flex-1 cursor-pointer rounded-pill px-3 py-2 text-center text-[12.5px] font-semibold transition-colors duration-200 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-soft ${
                topic === option ? "text-on-accent" : "text-ink-muted hover:text-ink"
              }`}
            >
              <input
                type="radio"
                name="feedback-topic"
                value={option}
                checked={topic === option}
                onChange={() => {
                  setTopic(option);
                  setPreview(null);
                }}
                className="sr-only"
              />
              {topic === option && (
                <motion.span
                  layoutId="feedback-topic"
                  className="absolute inset-0 rounded-pill bg-accent"
                  transition={SPRING}
                />
              )}
              <span className="relative">{t[label]}</span>
            </label>
          ))}
        </fieldset>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t.feedbackPlaceholder}
          rows={5}
          className="w-full resize-none rounded-[14px] border border-white/8 bg-white/4 px-4 py-3 text-[13px] leading-relaxed text-ink placeholder:text-ink-faint focus:border-white/14 focus:outline-none"
        />

        {/* Off by default, and the label says what it costs rather than what it
            does. "Attach the log" understates it; "attach a copy of your log" is
            the truth and still fits. */}
        <label className="flex cursor-pointer items-start gap-3 rounded-[14px] border border-white/8 bg-white/4 px-4 py-3">
          <input
            type="checkbox"
            checked={attachLog}
            onChange={(e) => {
              setAttachLog(e.target.checked);
              setPreview(null);
            }}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-[12.5px] font-semibold">{t.feedbackAttachLog}</span>
            <span className="text-[11.5px] leading-relaxed text-ink-faint">
              {t.feedbackAttachLogHint}
            </span>
          </span>
        </label>

        <div className="rounded-[14px] border border-white/8 bg-white/4">
          <button
            type="button"
            onClick={() => void reveal()}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[12.5px] font-semibold text-ink-muted transition-colors duration-200 hover:text-ink"
            aria-expanded={showPreview}
          >
            {showPreview ? t.crashHideDetail : t.feedbackShowDetail}
            <span className="text-[11px] text-ink-faint">{t.crashScrubbed}</span>
          </button>
          {showPreview && (
            <div className="max-h-[170px] overflow-auto border-t border-white/8 px-4 py-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-faint">
                {preview ?? t.crashReportUnavailable}
              </pre>
            </div>
          )}
        </div>

        {error && (
          <p className="rounded-[14px] border border-warn/30 bg-warn/10 px-4 py-3 text-[12.5px] leading-relaxed text-warn">
            {error}
          </p>
        )}
        {sent && (
          <p className="flex min-w-0 items-center gap-2 text-[12px] text-ink-muted">
            <span>{t.crashSent}</span>
            <button
              type="button"
              onClick={() => void openUrl(sent)}
              className="min-w-0 truncate text-ink-faint underline decoration-dotted underline-offset-2"
            >
              {sent}
            </button>
          </p>
        )}

        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || sent !== null}
            className="flex-1 rounded-pill bg-accent px-5 py-3 text-[13.5px] font-semibold text-on-accent transition-opacity duration-200 hover:opacity-90 disabled:opacity-45"
          >
            {busy ? t.crashSending : t.feedbackSend}
          </button>
          <button
            type="button"
            onClick={onClose}
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
