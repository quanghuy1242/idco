// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "@idco/ui";

describe("RichTextEditor", () => {
  it("renders a Lexical textbox with formatting toolbar controls", () => {
    const onChange = vi.fn<(value: unknown) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("textbox", { name: /^body$/i })).toHaveAttribute(
      "contenteditable",
      "true",
    );
    expect(screen.getByRole("button", { name: /bold/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /italic/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /slash menu/i })).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds starter nodes from the slash menu", () => {
    const onChange = vi.fn<(value: unknown) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /slash menu/i }));
    fireEvent.click(screen.getByRole("button", { name: /code/i }));

    expect(onChange).toHaveBeenCalledWith({
      root: {
        children: [
          {
            language: "ts",
            text: "const value = true;",
            type: "code-block",
          },
        ],
      },
    });
  });

  it("hides node actions that are not allowed", () => {
    render(
      <RichTextEditor
        allowedNodes={["paragraph", "text"]}
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /slash menu/i }));
    expect(screen.queryByRole("button", { name: /code/i })).toBeNull();
    expect(screen.getByRole("button", { name: /paragraph/i })).toBeVisible();
  });
});
