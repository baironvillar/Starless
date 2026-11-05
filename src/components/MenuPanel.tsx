import { AnimatePresence, motion, useDragControls } from "motion/react";
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
import { useBack } from "../lib/back";
import { SPRING, SPRING_SHEET } from "../lib/motion";
import { isMobile } from "../lib/version";

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
  /** What the menu is about, at the top of the phone's sheet. The desktop popover has the row beside it. */
  header?: ReactNode;
  /**
   * A right-click opens the menu where the mouse is, not under the dots: the
   * hand is on the row, and a menu that appears across the row is a menu the
   * hand has to travel to. The panel's top-left corner goes on the point and is
   * still kept inside the window.
   */
  point?: { x: number; y: number } | null;
};

/** On the phone a menu is a sheet rising from the bottom, not a popover (DESIGN.md, "The phone"). */
const SHEET = isMobile();

/**
 * One menu, floating over the app, for every menu in it.
 *
 * **A portal, and it is not decoration.** This is a `surface-menu` surface and
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
  header,
  point = null,
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
    if (!open || SHEET) {
      setAt(null);
      return;
    }
    if (point) {
      setAt({
        top: point.y,
        left: Math.max(12, Math.min(point.x, window.innerWidth - width - 12)),
      });
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
  }, [open, anchor, width, placement, point]);

  /**
   * A submenu is measured after it renders, because its height is not known
   * before: it holds as many playlists as the account has, and the last one
   * that hangs off the window is a playlist that cannot be clicked.
   *
   * **A menu that opens below the control and hangs off the window is a menu
   * that cannot be used.** The settings sheet is full of controls near its
   * bottom edge, so the list opens *above* the trigger there, and the same rule
   * applies to the track menu at the end of a long list.
   */
  useLayoutEffect(() => {
    if (!open || !at) return;
    const node = menu.current;
    if (!node) return;
    const height = node.offsetHeight;
    const limit = window.innerHeight - height - 12;
    if (limit < 12) return;
    // A point has no box: a menu that would hang off the bottom opens upward from it.
    const box = point
      ? new DOMRect(point.x, point.y - 8, 0, 0)
      : anchor.current?.getBoundingClientRect();
    if (!box) return;
    setAt((prev) => {
      if (!prev) return prev;
      let top = prev.top;
      if (placement === "right") {
        if (top > limit) top = limit;
      } else {
        const below = box.bottom + 8;
        if (below + height > window.innerHeight - 12) {
          const above = box.top - height - 8;
          top = above >= 12 ? above : Math.max(12, limit);
        }
      }
      // The same place is the same object: a new one would run this effect
      // again, and again, forever.
      return top === prev.top ? prev : { ...prev, top };
    });
  }, [at, open, placement, anchor, point]);

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

  if (SHEET && placement === "below") {
    return createPortal(
      <AnimatePresence>
        {open && (
          <Sheet label={label} header={header} onClose={() => closeRef.current()}>
            {children}
          </Sheet>
        )}
      </AnimatePresence>,
      document.body,
    );
  }

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
          className="surface-menu fixed z-50 origin-top-right overflow-hidden rounded-card py-1.5"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * The phone's menu: a sheet of glass rising from the bottom, the thing it is
 * about at its top, and rows a finger can hit.
 *
 * **Two ways out, as the popover has**: a tap on the shade outside it, and
 * dragging it down. The drag starts on the top strip only —the handle and the
 * header— because the playlist picker inside it scrolls, and a sheet that
 * moved with that list would close every time somebody scrolled up.
 *
 * It keeps `data-menu-panel` and the stopped click for the same reasons the
 * popover does: the outside-press check reads the mark, and the sheet is still
 * a React child of the row that opened it.
 */
function Sheet({
  label,
  header,
  onClose,
  children,
}: {
  label: string;
  header?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const drag = useDragControls();
  useBack(true, onClose);
  /**
   * A sheet opened by holding a row appears under the finger that is still
   * down, and the click the lift may send would land on the shade and close
   * it at once. The shade answers only once that finger has had time to lift.
   */
  const [openedAt] = useState(() => performance.now());
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={(event) => {
          event.stopPropagation();
          if (performance.now() - openedAt > 400) onClose();
        }}
        // The shade closes the sheet itself, with the guard above; the
        // window's outside-press check would close it without one.
        data-menu-panel=""
        className="fixed inset-0 z-50 bg-black/45"
        aria-hidden
      />
      <motion.div
        initial={{ y: "110%" }}
        animate={{ y: 0 }}
        exit={{ y: "110%" }}
        transition={SPRING_SHEET}
        drag="y"
        dragControls={drag}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.7 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 80 || info.velocity.y > 500) onClose();
        }}
        role="listbox"
        aria-label={label}
        data-menu-panel=""
        onClick={(event) => event.stopPropagation()}
        className="glass-overlay fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-50 flex max-h-[80vh] flex-col overflow-hidden rounded-card pb-2"
      >
        <div onPointerDown={(event) => drag.start(event)} className="shrink-0 touch-none">
          <span
            className="mx-auto mt-2.5 mb-1 block h-1 w-10 rounded-pill bg-white/20"
            aria-hidden
          />
          {header && <div className="border-b border-white/8 px-4 pt-2 pb-3">{header}</div>}
        </div>
        <div className="min-h-0 overflow-y-auto pt-1">{children}</div>
      </motion.div>
    </>
  );
}

type MenuItemProps = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** The one line that is true right now — a check, or a confirmation. */
  trailing?: ReactNode;
  /**
   * The row is the chosen one.
   *
   * **A listbox says which row is the answer.** A menu does not need it, but a
   * list of choices does, and the screen reader reads the check out loud before
   * the label.
   */
  selected?: boolean;
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
  selected,
  ref,
  onHover,
  onUnhover,
}: MenuItemProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={selected ?? false}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onUnhover}
      className={`flex w-full items-center text-left transition-colors duration-150 hover:bg-white/6 ${
        SHEET
          ? "gap-3.5 px-4 py-3.5 text-[15px] active:bg-white/8"
          : "gap-2.5 px-3 py-2 text-[13px]"
      }`}
    >
      {icon && (
        <span
          className={`grid shrink-0 place-items-center text-ink-muted ${SHEET ? "size-5 [&>svg]:size-[18px]" : "size-4"}`}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}
