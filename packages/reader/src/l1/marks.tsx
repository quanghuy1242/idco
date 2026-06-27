/**
 * L1 inline-mark primitives (docs/015 §4.2). Pure, RSC-safe, self-contained. Semantic
 * marks (strong/em/u/s) carry their `.rt-*` class so a host can theme them; the marks the
 * UA does not style (link, inline code, highlight, mark, glossary, comment) get their
 * appearance from the `.rt-*` stylesheet. The link is a plain `<a>` — a reader link needs
 * no client behavior — replacing the `react-aria-components` `Link` that tainted the
 * previous client primitive.
 *
 * @categoryDefault L1 Marks
 */
import type { ReactNode } from "react";
import { RT_MARK_CLASS } from "./typography";

type RichTextChildrenProps = { readonly children?: ReactNode };

/** Renders an inline link mark as a plain `<a>` carrying the `.rt-link` class. */
export function RichTextInlineLink({
  href,
  children,
}: RichTextChildrenProps & { readonly href: string }) {
  return (
    <a className={RT_MARK_CLASS.link} href={href}>
      {children}
    </a>
  );
}

/** Renders an inline code mark as a `<code>` carrying the `.rt-code` class. */
export function RichTextInlineCode({ children }: RichTextChildrenProps) {
  return <code className={RT_MARK_CLASS.code}>{children}</code>;
}

/** Renders a strong (bold) mark as a `<strong>` carrying the `.rt-strong` class. */
export function RichTextStrong({ children }: RichTextChildrenProps) {
  return <strong className={RT_MARK_CLASS.strong}>{children}</strong>;
}

/** Renders an emphasis (italic) mark as an `<em>` carrying the `.rt-em` class. */
export function RichTextEmphasis({ children }: RichTextChildrenProps) {
  return <em className={RT_MARK_CLASS.em}>{children}</em>;
}

/** Renders an underline mark as a `<u>` carrying the `.rt-underline` class. */
export function RichTextUnderline({ children }: RichTextChildrenProps) {
  return <u className={RT_MARK_CLASS.underline}>{children}</u>;
}

/** Renders a strikethrough mark as an `<s>` carrying the `.rt-strike` class. */
export function RichTextStrikethrough({ children }: RichTextChildrenProps) {
  return <s className={RT_MARK_CLASS.strikethrough}>{children}</s>;
}

/** Renders a highlight mark as a `<mark>` carrying the `.rt-highlight` class. */
export function RichTextHighlight({ children }: RichTextChildrenProps) {
  return <mark className={RT_MARK_CLASS.highlight}>{children}</mark>;
}

/** A comment-annotation highlight (docs/015 §12): static, snapshot-only, never a host call. */
export function RichTextMark({ children }: RichTextChildrenProps) {
  return <mark className={RT_MARK_CLASS.mark}>{children}</mark>;
}

/**
 * A glossary term (docs/015 §12). Wraps the term's marked content in a native `<abbr title>`
 * hover affordance, the same element the editor's `renderGlossaryMark` emits — `children` is
 * the actual run (which may itself carry bold/italic/etc. marks, since glossary nests *outside*
 * them, MARK_RANK), so the text is always rendered; only the hover `title` comes from the
 * resolved definition. (Rendering a separate `term` string here would drop a formatted run's
 * content, because a glossary-over-bold child arrives as a `<strong>` element, not a string.)
 */
export function RichTextGlossary({
  definition,
  children,
}: RichTextChildrenProps & { readonly definition: string }) {
  return (
    <abbr className={RT_MARK_CLASS.glossary} title={definition}>
      {children}
    </abbr>
  );
}
