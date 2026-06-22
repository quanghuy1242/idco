# 025 - Virtual Geometry: Offset Model, Order-Statistics Tree, Running Estimate, And Fling Stability

> Status: implementation-grade research and proposal (pre-implementation)
>
> Date: 2026-06-22
>
> Scope:
>
> - `packages/editor/src/core/virtual-range.ts`
> - `packages/editor/src/view/controllers/use-virtual-window.ts`
> - `packages/editor/src/view/controllers/refs.ts`
> - `packages/editor/src/view/controllers/constants.ts`
> - `packages/editor/src/view/react-view.tsx`
> - `packages/editor/src/view/types.ts`
> - new `packages/editor/src/core/offset-model/**`
> - tests under `tests/editor/**`
>
> Source docs:
>
> - `docs/009_large_document_virtualized_editor_plan.md` (virtualization plan, decorator placeholders §6.1.1)
> - `docs/010_owned_model_virtualized_editor_plan.md` (owned-model engine plan, scroll-to-block AC3/AC4)
> - `docs/011_foundation_dsa_owned_model_editor.md` (DSA foundation, window/offset model §2.6, scheduling §10.3)
> - `docs/020_editor_architectural_refactor.md` (controller decomposition, the `use-virtual-window` lift)
>
> Related docs:
>
> - `docs/008_editor_performance_contract.md` (lane/budget scheduler the hot paths respect)
> - `docs/015_reader_server_native_read_tier.md` (read-tier consumer of the same geometry)
>
> Assumptions:
>
> - "Support everything" means uniform smoothness from 1k to 500k+ blocks, including live editing and free-spin ("flywheel") mouse scrolling, with no deferral of any size class. This document carries the terminal design at every layer, not a stepping-stone.
> - Block heights are variable and not known until a block mounts and lays out. There is no server-provided height oracle.
> - The view already coalesces scroll work onto one animation frame; this document does not change that contract, it builds on it.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 Relevant Files](#31-relevant-files)
  - [3.2 Current Behavior](#32-current-behavior)
  - [3.3 Current Problems](#33-current-problems)
- [4. The Two-Axis Reframe](#4-the-two-axis-reframe)
- [5. Target Model](#5-target-model)
  - [5.1 The OffsetModel SPI](#51-the-offsetmodel-spi)
  - [5.2 The Augmented Order-Statistics Tree](#52-the-augmented-order-statistics-tree)
  - [5.3 The Estimate Split And Running Estimate](#53-the-estimate-split-and-running-estimate)
  - [5.4 The Anchoring Contract](#54-the-anchoring-contract)
  - [5.5 The Fling And Measurement Contract](#55-the-fling-and-measurement-contract)
- [6. Architecture Decisions](#6-architecture-decisions)
  - [6.1 Recommended: Implicit Augmented Treap Behind An SPI](#61-recommended-implicit-augmented-treap-behind-an-spi)
  - [6.2 Rejected Or Reference-Only Options](#62-rejected-or-reference-only-options)
  - [6.3 Why O(log n) Is The Floor](#63-why-olog-n-is-the-floor)
- [7. Algorithms In Detail](#7-algorithms-in-detail)
  - [7.1 Node Shape And Invariants](#71-node-shape-and-invariants)
  - [7.2 Pull-Up And Effective Height](#72-pull-up-and-effective-height)
  - [7.3 build, prefix, findIndex](#73-build-prefix-findindex)
  - [7.4 setHeight, insert, remove](#74-setheight-insert-remove)
  - [7.5 Complexity Table](#75-complexity-table)
- [8. Implementation Strategy](#8-implementation-strategy)
- [9. Detailed Implementation Plan](#9-detailed-implementation-plan)
  - [9.1 Phase A: The Seam](#91-phase-a-the-seam)
  - [9.2 Phase B: The Tree](#92-phase-b-the-tree)
  - [9.3 Phase C: Estimate And Anchoring](#93-phase-c-estimate-and-anchoring)
  - [9.4 Phase D: Fling And Measurement](#94-phase-d-fling-and-measurement)
- [10. Edge Cases And Failure Modes](#10-edge-cases-and-failure-modes)
- [11. Implementation Backlog](#11-implementation-backlog)
- [12. Future Backlog](#12-future-backlog)
- [13. Test And Verification Plan](#13-test-and-verification-plan)
- [14. Definition Of Done](#14-definition-of-done)
- [15. Final Model](#15-final-model)

## 1. Goal

Make virtualized scroll geometry correct and smooth across every document size and every input device, with no size class deferred. Concretely: replace the per-recompute O(n) prefix-sum walk with a structure that is O(log n) for query, measurement update, and structural edit; replace the locked single-block estimate with a running estimate that improves as the document is measured; and stop free-spin mouse "fling" scrolling from jumping content, flashing blanks, or forcing synchronous layout every frame.

Non-goals for this document: changing the document model itself (`docs/011`), the persistence/serialization path, or the decorator-hydration policy beyond gating it on fling velocity. The bake/index worker (`docs/010` §7.5) is untouched.

Short version: introduce an `OffsetModel` SPI, back it with an augmented order-statistics tree (an implicit treap carrying subtree size, measured-count, and measured-height-sum), derive the estimate from the tree's root aggregates, pin the visible block with scroll-anchoring so an improving estimate never jumps content, and gate decorator hydration plus measurement on scroll velocity so a flywheel fling stays cheap.

## 2. System Summary

The editor renders only the slice of blocks the viewport covers plus overscan (`docs/011` §2.6). To place that slice it needs three answers from the block geometry: total document pixel height (for the scroller), the pixel offset before the window (the top spacer), and "which block index sits at scroll offset Y" (to pick the window start/end). Today those answers come from a flat prefix-sum array rebuilt on every window recompute. Scroll events are coalesced onto one animation frame, so the window recompute runs at most once per painted frame regardless of input frequency (`docs/011` §10.3). Block heights are measured after mount by reading `offsetHeight`, cached by `NodeId`, and an estimate stands in for blocks that have never mounted.

## 3. Current-State Findings

### 3.1 Relevant Files

- `packages/editor/src/core/virtual-range.ts` - `calculateVirtualRange`, `cumulativeOffsets`, `lowerBound`. The geometry math.
- `packages/editor/src/view/controllers/use-virtual-window.ts` - the controller: the `useMemo` window recompute, the `onScroll` rAF coalescer, and the `useLayoutEffect` measure + scroll-to-block settle loop.
- `packages/editor/src/view/controllers/refs.ts` - `heightCacheRef` (`Map<NodeId, number>`), `estimateRef`, `estimateLockedRef`, `pendingScrollRef`, `registryRef`.
- `packages/editor/src/view/controllers/constants.ts` - `DEFAULT_BLOCK_ESTIMATE`, the seed estimate.
- `packages/editor/src/view/react-view.tsx` - block ref registration into `registryRef.current.blockRefs` on mount and removal on unmount (around lines 158-160).
- `packages/editor/src/view/types.ts` - `RenderRegistry.blockRefs: Map<NodeId, HTMLElement>` (line 87).

### 3.2 Current Behavior

`calculateVirtualRange` ([virtual-range.ts:17-45](../packages/editor/src/core/virtual-range.ts#L17-L45)) calls `cumulativeOffsets` ([virtual-range.ts:47-54](../packages/editor/src/core/virtual-range.ts#L47-L54)), which builds a fresh `[0 .. n]` prefix array by walking all `itemCount` blocks. It then derives `startIndex`/`endIndex` with two `lowerBound` binary searches ([virtual-range.ts:30-34](../packages/editor/src/core/virtual-range.ts#L30-L34)) and the before/after/total spacers from array lookups.

The controller's window `useMemo` ([use-virtual-window.ts:58-88](../packages/editor/src/view/controllers/use-virtual-window.ts#L58-L88)) calls `calculateVirtualRange` with `getItemSize(index) = heightCacheRef.current.get(order[index]) ?? estimateRef.current`. Its dependency array includes `scrollTop` and `measureVersion`, so the entire prefix array is rebuilt whenever either changes.

`onScroll` ([use-virtual-window.ts:90-102](../packages/editor/src/view/controllers/use-virtual-window.ts#L90-L102)) coalesces every scroll event onto a single `requestFrame`, reads `element.scrollTop`, and calls `setScrollTop` at most once per frame.

The measure effect ([use-virtual-window.ts:104-165](../packages/editor/src/view/controllers/use-virtual-window.ts#L104-L165)) iterates `registryRef.current.blockRefs` (only the mounted window), reads `element.offsetHeight` for each, writes changed heights into the cache, and bumps `measureVersion` when any changed. It locks the estimate to the first measured frame's average and never updates it again ([use-virtual-window.ts:126-129](../packages/editor/src/view/controllers/use-virtual-window.ts#L126-L129)). It also runs the scroll-to-block settle loop: re-assert `element.offsetTop` up to six frames until the scroller lands within 1px ([use-virtual-window.ts:130-152](../packages/editor/src/view/controllers/use-virtual-window.ts#L130-L152)).

### 3.3 Current Problems

1. The prefix array is rebuilt on every scroll frame even though it depends only on heights, not on scroll position. Only the two `lowerBound` queries depend on `scrollTop`. This makes per-scroll-frame work O(n) where it could be O(log n).
2. A single measured height forces a full O(n) array rebuild via the `measureVersion` bump. During first-pass scroll, new blocks measure every frame, so the rebuild fires every frame. This is the one term that scales with total document size.
3. There is no structural-edit path for the offset model at all; the array is simply rebuilt from `order` and the cache each time. A future O(log n) structure must not regress this.
4. The estimate is locked to the first measured frame ([use-virtual-window.ts:126-129](../packages/editor/src/view/controllers/use-virtual-window.ts#L126-L129)). If the first screen is atypical (all short blocks, all images), every never-mounted block forever uses that wrong estimate. Deep in a fling, accumulated estimate error places the window wrong and the content jumps when the visible region finally measures.
5. The measure effect reads `offsetHeight` synchronously inside a layout effect on the scroll path, forcing a synchronous reflow of the freshly mounted window every frame during a fling. This, not the arithmetic, is the dominant per-frame cost under a flywheel fling.
6. The settle loop only engages for a `pendingScrollRef` scroll-to-block target. A user wheel-fling has no such target, so nothing keeps content stable when corrections land mid-fling.

## 4. The Two-Axis Reframe

The work splits into two independent axes. Conflating them is what makes "just use a faster data structure" the wrong instinct.

Compute axis: how fast can we answer total / prefix / findIndex and absorb a measurement or an edit. This is bounded by the data structure. The flat array is O(n) per rebuild; the target is O(log n) per operation. This axis is what the order-statistics tree fixes (§5.2, §7).

Perception axis: whether the rendered result looks stable and arrives in time. Scroll-event frequency is already decoupled from recompute frequency by the rAF coalescer, and the number of blocks measured per frame is bounded by the window, not by fling distance, because virtualization skips intermediate blocks. So a faster data structure does not by itself make a fling smooth. What a fling stresses is estimate accuracy (jump on settle), synchronous layout cost (dropped frames), and hydration latency (blank flash). This axis is fixed by the running estimate (§5.3), anchoring (§5.4), and velocity-gated mount/measurement (§5.5).

Supporting everything means landing both axes. The tree is necessary (size classes up to 500k and live edits) but not sufficient (fling smoothness lives on the perception axis).

## 5. Target Model

### 5.1 The OffsetModel SPI

A product-neutral interface in `packages/editor/src/core/offset-model/`. It is the single seam every other piece plugs into, locked before any internals per the SPI-first stance. Position is an in-document-order index; pixels are CSS pixels.

```ts
export interface OffsetModel {
  /** Number of blocks currently modeled. */
  readonly count: number;

  /** Total pixel height of all blocks, estimate applied to unmeasured ones. O(1). */
  total(): number;

  /** Pixel offset of the top edge of block `index` (sum of heights of [0, index)). O(log n). */
  prefix(index: number): number;

  /** Largest index whose top edge is <= offset, i.e. the block containing pixel `offset`. O(log n). */
  findIndex(offset: number): number;

  /** Record a measured height for the block at `index`. O(log n). */
  setHeight(index: number, height: number): void;

  /** Insert an unmeasured block at `index` (document edit). O(log n). */
  insert(index: number): void;

  /** Remove the block at `index` (document edit). O(log n). */
  remove(index: number): void;

  /** Set the fallback height for never-measured blocks. O(1) — see §5.3. */
  setEstimate(estimate: number): void;

  /** Derived running estimate = measuredSum / measuredCount, or the seed if none. O(1). */
  suggestedEstimate(): number;
}
```

The controller depends only on this interface. `calculateVirtualRange` becomes a thin adapter that calls `findIndex` twice and `prefix`/`total` for the spacers; it keeps its current return shape (`VirtualRange`) so call sites do not churn.

### 5.2 The Augmented Order-Statistics Tree

The terminal implementation is an implicit balanced binary tree keyed by in-order position (no stored keys; position is derived from subtree size). Each node augments the standard treap with two sums so that prefix, find-by-offset, total, measurement, and edit are all O(log n), and so the estimate is a query-time scalar rather than per-leaf data. Full shapes and pseudocode are in §7.

### 5.3 The Estimate Split And Running Estimate

The estimate is not stored on leaves. The effective pixel height of a subtree is computed at query time as `(size - measuredCount) * E + measuredSum`, where `E` is the model-level estimate scalar and `size`, `measuredCount`, `measuredSum` are the node aggregates. Consequences:

- Changing `E` is O(1). It touches no nodes; it only changes how queries fold the aggregates.
- The running estimate is free: `suggestedEstimate() = root.measuredSum / root.measuredCount` (falling back to `DEFAULT_BLOCK_ESTIMATE` when `measuredCount === 0`). The tree already carries both sums at the root, so the best current estimate is one division away.

This deletes the lock at [use-virtual-window.ts:126-129](../packages/editor/src/view/controllers/use-virtual-window.ts#L126-L129). The estimate floats toward the true mean as measurement proceeds, which maximizes accuracy. Accuracy alone would make content jump every time `E` moves — that hazard is owned by anchoring (§5.4), not by freezing the estimate.

### 5.4 The Anchoring Contract

Whenever a recompute changes geometry (a new measurement, an estimate change, or an edit above the viewport), the visible block must keep its on-screen position. The contract:

- Before applying the change, capture the anchor: the topmost visible block's index `a` and its screen offset `s = prefix(a) - scrollTop` (its distance below the viewport top).
- After applying the change, the new top edge of `a` is `prefix'(a)`. Set `scrollTop' = prefix'(a) - s` and write it to both the scroller element and `scrollTop` state in the same frame.

The existing settle loop ([use-virtual-window.ts:130-152](../packages/editor/src/view/controllers/use-virtual-window.ts#L130-L152)) becomes the special case where the anchor is the scroll-to-block target and `s = 0`. Anchoring generalizes it to all scrolling, including free wheel-flings that have no `pendingScrollRef` target.

### 5.5 The Fling And Measurement Contract

Two cooperating mechanisms remove the dominant fling costs.

Measurement moves off the synchronous scroll path. Replace the per-frame `offsetHeight` loop with a `ResizeObserver` that observes each mounted block element. The observer fires after layout, outside the scroll frame, and calls `model.setHeight(indexOf(id), height)` then schedules a single coalesced recompute. No synchronous reflow is forced during scroll.

Mount is gated on velocity. Track `velocity = |Δ scrollTop| / Δt` across frames. Above a threshold `V`, enter fling mode: render placeholder boxes sized to the model's effective per-block height, skip decorator hydration (reuse the decorator-placeholder mechanism from `docs/009` §6.1.1), and do not block the frame on measurement. When velocity stays below `V` for `K` consecutive frames (scroll-idle), exit fling mode: hydrate decorator bodies in the window and let the `ResizeObserver` feed real heights, with anchoring (§5.4) absorbing the resulting offset corrections so nothing jumps.

## 6. Architecture Decisions

### 6.1 Recommended: Implicit Augmented Treap Behind An SPI

Use an implicit treap (randomized balanced BST keyed by subtree size) augmented with `{ size, measuredCount, measuredSum }`, hidden behind the `OffsetModel` SPI, with the estimate as a model scalar. Rationale: it is the only single structure that delivers O(log n) for all five hot operations including structural edits, it makes the running estimate a root-aggregate read, and the SPI lets us ship a flat-array implementation first and swap the tree in behind a property-test oracle. A treap's pull-up augmentation is the smallest correct code for this; an AVL or red-black tree is an acceptable substitute if a deterministic structure is preferred for tests, at the cost of rotation bookkeeping.

### 6.2 Rejected Or Reference-Only Options

- Flat prefix-sum array (the current code). O(n) per rebuild. Correct and genuinely fine up to tens of thousands of blocks, but rebuilds on scroll today and cannot do O(log n) edits. Kept as the reference implementation behind the SPI and as the property-test oracle, not as the terminal structure.
- Fenwick / binary indexed tree. O(log n) update and prefix, O(log n) find-by-offset via binary lifting, but it is indexed by position, so a structural insert or delete shifts every later index and forces an O(n) rebuild. Unacceptable in an editor where edits are frequent. Rejected as terminal; it would only suit a read-only viewer.
- Segment tree (sum tree). Same edit weakness as Fenwick unless made fully balanced and rebalancing, at which point it is just a less ergonomic order-statistics tree with more memory. Rejected in favor of the treap.
- Skip list. Equivalent asymptotics and a viable alternative; rejected only because the treap's recursive pull-up augmentation is less code to verify for this specific `{size, measuredCount, measuredSum}` triple.
- Keep the estimate stored per leaf. Rejected: an estimate change would touch every unmeasured leaf, O(n). The estimate-split keeps it O(1).

### 6.3 Why O(log n) Is The Floor

The problem is dynamic partial sums with search (update a value, query a prefix sum, find the index where a cumulative sum crosses a target) under arbitrary insertions and deletions. There is a cell-probe lower bound of Omega(log n) per operation for dynamic partial sums (Patrascu and Demaine, 2004). The augmented tree meets this bound on all operations, so it is asymptotically optimal. Anything faster would be a constant-factor change only — a cache-aware or SIMD-friendly node layout — which buys a small multiple on an already sub-millisecond cost and is not worth the complexity. This is the terminal compute design, not a stepping stone.

## 7. Algorithms In Detail

### 7.1 Node Shape And Invariants

```ts
interface TreapNode {
  left: TreapNode | null;
  right: TreapNode | null;
  priority: number;        // random; treap heap order keeps it balanced in expectation
  measured: boolean;       // is THIS block measured?
  height: number;          // this block's measured height; valid iff measured
  size: number;            // subtree block count
  measuredCount: number;   // subtree count of measured blocks
  measuredSum: number;     // subtree sum of measured heights
}
```

Invariants, restored by pull-up after every structural change:

```
size          = 1 + sz(left) + sz(right)
measuredCount = (measured ? 1 : 0) + mc(left) + mc(right)
measuredSum   = (measured ? height : 0) + ms(left) + ms(right)
```

The estimate `E` is held on the model, never on a node. In-order index is implicit: a node's own index equals `sz(left)` within its subtree.

### 7.2 Pull-Up And Effective Height

```
sz(n)  = n ? n.size : 0
mc(n)  = n ? n.measuredCount : 0
ms(n)  = n ? n.measuredSum : 0

pullUp(n):
  n.size          = 1 + sz(n.left) + sz(n.right)
  n.measuredCount = (n.measured ? 1 : 0) + mc(n.left) + mc(n.right)
  n.measuredSum   = (n.measured ? n.height : 0) + ms(n.left) + ms(n.right)

// Effective pixel height of a whole subtree, estimate applied to unmeasured blocks.
effSubtree(n, E) = n ? (n.size - n.measuredCount) * E + n.measuredSum : 0

// Effective pixel height of a single block.
effSelf(n, E)    = n.measured ? n.height : E
```

`total()` is `effSubtree(root, E)`, O(1) because the root already holds the aggregates.

### 7.3 build, prefix, findIndex

```
build(count):                       // O(count), balanced by random priorities
  build a treap of `count` unmeasured nodes; pull-up bottom-up.

prefix(i):                          // top edge of block i = sum of effective heights of [0, i)
  acc = 0; node = root; idx = i
  while node:
    lsize = sz(node.left)
    if idx <= lsize:
      node = node.left
    else:
      acc += effSubtree(node.left, E)   // whole left subtree precedes i
      acc += effSelf(node, E)           // this block precedes i
      idx -= lsize + 1
      node = node.right
  return acc

findIndex(offset):                 // index of the block containing pixel `offset`
  node = root; idx = 0; rem = offset
  while node:
    leftEff = effSubtree(node.left, E)
    if rem < leftEff:
      node = node.left
    else:
      rem -= leftEff
      idx += sz(node.left)
      selfEff = effSelf(node, E)
      if rem < selfEff:
        return idx                      // pixel lands inside this block
      rem -= selfEff
      idx += 1
      node = node.right
  return clamp(idx, 0, count)           // past the last block
```

The controller maps `findIndex` outputs to `startIndex`/`endIndex` exactly as `lowerBound` does today (start gets `-overscan`, end gets `+overscan`, both clamped), so the window semantics are unchanged.

### 7.4 setHeight, insert, remove

```
setHeight(i, h):                   // descend by implicit index, set leaf, pull-up the path
  walk from root to the node at in-order index i (using sz(left) to steer),
  set node.measured = true; node.height = h,
  pull-up every node on the path back to the root.   // O(log n)

insert(i):                         // split at i, merge a fresh unmeasured node
  (L, R) = split(root, i)          // L holds indices [0, i), R holds [i, count)
  root = merge(merge(L, newUnmeasuredNode()), R)     // O(log n)

remove(i):                         // split out one node, merge the rest
  (L, MR) = split(root, i)
  (M, R)  = split(MR, 1)           // M is the single removed node
  root = merge(L, R)               // O(log n)
```

`split` and `merge` are the standard implicit-treap operations, with `pullUp` called on every node whose children change. Heights survive edits because the persistent `NodeId -> height` cache (today's `heightCacheRef`) remains the id-keyed source of truth; the tree is the position-keyed query index. On `insert`, if the new block's `NodeId` is already in the cache (a block moved rather than created), seed it with `setHeight` immediately after `insert`.

### 7.5 Complexity Table

| Operation | Flat array (today) | Augmented treap (target) |
| --- | --- | --- |
| build | O(n) | O(n) |
| total | O(1) (array tail) | O(1) (root aggregate) |
| prefix | O(1) after O(n) rebuild | O(log n), no rebuild |
| findIndex | O(log n) after O(n) rebuild | O(log n), no rebuild |
| setHeight (one block) | O(n) rebuild | O(log n) |
| insert / remove (edit) | O(n) rebuild | O(log n) |
| estimate change | O(n) rebuild | O(1) |
| per scroll frame | O(n) | O(log n) |
| per first-pass measure frame | O(n) | O(window log n) |

## 8. Implementation Strategy

Four phases, each independently shippable, reviewable, and testable. The SPI in Phase A is the contract that lets B, C, and D land without churning the controller surface. Per the project's SPI-first stance, the interface is locked and reviewed before any tree internals are written. Phases A and B fix the compute axis; C and D fix the perception axis. Behavior is preserved at every phase boundary: A is byte-for-byte identical output; B is verified identical against A by property tests; C and D change perceived stability and cost, not window-selection semantics.

## 9. Detailed Implementation Plan

### 9.1 Phase A: The Seam

Current problem: `calculateVirtualRange` rebuilds the whole prefix array per call and the controller rebuilds it on scroll (§3.3 items 1-2).

Target behavior: a stable `OffsetModel` SPI; `calculateVirtualRange` becomes an adapter over it; the first implementation is the existing flat array, producing identical output. Split the controller `useMemo` so the model build is keyed on `[order, measureVersion]` and the query (window range) is keyed on `[model, scrollTop, viewportHeight, overscan]`, dropping the per-scroll-frame rebuild.

Implementation tasks:

- [ ] Add `packages/editor/src/core/offset-model/index.ts` exporting the `OffsetModel` interface (§5.1).
- [ ] Add `packages/editor/src/core/offset-model/flat-offset-model.ts` implementing the interface with the current prefix-array logic (port `cumulativeOffsets`/`lowerBound`).
- [ ] Rewrite `calculateVirtualRange` ([virtual-range.ts](../packages/editor/src/core/virtual-range.ts)) to accept an `OffsetModel` and call `findIndex`/`prefix`/`total`; keep the `VirtualRange` return shape.
- [ ] In `use-virtual-window.ts`, build the model in a `useMemo` keyed on `[order, measureVersion]`; compute the window in a second `useMemo` keyed on `[model, scrollTop, viewportHeight, overscan]`.

Tests: `tests/editor/offset-model-flat.test.ts` (parity of `total`/`prefix`/`findIndex` against a brute-force oracle on random heights), plus existing virtualization tests must pass unchanged.

### 9.2 Phase B: The Tree

Current problem: every measurement and (future) edit is O(n) (§3.3 items 2-3).

Target behavior: a treap implementation of `OffsetModel` with O(log n) `setHeight`, `insert`, `remove`, `prefix`, `findIndex`, swapped in behind the SPI; structural edits call `insert`/`remove`.

Implementation tasks:

- [ ] Add `packages/editor/src/core/offset-model/treap-offset-model.ts` (§7).
- [ ] Wire structural edits (block insert/remove in `order`) to `model.insert`/`model.remove`; maintain a `NodeId -> index` map for `setHeight`, rebuilt or patched on order change.
- [ ] Swap the controller's model construction from flat to treap behind the SPI; flat stays as the test oracle.

Tests: `tests/editor/offset-model-treap.test.ts` — randomized differential test that applies the same op sequence (`setHeight`, `insert`, `remove`, `setEstimate`) to the flat and treap models and asserts identical `total`/`prefix(i)`/`findIndex(y)` for all `i` and sampled `y` after each op.

### 9.3 Phase C: Estimate And Anchoring

Current problem: the estimate is locked to the first frame and content jumps when corrections land (§3.3 items 4, 6).

Target behavior: the estimate floats toward `suggestedEstimate()`; anchoring keeps the visible block fixed across every geometry change.

Implementation tasks:

- [ ] Delete the estimate lock ([use-virtual-window.ts:126-129](../packages/editor/src/view/controllers/use-virtual-window.ts#L126-L129)); after each measurement batch, call `model.setEstimate(model.suggestedEstimate())`.
- [ ] Implement the anchor capture/restore (§5.4) around every recompute that changes geometry; write the corrected `scrollTop` to the scroller and to state in the same frame.
- [ ] Re-express the scroll-to-block settle loop as the `s = 0` case of anchoring; remove the bespoke six-frame re-assert once anchoring covers it, or keep the six-frame cap purely as a safety bound.

Tests: `tests/editor/anchoring.test.ts` — assert that after injecting a height correction above the viewport, the anchored block's `prefix(a) - scrollTop` is unchanged within 1px; assert the running estimate converges to the measured mean.

### 9.4 Phase D: Fling And Measurement

Current problem: synchronous `offsetHeight` reflow every frame and blank flash under fast fling (§3.3 item 5).

Target behavior: measurement via `ResizeObserver` off the scroll path; velocity-gated placeholder mount during fling; hydrate and measure on idle, with anchoring absorbing corrections.

Implementation tasks:

- [ ] Replace the `offsetHeight` loop ([use-virtual-window.ts:104-119](../packages/editor/src/view/controllers/use-virtual-window.ts#L104-L119)) with a `ResizeObserver` per mounted block that calls `model.setHeight` and schedules one coalesced recompute per frame.
- [ ] Track scroll velocity in the `onScroll` rAF; expose a `fling` boolean to the render layer.
- [ ] Gate decorator hydration on `!fling`; render placeholders sized to `model` effective height during fling; hydrate on idle (velocity below `V` for `K` frames).

Tests: Ladle fling benchmark (below) plus `tests/editor/fling-mount.test.ts` asserting no synchronous `offsetHeight` read occurs inside the scroll frame and that placeholders carry the model height during simulated high-velocity scroll.

## 10. Edge Cases And Failure Modes

- Empty document (`count === 0`): `total` is 0, `prefix`/`findIndex` return 0, window is empty. Preserve today's early return ([virtual-range.ts:18-26](../packages/editor/src/core/virtual-range.ts#L18-L26)).
- Zero or negative measured height: clamp to a 1px floor as the current code does (`Math.max(1, ...)` at [virtual-range.ts:50](../packages/editor/src/core/virtual-range.ts#L50)); never store a non-positive height in the tree.
- `findIndex(offset)` past the end (overscrolled): clamp to `count`; `beforeHeight`/`afterHeight` must stay non-negative.
- Estimate divides by zero before any measurement: `suggestedEstimate()` returns `DEFAULT_BLOCK_ESTIMATE` when `measuredCount === 0`.
- Edit storm (large paste, multi-block delete): apply `insert`/`remove` per structural step; if a single transaction reorders thousands of blocks, fall back to a full `build` from `order` + cache (one O(n) build is cheaper than thousands of O(log n) edits). Choose the fallback when changed-block count exceeds `count / log2(count)`.
- Anchor block unmounts mid-correction (the topmost visible block scrolls out as the correction lands): re-resolve the anchor to the new topmost visible block before restore; if none is resolvable, fall back to proportional `scrollTop` (preserve `scrollTop / total`).
- ResizeObserver loop warning: writing `scrollTop` from inside a resize callback can re-trigger layout. Debounce the recompute onto the existing rAF coalescer rather than reacting synchronously inside the observer.
- Fling that never settles (continuous flywheel spin): placeholders must remain correct geometry indefinitely; hydration simply waits for idle. No correctness dependency on settling.
- Treap degeneracy: random priorities keep depth O(log n) in expectation; seed the RNG deterministically in tests so the differential test is reproducible.

## 11. Implementation Backlog

### VG-A1. OffsetModel SPI And Flat Implementation

Scope:

- `packages/editor/src/core/offset-model/index.ts`
- `packages/editor/src/core/offset-model/flat-offset-model.ts`
- `packages/editor/src/core/virtual-range.ts`

Tasks:

- [ ] Define the `OffsetModel` interface (§5.1).
- [ ] Port the prefix-array logic into `FlatOffsetModel`.
- [ ] Make `calculateVirtualRange` an adapter over `OffsetModel`, preserving `VirtualRange`.

Acceptance criteria:

- Existing virtualization output is unchanged for fixed heights.
- `calculateVirtualRange` no longer constructs an array internally; it queries a model.

Tests:

- `pnpm test tests/editor/offset-model-flat.test.ts`

### VG-A2. Controller Memo Split

Scope:

- `packages/editor/src/view/controllers/use-virtual-window.ts`

Tasks:

- [ ] Build the model in a `useMemo` keyed on `[order, measureVersion]`.
- [ ] Compute the window in a `useMemo` keyed on `[model, scrollTop, viewportHeight, overscan]`.

Acceptance criteria:

- Scrolling a fully measured document performs no prefix rebuild (verified by a spy/counter in test).

Tests:

- `pnpm test tests/editor/virtual-window-memo.test.ts`

### VG-B1. Treap OffsetModel

Scope:

- `packages/editor/src/core/offset-model/treap-offset-model.ts`

Tasks:

- [ ] Implement node shape, pull-up, build, prefix, findIndex, setHeight, insert, remove, setEstimate, suggestedEstimate (§7).

Acceptance criteria:

- Differential test against `FlatOffsetModel` passes over randomized op sequences.

Tests:

- `pnpm test tests/editor/offset-model-treap.test.ts`

### VG-B2. Edit Wiring And Swap

Scope:

- `packages/editor/src/view/controllers/use-virtual-window.ts`
- `packages/editor/src/view/react-view.tsx`

Tasks:

- [ ] Drive `insert`/`remove` from structural edits; maintain the `NodeId -> index` map.
- [ ] Swap the controller to the treap model behind the SPI.
- [ ] Implement the edit-storm full-`build` fallback threshold (§10).

Acceptance criteria:

- Live editing a 100k-block document keeps typing latency within the `docs/008` budget; no O(n) per keystroke.

Tests:

- `pnpm test tests/editor/offset-model-edit.test.ts`

### VG-C1. Running Estimate

Scope:

- `packages/editor/src/view/controllers/use-virtual-window.ts`

Tasks:

- [ ] Remove the estimate lock; call `setEstimate(suggestedEstimate())` after each measure batch.

Acceptance criteria:

- After measuring a representative sample, the estimate equals the measured mean within rounding.

Tests:

- `pnpm test tests/editor/running-estimate.test.ts`

### VG-C2. Scroll Anchoring

Scope:

- `packages/editor/src/view/controllers/use-virtual-window.ts`

Tasks:

- [ ] Capture/restore the anchor around every geometry-changing recompute (§5.4).
- [ ] Fold the scroll-to-block settle loop into the anchoring path.

Acceptance criteria:

- A height correction above the viewport shifts the anchored block's screen position by <= 1px.

Tests:

- `pnpm test tests/editor/anchoring.test.ts`

### VG-D1. ResizeObserver Measurement

Scope:

- `packages/editor/src/view/controllers/use-virtual-window.ts`
- `packages/editor/src/view/react-view.tsx`

Tasks:

- [ ] Replace the synchronous `offsetHeight` loop with a `ResizeObserver` feeding `setHeight` and a coalesced recompute.

Acceptance criteria:

- No synchronous `offsetHeight` read occurs on the scroll frame (verified by test/instrumentation).

Tests:

- `pnpm test tests/editor/fling-mount.test.ts`

### VG-D2. Velocity-Gated Mount

Scope:

- `packages/editor/src/view/controllers/use-virtual-window.ts`
- `packages/editor/src/view/render/*` (placeholder rendering)

Tasks:

- [ ] Track velocity in the scroll rAF; expose `fling`.
- [ ] Render model-sized placeholders during fling; hydrate decorator bodies on idle.

Acceptance criteria:

- Sustained flywheel fling at 500k blocks holds frame budget with no blank gaps after idle.

Tests:

- Ladle fling benchmark (§13), `pnpm test tests/editor/fling-mount.test.ts`

## 12. Future Backlog

- Cache-aware or flat-array-backed tree node layout for constant-factor gains beyond 1M blocks. Not first-release; the O(log n) floor is already met.
- Persisted height hints from the bake/index worker (`docs/010` §7.5) to warm the estimate before first mount, shrinking first-pass correction magnitude.
- Per-block-type estimate buckets (heading vs paragraph vs object) for a tighter pre-measurement estimate than a single global mean.
- CSS `content-visibility: auto` experiment as an alternative to manual placeholder mounting, measured against the velocity-gate approach.

## 13. Test And Verification Plan

- Unit/differential: flat oracle vs treap over randomized `setHeight`/`insert`/`remove`/`setEstimate` sequences, asserting `total`, `prefix(i)` for all `i`, and `findIndex(y)` for sampled `y`. Deterministic RNG seed.
- Memo counters: instrument the model-build memo and assert zero rebuilds while scrolling fixed-height content.
- Anchoring: inject corrections above the viewport and assert <= 1px anchor drift; assert estimate convergence.
- Fling benchmark: reuse the decorator-virtualization Ladle harness (mind the scroller and `readyMs` gotchas noted in `docs/009`-era benchmark work) at 1k / 10k / 100k / 500k blocks scripted at flywheel velocity. Pass criteria fixed up front: no dropped frames during sustained fling, no blank gaps after idle, and content settle-jump <= 1px.
- Full gate: `pnpm check` (format, lint, duplicate gate, typecheck, test, build) must pass; the architecture lint must stay green since all new code is product-neutral and side-effect-free.

## 14. Definition Of Done

- `OffsetModel` SPI exists, is exported from the editor core barrel, and is the only geometry surface the controller depends on.
- The treap implementation passes the differential test and is the active implementation; the flat implementation remains as the oracle.
- Per-scroll-frame work is O(log n); first-pass and edits are O(log n) per changed block; estimate change is O(1).
- The estimate floats toward the measured mean and anchoring holds visible content within 1px across corrections, estimate changes, and edits.
- Measurement runs off the synchronous scroll path via `ResizeObserver`; fast fling renders placeholders and hydrates on idle with no blank gaps.
- The fling benchmark meets its fixed pass criteria at all four size classes.
- `pnpm check` is green; no architecture-lint or duplicate-gate regressions.
- This document is updated to `Status: implemented` with per-backlog notes as phases land.

## 15. Final Model

Geometry lives behind one SPI, `OffsetModel`, backed by an implicit augmented treap that answers total in O(1) and prefix, find-by-offset, measurement, and edit in O(log n) — the proven floor for dynamic partial sums. The estimate is a model scalar derived from the tree's root aggregates, so it floats toward the true mean for free; scroll-anchoring pins the visible block so a moving estimate never jumps content. Measurement is asynchronous via `ResizeObserver`, and fast flywheel scrolling renders cheap model-sized placeholders, hydrating real decorator bodies only when the scroll settles. The compute axis is optimal and the perception axis is stable, so every size class from a one-page note to a half-million-block book scrolls and edits the same way, with nothing deferred.
