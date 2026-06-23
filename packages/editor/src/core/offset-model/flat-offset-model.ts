/**
 * FlatOffsetModel — the O(n) reference implementation of {@link OffsetModel}
 * (docs/025 §6.2, Phase A).
 *
 * This is the pre-treap geometry, ported behind the SPI: a heights array plus a
 * lazily rebuilt cumulative prefix array. Every mutation marks the prefix dirty
 * and the next query rebuilds it in O(n). That is intentionally the same cost
 * the editor pays today; the point of Phase A is the seam, not speed.
 *
 * It has a second job that outlives Phase A: it is the **oracle** the treap is
 * differentially tested against (docs/025 §9.2). So it must be obviously,
 * boringly correct — a flat array and a textbook binary search — with no clever
 * incremental tricks that could share a bug with the structure under test.
 *
 * Parity note: heights are floored at 1px (`Math.max(1, h)`), exactly as the
 * legacy `cumulativeOffsets` did, so the offset axis is strictly increasing and
 * `lowerBound`/`findIndex` stay well-defined. This floor is the reason the
 * Phase A output is byte-identical to the old code, not merely close.
 */
import type { OffsetModel } from "./index";

function floorHeight(height: number): number {
  // Strictly-increasing offsets require positive heights; mirror the legacy
  // floor so a zero/negative measurement cannot collapse two blocks onto the
  // same pixel and break the binary searches below.
  return Math.max(1, height);
}

export class FlatOffsetModel implements OffsetModel {
  private heights: number[];
  // `cum[k]` is the top edge of block k (sum of the first k heights); length is
  // count+1 with `cum[count] === total`. Rebuilt from `heights` on demand.
  private cum: number[] = [0];
  private dirty = true;

  constructor(heights: readonly number[] = []) {
    this.heights = heights.map(floorHeight);
  }

  /** Build from a count + size function, the shape `calculateVirtualRange` feeds. */
  static fromSizes(
    count: number,
    getItemSize: (index: number) => number,
  ): FlatOffsetModel {
    const heights: number[] = Array.from({ length: Math.max(0, count) });
    for (let i = 0; i < heights.length; i += 1) heights[i] = getItemSize(i);
    return new FlatOffsetModel(heights);
  }

  get count(): number {
    return this.heights.length;
  }

  private rebuild(): void {
    if (!this.dirty) return;
    const n = this.heights.length;
    const cum: number[] = Array.from({ length: n + 1 });
    cum[0] = 0;
    for (let i = 0; i < n; i += 1) cum[i + 1] = cum[i] + this.heights[i]!;
    this.cum = cum;
    this.dirty = false;
  }

  total(): number {
    this.rebuild();
    return this.cum[this.heights.length]!;
  }

  prefix(index: number): number {
    this.rebuild();
    const i = Math.max(0, Math.min(this.heights.length, index));
    return this.cum[i]!;
  }

  // First k in [0, count] with cum[k] >= target. Textbook lower-bound; the
  // window-edge math depends on this exact tie/non-edge behavior (docs/025 §7.3).
  lowerBound(target: number): number {
    this.rebuild();
    let lo = 0;
    let hi = this.cum.length; // count + 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cum[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Largest i with cum[i] <= offset, clamped to [0, count]. "Block at pixel Y."
  findIndex(offset: number): number {
    this.rebuild();
    const count = this.heights.length;
    if (count <= 0) return 0;
    if (offset <= 0) return 0;
    // lowerBound gives the first edge >= offset; the block containing the pixel
    // is the one just before that edge, unless the pixel sits exactly on an edge.
    const lb = this.lowerBound(offset);
    if (lb <= count && this.cum[lb] === offset) return Math.min(lb, count);
    return Math.max(0, Math.min(count, lb - 1));
  }

  setHeight(index: number, height: number): void {
    if (index < 0 || index >= this.heights.length) return;
    this.heights[index] = floorHeight(height);
    this.dirty = true;
  }

  insert(index: number, height: number): void {
    const at = Math.max(0, Math.min(this.heights.length, index));
    this.heights.splice(at, 0, floorHeight(height));
    this.dirty = true;
  }

  remove(index: number): void {
    if (index < 0 || index >= this.heights.length) return;
    this.heights.splice(index, 1);
    this.dirty = true;
  }
}
