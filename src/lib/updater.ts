import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update as TauriUpdate, Update } from "@tauri-apps/plugin-updater";
import { isPrerelease } from "./version";

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
  | { status: "available"; update: TauriUpdate }
  | { status: "downloading"; received: number; total: number }
  | { status: "ready"; update: TauriUpdate }
  /**
   * The download failed.
   *
   * **A state of its own, and the update stays in it.** The copy on this
   * machine did not change, so saying "you are up to date" would be a lie and
   * saying nothing would leave a button that appears to do nothing. The update
   * is kept so the same button can be pressed again.
   */
  | { status: "installFailed"; update: TauriUpdate }
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
    case "installFailed":
      return state.update.version;
    case "simulated":
      return state.version;
    default:
      return null;
  }
}

/** True only for a real update, so nothing ever offers to download a fiction. */
export function installableUpdate(state: UpdateState): Update | null {
  return state.status === "available" ||
    state.status === "ready" ||
    state.status === "installFailed"
    ? state.update
    : null;
}

/**
 * Whether this update goes backwards.
 *
 * **Being on a prerelease and wanting the public one is not a downgrade, it
 * is a door.** The public line and the develop line are two different doors,
 * and the one you are standing in is not always the one you want. So the
 * public release is offered even when it is older than what is running, and
 * the row says what is about to happen instead of calling it an update.
 */
export function isGoingBack(update: Update): boolean {
  return (
    update.version !== update.currentVersion && !isNewerThan(update.version, update.currentVersion)
  );
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
export async function installUpdate(
  update: TauriUpdate,
  sink: (state: UpdateState) => void = publish,
): Promise<void> {
  try {
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
          sink({ status: "downloading", received, total });
          break;
        case "Progress":
          received += event.data.chunkLength;
          sink({ status: "downloading", received, total });
          break;
        case "Finished":
          sink({ status: "ready", update });
          break;
      }
    });

    sink({ status: "ready", update });
    // Tauri exits the process once the installer takes over. This call exists only
    // so a running dev build does not sit there with a dead button.
    await update.close();
  } catch (e) {
    // A download that fails is not a crash and not an update: it is a failed
    // download. Saying so is the difference between a row the user can retry
    // and a button that looks like it did something.
    console.warn("Starless: no se pudo instalar la actualización", e);
    sink({ status: "installFailed", update });
  }
}

// ---------------------------------------------------------------------------
// The prerelease channel
// ---------------------------------------------------------------------------

/**
 * What the backend says about an update, in the shape the plugin's `Update`
 * expects: a `rid` pointing at a resource that lives in Rust.
 */
type UpdateMetadata = {
  rid: number;
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  rawJson: Record<string, unknown>;
};

/**
 * Its own state, separate from the release channel's.
 *
 * Not an extra case in `UpdateState` and not a second store wearing its
 * clothes: the badge on the Settings button asks the release channel whether to
 * nag, and a build of `develop` must never be the reason it nags. Sharing one
 * store would put a `0.4.1-dev` in the badge of somebody who is happily on
 * `0.4.0`, and the badge is the one thing in this app that is allowed to be
 * unasked-for.
 */
export type PrereleaseState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "none" }
  /** The prerelease is exactly what is running. Nothing to install, nothing wrong. */
  | { status: "same"; version: string }
  | { status: "available"; update: TauriUpdate }
  | { status: "downloading"; received: number; total: number }
  | { status: "ready"; update: TauriUpdate }
  /** The download failed. The update is still there, so the button can be pressed again. */
  | { status: "installFailed"; update: TauriUpdate }
  | { status: "error" };

let prerelease: PrereleaseState = { status: "idle" };
const prereleaseListeners = new Set<(state: PrereleaseState) => void>();

function publishPrerelease(state: PrereleaseState) {
  prerelease = state;
  for (const listener of prereleaseListeners) listener(state);
}

