/**
 * Pure geometry helpers for the editor's live layout affordances — table column
 * sizing and the draggable block handle. Kept free of React/DOM so the
 * behaviour the user reported (no right-hand gap when resizing, handle sitting
 * in the gap between blocks) can be unit-tested without a browser.
 */

/**
 * Even split of `available` px across `columns`, with the rounding remainder
 * folded into the last column so the widths sum to exactly `available` (the
 * table fills its frame). Used to seed `colWidths` on new/loaded tables.
 */
export function splitColumnWidths(
  available: number,
  columns: number,
): number[] {
  if (columns <= 0) return [];
  const base = Math.floor(available / columns);
  return Array.from({ length: columns }, (_, index) =>
    index === columns - 1 ? available - base * (columns - 1) : base,
  );
}

type TableSeedWidthInput = {
  readonly columns: number;
  readonly editorWidth: number;
  readonly tableWidth: number;
  readonly wrapperWidth: number;
  readonly minColumnWidth?: number;
};

/**
 * Width source priority for seeding table `colWidths`. The scroll wrapper is
 * authoritative when measured; otherwise use the editor content width before
 * trusting the table's intrinsic empty-cell width, which can be tiny.
 */
export function tableSeedAvailableWidth({
  columns,
  editorWidth,
  minColumnWidth = 120,
  tableWidth,
  wrapperWidth,
}: TableSeedWidthInput): number {
  if (columns <= 0) return 0;
  if (wrapperWidth > 0) return wrapperWidth;
  if (editorWidth > 0) return editorWidth;

  const fallbackWidth = columns * minColumnWidth;
  return tableWidth >= fallbackWidth ? tableWidth : fallbackWidth;
}

/**
 * New column widths after dragging the boundary on the right of `colIndex` by
 * `deltaX` px. Width is traded with the adjacent (right) column, so the total is
 * conserved — the table never shrinks and leaves a gap on the right — and
 * neither column drops below `minWidth`.
 */
export function resizeColumnWidths(
  widths: readonly number[],
  colIndex: number,
  deltaX: number,
  minWidth: number,
): number[] {
  const rightIndex = colIndex + 1;
  const leftStart = widths[colIndex] ?? minWidth;
  const rightStart = widths[rightIndex] ?? minWidth;
  // Clamp the shift so neither the dragged nor the adjacent column underflows.
  const delta = Math.max(
    minWidth - leftStart,
    Math.min(rightStart - minWidth, deltaX),
  );
  const next = [...widths];
  next[colIndex] = leftStart + delta;
  next[rightIndex] = rightStart - delta;
  return next;
}

/**
 * Scale `widths` proportionally so they sum to exactly `targetTotal`, folding
 * the rounding remainder into the last column. This is how a responsive table
 * keeps its columns' *proportions* while pinning the table to its container:
 * the `ResizeObserver` calls this with the new container width, and switching a
 * fixed table to responsive calls it with the container width to preserve the
 * authored ratios. Returns `[]` for empty input or a non-positive total.
 */
export function scaleColumnWidths(
  widths: readonly number[],
  targetTotal: number,
): number[] {
  if (widths.length === 0 || targetTotal <= 0) return [];
  const current = widths.reduce((sum, width) => sum + width, 0);
  if (current <= 0) return splitColumnWidths(targetTotal, widths.length);
  const scaled = widths.map((width) =>
    Math.max(1, Math.round((width / current) * targetTotal)),
  );
  // Fold the rounding drift into the last column so the sum is exact.
  const drift = targetTotal - scaled.reduce((sum, width) => sum + width, 0);
  scaled[scaled.length - 1] = Math.max(1, scaled[scaled.length - 1]! + drift);
  return scaled;
}

/**
 * Move the item at `from` to `to`, returning a new array. Used to keep a table's
 * `colWidths` aligned with its columns when a column is reordered (`$moveTableColumn`
 * moves the cells but not the separately-stored widths). Out-of-range indices
 * return the array unchanged.
 */
export function moveArrayItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * The fraction of the table each column occupies (`width / sum`), summing to 1.
 * The renderer turns these into `<colgroup>` percentages so a responsive table
 * reflows natively on the page without the editor's `ResizeObserver`. Returns
 * `[]` when widths are missing or sum to zero.
 */
export function columnWidthRatios(widths: readonly number[]): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (widths.length === 0 || total <= 0) return [];
  return widths.map((width) => width / total);
}

/**
 * Vertical offset (px) to drop the block handle from Lexical's first-line anchor
 * into the gap *below* the block — centred between this block and the next — so
 * "insert below" reads as adding a block there. `gap` is clamped to `maxGap` so
 * a large margin can't fling the handle far past the edge.
 */
export function blockHandleDropOffset(
  height: number,
  gap: number,
  lineHeight: number,
  maxGap = 32,
): number {
  const clampedGap = Math.min(Math.max(gap, 0), maxGap);
  return Math.max(0, height + clampedGap / 2 - lineHeight / 2);
}
