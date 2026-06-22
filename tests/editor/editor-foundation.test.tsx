// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderRichTextDocument } from "@idco/content-renderer";
import {
  capabilityFor,
  RichTextEditor,
} from "@quanghuy1242/idco-editor-legacy";

describe("editor foundation", () => {
  it("renders paragraph alignment from the document format", () => {
    const node = renderRichTextDocument({
      root: {
        children: [
          {
            type: "paragraph",
            format: "center",
            children: [{ type: "text", text: "Centered" }],
          },
        ],
      },
    });
    const { container } = render(<>{node}</>);
    expect(container.querySelector("p")).toHaveClass("text-center");
  });

  it("round-trips links, marks, glossary, tables and checklists in the renderer", () => {
    const { container } = render(
      <>
        {renderRichTextDocument({
          root: {
            children: [
              {
                type: "paragraph",
                children: [
                  {
                    type: "link",
                    url: "https://idco.test",
                    children: [{ type: "text", text: "site" }],
                  },
                  {
                    type: "mark",
                    ids: ["c1"],
                    children: [{ type: "text", text: "noted" }],
                  },
                  { type: "glossary", term: "API", definition: "interface" },
                ],
              },
              {
                type: "list",
                listType: "check",
                children: [
                  {
                    type: "listitem",
                    checked: true,
                    children: [{ type: "text", text: "done" }],
                  },
                ],
              },
              {
                type: "table",
                children: [
                  {
                    type: "tablerow",
                    children: [
                      {
                        type: "tablecell",
                        headerState: 1,
                        children: [{ type: "text", text: "H" }],
                      },
                      {
                        type: "tablecell",
                        headerState: 0,
                        children: [{ type: "text", text: "v" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        })}
      </>,
    );
    expect(container.querySelector("a")).toHaveAttribute(
      "href",
      "https://idco.test",
    );
    expect(container.querySelector("mark")).toHaveTextContent("noted");
    expect(container.querySelector("abbr")).toHaveAttribute(
      "title",
      "interface",
    );
    expect(container.querySelector('input[type="checkbox"]')).toBeChecked();
    expect(container.querySelector("th")).toHaveTextContent("H");
    expect(container.querySelector("td")).toHaveTextContent("v");
  });

  it("exposes link, comment, check-list and table controls in the editor", () => {
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /^link$/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^comment$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /glossary term/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /check list/i }),
    ).toBeInTheDocument();
  });

  it("treats check lists as a distinct, formattable block kind", () => {
    // Check lists are their own kind (not reported as bullet) so the toolbar
    // can light the right control; they still allow inline formatting.
    const check = capabilityFor("check");
    expect(check.canAlign).toBe(false);
    expect(check.inlineFormats.has("bold")).toBe(true);
    expect(capabilityFor("quote").inlineFormats.has("bold")).toBe(false);
  });

  it("accepts an onComment binding for inline comments", () => {
    render(
      <RichTextEditor
        label="Body"
        value={{ root: { children: [] } }}
        onChange={() => {}}
        onComment={() => {}}
      />,
    );
    // The comment control is present (it enables once text is selected).
    expect(
      screen.getByRole("button", { name: /^comment$/i }),
    ).toBeInTheDocument();
  });
});
