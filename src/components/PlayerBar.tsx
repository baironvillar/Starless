import {
  ListOrdered,
  Loader2,
  Mic2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Volume2,
  VolumeX,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StringKey } from "../lib/i18n";
import {
  coverImage,
  explain,
  formatDuration,
  type PlaybackStatus,
  seekPlayback,
  setVolume,
  type Track,
  togglePlayback,
  trackArtists,
} from "../lib/spotify";
import { DjArtwork, DjMark } from "./DjArtwork";
import { SmoothSlider } from "./SmoothSlider";

/**
 * What "repeat" currently means.
 *
 * `"off"` is the default, and the queue genuinely stops rather than wrapping: a
 * list that quietly starts over reads as "this never ends", which is not what the
 * user asked for when they ran out of a list they were scrolling by hand.
 */
export type RepeatMode = "off" | "all" | "one";

type PlayerBarProps = {
  /** The track the backend is actually holding. Null before anything is played. */
  track: Track | null;
  status: PlaybackStatus | null;
  /**
   * The DJ, while it is talking.
   *
   * Null the rest of the time. When it is not null, **the DJ is what is making
   * sound**, and it takes the place of the album cover on the left: the drawing
   * goes where the artwork goes and the line goes where the artist goes.
   */
  dj?: { speaker: string | null; line: string | null } | null;
  /**
   * Whether the bar is on screen.
   *
   * **The bar arrives with the music, and not with the app.** It used to fade
   * and rise the moment the window opened, into an empty bar: a glass
   * rectangle with a dead play button, two zeros and nothing on the left. A
   * bar that has nothing to say is not chrome, it is the shape of an absence —
   * and it was on screen before there was any music to put in it.
   *
   * So it waits. When a song is asked for, when the DJ starts talking, or when
   * the backend refuses something, the bar fades in and rises sixteen pixels
   * into place — the same entrance it always had, moved to the moment it
   * means something. Before that there is no bar at all, and the window is the
   * library.
   *
   * **And the way out is the way in.** A bar that fades up and then blinks out
   * is two different gestures, and the window — which is sliding down to give
   * the bar its room back — ends up moving for a bar that is already gone. It
   * fades down and sinks the sixteen pixels it came up, and the class that
   * takes it out of the focus order waits for that to be over.
   *
   * **The answer is the app's, not the bar's:** the window has to give the bar
   * its room at the same time, and two questions about the same thing have to
   * have one answer.
   */
  present: boolean;
  /**
   * Ask the DJ for another turn, or undefined when there is nothing to ask.
   *
   * **It only exists while the DJ is on.** The bar is chrome and the chrome
   * stays quiet: the button appears with the DJ's session and disappears with
   * it. The shelf card is how a session starts; this is how the next one is
   * asked for —the same path, so the backend follows its own cursor and the DJ
   * moves on instead of starting over.
   */
  onPlayDj?: () => void;
  /** The DJ is being asked for right now. */
  djBusy?: boolean;
  t: Record<StringKey, string>;
  queueOpen: boolean;
  onToggleQueue: () => void;
  lyricsOpen: boolean;
  onToggleLyrics: () => void;
  onPrevious: () => void;
  onNext: () => void;
  shuffle: boolean;
  onToggleShuffle: () => void;
  repeat: RepeatMode;
  onCycleRepeat: () => void;
};

import { SPRING } from "../lib/motion";

/** librespot's own scale, not ours. The conversion happens once, here. */
const MAX_VOLUME = 65535;

/**
 * The level to come back to when the sound comes back.
 *
 * This button used to send `muted ? MAX_VOLUME : 0`, which is wrong in exactly one
 * direction: muting remembered nothing, so unmuting was a decision the app made —
 * every single time, at full scale, whatever the person had been listening at. Set
 * it to half, mute, unmute, and the music jumps to a level nobody chose.
 *
 * So the last non-zero level the backend reports is what comes back. The value it
 * reports *is* the value that was asked for: `apply_volume` stores the attenuation
 * curve separately and returns the number untouched, so handing it back is exact
 * and not a value that drifts a little on every unmute.
 *
 * Half scale as the opening guess, for a session that has never been audible — the
 * app came up muted, or it was muted before the first status event arrived.
 * Unmuting into full scale is the loudest thing this app can do, and doing it to
 * someone who never asked for volume is not a decision it should be making.
 */
const DEFAULT_UNMUTE = MAX_VOLUME / 2;

