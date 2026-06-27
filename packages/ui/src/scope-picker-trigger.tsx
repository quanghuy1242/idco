// DaisyUI 5: https://daisyui.com/components/button/
"use client";

import { Button as AriaButton } from "react-aria-components";
import { NavIcon } from "./nav-icons";

/** Color tone applied to the scope trigger's outline and hover states. */
type ScopePickerTriggerTone = "accent" | "info";

/** Props for {@link ScopePickerTrigger}. */
type ScopePickerTriggerProps = {
  /** Current scope name shown on the button. */
  readonly label: string;
  /** Color tone applied to the outline and hover/press states. */
  readonly tone: ScopePickerTriggerTone;
  /** Override for the button's accessible name; defaults to a label-derived description. */
  readonly ariaLabel?: string;
};

const toneClass: Record<ScopePickerTriggerTone, string> = {
  accent:
    "btn-accent border-accent text-accent hover:border-accent hover:bg-accent/5 hover:text-accent data-[hovered]:bg-accent/5 data-[pressed]:bg-accent/10 focus-visible:outline-accent",
  info: "btn-info border-info text-info hover:border-info hover:bg-info/5 hover:text-info data-[hovered]:bg-info/5 data-[pressed]:bg-info/10 focus-visible:outline-info",
};

/**
 * An outlined trigger button that displays the active console scope and opens its picker.
 *
 * @categoryDefault Pickers
 */

/** An outlined React Aria button that displays the active console scope and opens its picker, styled with DaisyUI tones. */
export function ScopePickerTrigger({
  label,
  tone,
  ariaLabel,
}: ScopePickerTriggerProps) {
  return (
    <AriaButton
      type="button"
      aria-label={ariaLabel ?? `Select console scope, current ${label}`}
      className={[
        "btn btn-outline min-w-0 justify-between gap-3 bg-base-100 px-3 font-medium shadow-none",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        toneClass[tone],
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
      <NavIcon name="ChevronDown" variant="dock" />
    </AriaButton>
  );
}
