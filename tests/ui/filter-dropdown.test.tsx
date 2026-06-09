// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterDropdown } from "@idco/ui";

describe("FilterDropdown", () => {
  const options = [
    { value: "all", label: "All" },
    { value: "admin", label: "Admin" },
  ] as const;

  it("opens an animated React Aria popover", async () => {
    render(
      <FilterDropdown
        label="Role"
        options={options}
        value="all"
        onChange={vi.fn<(value: string) => void>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /role/i }));

    const listbox = await screen.findByRole("listbox");
    expect(listbox.parentElement).toHaveClass(
      "data-[entering]:animate-popover-in",
      "data-[exiting]:animate-popover-out",
    );
  });
});
