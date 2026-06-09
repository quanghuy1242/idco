// DaisyUI 5: https://daisyui.com/components/toggle/
"use client";

import { useRef } from "react";
import { useSwitch } from "react-aria";
import { useToggleState } from "react-stately";

export type SwitchTone = "primary" | "success";
export type SwitchSize = "sm" | "md";

type SwitchProps = {
  readonly label: string;
  readonly name?: string;
  readonly selected?: boolean;
  readonly defaultSelected?: boolean;
  readonly onChange?: (selected: boolean) => void;
  readonly size?: SwitchSize;
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
