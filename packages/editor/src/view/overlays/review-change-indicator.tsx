/**
 * The live in-editor **change indicator** (docs/036 §6.2.1, R6-I) — the human-edit review affordance.
 *
 * WHY THIS, AND NOT A WOVEN OVERLAY. The first R6-I draft built a panel of diff cards below the
 * editor; it was indistinguishable from the diff view (§6.1) and earned nothing the word *inline*
 * promises. The corrected split is by **who authored the change** (§6.2.1): a human editing their
 * own document already knows what they changed, so they do not need the full diff woven into the
 * surface — they need a lightweight signal of *which* blocks differ from a baseline, plus the diff
 * view on demand for the *what*. The genuinely woven overlay (proposed text decorated in place,
 * removals ghosted, accept/reject) is for **agent / proposal** changes you have *not* seen, and it
 * depends on the R6-J proposal model, so it rides R6-J. This module is the human half: a per-block
 * left-border marker.
 *
 * HOW IT AVOIDS TOUCHING THE RENDER PATH. The marker is not woven into any block's React render and
 * is not a separate absolutely-positioned rail with its own position bookkeeping (docs/036 resolved
 * question 3). It is a `data-*` attribute set on the block's *existing* DOM element (looked up by its
 * `data-engine-block-id`), styled by {@link REVIEW_INDICATOR_CSS} as an `::after` gutter bar sitting
 * in the surface's left inset, *outside* the block — so it leaves the prose untouched, adds **no
 * layout shift** (the block is already `position: relative`), and forces **no re-render**. React does
 * not manage this attribute, so it survives re-renders; a block that unmounts under virtualization
 * simply loses it, and a `MutationObserver` re-applies it when the block remounts.
 *
 * The pure core is {@link changedBlockIds} (which top-level ids differ, and their status), unit-
 * testable without a live editor; {@link applyReviewIndicators} is the DOM half; and
 * {@link useReviewChangeIndicator} wires them to a live store through the commit-coalesced
 * `useReviewSnapshot` hook. The detail surface stays the diff view — the indicator only flags where.
 *
 * @categoryDefault Diff View
 */
import { type RefObject, useEffect, useMemo } from "react";
import {
  diffSnapshots,
  type EditorDocumentSnapshot,
  type EditorStore,
} from "../../core";
import { useReviewSnapshot } from "../store-hooks";

/** The status of a block that differs from the baseline (a `removed` block has no live element). */
export type ReviewBlockStatus = "added" | "removed" | "moved" | "changed";

/** One block that differs from the baseline: its id and how it changed. */
export type ReviewChangedBlock = {
  readonly id: string;
  readonly status: ReviewBlockStatus;
};

/**
 * A surviving block that carries a *deletion* hint because a block was removed immediately
 * before/after it. A removed block has no live element of its own to mark (docs/036 §6.2.1), so the
 * hint rides its nearest surviving neighbor — a small red tick at the gap the deletion left.
 */
export type ReviewDeletionAnchor = {
  readonly id: string;
  readonly side: "before" | "after";
};

/** The DOM attribute the indicator sets on a changed block's element (styled by the CSS below). */
const REVIEW_ATTR = "data-engine-review-changed";
/** The DOM attributes flagging a block that a deletion sits immediately before / after. */
const REMOVED_BEFORE_ATTR = "data-engine-review-removed-before";
const REMOVED_AFTER_ATTR = "data-engine-review-removed-after";

/**
 * The top-level blocks that differ from the baseline, with their status (docs/036 §6.2.1) — the
 * pure input to the change indicator. Accepts any diff shape with `blocks[].id`/`.status` (the
 * engine's `SnapshotDiff` or the reader mirror), so it is trivially unit-testable. Only top-level
 * blocks are reported; a changed descendant bubbles up to its top-level container's status (§5.5).
 */
export function changedBlockIds(diff: {
  readonly blocks: readonly {
    readonly id: string;
    readonly status: string;
  }[];
}): ReviewChangedBlock[] {
  const out: ReviewChangedBlock[] = [];
  for (const block of diff.blocks) {
    if (block.status === "unchanged") continue;
    out.push({ id: block.id, status: block.status as ReviewBlockStatus });
  }
  return out;
}

/**
 * Where to hint at a deletion (docs/036 §6.2.1). A removed top-level block has no live element, so
 * the hint attaches to the surviving block that now sits at the gap: the block that FOLLOWS the run
 * of deletions (a "removed above" tick), or — when the deletion was at the very end — the block that
 * PRECEDES it (a "removed below" tick). Consecutive deletions collapse to one hint on the shared
 * neighbor. Reads the same ordered `blocks` shape as {@link changedBlockIds}, so it is pure/testable.
 */