export function subscribePrerelease(listener: (state: PrereleaseState) => void): () => void {
  prereleaseListeners.add(listener);
  listener(prerelease);
  return () => prereleaseListeners.delete(listener);
}

export function prereleaseState(): PrereleaseState {
  return prerelease;
}

/** The prerelease's version, for the row's label. */
export function prereleaseVersion(state: PrereleaseState): string | null {
  return state.status === "available" ||
    state.status === "ready" ||
    state.status === "installFailed"
    ? state.update.version
    : state.status === "same"
      ? state.version
      : null;
}

export function installablePrerelease(state: PrereleaseState): TauriUpdate | null {
  return state.status === "available" ||
    state.status === "ready" ||
    state.status === "installFailed"
    ? state.update
    : null;
}

/**
 * Ask for the newest prerelease and turn it into an installable update.
 *
 * **The installable update is made in Rust, and that is the whole point.**
 * `check()` can only read the endpoint baked into `tauri.conf.json`, which is
 * the stable one on purpose. So the backend is asked to build the update
 * against the prerelease's manifest: the same updater, the same embedded
 * public key, the same signature check, the same download.
 *
 * Reading the manifest in the webview and building an `Update` out of the JSON
 * would not lower the bar by one notch — but it would not work either: an
 * `Update` is a handle to a resource that lives in Rust, and the webview has
 * no way to make one. That is the difference between a row that offers a
 * build and a row that offers a button that installs nothing.
 */
export async function checkPrerelease(): Promise<void> {
  if (prerelease.status === "checking") return;
  publishPrerelease({ status: "checking" });

  try {
    // The backend resolves the whole channel: the tags, the release, and the
    // manifest behind it. The webview used to do the first two and the manifest
    // could not be fetched from here at all — the answer to that request
    // carries no CORS headers, so the browser stopped the request before a
    // byte arrived, and the row said "GitHub could not be reached" about a
    // GitHub that was perfectly reachable.
    const metadata = await invoke<UpdateMetadata | null>("check_prerelease_manifest");
    if (!metadata) {
      publishPrerelease({ status: "none" });
      return;
    }

    const current = await getVersion();
    // Refusing to go backwards matters more than refusing to repeat: the whole
    // point of this button is to get onto `develop`, and a prerelease older than
    // what is installed would be the updater offering to make the app older.
    if (!isNewerThan(metadata.version, current)) {
      // The same number is not the same build: the public release and the
      // develop build can carry the same version and be different programs.
      // Whoever is not running a develop build has not seen this one yet.
      if (metadata.version === current && !isPrerelease()) {
        publishPrerelease({ status: "available", update: new Update(metadata) });
        return;
      }
      publishPrerelease(
        metadata.version === current
          ? { status: "same", version: metadata.version }
          : { status: "none" },
      );
      return;
    }

    publishPrerelease({ status: "available", update: new Update(metadata) });
  } catch (e) {
    // The same reasoning as `checkForUpdate`: GitHub being unreachable is a fact
    // about the network, not about the installation.
    console.warn("Starless: no se pudo comprobar la prerelease", e);
    publishPrerelease({ status: "error" });
  }
}

/**
 * Install a prerelease, reporting progress to the prerelease channel.
 *
 * The translation is here rather than in the component because the two channels
 * share `installUpdate` and only differ in where the progress goes. A component
 * that had to do this itself would be re-deriving the mapping every time.
 */
export async function installPrerelease(update: TauriUpdate): Promise<void> {
  await installUpdate(update, (state) => {
    if (state.status === "downloading") {
      publishPrerelease({ status: "downloading", received: state.received, total: state.total });
    } else if (state.status === "ready") {
      publishPrerelease({ status: "ready", update: state.update });
    } else if (state.status === "installFailed") {
      publishPrerelease({ status: "installFailed", update: state.update });
    }
  });
}

/** `1.10.0` is newer than `1.9.0`, which a string comparison gets backwards. */
function isNewerThan(candidate: string, current: string): boolean {
  const a = candidate.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}
