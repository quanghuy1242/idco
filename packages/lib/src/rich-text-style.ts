/**
 * Shared rich-text cell-styling helpers — product-neutral, framework-free, RSC-safe.
 *
 * These two pure functions were copy-pasted verbatim between the client renderer
 * (`@idco/ui` `rich-text-content`) and the server reader's L1 layer (`reader/l1/types`),
 * with the reader copy's own header admitting "Moved verbatim from `@idco/ui`". They are
 * pure string→string maps with no React/DOM/runtime dependency, so the honest home is
 * here in lib: both renderers (and the editor's table view, which imports them through the
 * reader) now share one definition instead of maintaining the same logic in parallel.
 *
 * The boundary that forces a shared *lib* module rather than one renderer importing the
 * other: the reader's L1 layer must stay RSC-pure and cannot import `@idco/ui` (the
 * `architecture/reader-l1-purity` lint forbids it), and lib is the one package both the
 * client and the server-safe reader may depend on.
 */

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
 * color, leaving the themed default.
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
