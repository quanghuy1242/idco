// @vitest-environment jsdom

/**
 * R-backlog (note.md §5.7 / §5.10) @idco/ui coverage:
 *  - R1 (§5.7): `PageBody`/`PageHeader` forward a `width` to their inner
 *    container, including the new `xwide` (1536px) step.
 *  - R4 (§5.10): the bare `Input` gains `variant="ghost"` and `lg`/`xl` sizes for
 *    a borderless, label-less document-title field.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Input, PageBody, PageHeader } from "@idco/ui";

describe("R1 PageBody/PageHeader width", () => {
  it("defaults the body container to the wide cap", () => {
    render(
      <PageBody>
        <span>body</span>
      </PageBody>,
    );
    expect(screen.getByText("body").parentElement).toHaveClass("max-w-7xl");
  });

  it("forwards the xwide step (1536px) to the body container", () => {
    render(
      <PageBody width="xwide">
        <span>body</span>
      </PageBody>,
    );
    expect(screen.getByText("body").parentElement).toHaveClass(
      "max-w-[1536px]",
    );
  });

  it("forwards full width edge-to-edge", () => {
    render(
      <PageBody width="full">
        <span>body</span>
      </PageBody>,
    );
    expect(screen.getByText("body").parentElement).toHaveClass("max-w-none");
  });

  it("forwards width to the header container too (kept aligned with the body)", () => {
    render(
      <PageHeader width="xwide">
        <span>header</span>
      </PageHeader>,
    );
    // header → Container → flex row holding children; the container is the
    // grandparent of the child span.
    expect(
      screen.getByText("header").closest("div.max-w-\\[1536px\\]"),
    ).not.toBeNull();
  });
});

describe("R4 Input ghost variant + sizes", () => {
  it("is bordered at md by default", () => {
    render(<Input ariaLabel="Title" value="" onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: /title/i });
    expect(input).toHaveClass("input", "input-bordered");
    // md is the default DaisyUI size → no explicit size class.
    expect(input.className).not.toMatch(/input-(sm|lg|xl)/);
  });

  it("renders a borderless ghost variant", () => {
    render(
      <Input ariaLabel="Title" value="" onChange={() => {}} variant="ghost" />,
    );
    const input = screen.getByRole("textbox", { name: /title/i });
    expect(input).toHaveClass("input", "input-ghost");
    expect(input).not.toHaveClass("input-bordered");
  });

  it("supports the lg and xl sizes for a hero title", () => {
    const { rerender } = render(
      <Input ariaLabel="Title" value="" onChange={() => {}} size="lg" />,
    );
    expect(screen.getByRole("textbox", { name: /title/i })).toHaveClass(
      "input-lg",
    );
    rerender(
      <Input
        ariaLabel="Title"
        value=""
        onChange={() => {}}
        size="xl"
        variant="ghost"
      />,
    );
    const xl = screen.getByRole("textbox", { name: /title/i });
    expect(xl).toHaveClass("input-xl", "input-ghost");
  });
});
