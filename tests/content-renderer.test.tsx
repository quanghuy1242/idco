import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  RichTextRenderer,
  renderRichTextDocument,
} from "@idco/content-renderer";

describe("@idco/content-renderer", () => {
  it("renders known rich text nodes without Lexical runtime", () => {
    render(
      <RichTextRenderer
        value={{
          root: {
            children: [
              {
                children: [{ text: "Hello", type: "text" }],
                type: "paragraph",
              },
              { language: "ts", text: "const x = 1;", type: "code-block" },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("Hello").tagName.toLowerCase()).toBe("p");
    expect(screen.getByText("const x = 1;").tagName.toLowerCase()).toBe("code");
  });

  it("falls back to children for unknown node types", () => {
    render(
      <RichTextRenderer
        value={{
          root: {
            children: [
              {
                children: [{ text: "Still visible", type: "text" }],
                type: "new-node",
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("Still visible")).toBeInTheDocument();
  });

  it("returns null for malformed documents", () => {
    expect(renderRichTextDocument({ body: [] })).toBeNull();
  });
});
