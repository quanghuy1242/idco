// DaisyUI 5: https://daisyui.com/components/button/
"use client";

import { Button as AriaButton } from "react-aria-components";
import { NavIcon } from "./nav-icons";

type ScopePickerTriggerTone = "accent" | "info";

type ScopePickerTriggerProps = {
  readonly label: string;
  readonly tone: ScopePickerTriggerTone;
  readonly ariaLabel?: string;
};

const toneClass: Record<ScopePickerTriggerTone, string> = {
  accent:
    "btn-accent border-accent text-accent hover:border-accent hover:bg-accent/5 hover:text-accent data-[hovered]:bg-accent/5 data-[pressed]:bg-accent/10 focus-visible:outline-accent",
  info: "btn-info border-info text-info hover:border-info hover:bg-info/5 hover:text-info data-[hovered]:bg-info/5 data-[pressed]:bg-info/10 focus-visible:outline-info",
};

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
