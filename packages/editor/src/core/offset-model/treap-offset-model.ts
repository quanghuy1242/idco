/**
 * TreapOffsetModel — the O(log n) terminal implementation of {@link OffsetModel}
 * (docs/025 §5.2, §7, Phase B).
 *
 * An *implicit* treap: a randomized balanced BST keyed not by a stored key but by
 * in-order position, which is derived from subtree size. Each node augments the
 * standard treap with a subtree height-sum, so the four geometry questions are
 * all O(log n) and there is no estimate folded at query time — every node holds
 * one concrete height (a seed until measured, the real height after, docs/025
 * §5.3). This meets the Ω(log n) dynamic-partial-sums floor (docs/025 §6.3), so
 * it is the terminal structure, not a stepping stone.
 *
 * Why a treap and not a Fenwick/segment tree: a Fenwick is indexed by position,
 * so a structural insert/remove shifts every later index and forces an O(n)
 * rebuild — unacceptable in an editor. The treap's split/merge make insert and
 * remove O(log n) too, which is the whole reason this can be the *editing*
 * geometry, not just a read-only viewer's (docs/025 §6.2).
 *
 * Balance: priorities are random, so the expected height is ~1.39·log₂(n) (≈26
 * at 500k blocks). Split/merge/descent recursion is therefore O(log n) deep and
 * never threatens the stack at realistic document sizes. Tests inject a seeded
 * RNG so a failing case reproduces with the same tree shape.
 *
 * Numerical note: summation is hierarchical (pairwise up the tree), which is
 * strictly more stable than a flat left-to-right prefix sum — a quiet accuracy
 * win over {@link FlatOffsetModel} at large block counts (docs/025 §1 short
 * version, §7.5).
 */
import type { OffsetModel } from "./index";

interface TreapNode {
  left: TreapNode | null;
  right: TreapNode | null;
  // Min-heap priority: smaller value sits closer to the root. Random, which is
  // what keeps the tree balanced in expectation regardless of insert order.
  priority: number;
  // This block's concrete height (seed until measured, real after), floored 1px.
  height: number;
  // Subtree aggregates, restored by pull() after every structural change.
  size: number;
  heightSum: number;
}

function floorHeight(height: number): number {
  return Math.max(1, height);
}

function sz(node: TreapNode | null): number {
  return node ? node.size : 0;
}

function hs(node: TreapNode | null): number {
  return node ? node.heightSum : 0;
}

// Restore a node's aggregates from its children. Must be called on every node
// whose children changed, on the way back up — this is the single invariant the
// whole structure rests on (docs/025 §7.1).
function pull(node: TreapNode): void {
  node.size = 1 + sz(node.left) + sz(node.right);
  node.heightSum = node.height + hs(node.left) + hs(node.right);
}

function makeNode(height: number, priority: number): TreapNode {
  const h = floorHeight(height);
  return {
    height: h,
    heightSum: h,
    left: null,
    priority,
    right: null,
    size: 1,
  };
}

// Standard implicit-treap merge: `a` is entirely left of `b` in document order.
// Heap order decides which root wins; pull() the winner because its child set
// changed.
function merge(a: TreapNode | null, b: TreapNode | null): TreapNode | null {
  if (!a) return b;
  if (!b) return a;
  if (a.priority < b.priority) {
    a.right = merge(a.right, b);
    pull(a);
    return a;
  }
  b.left = merge(a, b.left);
  pull(b);
  return b;
}

// Split `node` into the first `k` blocks and the rest, by implicit index. The
// returned pair is [left = indices [0,k), right = indices [k,size)].
function split(
  node: TreapNode | null,
  k: number,
): [TreapNode | null, TreapNode | null] {
  if (!node) return [null, null];
  const leftSize = sz(node.left);
  if (k <= leftSize) {
    // The cut is inside the left subtree; `node` and its right child go right.
    const [l, r] = split(node.left, k);
    node.left = r;
    pull(node);
    return [l, node];
  }
  // The cut is inside the right subtree; `node` and its left child stay left.
  const [l, r] = split(node.right, k - leftSize - 1);
  node.right = l;
  pull(node);
  return [node, r];
}

export class TreapOffsetModel implements OffsetModel {
  private root: TreapNode | null = null;
  private readonly rng: () => number;

