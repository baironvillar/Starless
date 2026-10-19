import { useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Crown, Lock } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { StringKey } from "../lib/i18n";
import { AUTH_KEYS } from "../lib/spotify";

type AuthStatus = {
  /**
   * There is a saved session on disk to restore.
   *
   * True from the first read of a launch, long before librespot has finished
   * connecting, and false again the moment somebody signs out. It is the flag the
   * gate below asks to tell "restoring" apart from "needs the login screen".
   *
   * False is the *normal* answer on a machine that has never signed in, so it is
   * never a reason to disable the connect button. See the note there.
   */
  configured: boolean;
  signedIn: boolean;
  username: string | null;
  /** A kebab-case code from Rust, never prose. See [`AUTH_ERRORS`]. */
  detail: string | null;
};

const SPRING = { type: "spring" as const, stiffness: 380, damping: 32 };

/**
 * How long to keep hoping for a saved session before admitting there isn't one.
 *
 * Roughly a minute, because the handshake is seconds and a laptop coming out of
 * sleep is not. Past it the gate stops waiting and asks.
 */
const RESTORE_LIMIT = 45;

/**
 * Rust returns error codes, not sentences, and this map is where they become
 * language. The alternative — writing the messages in Rust — means translating
 * them later, into strings that were never shaped for a layout.
 */
const AUTH_ERRORS: Record<string, StringKey> = {
  missing_client_id: "authMissingClient",
  login_cancelled: "authCancelled",
  oauth_unavailable: "authOAuthFailed",
  login_task_failed: "authOAuthFailed",
  session_busy: "authBusy",
  cache_unavailable: "authCacheFailed",
  no_data_dir: "authCacheFailed",
  signout_failed: "authSignoutFailed",
};

/**
 * The door.
 *
 * Starless is a client for a service you did not build, so it has to ask before
 * it can be anything. This screen exists to make that one ask feel like part of
 * the app rather than a form someone stapled on: same glass, same type scale,
 * same accent, same motion budget.
 *
 * It also carries a claim the rest of the app depends on — that nothing leaves
 * the machine — so that claim is on the screen, not buried in a privacy page
 * nobody opens.
 *
 * And it carries the way out, because this is the screen a person sees when the
 * app is not working: the sign-in never completes, the library never loads, the
 * button does nothing. Reporting that used to mean Settings → Diagnostics, which
 * lives *behind* this gate — so the one launch where a report mattered was the
 * one launch with nowhere to write it. `onReport` is this screen's own exit.
 */
