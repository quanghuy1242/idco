// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RichTextEditor } from "@idco/ui";

describe("RichTextEditor", () => {
  it("edits plain text as a serialized rich text document", () => {
    const onChange = vi.fn<(value: unknown) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: /body plain text/i }),
      {
        target: { value: "Hello" },
      },
    );

    expect(onChange).toHaveBeenCalledWith({
      root: {
        children: [
          {
            children: [{ text: "Hello", type: "text" }],
            type: "paragraph",
          },
        ],
      },
    });
  });

  it("adds starter nodes from typed toolbar actions", () => {
    const onChange = vi.fn<(value: unknown) => void>();
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={onChange}
      />,
    );

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

    expect(screen.queryByRole("button", { name: /code/i })).toBeNull();
    expect(screen.getByRole("button", { name: /paragraph/i })).toBeVisible();
  });
});
