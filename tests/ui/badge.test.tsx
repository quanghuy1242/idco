// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "@idco/ui";

describe("Badge", () => {
  it("renders with neutral tone by default", () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText(/default/i);
    expect(badge.tagName.toLowerCase()).toBe("span");
    expect(badge).toHaveClass(
      "badge",
      "whitespace-nowrap",
      "badge-outline",
      "badge-neutral",
    );
    expect(badge).not.toHaveClass("badge-sm");
  });

  it("renders primary tone", () => {
    render(<Badge tone="primary">Primary</Badge>);
    expect(screen.getByText(/primary/i)).toHaveClass("badge-primary");
  });

  it("renders secondary tone", () => {
    render(<Badge tone="secondary">Secondary</Badge>);
    expect(screen.getByText(/secondary/i)).toHaveClass("badge-secondary");
  });

  it("renders accent tone", () => {
    render(<Badge tone="accent">Accent</Badge>);
    expect(screen.getByText(/accent/i)).toHaveClass("badge-accent");
  });

  it("renders success tone", () => {
    render(<Badge tone="success">Success</Badge>);
    expect(screen.getByText(/success/i)).toHaveClass("badge-success");
  });

  it("renders warning tone", () => {
    render(<Badge tone="warning">Warning</Badge>);
    expect(screen.getByText(/warning/i)).toHaveClass("badge-warning");
  });

  it("renders error tone", () => {
    render(<Badge tone="error">Error</Badge>);
    expect(screen.getByText(/error/i)).toHaveClass("badge-error");
  });

  it("renders info tone", () => {
    render(<Badge tone="info">Info</Badge>);
    expect(screen.getByText(/info/i)).toHaveClass("badge-info");
  });

  it("renders children as text content", () => {
    render(<Badge>Test Badge</Badge>);
    expect(screen.getByText("Test Badge")).toBeInTheDocument();
  });

  it("renders empty children without crashing", () => {
    render(<Badge />);
    const badge = document.querySelector(".badge");
    expect(badge).toBeDefined();
  });

  it("renders small size when specified", () => {
    render(<Badge size="sm">Small</Badge>);
    expect(screen.getByText(/small/i)).toHaveClass("badge-sm");
  });
});
