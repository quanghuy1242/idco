"use client";

// DaisyUI 5: https://daisyui.com/components/input/ (text label inside the
// `input` wrapper) — the `input` class sits on the container so a prefix label
// and a clear affordance can live beside the field.
// React Aria: https://react-spectrum.adobe.com/react-aria/SearchField.html
import {
  SearchField,
  Input,
  Button as ClearButton,
} from "react-aria-components";

type Size = "sm" | "md";

type InlineTextFilterProps = {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly size?: Size;
  readonly className?: string;
};

const sizeClass: Record<Size, string> = {
  sm: "input-sm",
  md: "",
};

/**
 * A compact, auto-width free-text filter for list toolbars. It mirrors
 * `FilterDropdown`'s inline look — a muted `Label:` prefix inside a bordered
 * control — but accepts arbitrary text instead of enumerated options, so a row
 * of filters reads as one toolbar rather than a stacked form. Built on React
 * Aria's `SearchField` for accessible clear behavior.
 */
export function InlineTextFilter({
  label,
  value,
  onChange,
  placeholder,
  size = "md",
  className,
}: InlineTextFilterProps) {
  return (
    <SearchField
      value={value}
      onChange={onChange}
      aria-label={label}
      className={`group input input-bordered ${sizeClass[size]} flex items-center gap-1 w-auto bg-base-100 text-base-content focus-within:input-primary${className ? ` ${className}` : ""}`.trim()}
    >
      <span className="text-base-content/50 shrink-0">{label}:</span>
      <Input
        placeholder={placeholder}
        className="grow border-0 bg-transparent p-0 outline-none w-28 min-w-0 text-base-content placeholder:text-base-content/40"
      />
      <ClearButton
        aria-label={`Clear ${label}`}
        className="hidden text-base leading-none text-base-content/40 hover:text-base-content/70 group-data-[empty=false]:block shrink-0"
      >
        ✕
      </ClearButton>
    </SearchField>
  );
}
