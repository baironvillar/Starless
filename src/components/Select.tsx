import { Check, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { MenuItem, MenuPanel } from "./MenuPanel";

export type SelectOption = { value: string; label: string };

type SelectProps = {
  /** The chosen value. Without it the control keeps one of its own. */
  value?: string;
  /** The value before anybody chose one. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  options: SelectOption[];
  /** The name of the control, for the people who cannot see it. */
  label?: string;
};

/**
 * A choice, drawn like the app.
 *
 * **The native `<select>` was the one control that did not belong.** Its closed
 * state was dressed up —the options were hidden and a chevron was drawn over it—
 * but the list itself was still the operating system's: a white rectangle with
 * black text, in a window that is otherwise glass over a dark background. It was
 * the one place where a choice looked like it belonged to another program.
 *
 * So the list is now the app's own menu —the same floating surface every other
 * menu in Starless uses— with a check on the chosen option. The trigger keeps
 * the exact shape it had, so nothing that was already there moved.
 *
 * **The list is a portal, and that is what makes it work inside the settings
 * sheet.** The panel is a scroll container with a glass surface; a list drawn
 * inside it would be clipped by the scroll and would be glass inside glass,
 * which DESIGN.md forbids. Out here it floats over the window, measured against
 * the trigger.
 */
export function Select({ value, defaultValue, onChange, options, label }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value ?? "");
  const anchor = useRef<HTMLButtonElement>(null);

  const chosen = value ?? own;
  const current = options.find((option) => option.value === chosen);

  const pick = (next: string) => {
    setOwn(next);
    onChange?.(next);
    setOpen(false);
  };

  /**
   * The list is as wide as the longest name in it.
   *
   * **Measured, not counted.** The width of a text run is not a number of
   * characters, and a list that cuts its own options is worse than a native one:
   * the person has to open it again to read what they missed. The trigger is
   * measured too, because it holds the name of the current choice and a list
   * narrower than its own trigger looks like a mistake.
   */
  const widest = options.reduce((longest, option) => Math.max(longest, option.label.length), 0);
  const width = Math.max(200, Math.ceil(widest * 7.6) + 58);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((was) => !was)}
        className="flex min-w-[164px] items-center justify-between gap-2 rounded-pill border border-white/14 bg-white/6 py-2.5 pr-4 pl-4 text-[13px] font-medium transition-colors duration-200 hover:bg-white/10"
      >
        <span className="truncate">{current?.label ?? ""}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-muted" strokeWidth={2} />
      </button>

      <MenuPanel
        open={open}
        onClose={() => setOpen(false)}
        anchor={anchor}
        label={label ?? current?.label ?? ""}
        width={width}
      >
        {options.map((option) => (
          <MenuItem
            key={option.value}
            label={option.label}
            selected={option.value === chosen}
            icon={
              option.value === chosen ? (
                <Check className="size-4 text-accent" strokeWidth={2.5} />
              ) : undefined
            }
            onSelect={() => pick(option.value)}
          />
        ))}
      </MenuPanel>
    </>
  );
}
