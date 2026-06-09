// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert } from "@idco/ui";

describe("Alert", () => {
  it("renders with info tone by default", () => {
    render(<Alert>Info message</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveClass("alert-info");
    expect(screen.getByText(/info message/i)).toBeInTheDocument();
  });

  it("renders error tone", () => {
    render(<Alert tone="error">Error occurred</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("alert-error");
  });

  it("renders success tone", () => {
    render(<Alert tone="success">Success!</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("alert-success");
  });

  it("renders warning tone", () => {
    render(<Alert tone="warning">Warning!</Alert>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("alert-warning");
  });

  it("renders an SVG icon", () => {
    render(<Alert>With icon</Alert>);
    const alert = screen.getByRole("alert");
    const svg = alert.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it("renders children in a span", () => {
    render(<Alert>Child content</Alert>);
    const span = screen.getByText(/child content/i);
    expect(span.tagName.toLowerCase()).toBe("span");
  });
});
