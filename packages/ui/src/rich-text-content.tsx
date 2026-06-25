// DaisyUI 5: https://daisyui.com/components/alert/
// DaisyUI 5: https://daisyui.com/components/badge/
// DaisyUI 5: https://daisyui.com/components/card/
// DaisyUI 5: https://daisyui.com/components/menu/
"use client";

import { readableTextColor, verticalAlignClass } from "@quanghuy1242/idco-lib";
import type { ReactNode } from "react";
import { Link as AriaLink } from "react-aria-components";
import { Alert, type AlertTone } from "./alert";
import { Badge } from "./badge";
import { CodeEditor, type CodeEditorLanguage } from "./code-editor";
import { NavIcon } from "./nav-icons";
import { Text } from "./typography";

export type RichTextHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type RichTextListKind = "bullet" | "number";
export type RichTextAlign = "left" | "center" | "right" | "justify";
export type RichTextTableOfContentsStyle = "panel" | "plain" | "compact";

export type RichTextTableOfContentsEntry = {
  readonly id: string;
  readonly href: string;
  readonly text: string;
  readonly level: number;
  readonly depth?: number;
  readonly number?: string;
};

type RichTextChildrenProps = {
  readonly children?: ReactNode;
};

const alignClass: Record<RichTextAlign, string> = {
  center: "text-center",
  justify: "text-justify",
  left: "text-left",
  right: "text-right",
};

export function RichTextArticle({ children }: RichTextChildrenProps) {
  return (
    <article className="flex flex-col gap-3 text-base leading-6 text-base-content [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&>h1:not(:first-child)]:mt-3 [&>h2:not(:first-child)]:mt-3 [&>h3:not(:first-child)]:mt-2 [&>h4:not(:first-child)]:mt-2 [&>h5:not(:first-child)]:mt-2 [&>h6:not(:first-child)]:mt-2">
      {children}
    </article>
  );
}

export function RichTextParagraph({
  align,
  children,
}: RichTextChildrenProps & {
  readonly align?: RichTextAlign;
}) {
  return (
    <p
      className={`m-0 text-base leading-6 text-base-content ${align ? alignClass[align] : ""}`.trim()}
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
  children,
}: RichTextChildrenProps & {
  readonly level: RichTextHeadingLevel;
  readonly align?: RichTextAlign;
  readonly anchorId?: string;
  readonly anchorLabel?: string;
}) {
  const className = [
    align ? alignClass[align] : "",
    anchorId ? "group/heading scroll-mt-20" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Text
      id={anchorId}
      variant={level}
      as={level}
      className={className || undefined}
    >
      <span>{children}</span>
      {anchorId ? (
        <AriaLink
          href={`#${anchorId}`}
          aria-label={`Link to ${anchorLabel || "heading"}`}
          className="ml-2 inline-flex align-middle text-base-content/40 opacity-0 transition hover:text-primary focus:text-primary focus:opacity-100 group-hover/heading:opacity-100"
        >
          <NavIcon name="Link2" />
        </AriaLink>
      ) : null}
    </Text>
  );
}

export function RichTextCallout({
  tone = "info",
  children,
}: RichTextChildrenProps & {
  readonly tone?: AlertTone;
}) {
  return <Alert tone={tone}>{children}</Alert>;
}

export function RichTextBlockquote({ children }: RichTextChildrenProps) {
  return (
    <blockquote className="m-0 border-l-4 border-base-300 py-1 pl-4 leading-6 italic text-base-content/80">
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
        className="m-0 ml-5 list-decimal space-y-1 text-base leading-6 text-base-content"
        start={start}
      >
        {children}
      </ol>
    );
  }
  return (
    <ul className="m-0 ml-5 list-disc space-y-1 text-base leading-6 text-base-content">
      {children}
    </ul>
  );
}

export function RichTextListItem({ children }: RichTextChildrenProps) {
  return <li>{children}</li>;
}

export function RichTextInlineLink({
  href,
  children,
}: RichTextChildrenProps & {
  readonly href: string;
}) {
  return (
    <AriaLink href={href} className="link link-primary">
      {children}
    </AriaLink>
  );
}

export function RichTextInlineCode({ children }: RichTextChildrenProps) {
  return (
    <code className="rounded bg-base-200 px-1 py-0.5 font-mono text-[0.9em] text-base-content">
      {children}
    </code>
  );
}

export function RichTextStrong({ children }: RichTextChildrenProps) {
  return <strong className="font-bold">{children}</strong>;
}

export function RichTextEmphasis({ children }: RichTextChildrenProps) {
  return <em className="italic">{children}</em>;
}

