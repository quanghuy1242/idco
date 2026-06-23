/**
 * OffsetModel SPI — the single seam every virtualization consumer plugs into
 * (docs/025 §5.1).
 *
 * The model owns one thing: the block-index → pixel-offset geometry. It answers
 * the three questions virtualization needs to place a window — total document
 * height, the pixel offset of a block's top edge, and which block sits at a
 * pixel — plus the mutations that keep those answers current (a measured height,
 * a structural insert/remove).
 *
 * Hard invariant that makes the whole design simple: **every block always carries
 * one concrete height.** There is no estimate folded in at query time and no
 * "measured vs unmeasured" branch inside the model. A block's height is its seed
 * (produced by the sibling `BlockEstimator`, docs/025 §5.3) until it is measured,
 * and its real height after. The model just stores whatever height it is handed,
 * which is why this interface has no `setEstimate`/`suggestedEstimate`:
 * estimation is a different concern that lives entirely outside the geometry.
 *
 * Two query primitives, not one, and on purpose:
 *
 * - `findIndex(offset)` answers "which block is at pixel Y" (the block whose box
 *   contains the pixel). Scroll-to-block and anchoring want this.
 * - `lowerBound(target)` answers "first block whose top edge is >= target" over
 *   the half-open offset axis `[0, count]`. The window-edge math (docs/025 §7.3)
 *   wants this because it reproduces the exact legacy selection, including the
 *   off-by-one rounding at non-edge targets that `findIndex` deliberately does
 *   not have. Keeping both means the window slice is byte-identical to the
 *   pre-OffsetModel code (the Phase A parity contract).
 *
 * Implementations: {@link FlatOffsetModel} (the O(n)-rebuild reference and test
 * oracle) and the augmented treap (docs/025 §5.2, the O(log n) terminal impl).
 */
export interface OffsetModel {
  /** Number of blocks currently modeled. */
  readonly count: number;

  /** Total pixel height of all blocks (sum of every concrete height). */
  total(): number;

  /**
   * Pixel offset of the top edge of block `index` — the sum of heights of
   * `[0, index)`. Defined for `index` in `[0, count]`; `prefix(count) === total()`.
   */
  prefix(index: number): number;

  /**
   * The block whose box contains pixel `offset`: the largest `i` with
   * `prefix(i) <= offset`, clamped to `[0, count]`. "Block at pixel Y."
   */
  findIndex(offset: number): number;

  /**
   * The first index `k` in `[0, count]` with `prefix(k) >= target`. The exact
   * window-edge primitive (docs/025 §7.3); see the file header for why this is
   * separate from `findIndex`.
   */
  lowerBound(target: number): number;

  /**
   * Set the concrete height of the block at `index`. Used for both the initial
   * seed and the later real measurement; the model does not distinguish them.
   * Heights are floored at 1px so the offset axis stays strictly increasing.
   */
  setHeight(index: number, height: number): void;

  /**
   * Insert a block at `index` with a concrete seed height. Diverges from the
   * docs/025 §5.1 bare `insert(index)` on purpose: requiring the seed up front
   * means a freshly inserted block never has a transient placeholder height that
   * a later query could observe. The caller passes `estimator.seed(i)`.
   */
  insert(index: number, height: number): void;

  /** Remove the block at `index`. */
  remove(index: number): void;
}

export { FlatOffsetModel } from "./flat-offset-model";
export { TreapOffsetModel } from "./treap-offset-model";
export { reconcileOffsetModel } from "./reconcile";
export {
  BlockEstimator,
  type BlockEstimatorOptions,
  type BlockMetrics,
} from "./block-estimator";
export { metricsForNode } from "./block-metrics";
