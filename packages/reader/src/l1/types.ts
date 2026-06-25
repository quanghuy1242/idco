/**
 * Shared L1 types and pure helpers (docs/015 §4.2). RSC-safe: no directive, no hooks,
 * no client imports. These are the framework-free vocabulary every L1 primitive speaks.
 */

export type RichTextHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type RichTextListKind = "bullet" | "number";
export type RichTextAlign = "left" | "center" | "right" | "justify";
export type RichTextCalloutTone = "info" | "success" | "warning" | "error";
export type RichTextTableOfContentsStyle = "panel" | "plain" | "compact";
export type RichTextTocSide = "left" | "right";

export type RichTextTableOfContentsEntry = {
  readonly id: string;
  readonly href: string;
  readonly text: string;
  readonly level: number;
  readonly depth?: number;
  readonly number?: string;
};

/** Tailwind `text-align` utility for an alignment value. */
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
