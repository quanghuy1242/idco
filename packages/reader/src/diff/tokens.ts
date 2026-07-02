/**
 * The one diff status token map (docs/039 §6.3) — status carried by shape first, color second.
 *
 * Both surfaces read this so the diff view's card left edge and the woven overlay's gutter bar are
 * the SAME status color (R-GI), and neither keeps a second palette. Each status names its DaisyUI
 * semantic CSS variable and a fallback hex; the shapes (underline+wash = insert, strikethrough =
 * delete, ring = attr/object, bar = block) live in the two stylesheets, but the color is single-
 * sourced here. The values match the shipped `RICH_TEXT_DIFF_CSS` card colors and the woven
 * `REVIEW_INDICATOR_CSS` bar colors, which is what "one palette" means.
 *
 * @categoryDefault Diff View
 */

/**
 * @categoryDefault Diff View
 */

/** One block/change status the token map covers. */
export type DiffStatusKey = "added" | "removed" | "changed" | "moved";

/** A status's semantic color: its CSS custom property and a hardcoded fallback. */
export type DiffStatusToken = {
  /** The DaisyUI semantic CSS variable, e.g. `--color-success`. */
  readonly cssVar: string;
  /** The fallback hex when the variable is unset. */
  readonly fallback: string;
};

/**
 * The status → semantic color map (docs/039 §6.3). `added` is success, `removed` error, `changed`
 * info, `moved` warning — the single source both the diff view card bar and the woven gutter bar
 * read, so a status is one color everywhere. A helper builds the `var(--x, #hex)` string.
 */
export const DIFF_STATUS_TOKENS: Readonly<
  Record<DiffStatusKey, DiffStatusToken>
> = {
  added: { cssVar: "--color-success", fallback: "#16a34a" },
  changed: { cssVar: "--color-info", fallback: "#0ea5e9" },
  moved: { cssVar: "--color-warning", fallback: "#d97706" },
  removed: { cssVar: "--color-error", fallback: "#dc2626" },
};

/** The `var(--color-x, #hex)` CSS color for a status — the value both surfaces paint their bar with. */
export function diffStatusColor(status: DiffStatusKey): string {
  const token = DIFF_STATUS_TOKENS[status];
  return `var(${token.cssVar}, ${token.fallback})`;
}
