import { Check, Copy, Users, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { copyText } from "../lib/clipboard";
import type { StringKey } from "../lib/i18n";
import { SPRING, SPRING_SHEET } from "../lib/motion";
import type { JamMember, JamSession } from "../lib/spotify";

type JamPanelProps = {
  t: Record<StringKey, string>;
  /** The open session, or `null` when there is none. */
  session: JamSession | null;
  /** A request is on its way: the buttons wait. */
  busy: boolean;
  /** What went wrong, in the words of the app. */
  error: string | null;
  /**
   * Whether the queue panel is open.
   *
   * **The jam docks to the left of it.** The two panels are about different
   * things and both of them are worth having open.
   */
  besideQueue: boolean;
  onStart: () => void;
  onJoin: (token: string) => void;
  onLeave: () => void;
  onClose: () => void;
};

/**
 * The jam: the shared session.
 *
 * **The door is where Spotify keeps it: top right, next to the friends.** The
 * panel is the "listening activity" one, with the card that offers to start a
 * Jam and the code that lets somebody else in.
 *
 * **A jam is a session, not a playlist.** It has an owner, guests, and a code;
 * it does not have a name and it does not live in the library. That is why the
 * panel has no "add to playlist" and why the code is the thing to share.
 *
 * **And the code is not a link.** It is the token that the service hands out
 * with the session, and it is what the joining door takes: there is no page to
 * open and no link to follow, so the panel shows the code itself.
 */
export function JamPanel({
  t,
  session,
  busy,
  error,
  besideQueue,
  onStart,
  onJoin,
  onLeave,
  onClose,
}: JamPanelProps) {
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    const code = session?.join_session_token;
    if (!code) return;
    const ok = await copyText(code);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <motion.aside
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={SPRING_SHEET}
      role="dialog"
      aria-label={t.jamActivity}
      // **El hueco son los veinte píxeles de siempre.** Al lado de la cola, el
      // panel arrancaba justo donde termina ella —240 de ancho más 20 de
      // margen— y los dos vidrios quedaban pegados. La app separa cada
      // superficie con veinte, y este no era el único que se olvidaba.
      className={`glass-sheet pointer-events-auto absolute top-[104px] ${besideQueue ? "right-[280px]" : "right-5"} z-30 flex w-[300px] flex-col overflow-hidden rounded-card`}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="truncate text-[15px] font-semibold tracking-tight">{t.jamActivity}</h2>
        <motion.button
          type="button"
          onClick={onClose}
          whileTap={{ scale: 0.9 }}
          transition={SPRING_SHEET}
          aria-label={t.close}
          title={t.close}
          className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
        >
          <X className="size-[17px]" strokeWidth={2} />
        </motion.button>
      </header>

      <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
        {session ? (
          <OpenJam
            t={t}
            session={session}
            busy={busy}
            copied={copied}
            onCopy={onCopy}
            onLeave={onLeave}
          />
        ) : (
          <>
            {/*
                The card that offers the Jam, in the words Spotify uses for it.
                The button is the accent of the app, and it is the only loud
                thing in the panel: everything else here is quiet.
            */}
            <section className="rounded-[16px] bg-white/6 p-3.5">
              <p className="text-[13px] leading-relaxed text-ink-muted">{t.jamStartHint}</p>
              <motion.button
                type="button"
                onClick={onStart}
                disabled={busy}
                whileTap={{ scale: 0.96 }}
                transition={SPRING}
                className="mt-3 flex items-center gap-2 rounded-pill bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-on-accent transition-[filter] duration-200 hover:brightness-110 disabled:opacity-60"
              >
                <Users className="size-4" strokeWidth={2.4} />
                {t.jamStart}
              </motion.button>
            </section>

            {/*
                Joining is the other door, and it takes the code. It is a form
                and not a button: the code is the only thing that identifies
                the session, so there is nothing to click.
            */}
            <section>
              <h3 className="pb-1.5 text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
                {t.jamJoinTitle}
              </h3>
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const code = token.trim();
                  if (code.length === 0) return;
                  onJoin(code);
                }}
              >
                <input
                  type="text"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder={t.jamJoinPlaceholder}
                  aria-label={t.jamJoinPlaceholder}
                  spellCheck={false}
                  autoComplete="off"
                  className="glass-control h-9 min-w-0 flex-1 rounded-pill px-3 text-[13px] outline-none placeholder:text-ink-faint"
                />
                <motion.button
                  type="submit"
                  disabled={busy || token.trim().length === 0}
                  whileTap={{ scale: 0.96 }}
                  transition={SPRING}
                  className="shrink-0 rounded-pill bg-white/10 px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-200 hover:bg-white/16 disabled:opacity-50"
                >
                  {busy ? t.jamJoining : t.jamJoin}
                </motion.button>
              </form>
            </section>
          </>
        )}

        {error && <p className="text-[12.5px] text-live">{error}</p>}
      </div>
    </motion.aside>
  );
}

