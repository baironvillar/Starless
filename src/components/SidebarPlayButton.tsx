import { Loader2, Play } from "lucide-react";

/** A sibling of navigation, so playing never opens the playlist as a side effect. */
export function SidebarPlayButton({
  label,
  busy = false,
  onPlay,
  className = "",
}: {
  label: string;
  busy?: boolean;
  onPlay: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-busy={busy}
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        onPlay();
      }}
      className={`pointer-events-auto absolute z-10 grid size-7 place-items-center rounded-pill bg-accent text-on-accent shadow-[0_4px_12px_-2px_rgba(0,0,0,0.8)] transition-opacity duration-150 ${busy ? "opacity-100" : "opacity-0 group-hover/sidebar:opacity-100 group-focus-within/sidebar:opacity-100 focus-visible:opacity-100"} ${className}`}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Play className="size-3.5 translate-x-px fill-current" strokeWidth={0} aria-hidden />
      )}
    </button>
  );
}
