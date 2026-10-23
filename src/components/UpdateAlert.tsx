import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { StringKey } from "../lib/i18n";
import { newerVersion, subscribeUpdate, updateState } from "../lib/updater";

type UpdateAlertProps = {
  t: Record<StringKey, string>;
};

/** Long enough to read two lines, short enough that it is not in the way. */
const ALERT_MS = 7_000;

import { SPRING } from "../lib/motion";

/**
 * "There is a newer version", said once.
 *
 * This reverses a decision that was written down before it was needed: the
 * updater used to live only inside Settings, because *no badge, no toast,
 * nothing at launch* — a music player that advertises its own maintenance is a
 * music player nobody keeps. What changed is not the principle but what is
 * known now: an update is a fact worth surfacing once, where the person can
 * reach the one button that does something about it.
 *
 * **It says it and then gets out of the way.** Nothing is modal, nothing waits
 * for an answer, nothing is downloaded. The alert names the version and leaves;
 * the badge on the Settings button is what stays, because that one is a
 * question the person asked at their own pace.
 *
 * A failed check produces no alert. That is not a quieter version of the same
 * thing — it is the difference between "there is a new version" and "GitHub did
 * not answer", and only the first is worth interrupting anybody for.
 *
 * Centred with layout rather than with a transform, for the reason the search
 * menu records: a `-translate-x-1/2` sitting above a `backdrop-filter` was the
 * one live transform that made a glass surface stop looking like glass in the
 * packaged build. This is glass.
 */
export function UpdateAlert({ t }: UpdateAlertProps) {
  const state = useSyncExternalStore(subscribeUpdate, updateState, updateState);
  const version = newerVersion(state);
  const simulated = state.status === "simulated";
  /** The version already said out loud, so it is not said again. */
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (version === null) {
      setDismissed(null);
      return;
    }
    if (dismissed === version) return;
    const id = setTimeout(() => setDismissed(version), ALERT_MS);
    return () => clearTimeout(id);
  }, [version, dismissed]);

  const visible = version !== null && version !== dismissed;

  return (
    <AnimatePresence>
      {visible && (
        <div className="pointer-events-none absolute inset-x-0 top-[112px] z-30 flex justify-center px-6">
          <motion.button
            type="button"
            onClick={() => setDismissed(version)}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING}
            className="glass pointer-events-auto flex max-w-[460px] items-center gap-3 rounded-pill px-4 py-2.5 text-left"
          >
            <span className="size-2 shrink-0 rounded-pill bg-live" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{t.updateAlertTitle}</span>
              <span className="block truncate text-[12px] text-ink-muted">
                {simulated
                  ? t.updateSimulated.replace("{version}", version)
                  : t.updateAlertBody.replace("{version}", version)}
              </span>
            </span>
          </motion.button>
        </div>
      )}
    </AnimatePresence>
  );
}
