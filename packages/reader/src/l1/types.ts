/**
 * Shared L1 types and pure helpers (docs/015 §4.2). RSC-safe: no directive, no hooks,
 * no client imports. These are the framework-free vocabulary every L1 primitive speaks.
 *
 * @categoryDefault L1 Blocks
 */

/** A heading level `h1`..`h6`. @category L1 Blocks */
export type RichTextHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
/** A list flavour: bullet or numbered. @category Typography */
export type RichTextListKind = "bullet" | "number";
/** A block text-alignment value. @category Typography */
export type RichTextAlign = "left" | "center" | "right" | "justify";
/** A callout tone: info, success, warning, or error. @category Typography */
export type RichTextCalloutTone = "info" | "success" | "warning" | "error";
/** A table-of-contents visual style: panel, plain, or compact. @category Typography */
export type RichTextTableOfContentsStyle = "panel" | "plain" | "compact";
/** Which side a TOC rail sits on. @category Typography */
export type RichTextTocSide = "left" | "right";

/**
 * One table-of-contents entry: a heading's anchor link plus its level, nesting depth, and optional number.
 *
 * @category Typography
 */
export type RichTextTableOfContentsEntry = {
  readonly id: string;
  readonly href: string;
  readonly text: string;
  readonly level: number;
  readonly depth?: number;
  readonly number?: string;
};

/** Tailwind `text-align` utility for an alignment value. @category Typography */
export const RT_ALIGN_CLASS: Record<RichTextAlign, string> = {
  center: "text-center",
  justify: "text-justify",
  left: "text-left",
  right: "text-right",
};

// `verticalAlignClass` and `readableTextColor` are pure cell-styling helpers shared with
// the client renderer (`@idco/ui` rich-text-content) and the editor's table view. They live
// in `@quanghuy1242/idco-lib` (RSC-safe, the one package both the client and this server-safe
// L1 layer may import) so the same logic is defined once, not mirrored per renderer. Re-exported
// here to keep the L1 vocabulary surface — and the editor's `idco-reader` import path — intact.
export { readableTextColor, verticalAlignClass } from "@quanghuy1242/idco-lib";