export function AuthGate({
  t,
  onReport,
  children,
}: {
  t: Record<StringKey, string>;
  onReport?: () => void;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  /**
   * Every time the door opens, everything behind it is refetched.
   *
   * This is the guarantee that closed the "it keeps saying sign in" loop. The
   * symptom was a library rendered on top of a cached `not_signed_in` — a real
   * error, real at the time it was recorded, and completely stale by the time
   * the session was actually good. Nothing refetched it, because the queries were
   * mounted and nothing had invalidated them: the login was treated as something
   * that changed the *credentials*, when what it changes is the *validity of
   * everything already cached*.
   *
   * Invalidate here and the ordering stops mattering. Whether a query last ran
   * before sign-out, during it, or after login, the first render of the app
   * cannot show anything that a previous session authorised.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    const open = Boolean(status?.signedIn);
    // Both directions. Closing the door drops what it authorised, so signing out
    // cannot leave a previous account's library sitting in memory either.
    if (open === wasOpen.current) return;
    wasOpen.current = open;

    void queryClient.invalidateQueries({ queryKey: ["playlist-tracks"] });
    for (const key of AUTH_KEYS) {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }, [status?.signedIn, queryClient]);

  /**
   * Signing out is announced rather than inferred.
   *
   * The gate used to discover it by reloading the window, which is both a blunt
   * instrument and a race. Listening for the backend's own signal means the gate
   * closes the moment the session is actually gone, and not one frame before.
   */
  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    listen<AuthStatus>("auth://status", (event) => {
      if (alive) setStatus(event.payload);
    })
      .then((off) => {
        if (alive) unlisten = off;
        // The listener is async, so the cleanup has to wait for it.
        else off();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    invoke<AuthStatus>("auth_status")
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Restoring a saved session is asynchronous: the window appears in well under a
   * second, and only then does librespot resolve an access point and complete its
   * handshake — about a second later. A single check on mount therefore reads
   * "not signed in" every single launch and shows a login screen to someone who
   * has been signed in for weeks.
   *
   * So keep asking, politely and with a ceiling. The interval stops the moment
   * the session appears; the counter stops us asking forever at someone who
   * genuinely needs to log in.
   */
  const [restoreTried, setRestoreTried] = useState(0);
  useEffect(() => {
    if (!status || status.signedIn) return;
    if (restoreTried >= RESTORE_LIMIT) return;
    const id = setTimeout(() => {
      setRestoreTried((tried) => tried + 1);
      invoke<AuthStatus>("auth_status")
        .then(setStatus)
        .catch(() => {});
    }, 1200);
    return () => clearTimeout(id);
  }, [status, restoreTried]);

  /**
   * The session exists the instant the browser approves, but librespot only fills
   * in the username once its handshake with Spotify's access point completes.
   * So the poll is not checking "did the button work" — it is checking "did the
   * connection finish", which takes seconds longer and can still fail on its own.
   */
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      invoke<AuthStatus>("auth_status")
        .then((next) => {
          setStatus(next);
          if (next.signedIn) setBusy(false);
        })
        .catch(() => {});
    }, 900);
    return () => clearInterval(id);
  }, [busy]);

  const connect = async () => {
    // A real sign-in resets the ceiling: the restore poll has already given up by
    // the time a user decides to log in.
    setRestoreTried(0);
    setBusy(true);
    setError(null);
    try {
      await invoke<AuthStatus>("begin_login");
    } catch (e) {
      setError(String(e));
      setBusy(false);
      return;
    }
    setBusy(false);
    // Re-read instead of adopting what `begin_login` returned.
    //
    // The handshake finishes a beat *after* the browser closes, so the value that
    // command returns is stale the moment it lands — and a poll that already saw
    // a signed-in session would be overwritten by it. Worse, the restore poll is
    // keyed on `status`, so with nothing to re-arm it the gate would sit on a
    // stale "signed out" forever. Reading again restarts the chain.
    invoke<AuthStatus>("auth_status")
      .then(setStatus)
      .catch(() => {});
  };

  /**
   * Two states that used to look like one.
   *
   * "There is a session on disk and it is still shaking hands" and "this account is
   * not signed in" both arrive as `signedIn: false`, and the gate answered both
   * with the login screen. So every launch flashed a sign-in form at someone who
   * was already signed in and took it away a second later. The poll below was
   * already waiting for the session to arrive; what was missing is the gate
   * admitting it did not know yet.
   *
   * Credentials on disk are what separates the two, and they are the honest signal:
   * only an account that completed a sign-in has any, and signing out deletes
   * them. `configured` is therefore true from the very first read — long before
   * librespot finishes connecting — and the login screen is still the right answer
   * to a machine with nothing saved, which is what someone signed out looks like.
   *
   * The ceiling bounds the wait: a session that never arrives stops being a
   * restore and becomes a login.
   */
  const restoring =
    !error && (status === null || (status.configured && restoreTried < RESTORE_LIMIT));

  if (status?.signedIn) return <>{children}</>;

  if (restoring) return <Restoring t={t} />;

  const message = error ? t[AUTH_ERRORS[error] ?? "authUnknown"] : null;

  return (
    <div className="absolute inset-0 z-30 grid place-items-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="glass flex w-full max-w-[460px] flex-col items-center gap-6 rounded-card px-9 py-10 text-center"
      >
        <div
          className="size-16 rounded-pill"
          style={{
            background: "linear-gradient(140deg, hsl(78 72% 58%), hsl(18 65% 38%))",
          }}
        />

        <div>
          <p className="text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
            {t.authKicker}
          </p>
          <h1 className="mt-2 text-[26px] leading-tight font-semibold tracking-tight">
            {t.authTitle}
          </h1>
          <p className="mx-auto mt-2 max-w-[34ch] text-[13px] leading-relaxed text-ink-muted">
            {t.authBody}
          </p>
        </div>

        {message && (
          <p className="w-full rounded-[14px] border border-warn/30 bg-warn/10 px-4 py-3 text-left text-[12.5px] leading-relaxed text-warn">
            {message}
          </p>
        )}

        {/* No `configured` guard on the button, and that is deliberate. This used
            to read `disabled={busy || !status?.configured}` because the field meant
            "is there a client id compiled in", and no id meant no possible login.
            The Web API took the only second identity away, so there is now always an
            id and nothing left to refuse over. But `configured` still exists, and
            it now means the opposite thing — "is there a session saved on disk" —
            which on a machine that never signed in is *false*. Keeping the guard
            would have greyed out the only button on the screen, on exactly the
            machine that needs it most: one that has never logged in. */}
        <motion.button
          type="button"
          onClick={connect}
          disabled={busy}
          whileTap={{ scale: 0.98 }}
          transition={SPRING}
          className="flex w-full items-center justify-center gap-2 rounded-pill bg-accent px-6 py-3.5 text-[14px] font-semibold text-on-accent transition-opacity duration-200 disabled:opacity-45"
        >
          {busy ? t.authWaiting : t.authConnect}
        </motion.button>

        {/* The way out of a screen you cannot get past. Quiet on purpose: it is
            not competing with the one button this screen exists to offer. */}
        {onReport && (
          <button
            type="button"
            onClick={onReport}
            disabled={busy}
            className="text-[12.5px] text-ink-muted underline decoration-dotted underline-offset-4 transition-colors duration-200 hover:text-ink disabled:opacity-45"
          >
            {t.authReport}
          </button>
        )}

        <ul className="flex w-full flex-col gap-2.5 border-t border-white/8 pt-6 text-left">
          <Note icon={Crown} tone="text-accent">
            {t.authPremium}
          </Note>
          <Note icon={Lock} tone="text-ink-muted">
            {t.authPrivate}
          </Note>
        </ul>
      </motion.div>
    </div>
  );
}

/**
 * The seconds before the app answers for itself.
 *
 * A mark and nothing else. It is not a stripped-down login screen on purpose: the
 * whole reason this state exists is that asking to sign in is the wrong question,
 * so putting the question on screen while we are still working it out is what made
 * the flash look like a bug in the first place.
 *
 * It enters once, like the bars, and then it is still. DESIGN.md allows exactly one
 * thing on screen to move indefinitely and that is the now-playing mark; a spinner
 * here would be the second, and it would be on screen for a second and a half.
 */
function Restoring({ t }: { t: Record<StringKey, string> }) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center">
      <motion.div
        role="status"
        aria-label={t.loading}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={SPRING}
        className="size-16 rounded-pill"
        style={{ background: "linear-gradient(140deg, hsl(78 72% 58%), hsl(18 65% 38%))" }}
      />
    </div>
  );
}

function Note({
  icon: Icon,
  tone,
  children,
}: {
  icon: typeof Crown;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-ink-muted">
      <Icon className={`mt-px size-3.5 shrink-0 ${tone}`} strokeWidth={2} />
      <span>{children}</span>
    </li>
  );
}
