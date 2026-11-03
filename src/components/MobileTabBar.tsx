import { House, Library, Search } from "lucide-react";
import type { StringKey } from "../lib/i18n";

export type MobileTab = "navHome" | "navSearch" | "navLibrary";

type MobileTabBarProps = {
  t: Record<StringKey, string>;
  active: MobileTab;
  onSelect: (tab: MobileTab) => void;
};

const TABS: { key: MobileTab; label: StringKey; Icon: typeof House }[] = [
  { key: "navHome", label: "navHome", Icon: House },
  { key: "navSearch", label: "navSearch", Icon: Search },
  { key: "navLibrary", label: "tabLibrary", Icon: Library },
];

/**
 * The phone's navigation, where the thumb is.
 *
 * Floating glass at the bottom with the 12px inset of the phone (DESIGN.md, "The
 * phone"): three tabs and no more. Settings is not one of them —it opens a few
 * times in the life of the app— and lives as a gear on Home.
 *
 * The bottom inset adds the system's gesture bar, which on an edge-to-edge
 * window sits on top of the page.
 */
export function MobileTabBar({ t, active, onSelect }: MobileTabBarProps) {
  return (
    <nav className="glass fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-30 grid h-16 grid-cols-3 rounded-card">
      {TABS.map(({ key, label, Icon }) => {
        const on = active === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            aria-current={on ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors duration-200 active:scale-[0.94] ${
              on ? "text-ink" : "text-ink-faint"
            }`}
          >
            <Icon className="size-5" strokeWidth={on ? 2.4 : 2} />
            {t[label]}
          </button>
        );
      })}
    </nav>
  );
}
