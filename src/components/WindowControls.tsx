import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { StringKey } from "../lib/i18n";

type WindowControlsProps = {
  t: Record<StringKey, string>;
};

/**
 * Minimise, maximise, close — the window's own controls, inside the window.
 *
 * The window runs with `decorations: false`, so the operating system's title bar
 * is not drawn at all. That is the point: a rectangle with the app's name in it
 * across the top is the single most "assembled" thing on an otherwise designed
 * window, and the top bar already carries the whole chrome.
 *
 * What that costs is the one thing the title bar was doing: moving the window.
 * `data-tauri-drag-region` on the bar handles it (see `TopBar`), and every control
 * inside opts out, because a button that drags the window when you mean to click
 * it is worse than no button.
 *
 * Max and restore are the same button. A window that cannot be resized yet — the
 * app is `resizable` but nobody has stretched it — would render a "restore" icon
 * that does nothing, so the icon follows the real state, polled once and on
 * change. Desktop apps have shipped that wrong for decades; it takes three lines.
 */
export function WindowControls({ t }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const app = getCurrentWindow();
    let alive = true;
    void app
      .isMaximized()
      .then((value) => alive && setMaximized(value))
      .catch(() => {});
    // Only this window can be maximised, and only by this button, so listening is
    // enough and a resize listener on the window would be the wrong hook.
    let unlisten: (() => void) | undefined;
    void app
      .onResized(() => void app.isMaximized().then((v) => alive && setMaximized(v)))
      .then((off) => {
        if (alive) unlisten = off;
        else off();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  // Every call goes through a catch: an IPC failure here has nowhere to surface —
  // there is no title bar to flash — and an unhandled rejection would take the app
  // down over a window that was already refusing politely.
  const run = (action: () => Promise<unknown>) => () => {
    void action().catch(() => {});
  };

  return (
    <div
      data-tauri-drag-region={false}
      className="flex shrink-0 items-center gap-0.5 rounded-pill p-0.5"
    >
      <Control label={t.windowMinimize} onClick={run(() => getCurrentWindow().minimize())}>
        <Minus className="size-4" strokeWidth={2} />
      </Control>

      <Control
        label={maximized ? t.windowRestore : t.windowMaximize}
        onClick={run(() => getCurrentWindow().toggleMaximize())}
      >
        <Square className="size-[13px]" strokeWidth={2} />
      </Control>

      <Control label={t.windowClose} onClick={run(() => getCurrentWindow().close())} danger>
        <X className="size-4" strokeWidth={2} />
      </Control>
    </div>
  );
}

function Control({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-tauri-drag-region={false}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-8 shrink-0 place-items-center rounded-pill transition-colors duration-150 ${
        danger
          ? "text-ink-muted hover:bg-live/20 hover:text-live"
          : "text-ink-muted hover:bg-white/10 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