/**
 * The jam that is open: the code, and who is in it.
 *
 * **The code is the whole invitation.** There is no page to open and no link to
 * follow: the guest's door takes the code, so the code is what gets shared.
 *
 * **The queue is not here.** It is in the queue panel, which is where a queue
 * belongs: this panel answers *who else is listening*, and the other one answers
 * *what comes next*. Two questions, two panels.
 */
function OpenJam({
  t,
  session,
  busy,
  copied,
  onCopy,
  onLeave,
}: {
  t: Record<StringKey, string>;
  session: JamSession;
  busy: boolean;
  copied: boolean;
  onCopy: () => void;
  onLeave: () => void;
}) {
  const code = session.join_session_token ?? "";
  // **The host closes the jam and the guest leaves it.** Two words for two
  // doors: the guest's door takes them out of the session and the jam goes
  // on, and the host's takes the jam down for everybody.
  const isOwner = session.is_session_owner;

  return (
    <>
      <section className="rounded-[16px] bg-white/6 p-3.5">
        <h3 className="pb-1 text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          {t.jamCode}
        </h3>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-[10px] bg-ground/50 px-2.5 py-1.5 font-mono text-[13px] text-ink">
            {code}
          </code>
          <motion.button
            type="button"
            onClick={onCopy}
            disabled={code.length === 0}
            whileTap={{ scale: 0.92 }}
            transition={SPRING}
            aria-label={t.jamCopy}
            title={copied ? t.jamCopied : t.jamCopy}
            className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink"
          >
            {copied ? (
              <Check className="size-4" strokeWidth={2.4} />
            ) : (
              <Copy className="size-4" strokeWidth={2} />
            )}
          </motion.button>
        </div>
      </section>

      <section>
        <h3 className="pb-1.5 text-[12px] font-semibold tracking-wide uppercase text-ink-faint">
          {t.jamMembers}
        </h3>
        {session.session_members.length === 0 ? (
          <p className="px-0.5 text-[12.5px] text-ink-faint">{t.jamAlone}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {session.session_members.map((member) => (
              <Member key={member.id} member={member} />
            ))}
          </ul>
        )}
      </section>

      <motion.button
        type="button"
        onClick={onLeave}
        disabled={busy}
        whileTap={{ scale: 0.96 }}
        transition={SPRING}
        className="rounded-pill border border-white/12 px-3.5 py-1.5 text-[13px] font-medium text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:opacity-60"
      >
        {busy ? (isOwner ? t.jamEnding : t.jamLeaving) : isOwner ? t.jamLeave : t.jamLeaveGuest}
      </motion.button>
    </>
  );
}

/**
 * Somebody in the jam.
 *
 * **The picture is theirs, and the name is theirs too.** The service sends both:
 * the account's display name and the photo, and the id that identifies them
 * inside the session.
 */
function Member({ member }: { member: JamMember }) {
  const name = member.display_name ?? member.username ?? member.id;

  return (
    <li className="flex items-center gap-2.5 rounded-[12px] px-1 py-1">
      <span className="relative size-8 shrink-0 overflow-hidden rounded-full bg-white/10">
        {member.image_url ? (
          <img src={member.image_url} alt="" loading="lazy" className="size-full object-cover" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{name}</span>
    </li>
  );
}
