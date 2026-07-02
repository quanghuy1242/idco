/**
 * `useReviewCursor` — the review cursor (docs/038 §7, docs/036 §9 R6-J J4).
 *
 * The active review surface (§7) is exactly ONE control at a time, on the change under a *cursor*.
 * This module is that cursor's headless controller: the ordered list of a proposal's/edit's changed
 * top-level blocks (the same "where" the passive marker layer flags, R6-I `changedBlockIds`), a
 * current index, and next/prev/goTo navigation that reveals the change (scroll-to-block). The visual
 * control that rides it is `ReviewCursorSurface`; the accept/reject that acts on the cursor's block is
 * the affordance the surface carries (§16). Keeping the navigation headless makes it unit-testable
 * without a live editor and lets a host drive it from a keyboard shortcut or a Changes-pane row.
 *
 * WHY TOP-LEVEL ENTRIES (not every changed element): the cursor is a *location* stepper — one stop
 * per changed block, matching the gutter-bar stops (§8). A nested change (a re-colored cell, ringed by
 * J3) is reached by stepping to its top-level block and is summarized in that block's detail; the
 * cursor does not stop on every nested ring, which would make "next change" walk dozens of cells in
 * one table. This mirrors `changedBlockIds` (top-level), the natural navigation granularity.
 *
 * WHY A STANDALONE CONTROLLER (not the overlay authority): the docs sketch (§4/§7) named the L3
 * affordance "the single overlay-authority surface". In this codebase the authority is INTERNAL editor
 * chrome (mounted by `owned-model-editor.tsx`, driven by selection/commit) and is not reachable by the
 * OPT-IN review layer — every shipped review piece (the R6-I indicator, J2/J3's `useReviewModel` +
 * markers) is a consumer-wired hook/component, and the shipped single-anchored affordance precedent is
 * `comment-affordance.tsx` (a plain positioned control, NOT an authority contributor). A single cursor
 * also makes "exactly one active surface" true BY CONSTRUCTION — the authority's one-winner arbitration
 * earns nothing here. So the review cursor is a headless hook + a standalone anchored surface, matching
 * the opt-in review architecture; the authority's coexistence/co-slot value returns only when in-review
 * text editing can raise the selection flyout beside the surface, which is J6 (editing-during-review).
 *
 * @categoryDefault Inline Review
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockDiff, NodeId, SnapshotDiff } from "../core";
import type { ReviewBlockStatus } from "./overlays";

/**
 * The review cursor exports (docs/038 §7). This standalone block is the api-map module header (the
 * file header above precedes elided value imports and is dropped from the emitted `.d.ts`), matching
 * the `review-model.ts` / `store-hooks.ts` convention.
 *
 * @categoryDefault Inline Review
 */

/** One stop on the review cursor: a changed top-level block, its status, and a one-line human summary. */
export type ReviewCursorEntry = {
  readonly id: NodeId;
  readonly status: ReviewBlockStatus;
  /** A short human summary of the change ("2 words inserted, 1 deleted", "Block added"), from {@link reviewEntryDetail}. */
  readonly detail: string;
  /**
   * The block to scroll to and anchor the surface on. For a present change it is `id`. For a
   * `removed` change it is the SURVIVING NEIGHBOR just ABOVE the gap ({@link survivingNeighbor}),
   * because the removed block is absent from the live document — `store.order` has no entry for it, so
   * the editor's `scrollToBlock(id)` is a no-op and the ghost (rendered in place, but virtualized out
   * when off screen) can never be revealed by its own id. Revealing the block above the gap scrolls it
   * to the viewport top, leaving the removed ghost visible just below it. A LEADING removal with no
   * block above falls back to the following survivor — whose top pins to the viewport, so that ghost
   * lands just ABOVE the top edge (clipped until the reviewer scrolls up a row); revealing the ghost's
   * own top would need the review-order-aware reveal seam below. It falls back to `id` only for an
   * ALL-removed document with no survivor at all — where the reveal cannot scroll (same seam); the
   * surface still anchors once the ghost is scrolled into view manually.
   */
  readonly revealId: NodeId;
};

