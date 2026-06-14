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
