"use client";

// DaisyUI 5: https://daisyui.com/components/select/
// React Aria: https://react-spectrum.adobe.com/react-aria/Select.html

import {
  Select,
  SelectValue,
  Button as SelectTrigger,
  Popover,
  ListBox,
  ListBoxItem,
} from "react-aria-components";
import { ChevronDown } from "lucide-react";

/** A selectable option with a stored `value` and its human-readable `label`. */
type FilterOption = {
  readonly value: string;
  readonly label: string;
};

type Size = "sm" | "md";

/** Props for {@link FilterDropdown}. */
type FilterDropdownProps = {
  readonly label: string;
  /** Selectable options shown in the dropdown. */
  readonly options: ReadonlyArray<FilterOption>;
  /** Currently selected option value; the control is controlled by this. */
  readonly value: string;
  /** Called with the newly selected option value. */
  readonly onChange: (value: string) => void;
  /** Trigger size; `md` (default) or compact `sm`. */
  readonly size?: Size;
  readonly className?: string;
  /** Render the `label` as a separate field label above the trigger instead of inline as a prefix. */
  readonly showLabel?: boolean;
};

const sizeClass: Record<Size, string> = {
  sm: "select select-bordered select-sm",
  md: "select select-bordered",
};

/**
 * A compact single-select filter control built on React Aria Select with DaisyUI select styling.
 *
 * @categoryDefault Pickers
 */

/** A compact single-select filter control with a controlled value, built on React Aria Select with DaisyUI select styling. */
export function FilterDropdown({
  label,
  options,
  value,
  onChange,
  size = "md",
  className,
  showLabel,
}: FilterDropdownProps) {
  return (
    <div className={showLabel ? "form-control w-full" : undefined}>
      {showLabel ? (
        <label className="label">
          <span className="label-text text-base font-medium text-base-content">
            {label}
          </span>
        </label>
      ) : null}
      <Select
        aria-label={label}
        selectedKey={value}
        onSelectionChange={(key) => onChange(String(key))}
        className={!showLabel ? className : undefined}
      >
        <SelectTrigger
          className={`${sizeClass[size]} ${showLabel ? "w-full" : "w-auto"} bg-none flex items-center gap-1`}
        >
          {!showLabel ? (
            <span className="text-base-content/50 mr-0.5">{label}:</span>
          ) : null}
          <SelectValue />
          <ChevronDown
            className="h-3 w-3 text-base-content/50 shrink-0"
            aria-hidden="true"
          />
        </SelectTrigger>
        <Popover className="z-50 w-(--trigger-width) data-[entering]:animate-popover-in data-[exiting]:animate-popover-out">
          <ListBox className="menu menu-sm popover-panel w-full">
            {options.map((opt) => (
              <ListBoxItem
                key={opt.value}
                id={opt.value}
                className="px-3 py-1.5 text-sm rounded cursor-pointer hover:bg-base-200 focus:bg-base-200 outline-none data-[selected]:font-medium"
              >
                {opt.label}
              </ListBoxItem>
            ))}
          </ListBox>
        </Popover>
      </Select>
    </div>
  );
}
