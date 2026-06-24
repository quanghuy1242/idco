/**
 * L1 block primitives (docs/015 §4.2). Pure, RSC-safe, self-contained: no `"use client"`,
 * no hooks, no event handlers, no `@idco/ui` import. Each emits a semantic element plus
 * the tag-independent `.rt-*` typography class (the single appearance source, §4.3), so
 * the editor's resting render and its editable host wear the identical class.
 *
 * These were reclaimed from `@idco/ui` `rich-text-content.tsx` and de-cliented: the
 * `Text`/`Alert`/`AriaLink`/`CodeEditor`/`NavIcon` dependencies (which carry or pull
 * `"use client"`) are replaced with plain semantic elements, the `.rt-*` classes, and
 * inline SVG. Prose appearance now lives in the `.rt-*` stylesheet, not in component
 * class strings, so it is the same definition the editor uses.
 */
import type { CSSProperties, ReactNode } from "react";
import { RT_BLOCK, RT_BLOCK_CLASS, RT_CALLOUT_TONE_CLASS } from "./typography";
import {
  RT_ALIGN_CLASS,
  type RichTextAlign,
  type RichTextCalloutTone,
  type RichTextHeadingLevel,
  type RichTextListKind,
} from "./types";
import { CalloutGlyph, LinkGlyph } from "./icons";

type RichTextChildrenProps = { readonly children?: ReactNode };

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** One visual indent level in em — mirrors the editor's `INDENT_STEP_EM` (docs/018 §2.8). */
const INDENT_STEP_EM = 1.6;

/** The left-margin style for a block's `attrs.indent` level, matching the editor surface. */
function indentStyle(indent?: number): CSSProperties | undefined {
  return typeof indent === "number" && indent > 0
    ? { marginLeft: `${indent * INDENT_STEP_EM}em` }
    : undefined;
}

export function RichTextArticle({ children }: RichTextChildrenProps) {
  // One spacing source (docs/028 §4.5): a single uniform gap between top-level blocks, and
  // `[&>div>*]:my-0` neutralizes each block primitive's own vertical margin (table/TOC carry
  // `my-3` for the editor's no-gap resting render) so spacing never compounds with the gap.
  // Content-visibility wrappers don't margin-collapse, so a single flex gap — not per-block
  // margins — is what keeps the reader's rhythm matching the editor's (docs/015 §5.3).
  return (
    <article
      className="flex flex-col gap-2.5 text-base-content [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>div>*]:my-0"
      data-rt-article=""
    >
      {children}
    </article>
  );
}

export function RichTextParagraph({
  align,
  indent,
  children,
}: RichTextChildrenProps & {
  readonly align?: RichTextAlign;
  readonly indent?: number;
}) {
  return (
    <p
      className={cx(
        RT_BLOCK,
        RT_BLOCK_CLASS.paragraph,
        align && RT_ALIGN_CLASS[align],
      )}
      style={indentStyle(indent)}
    >
      {children}
    </p>
  );
}

export function RichTextHeading({
  level,
  align,
  anchorId,
  anchorLabel,
  indent,
  children,
}: RichTextChildrenProps & {
  readonly level: RichTextHeadingLevel;
  readonly align?: RichTextAlign;
  readonly anchorId?: string;
  readonly anchorLabel?: string;
  readonly indent?: number;
}) {
  const Tag = level;
  return (
    <Tag
      id={anchorId}
      className={cx(
        RT_BLOCK,
        RT_BLOCK_CLASS[level],
        align && RT_ALIGN_CLASS[align],
        anchorId && "group/heading scroll-mt-20",
      )}
      style={indentStyle(indent)}
    >
      <span>{children}</span>
      {anchorId ? (
        <a
          aria-label={`Link to ${anchorLabel || "heading"}`}
          className="ml-2 inline-flex align-middle text-base-content/40 opacity-0 transition hover:text-primary focus:text-primary focus:opacity-100 group-hover/heading:opacity-100"
          href={`#${anchorId}`}
        >
          <LinkGlyph />
        </a>
      ) : null}
    </Tag>
  );
}

export function RichTextCallout({
  tone = "info",
  children,
}: RichTextChildrenProps & { readonly tone?: RichTextCalloutTone }) {
  return (
    <aside
      className={cx(
        RT_BLOCK,
        RT_BLOCK_CLASS.callout,
        tone !== "info" && RT_CALLOUT_TONE_CLASS[tone],
        "flex items-start gap-2 px-4 py-2",
      )}
      data-rt-callout-tone={tone}
      role="note"
    >
      <CalloutGlyph tone={tone} />
      <div className="w-full">{children}</div>
    </aside>
  );
}

export function RichTextBlockquote({
  indent,
  children,
}: RichTextChildrenProps & { readonly indent?: number }) {
  return (
    <blockquote
      className={cx(RT_BLOCK, RT_BLOCK_CLASS.quote, "py-1 pl-4")}
      style={indentStyle(indent)}
    >
      {children}
    </blockquote>
  );
}

export function RichTextList({
  kind,
  start,
  children,
}: RichTextChildrenProps & {
  readonly kind: RichTextListKind;
  readonly start?: number;
}) {
  if (kind === "number") {
    return (
      <ol
        className={cx(
          RT_BLOCK,
          RT_BLOCK_CLASS.listOrdered,
          "ml-5 list-decimal space-y-1",
        )}
        start={start}
      >
        {children}
      </ol>
    );
  }
  return (
    <ul
      className={cx(RT_BLOCK, RT_BLOCK_CLASS.list, "ml-5 list-disc space-y-1")}
    >
      {children}
    </ul>
  );
}

export function RichTextListItem({
  indent,
  children,
}: RichTextChildrenProps & { readonly indent?: number }) {
  return (
    <li className={RT_BLOCK_CLASS.listItem} style={indentStyle(indent)}>
      {children}
    </li>
  );
}

/**
 * The static code block (docs/015 §4.2): the reader runs no Prism, so it renders the
 * baked highlighted HTML when present, otherwise the plain source as a `<pre>`. The live
 * code editor (Prism, interactive) is an editor-only surface / an L3 island, never L1.
 */
export function RichTextCodeBlock({
  value,
  language,
  bakedHtml,
}: {
  readonly value: string;
  readonly language?: string;
  /** Pre-highlighted, already-sanitized HTML from the bake; renders when present. */
  readonly bakedHtml?: string;
}) {
  return (
    <pre
      className={cx(RT_BLOCK, RT_BLOCK_CLASS.codeBlock)}
      data-language={language}
    >
      {bakedHtml ? (
        // Baked HTML is sanitized at the boundary before it reaches L1 (docs/015 §4.2).
        <code dangerouslySetInnerHTML={{ __html: bakedHtml }} />
      ) : (
        <code>{value}</code>
      )}
    </pre>
  );
}
