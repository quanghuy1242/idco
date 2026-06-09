// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "@idco/ui";

describe("Switch", () => {
  it("renders a labeled switch with the toggle class", () => {
    render(<Switch label="Enabled" />);
    const input = screen.getByRole("switch", { name: /enabled/i });
    expect(input).toHaveClass("toggle");
  });

  it("calls onChange with true when toggled on", () => {
    const onChange = vi.fn<(v: boolean) => void>();
    render(<Switch label="Enabled" onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: /enabled/i }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reflects the selected prop", () => {
    render(<Switch label="Enabled" selected />);
    expect(screen.getByRole("switch", { name: /enabled/i })).toBeChecked();
  });

  it("applies toggle-sm for small size", () => {
    render(<Switch label="Enabled" size="sm" />);
    expect(screen.getByRole("switch", { name: /enabled/i })).toHaveClass(
      "toggle-sm",
    );
  });

  it("applies the tone class", () => {
    render(<Switch label="Enabled" tone="success" />);
    expect(screen.getByRole("switch", { name: /enabled/i })).toHaveClass(
      "toggle-success",
    );
  });

  it("marks the input as disabled", () => {
    render(<Switch label="Enabled" disabled />);
    expect(screen.getByRole("switch", { name: /enabled/i })).toBeDisabled();
  });
});
