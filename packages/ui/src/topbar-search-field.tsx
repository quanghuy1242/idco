// DaisyUI 5: https://daisyui.com/components/input/
// React Aria: https://react-spectrum.adobe.com/react-aria/SearchField.html
"use client";

import { Button, Input, SearchField } from "react-aria-components";

type TopbarSearchFieldProps = {
  readonly placeholder?: string;
};

export function TopbarSearchField({
  placeholder = "Search",
}: TopbarSearchFieldProps) {
  return (
    <SearchField
      aria-label={placeholder}
      className="group relative flex items-center"
    >
      <Input
        placeholder={placeholder}
        className="input input-bordered min-w-24 md:w-48 bg-base-100 text-base-content focus:input-primary pr-7"
      />
      <Button
        aria-label="Clear search"
        className="absolute right-2 hidden text-base leading-none text-base-content/40 hover:text-base-content/70 group-data-[empty=false]:block"
      >
        ✕
      </Button>
    </SearchField>
  );
}
