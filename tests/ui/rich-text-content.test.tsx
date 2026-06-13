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
});
