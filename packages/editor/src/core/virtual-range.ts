/**
 * Virtual window math, now expressed over the {@link OffsetModel} SPI
 * (docs/025 §5.1, Phase A).
 *
 * `rangeFromModel` is the real primitive: given a built model and the scroll
 * geometry, it returns the window slice. `calculateVirtualRange` is a thin
 * back-compat wrapper that builds a {@link FlatOffsetModel} from a size function
 * and queries it, so existing callers keep their `getItemSize` shape and their
 * exact output.
 *
 * Parity is deliberate and load-bearing: the window edges come from
 * `model.lowerBound` with the same `-1` / overscan arithmetic the legacy
 * `cumulativeOffsets` code used, so the selected `[startIndex, endIndex)` slice
 * is byte-identical to the pre-OffsetModel behavior (the Phase A contract).
 */
import { type OffsetModel, FlatOffsetModel } from "./offset-model";

/**
 * @categoryDefault Virtual Geometry
 */

/** Inputs to the back-compat range calculation: item count, scroll geometry, and a size function. */
export type VirtualRangeInput = {
  readonly itemCount: number;
  readonly scrollOffset: number;
  readonly viewportSize: number;
  readonly overscan?: number;
  readonly getItemSize: (index: number) => number;
};

/** The window slice to render: the index range plus the spacer heights above, below, and total. */
export type VirtualRange = {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly beforeHeight: number;
  readonly afterHeight: number;
  readonly totalHeight: number;
};

/** A per-frame window query against a prebuilt offset model: scroll offset, viewport size, and overscan. */
export type VirtualRangeQuery = {
  readonly scrollOffset: number;
  readonly viewportSize: number;
  readonly overscan?: number;
};

const EMPTY_RANGE: VirtualRange = {
  afterHeight: 0,
  beforeHeight: 0,
  endIndex: 0,
  startIndex: 0,
  totalHeight: 0,
};

/**
 * Window slice for a prebuilt model. This is the per-frame query path: it does
 * O(log n) work on the treap (two `lowerBound` descents + two `prefix` reads)
 * and never rebuilds the geometry, which is the whole point of separating build
 * from query (docs/025 §9.1).
 */
export function rangeFromModel(
  model: OffsetModel,
  query: VirtualRangeQuery,
): VirtualRange {
  const count = model.count;
  if (count <= 0) return EMPTY_RANGE;

  const scrollOffset = Math.max(0, query.scrollOffset);
  const viewportSize = Math.max(0, query.viewportSize);
  const total = model.total();

  // `visibleStart` is the last block whose top edge is at or above the scroll
  // line, minus one (the legacy `lowerBound(...) - 1`); `visibleEnd` is the
  // first block whose top edge is at or past the viewport bottom. The `-1` vs
  // no-`-1` asymmetry is exactly the old behavior and is why both `lowerBound`
  // and `findIndex` exist on the SPI (see offset-model header).
  const visibleStart = model.lowerBound(scrollOffset) - 1;
  const visibleEnd = model.lowerBound(scrollOffset + viewportSize);

  const overscan = Math.max(0, query.overscan ?? 1);
  const startIndex = Math.max(0, visibleStart - overscan);
  const endIndex = Math.min(count, visibleEnd + overscan);

  return {
    afterHeight: total - model.prefix(endIndex),
    beforeHeight: model.prefix(startIndex),
    endIndex,
    startIndex,
    totalHeight: total,
  };
}

/**
 * Back-compat entry point: builds a flat model from the size function and
 * queries it. Output is identical to the legacy `cumulativeOffsets` path.
 */
export function calculateVirtualRange(input: VirtualRangeInput): VirtualRange {
  if (input.itemCount <= 0) return EMPTY_RANGE;
  const model = FlatOffsetModel.fromSizes(input.itemCount, input.getItemSize);
  return rangeFromModel(model, {
    overscan: input.overscan,
    scrollOffset: input.scrollOffset,
    viewportSize: input.viewportSize,
  });
}