/** The review cursor handle returned by {@link useReviewCursor}. */
export type ReviewCursor = {
  /** The changed top-level blocks, in document (merged-spine) order. */
  readonly entries: readonly ReviewCursorEntry[];
  /** The current stop index, or -1 when there are no changes. */
  readonly index: number;
  /** The current entry, or null when there are no changes. */
  readonly current: ReviewCursorEntry | null;
  /** Total number of stops (`entries.length`). */
  readonly count: number;
  /** Step to the next change (wraps to the first), revealing it. No-op when empty. */
  next(): void;
  /** Step to the previous change (wraps to the last), revealing it. No-op when empty. */
  prev(): void;
  /** Jump to a specific block's stop by id, revealing it; no-op if the id is not a changed block. */
  goTo(id: NodeId): void;
};

/** Sum the character length of a text-leaf diff's runs for one op kind. */
function textLen(block: BlockDiff, op: "insert" | "delete"): number {
  if (!block.text) return 0;
  let n = 0;
  for (const run of block.text.runs) if (run.op === op) n += run.text.length;
  return n;
}

/** Pluralize a count with its noun ("1 character", "3 characters"). */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * A short, human summary of one block's change (docs/038 §6 T1/T2 detail, condensed to a line) — pure,
 * so it is unit-testable and reusable by the Changes pane (J5). It names the SHAPE of the change the
 * cursor lands on, not the full diff (that is the drill-in, §6 T3): a whole add/remove/move, the
 * inserted/deleted character counts of a text edit, a formatting (attr) change, an object-field change,
 * or the count of nested changes in a container. Falls back to "Changed" for a shape it cannot name.
 */
export function reviewEntryDetail(block: BlockDiff): string {
  if (block.status === "added") return "Block added";
  if (block.status === "removed") return "Block removed";

  const parts: string[] = [];
  if (block.status === "moved") parts.push("Moved");

  const inserted = textLen(block, "insert");
  const deleted = textLen(block, "delete");
  if (inserted > 0 && deleted > 0) {
    parts.push(`${count(inserted, "character")} in, ${deleted} out`);
  } else if (inserted > 0) {
    parts.push(`${count(inserted, "character")} inserted`);
  } else if (deleted > 0) {
    parts.push(`${count(deleted, "character")} deleted`);
  }
  // A mark added/removed with no character change (bold toggled, a link dropped) reads as formatting.
  if (
    block.text &&
    inserted === 0 &&
    deleted === 0 &&
    block.text.markChanges.length > 0
  ) {
    parts.push("Formatting changed");
  }
  if (block.attrs) parts.push("Formatting changed");
  if (block.object) {
    const fields = block.object.fields?.length ?? 0;
    parts.push(
      fields > 0 ? count(fields, "field") + " changed" : "Content changed",
    );
  }
  if (block.children) {
    const nested = block.children.filter(
      (c) => c.status !== "unchanged",
    ).length;
    if (nested > 0) parts.push(count(nested, "nested change"));
  }

  // De-duplicate (attrs + a mark change both say "Formatting changed") preserving order.
  const seen = new Set<string>();
  const unique = parts.filter((p) => (seen.has(p) ? false : seen.add(p)));
  return unique.length > 0 ? unique.join(", ") : "Changed";
}

/**
 * The ordered cursor stops for a diff (docs/038 §7) — the changed TOP-LEVEL blocks in merged-spine
 * order, each with its status and a one-line detail. Pure, so it is unit-testable and drives both the
 * cursor and a host's "N changes" count. A `null` diff yields no entries.
 */
export function reviewCursorEntries(
  diff: SnapshotDiff | null,
): ReviewCursorEntry[] {
  if (!diff) return [];
  const blocks = diff.blocks;
  const out: ReviewCursorEntry[] = [];
  blocks.forEach((block, i) => {
    if (block.status === "unchanged") return;
    out.push({
      detail: reviewEntryDetail(block),
      id: block.id,
      revealId:
        block.status === "removed"
          ? (survivingNeighbor(blocks, i) ?? block.id)
          : block.id,
      status: block.status as ReviewBlockStatus,
    });
  });
  return out;
}

