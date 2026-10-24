import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update as TauriUpdate, Update } from "@tauri-apps/plugin-updater";

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
export async function installUpdate(
  update: TauriUpdate,
  sink: (state: UpdateState) => void = publish,
): Promise<void> {
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
}

// ---------------------------------------------------------------------------
// The prerelease channel
// ---------------------------------------------------------------------------

/**
 * Where a prerelease is looked up, and why it is not `releases/latest`.
 *
 * GitHub does not redirect `releases/latest` to a prerelease. That is not an
 * inconvenience here, it is the mechanism: it is what keeps a build of
 * `develop` from ever being offered to somebody who only wanted the app. So the
 * prerelease needs its own door, and this one is the releases API listing them
 * newest first.
 *
 * No token, and no polling: a repository that is not private answers this
 * without one, and it is a button somebody presses once, not a request the app
 * makes on every launch.
 */
const RELEASES_API = "https://api.github.com/repos/baironvillar/Starless/releases?per_page=10";

type GithubRelease = {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  assets: { name: string; browser_download_url: string }[];
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
  return state.status === "available" || state.status === "ready"
    ? state.update.version
    : state.status === "same"
      ? state.version
      : null;
}

export function installablePrerelease(state: PrereleaseState): TauriUpdate | null {
  return state.status === "available" || state.status === "ready" ? state.update : null;
}

/**
 * Ask GitHub for the newest prerelease and turn it into an installable update.
 *
 * **The manifest is fetched by hand on purpose.** `check()` can only read the
 * endpoint baked into `tauri.conf.json`, which is the public one on purpose.
 * Reading a prerelease's `latest.json` directly and building an `Update` from it
 * does not lower the bar by one notch: the signature is checked in Rust against
 * the public key embedded in the binary, the version is inside what gets signed,
 * and a manifest that carries its own `config.pubkey` is ignored — the plugin has
 * a test for exactly that. What this cannot do is install anything that was not
 * signed with the key that is already on this machine.
 */
export async function checkPrerelease(): Promise<void> {
  if (prerelease.status === "checking") return;
  publishPrerelease({ status: "checking" });

  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub respondió ${response.status}`);
    const releases = (await response.json()) as GithubRelease[];

    // Drafts are not there to download yet, and the newest published prerelease
    // is the first one in a list that GitHub already sorted.
    const found = releases.find((r) => r.prerelease && !r.draft);
    const manifest = found?.assets.find((a) => a.name === "latest.json");
    if (!found || !manifest) {
      publishPrerelease({ status: "none" });
      return;
    }

    const metadata = await (await fetch(manifest.browser_download_url)).json();
    const current = await getVersion();

    // Refusing to go backwards matters more than refusing to repeat: the whole
    // point of this button is to get onto `develop`, and a prerelease older than
    // what is installed would be the updater offering to make the app older.
    if (!isNewerThan(metadata.version, current)) {
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
