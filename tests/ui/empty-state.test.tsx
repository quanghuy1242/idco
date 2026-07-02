// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "@idco/ui";

describe("EmptyState", () => {
  it("renders a primary CTA when an action is provided", () => {
    const onCta = vi.fn<() => void>();

    render(
      <EmptyState message="No users found" cta="Create User" onCta={onCta} />,
    );

    const button = screen.getByRole("button", { name: "Create User" });
    expect(screen.getByText("No users found")).toBeInTheDocument();
    expect(button).toHaveClass("btn", "btn-primary");
    expect(button).not.toHaveClass("btn-outline");

    fireEvent.click(button);
    expect(onCta).toHaveBeenCalledOnce();
  });

  it("omits the CTA when no action handler is provided", () => {
    render(<EmptyState message="Nothing here" cta="Create" />);

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a primary CTA link when an href is provided", () => {
    render(
      <EmptyState
        message="No apps"
        cta="Create Application"
        ctaHref="/admin/oauth/applications/new"
      />,
    );

    const link = screen.getByRole("link", { name: /create application/i });
    expect(link).toHaveAttribute("href", "/admin/oauth/applications/new");
    expect(link).toHaveClass("btn", "btn-primary");
  });

  it("renders a toned icon chip so empty states are not identical grey blocks (R2)", () => {
    const { container } = render(
      <EmptyState icon="FileText" tone="primary" message="No posts yet" />,
    );

    // The chip is a rounded, tinted box wrapping the registered icon glyph.
    const chip = container.querySelector("span.rounded-box");
    expect(chip).not.toBeNull();
    expect(chip).toHaveClass("bg-primary/10", "text-primary");
    expect(chip?.querySelector("svg")).not.toBeNull();
  });

  it("defaults to a neutral Inbox chip when no icon/tone is given (R2)", () => {
    const { container } = render(<EmptyState message="Nothing here" />);
    const chip = container.querySelector("span.rounded-box");
    expect(chip).toHaveClass("bg-base-200");
    expect(chip?.querySelector("svg")).not.toBeNull();
  });
});
