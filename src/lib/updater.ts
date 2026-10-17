import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

/**
 * Whether a newer Starless exists, and the job of installing it.
 *
 * Two decisions live here, and both are about not surprising someone who is
 * listening to music.
 *
 * **Check quietly, install on request.** The check happens once at startup and
 * costs one small request; nothing is downloaded, nothing is written, and the app
 * never restarts itself. Downloading a few megabytes at launch is what turns an
 * updater into the reason an app takes longer to open.
 *
 * **Ask before applying.** Starless plays audio. An update that installs itself
 * mid-track cuts the song, and an app that cuts your music to install a patch is
 * an app you turn off. So the button is in Settings and the click is the user's.
 *
 * A failure to check is not an error worth showing. It means GitHub was
 * unreachable, which is a fact about the network and not about the installation —
 * the app is still the version it was, and saying so out loud on every launch
 * would only train people to ignore the one time a real update exists.
 */
export type UpdateState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; update: Update }
  | { status: "downloading"; received: number; total: number }
  | { status: "ready"; update: Update }
  | { status: "error" }
  /**
   * A version that does not exist, announced by the dev panel.
   *
   * **A status of its own rather than a fake `Update`.** An `Update` is the
   * plugin's object with a real download URL behind it, and a fake one would put
   * an install button on screen that downloads nothing and fails — which is the
   * exact confusion this panel exists to prevent. Here there is nothing to
   * install, and every screen that shows it says so instead of pretending.
   */
  | { status: "simulated"; version: string };

let current: UpdateState = { status: "idle" };
const listeners = new Set<(state: UpdateState) => void>();

function publish(state: UpdateState) {
  current = state;
  for (const listener of listeners) listener(state);
}

export function subscribeUpdate(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

export function updateState(): UpdateState {
  return current;
}

/**
 * The version a screen shows when an update exists, or `null` when it does not.
 *
 * One place, because three surfaces read this — the alert, the badge on the
 * Settings button and the row inside Settings — and three places deciding
 * "is there an update?" is three places that can disagree. Disagreement here
 * would look like the app arguing with itself: a green button over a row that
 * says you are up to date.
 */
export function pendingVersion(state: UpdateState): string | null {
  switch (state.status) {
    case "available":
    case "ready":
      return state.update.version;
    case "simulated":
      return state.version;
    default:
      return null;
  }
}

/** True only for a real update, so nothing ever offers to download a fiction. */
export function installableUpdate(state: UpdateState): Update | null {
  return state.status === "available" || state.status === "ready" ? state.update : null;
}

/**
 * Pretend a newer version exists, so the three surfaces can be looked at
 * without publishing anything.
 *
 * **Dead in a release build, and that is the whole design.** `import.meta.env.DEV`
 * is replaced by Vite at build time, so this reduces to an early return and the
 * body is dropped from the bundle — which is the only gate that holds. Gating on
 * the branch would not: `develop` merges into `main` and ships, so a
 * branch-gated panel would be a panel in a release. Nobody has to remember not
 * to remove a `if (dev)` — the compiler removes it.
 */
export function simulateUpdate(version: string): void {
  if (!import.meta.env.DEV) return;
  publish({ status: "simulated", version });
}

/** Back to "nothing to report", for looking at the unmarked state again. */
export function clearSimulatedUpdate(): void {
  if (!import.meta.env.DEV) return;
  publish({ status: "idle" });
}

/**
 * Ask GitHub whether there is something newer.
 *
 * Safe to call more than once: a check already in flight is not started again.
 */
export async function checkForUpdate(): Promise<void> {
  if (current.status === "checking") return;
  publish({ status: "checking" });

  try {
    const update = await check();
    if (update) {
      publish({ status: "available", update });
      return;
    }
    publish({ status: "current" });
  } catch (e) {
    // Offline, a blocked request, an endpoint that is not configured yet. None of
    // those mean anything about the copy of Starless the user is running.
    console.warn("Starless: no se pudo comprobar si hay actualizaciones", e);
    publish({ status: "idle" });
  }
}

/**
 * Download it, then apply it.
 *
 * On Windows this hands the installer to the system and the app exits inside
 * `downloadAndInstall`, so nothing after this line runs — including the cleanup
 * that a caller might reasonably expect.
 */
export async function installUpdate(update: Update): Promise<void> {
  let received = 0;
  let total = 0;

  // Said before the download, not after, because after is too late: the process
  // is gone by then. Without this the session's marker survives the update and
  // the next launch opens with a crash report about an update that worked
  // perfectly. Best effort on purpose — if the backend cannot answer, the update
  // matters more than the report.
  await invoke("announce_clean_exit").catch(() => {});

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        received = 0;
        publish({ status: "downloading", received, total });
        break;
      case "Progress":
        received += event.data.chunkLength;
        publish({ status: "downloading", received, total });
        break;
      case "Finished":
        publish({ status: "ready", update });
        break;
    }
  });

  publish({ status: "ready", update });
  // Tauri exits the process once the installer takes over. This call exists only
  // so a running dev build does not sit there with a dead button.
  await update.close();
}