export function RichTextUnderline({ children }: RichTextChildrenProps) {
  return <u className="underline">{children}</u>;
}

export function RichTextStrikethrough({ children }: RichTextChildrenProps) {
  return <s className="line-through">{children}</s>;
}

export function RichTextHighlight({ children }: RichTextChildrenProps) {
  return <mark className="rounded px-1">{children}</mark>;
}

export function RichTextMediaFigure({
  alt,
  caption,
  src,
}: {
  readonly alt?: string;
  readonly caption?: string;
  readonly src: string;
}) {
  return (
    <figure className="m-0 overflow-hidden rounded-box border border-base-300 bg-base-200">
      <img
        alt={alt ?? ""}
        className="max-h-96 w-full object-contain"
        src={src}
      />
      {caption ? (
        <figcaption className="border-t border-base-300 px-3 py-2 text-sm text-base-content/60">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function RichTextEmbed({
  title,
  url,
}: {
  readonly title?: string;
  readonly url: string;
}) {
  return (
    <figure className="m-0 overflow-hidden rounded-box border border-base-300 bg-base-200">
      <iframe
        className="aspect-video w-full"
        loading="lazy"
        // Send the origin (not the full URL): providers like YouTube reject the
        // embed (player "Error 153") when there is no referrer to authorize the
        // embedding domain, but the path stays private.
        referrerPolicy="strict-origin-when-cross-origin"
        // `allow-same-origin` lets the *third-party* provider (YouTube, etc.)
        // reach its own origin's storage/caches so its player actually
        // initializes — without it the frame renders black and logs `caches`/
        // player errors. Paired with cross-origin `src` it only grants the frame
        // access to the provider's origin, never the host app's.
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
        src={url}
        title={title ?? "Embedded content"}
      />
    </figure>
  );
}

export function RichTextPostReference({
  href,
  label,
  postId,
}: {
  readonly href?: string;
  readonly label: string;
  readonly postId?: string;
}) {
  if (!href) {
    return (
      <span data-post-id={postId}>
        <Badge>{label}</Badge>
      </span>
    );
  }
  return (
    <AriaLink
      href={href}
      data-post-id={postId}
      className="card card-border bg-base-100 transition hover:border-primary"
    >
      <span className="card-body gap-1 p-4">
        <span className="text-xs font-semibold uppercase text-base-content/50">
          Read next
        </span>
        <span className="link link-primary">{label}</span>
      </span>
    </AriaLink>
  );
}

export function RichTextCodeBlock({
  language = "text",
  value,
}: {
  readonly language?: CodeEditorLanguage;
  readonly value: string;
}) {
  return (
    <CodeEditor
      label="Code content"
      value={value}
      language={language}
      readOnly
      maxHeight="lg"
      onChange={() => {}}
    />
  );
}

export function RichTextMark({ children }: RichTextChildrenProps) {
  return (
    <mark className="rounded bg-warning/30 px-0.5 text-base-content">
      {children}
    </mark>
  );
}

export function RichTextGlossary({
  term,
  definition,
}: {
  readonly term: string;
  readonly definition: string;
}) {
  return (
    <abbr
      title={definition}
      className="cursor-help font-medium text-base-content underline decoration-dotted decoration-base-content/40 underline-offset-2"
    >
      {term}
    </abbr>
  );
}

export function RichTextCheckList({ children }: RichTextChildrenProps) {
  return (
    <ul className="m-0 ml-1 list-none space-y-1 text-base leading-6 text-base-content">
      {children}
    </ul>
  );
}

export function RichTextCheckListItem({
  checked,
  children,
}: RichTextChildrenProps & {
  readonly checked?: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        readOnly
        className="checkbox checkbox-sm mt-0.5"
        aria-hidden="true"
        tabIndex={-1}
      />
      <span className={checked ? "text-base-content/60 line-through" : ""}>
        {children}
      </span>
    </li>
  );
}

/** CSS for the rendered numbered-column gutter — mirrors the editor's counter
 *  technique so the published table matches what the author saw. Self-contained
 *  (`@idco/ui` ships no stylesheet) and scoped to `.rt-table-numbered`. */
const NUMBERED_TABLE_CSS = `
.rt-table-numbered{counter-reset:rt-row}
.rt-table-numbered tr{counter-increment:rt-row}
.rt-table-numbered tr>*:first-child{padding-left:3rem}
.rt-table-numbered tr>*:first-child::before{content:counter(rt-row);position:absolute;left:0;top:0;bottom:0;width:2.25rem;display:grid;place-items:center;font-size:0.7rem;font-variant-numeric:tabular-nums;color:var(--color-base-content);opacity:0.45;background:var(--color-base-200);border-right:1px solid var(--color-base-300)}
`;

export function RichTextTable({
  children,
  colWidths,
  layout = "fixed",
  numbered = false,
}: RichTextChildrenProps & {
  readonly colWidths?: readonly number[];
  readonly layout?: string;
  readonly numbered?: boolean;
}) {
  // The wrapper owns the rounded outer frame (matching the editor and the other
  // bordered blocks); cells draw only the interior grid. overflow-x scrolls wide
  // tables while the radius still clips the table's square corners.
  const responsive = layout === "responsive" || layout === "full-width";
  const total = colWidths?.reduce((sum, width) => sum + width, 0) ?? 0;
  // Responsive tables emit `%` widths so the page reflows natively (no JS);
  // fixed tables emit the authored `px` and scroll when wider than the frame.
  const colGroup =
    colWidths && colWidths.length > 0 ? (
      <colgroup>
        {colWidths.map((width, index) => (
          <col
            // eslint-disable-next-line react/no-array-index-key -- columns are positional
            key={index}
            style={{
              width:
                responsive && total > 0
                  ? `${((width / total) * 100).toFixed(4)}%`
                  : `${width}px`,
            }}
          />
        ))}
      </colgroup>
    ) : null;
  return (
    <div className="my-3 overflow-x-auto overflow-y-hidden rounded-box border border-base-300">
      {numbered ? <style>{NUMBERED_TABLE_CSS}</style> : null}
      <table
        data-table-layout={layout}
        className={`border-separate border-spacing-0 text-sm [&_tr:last-child>*]:border-b-0 [&_tr>*:last-child]:border-r-0 ${
          responsive || !colGroup ? "w-full" : ""
        } ${colGroup ? "table-fixed" : ""} ${
          numbered ? "rt-table-numbered [&_td]:relative [&_th]:relative" : ""
        }`.trim()}
      >
        {colGroup}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function RichTextTableRow({ children }: RichTextChildrenProps) {
  return <tr>{children}</tr>;
}

// `verticalAlignClass` and `readableTextColor` are pure cell-styling helpers shared with the
// server reader (`reader/l1`) and the editor's table view; the single definition lives in
// `@quanghuy1242/idco-lib` (the product-neutral package both renderers may import). Re-exported
// here so this module's public surface is unchanged for consumers importing them from `@idco/ui`.
export { readableTextColor, verticalAlignClass };

export function RichTextTableCell({
  header,
  children,
  colSpan,
  rowSpan,
  backgroundColor,
  verticalAlign,
}: RichTextChildrenProps & {
  readonly header?: boolean;
  readonly colSpan?: number;
  readonly rowSpan?: number;
  readonly backgroundColor?: string;
  readonly verticalAlign?: string;
}) {
  const className = `border-b border-r border-base-300 px-5 py-2.5 ${verticalAlignClass(
    verticalAlign,
  )} text-base-content`;
  // Merged cells span columns/rows; a cell background overrides the surface, and
  // the text color flips to stay legible against the chosen fill (any theme).
  const span = {
    ...(colSpan && colSpan > 1 ? { colSpan } : {}),
    ...(rowSpan && rowSpan > 1 ? { rowSpan } : {}),
    ...(backgroundColor
      ? {
          style: {
            background: backgroundColor,
            color: readableTextColor(backgroundColor),
          },
        }
      : {}),
  };
  if (header) {
    return (
      <th
        {...span}
        className={`${className} bg-base-200 text-left font-semibold`}
      >
        {children}
      </th>
    );
  }
  return (
    <td {...span} className={className}>
      {children}
    </td>
  );
}

// Margin (not padding): see the call site — `menu` owns the anchor's
// `padding-inline`, so depth has to indent with `margin-inline-start` to avoid
// fighting it.
const tocDepthClass: Record<number, string> = {
  0: "",
  1: "ms-6",
  2: "ms-12",
  3: "ms-18",
  4: "ms-24",
  5: "ms-30",
};

export function RichTextTableOfContents({
  entries,
  style = "plain",
  title = "Table of contents",
}: {
  readonly entries: readonly RichTextTableOfContentsEntry[];
  readonly style?: RichTextTableOfContentsStyle;
  readonly title?: string;
}) {
  const hasNumbers = entries.some((entry) => Boolean(entry.number));
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
        <NavIcon name="ScrollText" />
        {title}
      </div>
      {entries.length > 0 ? (
        <ul
          className={`menu w-full p-0 ${style === "compact" ? "text-xs" : "text-sm"}`}
        >
          {entries.map((entry) => (
            <li key={entry.id}>
              <AriaLink
                href={entry.href}
                aria-label={
                  entry.number ? `${entry.number} ${entry.text}` : entry.text
                }
                // Depth indentation uses `ms-*` (margin-inline-start), not
                // `pl-*`: DaisyUI's `menu` already sets `padding-inline` on the
                // anchor for its themed inset, and a competing `padding-left`
                // would lose to it and collapse the first level flush with the
                // root. Margin stacks cleanly on top of the menu padding. When
                // any entry is numbered, every row reserves a fixed number column
                // (the `min-w` span) so text aligns and the indentation reads as
                // real structure — including unnumbered orphans (a heading whose
                // parent level is filtered out), which keep an empty number cell
                // instead of shifting left.
                className={[
                  "items-baseline",
                  tocDepthClass[Math.min(entry.depth ?? 0, 5)] ?? "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {hasNumbers ? (
                  <span className="min-w-9 text-right font-mono text-xs tabular-nums text-base-content/50">
                    {entry.number ?? ""}
                  </span>
                ) : null}
                {/* Headings are nav labels, so prefer wrapping over dropping
                    text: panel/plain wrap with a hanging indent (the number sits
                    in its own column) and clamp at 3 lines as a safety valve.
                    `compact` opts into density, so it keeps single-line
                    truncation. */}
                <span
                  className={`min-w-0 ${style === "compact" ? "truncate" : "line-clamp-3"}`}
                >
                  {entry.text}
                </span>
              </AriaLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-base-content/60">
          No headings in this document.
        </p>
      )}
    </>
  );

  if (style === "plain") {
    return (
      <nav aria-label={title} className="my-3 grid gap-2">
        {body}
      </nav>
    );
  }

  if (style === "compact") {
    return (
      <nav
        aria-label={title}
        className="my-2 rounded-box border border-base-300 bg-base-100 p-3"
      >
        <div className="grid gap-1.5">{body}</div>
      </nav>
    );
  }

  // `border-base-300`, not DaisyUI's `card-border` (which is base-200): the rail
  // sits beside the editor frame / article, and those use base-300 — as does the
  // `compact` variant above — so match it for a consistent edge.
  return (
    <nav
      aria-label={title}
      className="card my-3 border border-base-300 bg-base-100"
    >
      <div className="card-body gap-2 p-4">{body}</div>
    </nav>
  );
}

export type RichTextTocSide = "left" | "right";

/**
 * Sticky side rail for a `placement: "aside"` table of contents. Hidden below
 * `lg` (the shells render the TOC inline at that breakpoint instead); at `lg`+
 * it pins to the top of the viewport and travels the full height of its grid
 * track. Presentational only — the reserved column lives in `RichTextTocLayout`.
 */
export function RichTextTocRail({
  entries,
  title = "Table of contents",
  style = "compact",
  top = "1rem",
}: {
  readonly entries: readonly RichTextTableOfContentsEntry[];
  readonly title?: string;
  readonly style?: RichTextTableOfContentsStyle;
  /** CSS length used for the sticky offset from the top of the scroll container. */
  readonly top?: string;
}) {
  return (
    <aside className="hidden lg:block">
      {/* Drop the TOC's own vertical margin so the rail's top aligns with the
          editor frame / article top instead of sitting a row lower. */}
      <div className="lg:sticky [&>nav]:my-0" style={{ top }}>
        <RichTextTableOfContents
          entries={entries}
          style={style}
          title={title}
        />
      </div>
    </aside>
  );
}

/**
 * Side-aware responsive shell that reserves a column for a TOC rail. At `lg`+ it
 * is a two-column grid (rail + content, ordered by `side`); below `lg` it
 * collapses to normal flow so the rail's own `lg:` visibility hides it and the
 * content reads single-column. When `rail` is absent it renders children as-is,
 * so callers can mount it unconditionally. Used by both the editor shell and the
 * read-side renderer so editor and published output stay in lockstep.
 */
export function RichTextTocLayout({
  children,
  rail,
  side = "left",
}: {
  readonly children: ReactNode;
  readonly rail?: ReactNode;
  readonly side?: RichTextTocSide;
}) {
  if (!rail) return <>{children}</>;
  const columns =
    side === "right"
      ? "lg:grid-cols-[minmax(0,1fr)_16rem]"
      : "lg:grid-cols-[16rem_minmax(0,1fr)]";
  return (
    <div className={`lg:grid ${columns} lg:gap-6`}>
      {side === "left" ? rail : null}
      {children}
      {side === "right" ? rail : null}
    </div>
  );
}
