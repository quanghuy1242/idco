// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Inline } from "@idco/ui";

describe("Inline", () => {
  it("renders children in a flex container", () => {
    render(
      <Inline>
        <span>Item 1</span>
        <span>Item 2</span>
      </Inline>,
    );
    expect(screen.getByText(/item 1/i)).toBeInTheDocument();
    expect(screen.getByText(/item 2/i)).toBeInTheDocument();
  });

  it("applies flex-row by default", () => {
    const { container } = render(<Inline>Content</Inline>);
    expect(container.firstChild).toHaveClass("flex", "flex-row");
  });

  it("applies sm gap by default", () => {
    const { container } = render(<Inline>Content</Inline>);
    expect(container.firstChild).toHaveClass("gap-2");
  });

  it("applies xs gap when specified", () => {
    const { container } = render(<Inline gap="xs">Content</Inline>);
    expect(container.firstChild).toHaveClass("gap-1");
  });

  it("applies md gap when specified", () => {
    const { container } = render(<Inline gap="md">Content</Inline>);
    expect(container.firstChild).toHaveClass("gap-4");
  });

  it("applies lg gap when specified", () => {
    const { container } = render(<Inline gap="lg">Content</Inline>);
    expect(container.firstChild).toHaveClass("gap-6");
  });

  it("applies center alignment by default", () => {
    const { container } = render(<Inline>Content</Inline>);
    expect(container.firstChild).toHaveClass("items-center");
  });

  it("applies start alignment when specified", () => {
    const { container } = render(<Inline align="start">Content</Inline>);
    expect(container.firstChild).toHaveClass("items-start");
  });

  it("applies end alignment when specified", () => {
    const { container } = render(<Inline align="end">Content</Inline>);
    expect(container.firstChild).toHaveClass("items-end");
  });

  it("applies start justify by default", () => {
    const { container } = render(<Inline>Content</Inline>);
    expect(container.firstChild).toHaveClass("justify-start");
  });

  it("applies between justify when specified", () => {
    const { container } = render(<Inline justify="between">Content</Inline>);
    expect(container.firstChild).toHaveClass("justify-between");
  });

  it("applies end justify when specified", () => {
    const { container } = render(<Inline justify="end">Content</Inline>);
    expect(container.firstChild).toHaveClass("justify-end");
  });

  it("applies flex-wrap by default", () => {
    const { container } = render(<Inline>Content</Inline>);
    expect(container.firstChild).toHaveClass("flex-wrap");
  });

  it("applies flex-nowrap when wrap is false", () => {
    const { container } = render(<Inline wrap={false}>Content</Inline>);
    expect(container.firstChild).toHaveClass("flex-nowrap");
    expect(container.firstChild).not.toHaveClass("flex-wrap");
  });
});
