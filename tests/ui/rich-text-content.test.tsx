// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  RichTextArticle,
  RichTextBlockquote,
  RichTextCallout,
  RichTextCodeBlock,
  RichTextEmbed,
  RichTextInlineLink,
  RichTextList,
  RichTextListItem,
  RichTextParagraph,
  RichTextMediaFigure,
  RichTextPostReference,
  RichTextHeading,
  RichTextTableOfContents,
} from "@idco/ui";

describe("Rich text content primitives", () => {
  it("defines a compact article rhythm for rendered rich text", () => {
    const { container } = render(
      <RichTextArticle>
        <RichTextParagraph>First paragraph</RichTextParagraph>
        <RichTextParagraph>Second paragraph</RichTextParagraph>
      </RichTextArticle>,
    );

    expect(container.querySelector("article")).toHaveClass(
      "flex",
      "flex-col",
      "gap-3",
      "leading-6",
    );
    expect(screen.getByText("First paragraph")).toHaveClass("m-0", "leading-6");
  });

  it("uses the shared Alert primitive for callouts", () => {
    render(<RichTextCallout tone="warning">Heads up</RichTextCallout>);
    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "warning");
  });

  it("renders links with React Aria link behavior and DaisyUI link styling", () => {
    render(<RichTextInlineLink href="/docs">Documentation</RichTextInlineLink>);
    expect(screen.getByRole("link", { name: /documentation/i })).toHaveClass(
      "link",
      "link-primary",
    );
  });

  it("renders quote, list, media, and post reference surfaces", () => {
    const { container } = render(
      <>
        <RichTextBlockquote>Quoted</RichTextBlockquote>
        <RichTextList kind="number" start={3}>
          <RichTextListItem>Numbered</RichTextListItem>
        </RichTextList>
        <RichTextMediaFigure
          alt="Diagram"
          caption="A caption"
          src="/diagram.png"
        />
        <RichTextPostReference
          href="/posts/1"
          label="Read next"
          postId="post-1"
        />
      </>,
    );

    expect(container.querySelector("blockquote")).toHaveTextContent("Quoted");
    expect(container.querySelector("blockquote")).toHaveClass(
      "m-0",
      "leading-6",
    );
    expect(screen.getByText("Numbered").closest("ol")).toHaveAttribute(
      "start",
      "3",
    );
    expect(screen.getByText("Numbered").closest("ol")).toHaveClass(
      "m-0",
      "space-y-1",
      "leading-6",
    );
    expect(screen.getByRole("img", { name: /diagram/i })).toHaveAttribute(
      "src",
      "/diagram.png",
    );
    expect(screen.getByText("A caption").tagName.toLowerCase()).toBe(
      "figcaption",
    );
    expect(screen.getByRole("link", { name: /read next/i })).toHaveAttribute(
      "data-post-id",
      "post-1",
    );
  });

  it("renders embeds and read-only code through shared primitives", () => {
    render(
      <>
        <RichTextEmbed url="https://example.test/embed" />
        <RichTextCodeBlock value="const x = 1;" language="ts" />
      </>,
    );

    expect(screen.getByTitle("Embedded content")).toHaveAttribute(
      "src",
      "https://example.test/embed",
    );
    expect(
      screen.getByRole("textbox", { name: /code content/i }),
    ).toHaveAttribute("readonly");
  });

  it("renders heading anchor links by default when an anchor id is present", () => {
    render(
      <RichTextHeading level="h2" anchorId="overview" anchorLabel="Overview">
        Overview
      </RichTextHeading>,
    );

    expect(screen.getByRole("heading", { name: /overview/i })).toHaveAttribute(
      "id",
      "overview",
    );
    expect(
      screen.getByRole("link", { name: /link to overview/i }),
    ).toHaveAttribute("href", "#overview");
  });

  it("renders a TOC navigation block with numbering and indentation", () => {
    render(
      <RichTextTableOfContents
        title="Contents"
        style="panel"
        entries={[
          {
            depth: 0,
            href: "#install",
            id: "install",
            level: 2,
            number: "1",
            text: "Install",
          },
          {
            depth: 1,
            href: "#configure",
            id: "configure",
            level: 3,
            number: "1.1",
            text: "Configure",
          },
        ]}
      />,
    );

    expect(screen.getByRole("navigation", { name: /contents/i })).toHaveClass(
      "card",
    );
    expect(screen.getByRole("link", { name: /1 install/i })).toHaveAttribute(
      "href",
      "#install",
    );
    // Depth indents the row with `ms-*` (the grid layout + themed inset come
    // from DaisyUI `menu`); the number sits in a fixed `min-w-9` column and the
    // label wraps (line-clamp) instead of the depth class landing on the text.
    expect(screen.getByRole("link", { name: /1.1 configure/i })).toHaveClass(
      "items-baseline",
      "ms-6",
    );
    expect(screen.getByText("1.1")).toHaveClass("min-w-9");
    expect(screen.getByText("Configure")).toHaveClass("line-clamp-3");
    expect(screen.getByText("Configure")).not.toHaveClass("ms-6");
  });

  it("keeps the number column and indentation for an unnumbered orphan entry", () => {
    render(
      <RichTextTableOfContents
        title="Contents"
        entries={[
          {
            depth: 1,
            href: "#orphan",
            id: "orphan",
            level: 3,
            text: "Orphan details",
          },
          {
            depth: 0,
            href: "#top",
            id: "top",
            level: 2,
            number: "1",
            text: "Top section",
          },
        ]}
      />,
    );

    // The orphan (no number) still reserves the number column so it aligns with
    // numbered rows, and it is indented by its depth rather than promoted.
    const orphan = screen.getByRole("link", { name: "Orphan details" });
    expect(orphan).toHaveClass("items-baseline", "ms-6");
    expect(orphan.querySelector(".min-w-9")).not.toBeNull();
    const top = screen.getByRole("link", { name: /1 top section/i });
    expect(top).toHaveClass("items-baseline");
    expect(top).not.toHaveClass("ms-6");
  });

  it("drops the number column entirely for a plain unnumbered TOC", () => {
    render(
      <RichTextTableOfContents
        title="Contents"
        entries={[
          { depth: 0, href: "#a", id: "a", level: 2, text: "Alpha" },
          { depth: 1, href: "#b", id: "b", level: 3, text: "Beta" },
        ]}
      />,
    );

    const alpha = screen.getByRole("link", { name: "Alpha" });
    expect(alpha).toHaveClass("items-baseline");
    expect(alpha).not.toHaveClass("ms-6");
    // No numbers anywhere → no reserved number column on any row.
    expect(alpha.querySelector(".min-w-9")).toBeNull();
    expect(screen.getByRole("link", { name: "Beta" })).toHaveClass("ms-6");
  });
});
