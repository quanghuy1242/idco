// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VirtualRichTextEditor } from "@idco/editor";

describe("VirtualRichTextEditor", () => {
  it("renders a bounded virtual shell and activates a focused section editor", async () => {
    const onChange = vi.fn<(value: unknown) => void>();
    const { container } = render(
      <VirtualRichTextEditor
        label="Book section"
        largeDocument={{ fallbackBlocksPerSection: 5, mode: "large-document" }}
        value={paragraphs(80)}
        onChange={onChange}
      />,
    );

    expect(
      container.querySelector("[data-large-document-shell]"),
    ).toBeVisible();
    expect(container.querySelectorAll("[data-section-id]").length).toBeLessThan(
      80 / 5,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: /edit section/i })[0]!,
    );

    expect(
      await screen.findByRole("textbox", { name: /book section/i }),
    ).toHaveAttribute("contenteditable", "true");
  });
});

function paragraphs(count: number) {
  return {
    root: {
      children: Array.from({ length: count }, (_, index) => ({
        type: "paragraph",
        children: [{ type: "text", text: `Paragraph ${index + 1}` }],
      })),
    },
  };
}