export function deletionAnchors(diff: {
  readonly blocks: readonly {
    readonly id: string;
    readonly status: string;
  }[];
}): ReviewDeletionAnchor[] {
  const { blocks } = diff;
  const anchors: ReviewDeletionAnchor[] = [];
  const seen = new Set<string>();
  const add = (id: string, side: "before" | "after") => {
    const key = `${id}:${side}`;
    if (seen.has(key)) return;
    seen.add(key);
    anchors.push({ id, side });
  };
  blocks.forEach((block, i) => {
    if (block.status !== "removed") return;
    let after = i + 1;
    while (after < blocks.length && blocks[after]!.status === "removed")
      after += 1;
    if (after < blocks.length) {
      add(blocks[after]!.id, "before");
      return;
    }
    let before = i - 1;
    while (before >= 0 && blocks[before]!.status === "removed") before -= 1;
    if (before >= 0) add(blocks[before]!.id, "after");
  });
  return anchors;
}

/** Escape a node id for a CSS attribute selector (node ids are safe today; this keeps it robust). */
function escapeId(id: string): string {
  return id.replace(/["\\]/g, "\\$&");
}

/** The block id an element carries (the key both the decoration and its cleanup match on). */
function blockIdOf(element: Element): string | null {
  return element.getAttribute("data-engine-block-id");
}

/**
 * Decorate a live editor root's changed blocks (docs/036 §6.2.1). Sets `data-engine-review-changed`
 * on each present changed block's element (matched by its unique `data-engine-block-id`) and clears
 * it from any block no longer changed. A `removed` block has no live element, so instead of a marker
 * on it, its surviving neighbor (from {@link deletionAnchors}) gets a `removed-before`/`-after`
 * deletion tick — so a removal still leaves a trace in the live editor, not only in the diff view.
 * Idempotent; safe to call on every commit/remount.
 */
export function applyReviewIndicators(
  root: HTMLElement,
  changed: readonly ReviewChangedBlock[],
  deletions: readonly ReviewDeletionAnchor[] = [],
): void {
  const wanted = new Map(changed.map((block) => [block.id, block.status]));
  const wantBefore = new Set<string>();
  const wantAfter = new Set<string>();
  for (const anchor of deletions) {
    (anchor.side === "before" ? wantBefore : wantAfter).add(anchor.id);
  }
  // Clear stale markers: a status marker whose block is no longer changed (or is now `removed`), and
  // a deletion tick whose neighbor no longer has a deletion beside it.
  for (const element of root.querySelectorAll(`[${REVIEW_ATTR}]`)) {
    const id = blockIdOf(element);
    if (!id || !wanted.has(id) || wanted.get(id) === "removed") {
      element.removeAttribute(REVIEW_ATTR);
    }
  }
  for (const element of root.querySelectorAll(`[${REMOVED_BEFORE_ATTR}]`)) {
    const id = blockIdOf(element);
    if (!id || !wantBefore.has(id))
      element.removeAttribute(REMOVED_BEFORE_ATTR);
  }
  for (const element of root.querySelectorAll(`[${REMOVED_AFTER_ATTR}]`)) {
    const id = blockIdOf(element);
    if (!id || !wantAfter.has(id)) element.removeAttribute(REMOVED_AFTER_ATTR);
  }
  const find = (id: string) =>
    root.querySelector(`[data-engine-block-id="${escapeId(id)}"]`);
  for (const [id, status] of wanted) {
    if (status === "removed") continue; // no live element for a removed block
    const element = find(id);
    if (element instanceof HTMLElement)
      element.setAttribute(REVIEW_ATTR, status);
  }
  for (const id of wantBefore) {
    const element = find(id);
    if (element instanceof HTMLElement)
      element.setAttribute(REMOVED_BEFORE_ATTR, "");
  }
  for (const id of wantAfter) {
    const element = find(id);
    if (element instanceof HTMLElement)
      element.setAttribute(REMOVED_AFTER_ATTR, "");
  }
}

/**
 * Wire the change indicator to a live editor (docs/036 §6.2.1). Diffs the captured `baseline`
 * against the live document (via the commit-coalesced `useReviewSnapshot`) and decorates the
 * changed blocks under `rootRef` with a left border, re-applying on each commit and on block
 * remount (a `MutationObserver`, coalesced to a frame so a typing burst is one pass). Returns the
 * changed-block list so a host can show a count. `enabled: false` or a `null` baseline clears it.
 *
 * The host injects {@link REVIEW_INDICATOR_CSS} once (it is not a component, so it cannot inject
 * its own style), and passes a ref to the element wrapping the editor.
 */
export function useReviewChangeIndicator(options: {
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly store: EditorStore;
  readonly baseline: EditorDocumentSnapshot | null;
  readonly enabled?: boolean;
}): readonly ReviewChangedBlock[] {
  const { rootRef, store, baseline, enabled = true } = options;
  const current = useReviewSnapshot(store);
  const { changed, deletions } = useMemo(() => {
    if (!(enabled && baseline)) {
      return {
        changed: [] as ReviewChangedBlock[],
        deletions: [] as ReviewDeletionAnchor[],
      };
    }
    const diff = diffSnapshots(baseline, current);
    return { changed: changedBlockIds(diff), deletions: deletionAnchors(diff) };
  }, [enabled, baseline, current]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Re-apply on every mutation burst so a block that remounts under virtualization re-decorates;
    // coalesced to one frame (childList/subtree only, never `attributes`, so our own writes do not
    // re-trigger it — no loop). The commit-driven `changed` change re-runs this effect too, so the
    // non-virtualized case is covered without the observer ever firing.
    let raf = 0;
    const apply = () => {
      raf = 0;
      applyReviewIndicators(root, changed, deletions);
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(apply);
    };
    applyReviewIndicators(root, changed, deletions);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
      applyReviewIndicators(root, [], []);
    };
  }, [rootRef, changed, deletions]);
  return changed;
}

