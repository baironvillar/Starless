import { AnimatePresence, motion } from "motion/react";
import {
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { SPRING } from "../lib/motion";

type MenuPanelProps = {
  open: boolean;
  onClose: () => void;
  /** The control the menu hangs off. It is measured, not styled against. */
  anchor: RefObject<HTMLElement | null>;
  label: string;
  width: number;
  children: ReactNode;
  /**
   * Where the panel opens relative to the anchor.
   *
   * `below` hangs under the control that opened the menu. `right` opens beside
   * the row that opened it, which is what a submenu is.
   */
  placement?: "below" | "right";
  /** The pointer arrived over the panel. A submenu needs it to stay open. */
  onHover?: () => void;
  /** The pointer left the panel. */
  onUnhover?: () => void;
};

/**
 * One menu, floating over the app, for every menu in it.
 *
 * **A portal, and it is not decoration.** This is a `glass-overlay` surface and
 * the surfaces it opens over are already glass: drawn inside one, it would be a
 * glass surface nested in a glass surface, which DESIGN.md forbids because every
 * level multiplies the blur and compounds the contrast loss. It would also be
 * clipped — the library rail is `overflow-hidden` with an animated width, and a
 * transform on an ancestor is what a `position: fixed` descendant measures
 * against. Out here it is its own floating surface, anchored by a measured rect.
 *
 * **Two ways out, and both are needed**: Escape for the keyboard and a press
 * outside for the mouse. A menu that only closes on Escape traps the person
 * using the mouse. This used to live inside `LibraryControls` and be imported by
 * the playlist's order menu, which is exactly how two menus end up disagreeing
 * about what "close" means.
 *
 * **A panel is a leaf, for events as well as for glass.** It floats over
 * something clickable — a row that plays a song — and a portal is a child of
 * React of whatever it floats over, so the clicks inside it arrive at that
 * row unless something stops them. The two comments below say where they die
 * and how the panel knows that a press landed inside it.
 *
 * **The close handler is held in a ref on purpose.** Callers write
 * `const close = () => setOpen(false)` inline, which is a new function on every
 * render; subscribing to it directly tears the listener down and puts it back up
 * every frame the parent re-renders, which is a menu that flickers open under a
 * mouse that has not moved.
 */
export function MenuPanel({
  open,
  onClose,
  anchor,
  label,
  width,
  children,
  placement = "below",
  onHover,
  onUnhover,
}: MenuPanelProps) {
  const menu = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  /**
   * Measured when the menu opens, not on every render.
   *
   * Right-aligned to the anchor and clamped to the window, because a menu that
   * opens off the edge of a narrow window is a menu that cannot be used. A
   * submenu opens *beside* the row instead, and flips to the other side when
   * there is no room, for the same reason.
   */
  useEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const box = anchor.current?.getBoundingClientRect();
    if (!box) return;

    if (placement === "right") {
      const onRight = box.right + 8;
      const fits = onRight + width <= window.innerWidth - 12;
      setAt({
        top: Math.max(12, box.top),
        left: fits ? onRight : Math.max(12, box.left - width - 8),
      });
      return;
    }

    setAt({
      top: box.bottom + 8,
      left: Math.max(12, Math.min(box.right - width, window.innerWidth - width - 12)),
    });
  }, [open, anchor, width, placement]);

  /**
   * A submenu is measured after it renders, because its height is not known
   * before: it holds as many playlists as the account has, and the last one
   * that hangs off the window is a playlist that cannot be clicked.
   */
  useLayoutEffect(() => {
    if (!open || !at || placement !== "right") return;
    const node = menu.current;
    if (!node) return;
    const limit = window.innerHeight - node.offsetHeight - 12;
    if (limit < 12) return;
    setAt((prev) => (prev && prev.top > limit ? { ...prev, top: limit } : prev));
  }, [at, open, placement]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchor.current?.contains(target)) return;

      /**
       * **The path of the event, and not the tree of the DOM.**
       *
       * A submenu is a portal: a *sibling* of the panel that opened it, not a
       * child of it. So "is this press inside one of my panels" cannot be
       * answered with `contains` — the panel that would answer it is not an
       * ancestor of the target, and a press on the search field of the submenu
       * reads as a press in the void. The path of the event says which
       * elements it crossed, and every panel of this tree is one of them.
       *
       * The other way around — each panel announcing its node to a shared set
       * — was tried first and it is a trap: the panel is not in the document
       * until it has been measured, so the effect that announces it runs
       * before there is anything to announce, and never runs again. The
       * failure is silent and it closes the menu on the first press.
       */
      for (const entry of event.composedPath()) {
        if (entry instanceof HTMLElement && entry.hasAttribute("data-menu-panel")) return;
      }

      closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, anchor]);

  return createPortal(
    <AnimatePresence>
      {open && at && (
        <motion.div
          ref={menu}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={SPRING}
          role="listbox"
          aria-label={label}
          /**
           * The mark the outside-press check looks for in the path of the
           * event. Every panel of a tree carries it, and it says nothing else:
           * it is not a style and it is not a hook.
           */
          data-menu-panel=""
          style={{ top: at.top, left: at.left, width }}
          /**
           * The panel is a leaf, and it has to be one.
           *
           * **A portal is a child of React of whatever it floats over.** The events
           * of React travel the React tree, not the DOM tree, so a click inside
           * this panel arrives at the row underneath it — and the row underneath
           * is a song, and clicking a song plays it. A click on "Add to playlist"
           * that also starts the song is not a control, it is two controls
           * fighting, and the song wins because it is the one with the whole row.
           *
           * The click dies here, at the edge of the panel, where it belongs.
           */
          onClick={(event) => event.stopPropagation()}
          onMouseEnter={onHover}
          onMouseLeave={onUnhover}
          // Laid out with a measured `left` and no transform on the X axis.
          // `SearchMenu` lost its `-translate-x-1/2` for the same reason: a
          // composited layer between the backdrop and the thing that samples it
          // is what took the blur out of the packaged build.
          className="glass-overlay fixed z-50 origin-top-right overflow-hidden rounded-card py-1.5"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

type MenuItemProps = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** The one line that is true right now — a check, or a confirmation. */
  trailing?: ReactNode;
  /**
   * The row is also the anchor of a submenu, so it has to be measurable.
   *
   * A `ref` as a plain prop, which is what React 19 does with function
   * components: there is no `forwardRef` to remember and nothing to forget.
   */
  ref?: Ref<HTMLButtonElement>;
  /**
   * The pointer arrived, and the pointer left.
   *
   * **The row that opens a submenu opens it on the way in, not on the click.**
   * A click asks for the submenu; a hover *is* the submenu. The row that owns
   * one is the only row in the menu that changes shape under the pointer, and
   * the chevron is what says so.
   */
  onHover?: () => void;
  onUnhover?: () => void;
};

/**
 * One row of a menu. A row is not a button wearing a costume: it is a `<button>`,
 * because a menu you cannot reach with the keyboard is not finished.
 */
export function MenuItem({
  label,
  icon,
  onSelect,
  trailing,
  ref,
  onHover,
  onUnhover,
}: MenuItemProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={false}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onUnhover}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-white/6"
    >
      {icon && (
        <span className="grid size-4 shrink-0 place-items-center text-ink-muted">{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}
