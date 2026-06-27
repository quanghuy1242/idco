// DaisyUI 5: https://daisyui.com/components/toggle/
"use client";

import { useRef } from "react";
import { useSwitch } from "react-aria";
import { useToggleState } from "react-stately";

/**
 * Accessible on/off toggle built on React Aria `useSwitch` with a native checkbox and DaisyUI `toggle` styling.
 *
 * @categoryDefault Forms
 */

/** Accent color of the toggle when on. */
export type SwitchTone = "primary" | "success";
/** Control size of the toggle. */
export type SwitchSize = "sm" | "md";

/** Props for {@link Switch}. */
type SwitchProps = {
  readonly label: string;
  readonly name?: string;
  /** Controlled on/off state. Pair with {@link SwitchProps.onChange}. */
  readonly selected?: boolean;
  /** Initial on/off state when uncontrolled. */
  readonly defaultSelected?: boolean;
  /** Called with the new on/off state when toggled. */
  readonly onChange?: (selected: boolean) => void;
  /** Control size: `sm` for compact, `md` (default) for standard. */
  readonly size?: SwitchSize;
  /** Accent color when on: `primary` (default) or `success`. */
  readonly tone?: SwitchTone;
  readonly disabled?: boolean;
};

const sizeClass: Record<SwitchSize, string> = {
  sm: "toggle-sm",
  md: "",
};

const toneClass: Record<SwitchTone, string> = {
  primary: "toggle-primary",
  success: "toggle-success",
};

/**
 * A labeled on/off toggle with configurable size and accent tone.
 */
// DaisyUI `toggle` needs the native `:checked` pseudo-class, so we use `useSwitch` + a native input (not the RAC `Switch` wrapper). See `form.tsx`.
export function Switch({
  label,
  name,
  selected,
  defaultSelected,
  onChange,
  size = "md",
  tone = "primary",
  disabled,
}: SwitchProps) {
  const state = useToggleState({
    isSelected: selected,
    defaultSelected,
    onChange,
    isDisabled: disabled,
  });
  const ref = useRef<HTMLInputElement>(null);
  const { inputProps } = useSwitch(
    { name, "aria-label": label, isDisabled: disabled },
    state,
    ref,
  );

  return (
    <label className="label cursor-pointer justify-start gap-3">
      <input
        {...inputProps}
        ref={ref}
        className={`toggle ${sizeClass[size]} ${toneClass[tone]}`.trim()}
      />
      <span className="label-text text-base text-base-content">{label}</span>
    </label>
  );
}
