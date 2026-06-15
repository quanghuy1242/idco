import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  RichTextRenderer,
  renderRichTextDocument,
} from "@idco/content-renderer";

/** A one-row, two-column table document wrapping the given table-node fields. */
function tableDoc(table: Record<string, unknown>) {
  return {
    root: {
      children: [
        {
          ...table,
          children: [
            {
              type: "tablerow",
              children: [
                {
                  type: "tablecell",
                  headerState: 0,
                  children: [{ text: "A", type: "text" }],
                },
                {
                  type: "tablecell",
                  headerState: 0,
                  children: [{ text: "B", type: "text" }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

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
              {
                children: [
                  { format: 1, text: "Bold", type: "text" },
                  { text: " and ", type: "text" },
                  { format: 2 | 8, text: "underlined italic", type: "text" },
                  { text: " with ", type: "text" },
                  { format: 16, text: "inlineCode", type: "text" },
                  { type: "linebreak" },
                  { text: "after break", type: "text" },
                ],
                type: "paragraph",
              },
              {
                children: [
                  {
                    children: [{ text: "First numbered item", type: "text" }],
                    type: "listitem",
                    value: 3,
                  },
                ],
                listType: "number",
                start: 3,
                tag: "ol",
                type: "list",
              },
              {
                children: [{ text: "Heads up", type: "text" }],
                tone: "warning",
                type: "callout",
              },
              { language: "ts", text: "const x = 1;", type: "code-block" },
              { alt: "Logo", mediaId: "media-logo", type: "media" },
              { postId: "post-1", title: "Read next", type: "post-ref" },
              { type: "embed", url: "https://example.com/embed/demo" },
            ],
          },
        }}
        allowedEmbedDomains={["example.com"]}
        resolveMedia={(node) =>
          node.mediaId === "media-logo"
            ? {
                alt: "Resolved logo",
                caption: "Resolved caption",
                src: "/logo.png",
              }
            : null
        }
        resolvePost={(node) =>
          node.postId === "post-1"
            ? { href: "/posts/read-next", label: "Read next" }
            : null
        }
      />,
    );

    expect(screen.getByText("Hello").tagName.toLowerCase()).toBe("p");
    expect(screen.getByText("Bold").tagName.toLowerCase()).toBe("strong");
    expect(screen.getByText("underlined italic").closest("em")).not.toBeNull();
    expect(screen.getByText("underlined italic").closest("u")).not.toBeNull();
    expect(screen.getByText("inlineCode").tagName.toLowerCase()).toBe("code");
    const formattedParagraph = screen.getByText("inlineCode").closest("p");
    expect(formattedParagraph?.textContent).toContain("after break");
    expect(
      Array.from(formattedParagraph?.childNodes ?? []).some(
        (node) => node.nodeName === "BR",
      ),
    ).toBe(true);
    expect(
      screen.getByText("First numbered item").closest("ol"),
    ).toHaveAttribute("start", "3");
    expect(
      screen.getByText("Heads up").closest("[role='alert']"),
    ).toHaveAttribute("data-tone", "warning");
    expect(
      screen.getByRole("textbox", { name: /code content/i }),
    ).toHaveAttribute("readonly");
    expect(screen.getByText("const").closest("code")).toHaveTextContent(
      "const x = 1;",
    );
    expect(screen.getByRole("img", { name: /resolved logo/i })).toHaveAttribute(
      "src",
      "/logo.png",
    );
    expect(screen.getByText("Resolved caption").tagName.toLowerCase()).toBe(
      "figcaption",
    );
    expect(screen.getByRole("link", { name: /read next/i })).toHaveAttribute(
      "href",
      "/posts/read-next",
    );
    expect(screen.getByTitle("Embedded content")).toHaveAttribute(
      "src",
      "https://example.com/embed/demo",
    );
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

  it("skips disallowed embeds", () => {
    render(
      <RichTextRenderer
        value={{
          root: {
            children: [{ type: "embed", url: "https://evil.test/embed" }],
          },
        }}
        allowedEmbedDomains={["example.com"]}
      />,
    );

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders a responsive table with percentage column widths (renderer parity)", () => {
    const { container } = render(
      <RichTextRenderer
        value={tableDoc({
          type: "editor-table",
          layout: "responsive",
          colWidths: [100, 300],
        })}
      />,
    );
    const table = container.querySelector("table")!;
    expect(table.getAttribute("data-table-layout")).toBe("responsive");
    const cols = [...table.querySelectorAll("col")];
    // 100 / 400 and 300 / 400 → 25% / 75%.
    expect(cols[0]?.getAttribute("style")).toContain("25");
    expect(cols[1]?.getAttribute("style")).toContain("75");
  });

  it("renders a fixed table with pixel column widths", () => {
    const { container } = render(
      <RichTextRenderer
        value={tableDoc({
          type: "table",
          layout: "fixed",
          colWidths: [220, 140],
        })}
      />,
    );
    const cols = [...container.querySelectorAll("col")];
    expect(cols[0]?.getAttribute("style")).toContain("220px");
    expect(cols[1]?.getAttribute("style")).toContain("140px");
  });

  it("renders the numbered-column gutter when showRowNumbers is set", () => {
    const { container } = render(
      <RichTextRenderer
        value={tableDoc({
          type: "editor-table",
          layout: "responsive",
          colWidths: [100, 100],
          showRowNumbers: true,
        })}
      />,
    );
    const table = container.querySelector("table")!;
    expect(table.classList.contains("rt-table-numbered")).toBe(true);
    expect(container.querySelector("style")?.textContent).toContain(
      "counter(rt-row)",
    );
  });

  it("renders heading anchors and repairs missing duplicate ids", () => {
    render(
      <RichTextRenderer
        value={{
          root: {
            children: [
              {
                type: "heading",
                tag: "h2",
                children: [{ type: "text", text: "Overview" }],
              },
              {
                type: "heading",
                tag: "h3",
                anchorId: "overview",
                children: [{ type: "text", text: "Details" }],
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: /overview/i })).toHaveAttribute(
      "id",
      "overview",
    );
    expect(screen.getByRole("heading", { name: /details/i })).toHaveAttribute(
      "id",
      "overview-2",
    );
    expect(
      screen.getByRole("link", { name: /link to overview/i }),
    ).toHaveAttribute("href", "#overview");
  });

  it("renders table-of-contents blocks from current headings and settings", () => {
    render(
      <RichTextRenderer
        value={{
          root: {
            children: [
              {
                type: "table-of-contents",
                title: "On this page",
                minLevel: 2,
                maxLevel: 3,
                numbering: "decimal",
                style: "compact",
              },
              {
                type: "heading",
                tag: "h1",
                children: [{ type: "text", text: "Skipped" }],
              },
              {
                type: "heading",
                tag: "h2",
                children: [{ type: "text", text: "Install" }],
              },
              {
                type: "heading",
                tag: "h3",
                children: [{ type: "text", text: "Configure" }],
              },
              {
                type: "heading",
                tag: "h4",
                children: [{ type: "text", text: "Too deep" }],
              },
            ],
          },
        }}
      />,
    );

    const nav = screen.getByRole("navigation", { name: /on this page/i });
    expect(nav).toHaveClass("rounded-box");
    expect(
      within(nav).getByRole("link", { name: /1 install/i }),
    ).toHaveAttribute("href", "#install");
    expect(
      within(nav).getByRole("link", { name: /1.1 configure/i }),
    ).toHaveAttribute("href", "#configure");
    expect(within(nav).queryByRole("link", { name: /skipped/i })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /too deep/i })).toBeNull();
  });

  it("renders an aside table-of-contents as a sticky side rail plus an inline fallback", () => {
    const { container } = render(
      <RichTextRenderer
        value={{
          root: {
            children: [
              {
                type: "table-of-contents",
                title: "On this page",
                minLevel: 2,
                maxLevel: 3,
                style: "compact",
                placement: "aside",
                side: "right",
              },
              {
                type: "heading",
                tag: "h2",
                children: [{ type: "text", text: "Install" }],
              },
            ],
          },
        }}
      />,
    );

    // The layout reserves a right-side rail column.
    const layout = container.firstElementChild as HTMLElement;
    expect(layout.className).toContain("lg:grid");
    expect(layout.className).toContain("minmax(0,1fr)_16rem");

    // Two copies render: the sticky rail (hidden below lg) and the inline
    // fallback (hidden at lg+). Both list the same heading.
    const navs = screen.getAllByRole("navigation", { name: /on this page/i });
    expect(navs).toHaveLength(2);
    navs.forEach((nav) => {
      expect(
        within(nav).getByRole("link", { name: /1 install/i }),
      ).toHaveAttribute("href", "#install");
    });

    const rail = container.querySelector("aside");
    expect(rail).not.toBeNull();
    expect(rail?.className).toContain("hidden");
    expect(rail?.className).toContain("lg:block");
  });
});