/**
 * The change-indicator stylesheet (docs/036 §6.2.1) — a **gutter bar OUTSIDE the block**, not a
 * border woven into it. The first cut drew a `box-shadow:inset` bar with rounded corners on the
 * block's own box: it overlapped the block's left edge (reading as "attached" to the content) and
 * its radius rounded the ends. This draws the bar as an `::after` positioned in the surface's left
 * inset (`SURFACE_PADDING` = 16px), 8px left of the block — so the prose stays untouched (no wash,
 * no inset, no radius) and the bar is a clean straight rail like a code editor's changed-line
 * marker. Same status palette as the diff view's cards. Tokens only. A host injects it once.
 *
 * One `::after` composes every case (a block can be `changed` AND have a deletion beside it at once,
 * a common pairing): three background gradient layers — a vertical **status bar** (color per
 * `data-engine-review-changed`) plus a short red horizontal **deletion tick** at the top / bottom
 * edge when `data-engine-review-removed-before` / `-after` is set. Each layer's color is a custom
 * property that defaults transparent, so unset layers simply do not paint and no per-combination rule
 * is needed. A `removed` block has no live element of its own, so the tick rides its surviving
 * neighbor, pointing at the gap the deletion left.
 *
 * The vertical bar is inset ~4px from the block's top and bottom so it **hugs the block's content**
 * rather than spanning its full box: the live surface gives block types uneven vertical space (text
 * blocks pad 5px, objects margin 4px, tables carry more), so a full-box bar touched some neighbors
 * and gapped others unpredictably. A content-hugging bar reads as one tidy marker per block whatever
 * the surrounding spacing. The deletion ticks stay at the true box edges (they mark the *gap*).
 *
 * Mechanics that make it safe: every editable block already carries `position: relative` (the base
 * block style — the list-marker `::before` anchors to it), so the `::after` anchors to the block
 * with no added style and thus no layout shift, and it does not perturb the model-derived overlays
 * (they position off viewport rects, not the block's offset parent). The marker uses `::after`
 * because a list item's marker already owns the block's `::before`; `pointer-events:none` keeps the
 * gutter click-through (a click there still lands on the block).
 */
export const REVIEW_INDICATOR_CSS = `
[data-engine-review-changed],[data-engine-review-removed-before],[data-engine-review-removed-after]{position:relative;}
[data-engine-review-changed]{--rev-bar:var(--color-info, #0ea5e9);}
[data-engine-review-changed="added"]{--rev-bar:var(--color-success, #16a34a);}
[data-engine-review-changed="moved"]{--rev-bar:var(--color-warning, #d97706);}
[data-engine-review-changed="changed"]{--rev-bar:var(--color-info, #0ea5e9);}
[data-engine-review-removed-before]{--rev-del-top:var(--color-error, #dc2626);}
[data-engine-review-removed-after]{--rev-del-bottom:var(--color-error, #dc2626);}
[data-engine-review-changed]::after,[data-engine-review-removed-before]::after,[data-engine-review-removed-after]::after{content:"";position:absolute;left:-9px;top:0;bottom:0;width:7px;pointer-events:none;background:linear-gradient(var(--rev-del-top, transparent),var(--rev-del-top, transparent)) 0 0/7px 3px no-repeat,linear-gradient(var(--rev-del-bottom, transparent),var(--rev-del-bottom, transparent)) 0 100%/7px 3px no-repeat,linear-gradient(var(--rev-bar, transparent),var(--rev-bar, transparent)) 0 4px/3px calc(100% - 8px) no-repeat;}
`;
