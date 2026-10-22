import { ArrowUpDown, Check, LayoutGrid, List } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { StringKey } from "../lib/i18n";
import { SPRING } from "../lib/motion";
import { LIBRARY_SORTS, type LibrarySort, type LibraryView } from "../lib/spotify";

/** The label each order is announced with, in both languages. */
const SORT_LABEL: Record<LibrarySort, StringKey> = {
  "name-asc": "sortNameAsc",
  "name-desc": "sortNameDesc",
  creator: "sortCreator",
  tracks: "sortTracks",
};

/** Wide enough for "Nombre, de A a Z" in Spanish, which is the longer of the two. */
const MENU_PX = 236;

/**
 * Two ways out of the menu, and both are needed: Escape for the keyboard, and a
 * click outside for the mouse. A menu that only closes on Escape is a menu that
 * traps the person using the mouse.
 *
 * **Not exported any more.** The playlist's order menu and a song's three dots
 * moved onto [`MenuPanel`](../components/MenuPanel), which owns this and the
 * measuring together. Exported here it was a third place to keep the same two
 * exits working, and a copy is a copy that one day closes on only one of them.
 */
function useDismiss(
  open: boolean,
  close: () => void,
  anchor: React.RefObject<HTMLElement | null>,
  menu: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchor.current?.contains(target) || menu.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close, anchor, menu]);
}

type LibrarySortMenuProps = {
  t: Record<StringKey, string>;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  className?: string;
};

/**
 * The order control, and it lives on the library rail because that is the library.
 *
 * The menu is a **portal**, and that is not decoration. It is a `glass-overlay`
 * surface, and the rail is already glass: drawn inside it, the menu would be a glass
 * surface nested in a glass surface, which DESIGN.md forbids because every level
 * multiplies the blur and compounds the contrast loss. It would also be clipped —
 * the rail is `overflow-hidden` and its width is animated, and a transform on an
 * ancestor is what a `position: fixed` descendant measures against. Out here it is
 * its own floating surface, anchored to the button by its measured rect.
 */
export function LibrarySortMenu({ t, sort, onSortChange, className = "" }: LibrarySortMenuProps) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);
  useDismiss(open, close, anchor, menu);

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const box = anchor.current?.getBoundingClientRect();
    if (box) {
      // Right-aligned to the button and kept on screen, because a menu that opens
      // off the edge of a narrow window is a menu that cannot be used.
      setAt({
        top: box.bottom + 8,
        left: Math.max(12, Math.min(box.right - MENU_PX, window.innerWidth - MENU_PX - 12)),
      });
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.librarySort}
        // The button is an icon, so the order that is on has to be readable
        // somewhere: its tooltip says which one it is, in both languages.
        title={`${t.librarySort}: ${t[SORT_LABEL[sort]]}`}
        className={`grid size-8 shrink-0 place-items-center rounded-pill text-ink-muted transition-colors duration-200 hover:bg-white/8 hover:text-ink ${className}`}
      >
        <ArrowUpDown className="size-4" strokeWidth={2} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && at && (
            <motion.div
              ref={menu}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={SPRING}
              role="listbox"
              aria-label={t.librarySort}
              style={{ top: at.top, left: at.left, width: MENU_PX }}
              // Laid out with a measured `left` and no transform on the X axis.
              // SearchMenu lost its `-translate-x-1/2` for the same reason: a
              // composited layer between the backdrop and the thing that samples
              // it is what took the blur out of the packaged build.
              className="glass-overlay fixed z-50 origin-top-right overflow-hidden rounded-card py-1.5"
            >
              {LIBRARY_SORTS.map((option) => {
                const active = option === sort;
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onSortChange(option);
                      close();
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors duration-150 ${
                      active ? "bg-white/10" : "hover:bg-white/6"
                    }`}
                  >
                    <span className="min-w-0 flex-1">{t[SORT_LABEL[option]]}</span>
                    <Check
                      className={`size-3.5 shrink-0 transition-opacity duration-150 ${
                        active ? "text-accent opacity-100" : "opacity-0"
                      }`}
                      strokeWidth={2.5}
                    />
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

type LibraryViewToggleProps = {
  t: Record<StringKey, string>;
  view: LibraryView;
  onViewChange: (view: LibraryView) => void;
};

/**
 * Grid or list, and it sits on the rail beside the order control.
 *
 * Both controls answer the same question — *how do I want my library* — and splitting
 * them between the rail and a screen is how one of them ends up in Ajustes and nobody
 * finds it. **Where the answer shows up is a separate thing:** the rail is already a
 * list of names, so this draws Inicio — the same library, one screen over. It was
 * tried on the shelf first and read as two unrelated controls belonging to different
 * things, which is not what it is.
 *
 * A segmented control and not one button whose icon flips: with two icons and one of
 * them lit, "which one am I looking at" needs no hover. With one icon it does, and an
 * icon meaning the opposite of the state it shows is a control people get wrong once
 * and then distrust.
 */
export function LibraryViewToggle({ t, view, onViewChange }: LibraryViewToggleProps) {
  return (
    <div className="flex h-8 items-center gap-0.5 rounded-pill bg-white/8 p-0.5">
      {[
        { option: "grid" as const, icon: LayoutGrid, label: t.viewGrid },
        { option: "list" as const, icon: List, label: t.viewList },
      ].map(({ option, icon: Icon, label }) => {
        const active = option === view;
        return (
          <button
            key={option}
            type="button"
            aria-label={label}
            aria-pressed={active}
            title={label}
            onClick={() => onViewChange(option)}
            className={`grid size-7 place-items-center rounded-pill transition-colors duration-200 ${
              active ? "bg-white/12 text-ink" : "text-ink-muted hover:text-ink"
            }`}
          >
            <Icon className="size-4" strokeWidth={2} />
          </button>
        );
      })}
    </div>
  );
}