/**
 * The surviving (non-`removed`) top-level block nearest a removed one in merged-spine order, used to
 * reveal the deletion by scroll. Prefers the block that PRECEDES the removal, falling back to the one
 * that FOLLOWS. The preference is deliberate and is what keeps the removed ghost ON SCREEN: the ghost
 * renders in place BELOW its preceding survivor and ABOVE its following one, and `scrollToBlock` scrolls
 * the target to the viewport TOP — so revealing the PRECEDING survivor puts the ghost just below the top
 * (visible), whereas revealing the following one would push the ghost off the top. (This is the reverse
 * of the R6-I gutter-tick deletion anchor, which prefers the following block because a tick has no
 * scroll.) For a run of consecutive removals it lands on the survivor just above the run, so the whole
 * struck region reads downward from the top. Null only when EVERY top-level block was removed — then the
 * caller falls back to the removed id, which cannot be scrolled to (see {@link ReviewCursorEntry}).
 */
function survivingNeighbor(
  blocks: readonly BlockDiff[],
  i: number,
): NodeId | null {
  for (let j = i - 1; j >= 0; j -= 1)
    if (blocks[j]!.status !== "removed") return blocks[j]!.id;
  for (let j = i + 1; j < blocks.length; j += 1)
    if (blocks[j]!.status !== "removed") return blocks[j]!.id;
  return null;
}

/** Options for {@link useReviewCursor}. */
export type ReviewCursorOptions = {
  /** Reveal a block when the cursor lands on it — wire to the editor's `scrollToBlock` (docs/038 §7). */
  readonly onReveal?: (id: NodeId) => void;
};

/**
 * Drive a review cursor over a diff (docs/038 §7, R6-J J4). Recomputes the ordered stops when the diff
 * changes and keeps the cursor pointing at the SAME block across a re-diff when it survives (so
 * resolving one change advances sanely instead of jumping to index 0); clamps into range otherwise.
 * `next`/`prev` wrap and reveal; `goTo(id)` jumps to a changed block and reveals it. Revealing is the
 * host's `onReveal` (the editor's `scrollToBlock`), so an off-screen change scrolls into view.
 *
 * Headless: no DOM, no surface. `ReviewCursorSurface` renders the control that rides this handle.
 */
export function useReviewCursor(
  diff: SnapshotDiff | null,
  options: ReviewCursorOptions = {},
): ReviewCursor {
  const { onReveal } = options;
  const entries = useMemo(() => reviewCursorEntries(diff), [diff]);
  const [index, setIndex] = useState(0);

  // Keep the cursor on the same block across a re-diff (a resolved change drops out): remember the
  // current id and re-find it; if it is gone, clamp the old index into the new range. This is why the
  // index is reconciled in an effect against the previous id, not just clamped to length.
  const currentIdRef = useRef<NodeId | null>(entries[0]?.id ?? null);
  useEffect(() => {
    if (entries.length === 0) {
      currentIdRef.current = null;
      setIndex(0);
      return;
    }
    const prevId = currentIdRef.current;
    const foundAt = prevId ? entries.findIndex((e) => e.id === prevId) : -1;
    const nextIndex =
      foundAt >= 0 ? foundAt : Math.min(index, entries.length - 1);
    currentIdRef.current = entries[nextIndex]?.id ?? null;
    if (nextIndex !== index) setIndex(nextIndex);
  }, [entries, index]);

  const land = useCallback(
    (nextIndex: number) => {
      if (entries.length === 0) return;
      const clamped =
        ((nextIndex % entries.length) + entries.length) % entries.length;
      currentIdRef.current = entries[clamped]?.id ?? null;
      setIndex(clamped);
      // Reveal the entry's `revealId`, not its `id`: a removed change reveals its surviving neighbor
      // (a removed block is absent from `store.order`, so scrolling to its own id is a no-op).
      const revealId = entries[clamped]?.revealId;
      if (revealId) onReveal?.(revealId);
    },
    [entries, onReveal],
  );

  const next = useCallback(() => land(index + 1), [land, index]);
  const prev = useCallback(() => land(index - 1), [land, index]);
  const goTo = useCallback(
    (id: NodeId) => {
      const at = entries.findIndex((e) => e.id === id);
      if (at >= 0) land(at);
    },
    [entries, land],
  );

  const safeIndex =
    entries.length === 0 ? -1 : Math.min(index, entries.length - 1);
  return {
    count: entries.length,
    current: safeIndex >= 0 ? (entries[safeIndex] ?? null) : null,
    entries,
    goTo,
    index: safeIndex,
    next,
    prev,
  };
}
