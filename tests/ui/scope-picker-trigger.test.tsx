// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScopePickerTrigger } from "@idco/ui";

describe("ScopePickerTrigger", () => {
  it("renders with the same base height as other medium buttons without ghost hover padding", () => {
    render(<ScopePickerTrigger label="Platform" tone="accent" />);

    const trigger = screen.getByRole("button", {
      name: "Select console scope, current Platform",
    });
    expect(trigger).toHaveTextContent("Platform");
    expect(trigger).toHaveClass(
      "btn",
      "btn-outline",
      "min-w-0",
      "px-3",
      "font-medium",
    );
    expect(trigger).toHaveClass("btn-accent", "border-accent", "text-accent");
    expect(trigger).not.toHaveClass("btn-ghost");
  });

  it("matches organization tone to the old info badge color", () => {
    render(<ScopePickerTrigger label="Acme Publishing" tone="info" />);

    const trigger = screen.getByRole("button", {
      name: "Select console scope, current Acme Publishing",
    });
    expect(trigger).toHaveClass("border-info", "text-info");
  });

  it("allows an explicit accessible label", () => {
    render(
      <ScopePickerTrigger
        label="Acme Publishing"
        tone="info"
        ariaLabel="Choose scope"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Choose scope" }),
    ).toHaveTextContent("Acme Publishing");
  });
});
