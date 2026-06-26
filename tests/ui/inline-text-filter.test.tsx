// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InlineTextFilter } from "@idco/ui";

describe("InlineTextFilter", () => {
  it("renders the label prefix and reports typed text", () => {
    const onChange = vi.fn<(value: string) => void>();
    render(<InlineTextFilter label="Slug" value="" onChange={onChange} />);

    expect(screen.getByText("Slug:")).toBeInTheDocument();
    const input = screen.getByRole("searchbox", { name: "Slug" });
    fireEvent.change(input, { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("clears the value through the React Aria clear button", () => {
    const onChange = vi.fn<(value: string) => void>();
    render(<InlineTextFilter label="Slug" value="hello" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear Slug" }));
    expect(onChange).toHaveBeenCalledWith("");
  });
});