  /**
   * @param heights initial per-block heights (each floored at 1px on insert).
   * @param rng priority source; defaults to `Math.random`. Tests pass a seeded
   *   generator so the tree shape — and therefore any failure — is reproducible.
   */
  constructor(
    heights: readonly number[] = [],
    rng: () => number = Math.random,
  ) {
    this.rng = rng;
    // Build by appending. O(n log n), one-time at construction; after this the
    // controller mutates in place (setHeight/insert/remove are each O(log n)),
    // which is the point — never rebuild the tree to absorb a measurement.
    for (const h of heights) {
      this.root = merge(this.root, makeNode(h, this.rng()));
    }
  }

  get count(): number {
    return sz(this.root);
  }

  total(): number {
    return hs(this.root); // O(1): the root already holds the whole sum.
  }

  // Top edge of block `index` = sum of heights of [0, index). Descend, adding a
  // whole left subtree's height plus this node's height each time we step right
  // past `index` (docs/025 §7.3).
  prefix(index: number): number {
    const count = this.count;
    let idx = Math.max(0, Math.min(count, index));
    let acc = 0;
    let node = this.root;
    while (node) {
      const leftSize = sz(node.left);
      if (idx <= leftSize) {
        node = node.left;
      } else {
        acc += hs(node.left) + node.height;
        idx -= leftSize + 1;
        node = node.right;
      }
    }
    return acc;
  }

  // The block whose box contains pixel `offset` (docs/025 §7.3). At each node,
  // either the pixel is in the left subtree, inside this block, or further right.
  findIndex(offset: number): number {
    const count = this.count;
    if (count <= 0) return 0;
    if (offset <= 0) return 0;
    let rem = offset;
    let idx = 0;
    let node = this.root;
    while (node) {
      const leftSum = hs(node.left);
      if (rem < leftSum) {
        node = node.left;
      } else {
        rem -= leftSum;
        idx += sz(node.left);
        if (rem < node.height) return idx; // pixel lands inside this block
        rem -= node.height;
        idx += 1;
        node = node.right;
      }
    }
    return Math.min(idx, count); // past the last block
  }

  // First k in [0, count] with prefix(k) >= target. Mirrors the flat model's
  // binary lower-bound exactly, including the count+1 overflow when target is
  // past the total — the window-edge math depends on that off-by-one for the
  // overscrolled case (docs/025 §7.3, virtual-range.ts).
  lowerBound(target: number): number {
    const count = this.count;
    if (count === 0) return target <= 0 ? 0 : 1; // matches flat cum = [0]
    if (target > this.total()) return count + 1;
    let node = this.root;
    let acc = 0;
    let k = 0;
    while (node) {
      const leftSum = hs(node.left);
      if (acc + leftSum >= target) {
        // The first edge >= target is within the left subtree.
        node = node.left;
      } else {
        // Skip the whole left subtree and this block; if the running prefix now
        // reaches target, this index k is the answer (nothing smaller can be,
        // since everything to the left summed below target).
        acc += leftSum + node.height;
        k += sz(node.left) + 1;
        if (acc >= target) return k;
        node = node.right;
      }
    }
    return k; // unreachable given the target>total guard, but keeps k well-typed
  }

  // Update one block's height and pull() the path back to the root — the only
  // nodes whose aggregates changed are the ancestors of `index` (docs/025 §7.4).
  setHeight(index: number, height: number): void {
    if (index < 0 || index >= this.count) return;
    const h = floorHeight(height);
    const update = (node: TreapNode | null, k: number): void => {
      if (!node) return;
      const leftSize = sz(node.left);
      if (k < leftSize) update(node.left, k);
      else if (k > leftSize) update(node.right, k - leftSize - 1);
      else node.height = h;
      pull(node);
    };
    update(this.root, index);
  }

  insert(index: number, height: number): void {
    const at = Math.max(0, Math.min(this.count, index));
    const node = makeNode(height, this.rng());
    const [l, r] = split(this.root, at);
    this.root = merge(merge(l, node), r);
  }

  remove(index: number): void {
    if (index < 0 || index >= this.count) return;
    const [l, mr] = split(this.root, index);
    const [, r] = split(mr, 1); // drop the single node at `index`
    this.root = merge(l, r);
  }
}
