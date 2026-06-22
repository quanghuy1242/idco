/**
 * The transient table cell-range channel (docs/024 §7.4).
 *
 * Dragging across cells paints a rectangular *view-layer* range — it never enters the
 * core `EditorSelection` (docs/022 §7). The drag itself is a genuinely-spatial
 * affordance that stays in `table-interactions` (docs/024 §7.4); but `contributeCommands`
 * is a pure function of the model + this view state, and it needs to know whether a
 * ≥2-cell range exists to offer "Merge cells". Rather than add ephemeral view state to
 * the core store (where `activeObjectId` lives), this is a per-store module channel: the
 * spatial drag layer writes it, the table cell's `contributeCommands` reads it at
 * menu-open time. A `WeakMap` keys it by store so multiple editors do not collide and the
 * entry is GC'd with the store. No reactivity is needed: the context menu re-resolves on
 * open (`requestContextMenu` builds a fresh context), reading the latest range then.
 */
import type { EditorStore, NodeId } from "../../../core";

export type CellCoords = { readonly row: number; readonly col: number };

export type CellRange = {
  readonly tableId: NodeId;
  readonly anchor: CellCoords;
  readonly focus: CellCoords;
};

const RANGES = new WeakMap<EditorStore, CellRange>();

/** Record (or clear) the current drag-selected cell range for a store. */
export function setCellRange(
  store: EditorStore,
  range: CellRange | null,
): void {
  if (range) RANGES.set(store, range);
  else RANGES.delete(store);
}

/** The current drag-selected cell range for a store, or null. */
export function getCellRange(store: EditorStore): CellRange | null {
  return RANGES.get(store) ?? null;
}
