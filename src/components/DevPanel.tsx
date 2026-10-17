import { invoke } from "@tauri-apps/api/core";
import { Bug, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { StringKey } from "../lib/i18n";
import { clearSimulatedUpdate, simulateUpdate } from "../lib/updater";

type DevPanelProps = {
  t: Record<StringKey, string>;
};

/**
 * Buttons for looking at states that are otherwise hard to reach.
 *
 * **The gate is `import.meta.env.DEV`, and that is the whole design.** The
 * obvious gate — "only on `develop`" — does not hold: `develop` merges into
 * `main` and gets released, so a branch-gated panel is a panel in a shipped
 * build, waiting for the one release where nobody was looking. Vite replaces
 * `import.meta.env.DEV` with `false` at build time, the mount below becomes
 * `false && …`, and the component is dropped from the bundle. Nobody has to
 * remember not to ship this; the compiler ships it for them.
 *
 * So the honest way to describe this is not "a dev tool" but "the dev build's
 * only extra surface" — and that is also why everything here is about *showing*
 * something, never about changing real state. Simulating an update produces a
 * version with no download behind it, on purpose: a button that installs a
 * fiction is a broken updater with extra steps.
 */
export function DevPanel({ t }: DevPanelProps) {
  const [crashPlanted, setCrashPlanted] = useState(false);
  const [crashError, setCrashError] = useState<string | null>(null);
  if (!import.meta.env.DEV) return null;

  return (
    <div className="mt-5 rounded-card border border-dashed border-white/14 bg-white/2 p-4">
      <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wide uppercase text-ink-faint">
        <Bug className="size-3.5" strokeWidth={2} />
        {t.devOnly}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{t.devOnlyHint}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => simulateUpdate("0.9.9")}
          className="flex items-center gap-2 rounded-pill border border-white/14 bg-white/6 px-3.5 py-2 text-[12.5px] font-medium transition-colors duration-200 hover:bg-white/10"
        >
          <Sparkles className="size-3.5" strokeWidth={2} />
          {t.devSimulateUpdate}
        </button>

        <button
          type="button"
          onClick={clearSimulatedUpdate}
          className="flex items-center gap-2 rounded-pill border border-white/14 bg-white/6 px-3.5 py-2 text-[12.5px] font-medium transition-colors duration-200 hover:bg-white/10"
        >
          <RotateCcw className="size-3.5" strokeWidth={2} />
          {t.devClearUpdate}
        </button>

        {/* The crash is planted, not performed: the dialog belongs to the next
            launch, exactly as it would after a real one. Saying so is the whole
            point — a button that looked like it crashed the app on click would be
            testing something that never happens. */}
        <button
          type="button"
          onClick={async () => {
            setCrashError(null);
            try {
              await invoke("simulate_crash");
              setCrashPlanted(true);
            } catch (e) {
              setCrashPlanted(false);
              setCrashError(String(e));
            }
          }}
          className="flex items-center gap-2 rounded-pill border border-white/14 bg-white/6 px-3.5 py-2 text-[12.5px] font-medium transition-colors duration-200 hover:bg-white/10"
        >
          <TriangleAlert className="size-3.5" strokeWidth={2} />
          {t.devSimulateCrash}
        </button>
      </div>

      {crashPlanted && <p className="mt-2.5 text-[12px] text-ink-faint">{t.devCrashPlanted}</p>}
      {crashError && <p className="mt-2.5 text-[12px] text-warn">{crashError}</p>}
    </div>
  );
}
