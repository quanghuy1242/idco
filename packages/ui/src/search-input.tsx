"use client";

// DaisyUI 5: https://daisyui.com/components/input/
// React Aria: https://react-spectrum.adobe.com/react-aria/SearchField.html

import {
  SearchField,
  Input,
  Button as ClearButton,
} from "react-aria-components";

/** Control height of the search field. */
type Size = "sm" | "md";

/** Props for {@link SearchInput}. */
type SearchInputProps = {
  /** Controlled query string. */
  readonly value: string;
  /** Called with the new query on each edit or clear. */
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  /** When true, the field flexes to fill its row; otherwise it spans full width. */
  readonly grow?: boolean;
  /** Control height: `sm` for compact, `md` (default) for standard. */
  readonly size?: Size;
};

const sizeClass: Record<Size, string> = {
  sm: "input input-bordered input-sm",
  md: "input input-bordered",
};

/**
 * Controlled search box with a clear affordance, built on React Aria `SearchField`.
 *
 * @categoryDefault Forms
 */

/**
 * A search field with a clear button that surfaces once text is entered.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  grow = false,
  size = "md",
}: SearchInputProps) {
  return (
    <SearchField
      value={value}
      onChange={onChange}
      aria-label="Search"
      className={`group relative flex items-center${grow ? " flex-1" : " w-full"}`}
    >
      <Input
        placeholder={placeholder}
        className={`${sizeClass[size]} bg-base-100 text-base-content focus:input-primary pr-7 w-full`}
      />
      <ClearButton
        aria-label="Clear search"
        className="absolute right-2 hidden text-base leading-none text-base-content/40 hover:text-base-content/70 group-data-[empty=false]:block"
      >
        ✕
      </ClearButton>
    </SearchField>
  );
}