/** Feeds the `--fill` custom property the slider recipe paints its track with. */
function fillStyle(percent: number): React.CSSProperties {
  return { "--fill": `${percent}%` } as React.CSSProperties;
}

/**
 * The floating player bar.
 *
 * Detached from the window edges on purpose — inset on all sides, with a large
 * radius. The radius is the signal that says "this floats"; square corners on a
 * floating surface read as a rendering bug.
 *
 * Three columns — `1fr auto 1fr` — so the transport sits on the optical centre of
 * the window no matter how wide the track title grows. The seek bar lives directly
 * UNDER the transport, not beside it: a progress bar that runs off to one side
 * reads as a separate widget, and the pairing of "what I am hearing" with "how far
 * in I am" only holds when they share a centre.
 *
 * Everything on it reads from the real backend. An idle bar that looks busy is the
 * thing DESIGN.md rules out, and it also hides the one moment that matters here —
 * a refusal has to be visible where the user is already looking.
 *
 * DESIGN.md performance budget: nothing here animates `backdrop-filter`. The bar
 * animates its own transform and opacity only.
 */
export function PlayerBar({
  track,
  status,
  dj,
  present,
  onPlayDj,
  djBusy,
  t,
  queueOpen,
  onToggleQueue,
  lyricsOpen,
  onToggleLyrics,
  onPrevious,
  onNext,
  shuffle,
  onToggleShuffle,
  repeat,
  onCycleRepeat,
}: PlayerBarProps) {
  const playing = status?.playing ?? false;
  const loading = status?.loading ?? false;
  const error = status?.error ?? null;

  /**
   * Whether the bar has finished leaving the screen.
   *
   * **The `invisible` class has to wait for the exit, or there is no exit.**
   * `visibility: hidden` takes effect on the very frame it is applied, so a bar
   * that is hidden and told to fade out in the same breath does not fade: it is
   * simply gone — while the window is still sliding down to make room for a bar
   * that is no longer there. The class goes on when the animation is over, and
   * not one frame before.
   *
   * The entrance has the same rule on the other side: `invisible` comes off
   * first, so the bar can be seen fading in instead of appearing already faded.
   */
  const [gone, setGone] = useState(!present);
  /**
   * The same question, read at the moment the animation ends.
   *
   * A ref and not the prop: the callback that closes the exit can fire after the
   * bar has been asked to come back, and a stale `present` would hide a bar that
   * is on its way in.
   */
  const presentRef = useRef(present);
  presentRef.current = present;
  useEffect(() => {
    if (present) setGone(false);
  }, [present]);

  const position = status?.positionMs ?? 0;
  const duration = status?.durationMs ?? track?.duration_ms ?? 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  // librespot's own scale, not ours. The conversion happens once, here, so nothing
  // downstream has to know that 65535 is a thing.
  const volume = (status?.volume ?? 0) / MAX_VOLUME;
  const muted = volume <= 0.001;

  /**
   * The last level that was actually audible, in this session.
   *
   * Recorded on the way *in* rather than on the way out: whatever the backend
   * reports as non-zero is the level to come back to, and muting writes a zero
   * that must not overwrite it. `status.volume` of 0 is the one value that is
   * skipped, which is exactly the value that means "muted".
   */
  const lastAudible = useRef<number>(DEFAULT_UNMUTE);
  useEffect(() => {
    if (status?.volume) lastAudible.current = status.volume;
  }, [status?.volume]);

  const toggleMute = useCallback(() => {
    void setVolume(muted ? lastAudible.current : 0).catch(() => {});
  }, [muted]);

  const busy = loading;
  /**
   * Whether there is nothing to control.
   *
   * **The DJ counts as something playing.** While the DJ is talking the bar is
   * not idle: the music is on its way, and the volume is exactly the control
   * that matters —the voice is the loudest thing in the room, and turning it
   * down is what a person does when it is too loud. A locked slider during the
   * DJ's ten seconds of talking is a control that exists and cannot be used.
   *
   * And the transport is not locked either, because "next" is the one thing
   * that lets a person skip the voice and keep the song the DJ chose.
   */
  const idle = !track && !dj;
  /** Whether there is a song to ask about. The DJ's voice is not a song. */
  const noSong = !track;

  /**
   * What is sounding, as a key.
   *
   * **The key is what makes the song arrive.** When it changes, the block
   * below is a new one and it enters from below: a song that starts playing
   * comes up out of the bar instead of appearing in it.
   */
  const sounding = dj ? "dj" : (track?.id ?? "none");

  return (
    <motion.footer
      initial={{ opacity: 0, y: 16 }}
      animate={present ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={SPRING}
      onAnimationComplete={() => {
        if (!presentRef.current) setGone(true);
      }}
      className={`glass absolute inset-x-5 bottom-5 z-20 grid h-[104px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-5 rounded-card px-5 ${
        present ? "pointer-events-auto" : "pointer-events-none"
      } ${gone ? "invisible" : ""}`}
    >
      {/*
          What is sounding — or what went wrong.

          **Nothing at all when nothing is playing.** The bar is chrome, and
          chrome that says "nothing is playing" is a message about a state the
          user can see for himself: the bar is empty, the queue is empty, the
          content is empty. What was there was a caption for an absence, and
          it took the space the cover of the song was going to take.

          **And what does arrive comes from below.** The song does not appear in
          the bar: it comes up out of it, the way a record comes off a turntable
          into the light.
      */}
      <div className="flex min-w-0 items-center gap-3">
        <AnimatePresence initial={false} mode="wait">
          {(dj || track || error) && (
            <motion.div
              key={sounding}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={SPRING}
              className="flex min-w-0 items-center gap-3"
            >
              {dj ? <DjAvatar /> : <Cover track={track} />}

              <div className="min-w-0">
                {error ? (
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-semibold text-warn">
                    <TriangleAlert className="size-[13px] shrink-0" strokeWidth={2} />
                    <span className="truncate">{t.playbackErrorTitle}</span>
                  </p>
                ) : dj ? (
                  /*
                      The DJ, in the same two lines as a song: who is speaking above,
                      what they said below. The name comes from the service —it is the
                      DJ's own name— and the line is the sentence, which the queue
                      panel also shows in full. What the service does not send, the bar
                      says: the generic name and "speaking".
                  */
                  <>
                    <p className="truncate text-[13.5px] font-semibold">
                      {dj.speaker ?? t.djSpeaker}
                    </p>
                    <p className="truncate text-[12.5px] text-ink-muted">
                      {dj.line ?? t.djSpeaking}
                    </p>
                  </>
                ) : track ? (
                  <>
                    <p className="truncate text-[13.5px] font-semibold">{track.name}</p>
                    <p className="truncate text-[12.5px] text-ink-muted">{trackArtists(track)}</p>
                  </>
                ) : null}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Transport, with the seek bar beneath it on the same centre axis */}
      <div className="flex w-[clamp(190px,34vw,560px)] flex-col items-center gap-2">
        <div className="flex items-center gap-1">
          {/* Shuffle and repeat flank the transport rather than living in the side
              column: they are modifiers of *what the transport does next*, and
              putting them beside the volume would group them with a control that
              has nothing to do with order. */}
          <TransportToggle
            on={shuffle}
            onClick={onToggleShuffle}
            label={shuffle ? t.shuffleOn : t.shuffle}
            disabled={idle}
          >
            <Shuffle className="size-[15px]" strokeWidth={2} />
          </TransportToggle>

          <motion.button
            type="button"
            onClick={onPrevious}
            disabled={idle}
            whileTap={{ scale: 0.9 }}
            transition={SPRING}
            aria-label={t.previous}
            title={t.previous}
            className="grid size-9 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <SkipBack className="size-[17px] fill-current" strokeWidth={0} />
          </motion.button>

          <motion.button
            type="button"
            onClick={() => {
              // **Con el DJ hablando, "reproducir" es "empezá la música".**
              //
              // La frase es de la canción que viene, y la está introducing: la
              // música no empezó porque el DJ habla primero. Apretar play es
              // decir "no la quiero escuchar", y eso es lo mismo que apretar
              // siguiente.
              if (dj) onNext();
              else void togglePlayback().catch(() => {});
            }}
            disabled={idle || busy}
            whileTap={{ scale: 0.94 }}
            transition={SPRING}
            aria-label={dj ? t.djSkipVoice : playing ? t.pause : t.play}
            className="mx-1 grid size-11 place-items-center rounded-pill bg-ink text-ground transition-transform duration-150 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-[18px] animate-spin" strokeWidth={2} />
            ) : playing ? (
              <Pause className="size-[18px] fill-current" strokeWidth={0} />
            ) : (
              <Play className="size-[18px] translate-x-px fill-current" strokeWidth={0} />
            )}
          </motion.button>

          <motion.button
            type="button"
            onClick={onNext}
            disabled={idle}
            whileTap={{ scale: 0.9 }}
            transition={SPRING}
            aria-label={dj ? t.djSkipVoice : t.next}
            title={dj ? t.djSkipVoice : t.next}
            className="grid size-9 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <SkipForward className="size-[17px] fill-current" strokeWidth={0} />
          </motion.button>

          <TransportToggle
            on={repeat !== "off"}
            onClick={onCycleRepeat}
            label={repeatLabel(repeat, t)}
            disabled={idle}
          >
            {repeat === "one" ? (
              <Repeat1 className="size-[15px]" strokeWidth={2} />
            ) : (
              <Repeat className="size-[15px]" strokeWidth={2} />
            )}
          </TransportToggle>
        </div>

        <div className="flex w-full items-center gap-2.5">
          <span className="tabular w-10 text-right text-[12px] font-medium text-ink-muted">
            {formatDuration(position)}
          </span>
          <input
            type="range"
            className="slider min-w-0 grow"
            min={0}
            max={Math.max(duration, 1)}
            step={1}
            value={Math.min(position, duration || 0)}
            disabled={idle || duration <= 0}
            onChange={(e) => void seekPlayback(Number(e.target.value)).catch(() => {})}
            style={fillStyle(progress * 100)}
            aria-label={t.position}
          />
          <span className="tabular w-10 text-[12px] text-ink-muted">
            {formatDuration(duration)}
          </span>
        </div>

        {/* The refusal, in full, where there is room for it. */}
        {error && (
          <p className="w-full truncate text-center text-[12px] text-warn" title={explain(error)}>
            {explain(error)}
          </p>
        )}
      </div>

      {/* Secondary controls, mirroring the left column's width */}
      <div className="flex min-w-0 items-center justify-end gap-2">
        {/*
            The DJ's own button, where the official client has one: the mark the
            card on the shelf is drawn with, in the chrome's ink and not in the
            card's blue. Clicking it asks the DJ for another turn — the backend
            follows its own cursor, so the DJ moves on rather than starting
            over.
        */}
        {onPlayDj && (
          <motion.button
            type="button"
            onClick={onPlayDj}
            disabled={djBusy}
            whileTap={{ scale: 0.9 }}
            transition={SPRING}
            aria-label={t.djNext}
            title={t.djNext}
            className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/10 hover:text-ink disabled:pointer-events-none disabled:opacity-35"
          >
            <DjMark className="size-[17px]" />
          </motion.button>
        )}

        {/*
            The queue button is on at every width, and the volume slider is the
            one that sheds. A control that appears at some sizes is a control that
            is missing from others: below `lg` the queue is a sheet over the
            content instead of a column, but it is still the queue, and it now
            opens closed — there would be no way to reach it at all.
        */}
        <button
          type="button"
          onClick={onToggleQueue}
          aria-label={t.queue}
          title={t.queue}
          aria-pressed={queueOpen}
          className={`grid size-8 shrink-0 place-items-center rounded-pill transition-colors duration-200 hover:bg-white/10 ${
            queueOpen ? "bg-white/12 text-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          <ListOrdered className="size-[17px]" strokeWidth={2} />
        </button>

        {/*
            The lyrics button sits next to the queue, not next to the song's name
            where it started. Both open a panel that takes the main surface — the
            list and the lyrics land in the same place — so they belong in the same
            column, side by side: one button to bring a panel in, another to swap
            it. Split across the bar they read as two unrelated features. Disabled
            when nothing is playing, because then there is no song to ask about —
            the same rule as the transport.
        */}
        <motion.button
          type="button"
          onClick={onToggleLyrics}
          disabled={noSong}
          whileTap={{ scale: 0.9 }}
          transition={SPRING}
          aria-label={lyricsOpen ? t.closeLyrics : t.showLyrics}
          title={lyricsOpen ? t.closeLyrics : t.showLyrics}
          aria-pressed={lyricsOpen}
          className={`grid size-8 shrink-0 place-items-center rounded-pill transition-colors duration-200 disabled:pointer-events-none disabled:opacity-35 ${
            lyricsOpen ? "bg-white/12 text-ink" : "text-ink-muted hover:bg-white/10 hover:text-ink"
          }`}
        >
          <Mic2 className="size-[17px]" strokeWidth={2} />
        </motion.button>

        {/*
            The volume control, and what it decided not to be.

            The slider is on the bar at every width, and the icon next to it mutes —
            which is what it always did, and what an icon shaped like a speaker is
            for. A popover that opened above the bar was tried for narrow windows and
            taken back out: it needed a portal to escape the bar's `contain: paint`,
            and it put the volume two clicks away on the widths where it already fits.
            The measurement that settles it is the 768px minimum — the right column
            needs 185px and has 202px there, so the slider stays and nothing has to be
            invented for a case that does not exist.
        */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? t.unmute : t.mute}
            title={muted ? t.unmute : t.mute}
            className={`shrink-0 transition-colors duration-200 ${
              muted ? "text-live" : "text-ink-muted hover:text-ink"
            }`}
          >
            {muted ? (
              <VolumeX className="size-[17px]" strokeWidth={2} />
            ) : (
              <Volume2 className="size-[17px]" strokeWidth={2} />
            )}
          </button>
          {/*
            The same slider as the crossfade in Settings, in ink: the bar is
            chrome. The spring also covers the round trip — the value comes
            back from the backend a moment after the drag, and it glides there
            instead of snapping.
          */}
          <SmoothSlider
            className="w-20"
            tone="ink"
            max={MAX_VOLUME}
            step={128}
            value={status?.volume ?? 0}
            disabled={idle}
            onChange={(value) => void setVolume(value).catch(() => {})}
            label={t.volume}
          />
        </div>
      </div>
    </motion.footer>
  );
}

/**
 * Repeat cycles through three states, so the label has to say which one it is
 * *now* — not what pressing it will do. A toggle whose meaning depends on hidden
 * state is a toggle people press twice to undo.
 */
function repeatLabel(repeat: RepeatMode, t: Record<StringKey, string>): string {
  if (repeat === "one") return t.repeatOne;
  if (repeat === "all") return t.repeatAll;
  return t.repeat;
}

/**
 * Shuffle and repeat.
 *
 * Active state is the accent, not just a brighter grey: an order modifier is a
 * claim about what happens next, and the user needs to see at a glance whether
 * it is in force. `aria-pressed` carries the same fact to anyone not using the
 * colour.
 */
function TransportToggle({
  on,
  onClick,
  label,
  disabled,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.9 }}
      transition={SPRING}
      aria-label={label}
      title={label}
      aria-pressed={on}
      className={`grid size-9 shrink-0 place-items-center rounded-pill transition-colors duration-200 disabled:pointer-events-none disabled:opacity-35 ${
        on ? "bg-accent/15 text-accent" : "text-ink-faint hover:bg-white/8 hover:text-ink"
      }`}
    >
      {children}
    </motion.button>
  );
}

/**
 * Real cover art, or an empty frame.
 *
 * Never a generated gradient: a colour invented from nothing is a claim that
 * there is artwork there, and DESIGN.md's rule against fabricating evidence
 * applies here too. An empty square reads honestly as "no cover".
 *
 * The frame is `rounded-[10px]`, matching the queue, the rail and the shelf. It
 * was `rounded-pill`, which on a 56px box is clamped to half the width and comes
 * out a **circle** — so the one cover the eye never leaves was the only artwork
 * in the app drawn differently from all the others, sitting in the same bar as
 * three buttons that legitimately are pills. Nobody chose a hero shape here;
 * `rounded-pill` got copied down from the controls above it.
 */
function Cover({ track }: { track: Track | null }) {
  const cover = coverImage(track?.album?.images);

  if (!cover) {
    return <span className="size-14 shrink-0 rounded-[10px] bg-white/6" aria-hidden />;
  }
  return (
    <span className="size-14 shrink-0 overflow-hidden rounded-[10px]">
      <img src={cover.url} alt="" className="size-full object-cover" />
    </span>
  );
}

/**
 * The DJ, while it talks.
 *
 * **The same slot the album cover uses.** What the bar shows on the left is
 * what is making sound, and while the DJ talks that is the DJ: its drawing
 * takes the place of the cover, and the song's artwork comes back when the
 * music starts.
 *
 * The drawing is the account's DJ card —the same one that is on the shelf—. The
 * service sends no picture for the DJ, and inventing one would be a claim that
 * there is artwork there.
 */
function DjAvatar() {
  return (
    <span className="relative size-14 shrink-0 overflow-hidden rounded-[10px]">
      <DjArtwork />
    </span>
  );
}
