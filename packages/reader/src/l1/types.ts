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

/** Map a cell's `verticalAlign` attr to its Tailwind vertical-align class. */
export function verticalAlignClass(verticalAlign?: string): string {
  if (verticalAlign === "middle") return "align-middle";
  if (verticalAlign === "bottom") return "align-bottom";
  return "align-top";
}

/**
 * A readable text color (near-black or near-white) for a cell's explicit background,
 * by perceived luminance. A user-set cell fill is theme-independent, so the themed
 * `text-base-content` can collapse into it; picking the contrast color from the fill
 * keeps text legible regardless of theme. Returns `undefined` for an unset/unparseable
 * color, leaving the themed default. (Moved verbatim from `@idco/ui` `rich-text-content`.)
 */
export function readableTextColor(background?: string): string | undefined {
  if (!background) return undefined;
  const hex = background.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return undefined;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#111827" : "#f9fafb";
}
