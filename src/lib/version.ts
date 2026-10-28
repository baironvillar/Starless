import { getVersion } from "@tauri-apps/api/app";

/**
 * The shipped version.
 *
 * Inside Tauri this reads the value Tauri compiled into the binary from
 * `tauri.conf.json`, so it always reflects what the user actually installed —
 * not what the frontend bundle happens to claim. Outside Tauri (plain `vite
 * dev`, or a browser) it falls back to the build-time constant.
 */
export async function appVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return __APP_VERSION__;
  }
}

/**
 * Whether this build came from `develop`.
 *
 * **A fact about the build, not a question for the network.** The app knows it
 * because the build was told: the same decision that gives a develop build its
 * inverted icon is the one that says so here. Asking GitHub would make the
 * answer depend on whether the machine happens to have a connection, and the
 * whole point is to be able to look at the app and know what it is.
 *
 * **The `typeof` is not paranoia.** Vite replaces `define` constants in the
 * bundle, but in the dev server it hands them to the page as globals —and the
 * constant is not there at all if the page is opened outside the dev server.
 * A missing constant that throws takes the whole screen down, and this runs
 * while the settings panel renders.
 */
export function isPrerelease(): boolean {
  return typeof __STARLESS_CHANNEL__ !== "undefined" && __STARLESS_CHANNEL__ === "develop";
}

/**
 * Whether this build is the one published as the public release.
 *
 * **A fact the app can learn, and a fact worth learning.** A public release
 * built from `develop` ships the same binary the person is running: the app
 * would call itself a prerelease forever while being the public version. The
 * backend compares the two commits and says so, and the badge in Settings
 * stops saying "pre-release" about the public build.
 *
 * **It starts false and stays false when nobody can tell.** The comparison
 * needs the network, and without it the badge says what the build knows about
 * itself: that it came from `develop`.
 */
let publicBuild = false;
const publicBuildListeners = new Set<() => void>();

/** Say that this build is the public one. */
export function markPublicBuild(): void {
  if (publicBuild) return;
  publicBuild = true;
  for (const listener of publicBuildListeners) listener();
}

/** Whether this build is the public one. */
export function isPublicBuild(): boolean {
  return publicBuild;
}

/** Listen for the moment the app finds out. */
export function subscribePublicBuild(listener: () => void): () => void {
  publicBuildListeners.add(listener);
  return () => {
    publicBuildListeners.delete(listener);
  };
}
