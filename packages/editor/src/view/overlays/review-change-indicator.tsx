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
import { diffStatusColor } from "@quanghuy1242/idco-reader";
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
 * Which marker carries a changed element (docs/038 §7–§9, R6-J J3). A `bar` is the left-inset gutter
 * bar — it aligns with the surface inset only for a *top-level* block and, sitting outside the prose
 * box, keeps a status hue with no content-color collision. A `ring` is an on-content two-tone
 * box-shadow for a *nested* element the inset bar cannot reach (a re-colored table cell, an object
 * whose field changed).
 */
export type ReviewMarkerKind = "bar" | "ring";

/**
 * One changed element at ANY depth (docs/038 §7): its id, how it changed, and which marker carries
 * it. The any-depth generalization of {@link ReviewChangedBlock} — the passive marker layer decorates
 * every changed element with one mechanism (a `data-*` on its `[data-engine-block-id]`), a gutter bar
 * on top-level blocks and a ring on nested elements.
 */
export type ReviewChangedElement = {
  readonly id: string;
  readonly status: ReviewBlockStatus;
  readonly marker: ReviewMarkerKind;
};

/** The DOM attribute the indicator sets on a changed block's element (styled by the CSS below). */
const REVIEW_ATTR = "data-engine-review-changed";
/** The DOM attribute set on a changed *nested* element — an on-content two-tone ring (docs/038 §8–§9). */
const RING_ATTR = "data-engine-review-ring";

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

/** The minimal recursive diff shape {@link changedElements} reads (the engine `SnapshotDiff` or the reader mirror). */
type ElementDiffNode = {
  readonly id: string;
  readonly status: string;
  /** A node-attribute change (a cell's fill, alignment, indent, heading level) on a matched node. */
  readonly attrs?: unknown;
  /** An object node's field-level change (code source/language, image alt) on a matched node. */
  readonly object?: unknown;
  /** The recursive child diffs of a structural container (present on a matched, surviving container). */
  readonly children?: readonly ElementDiffNode[];
};

/**
 * Every changed element at ANY depth, with the marker that carries it (docs/038 §7–§9, R6-J J3) — the
 * pure any-depth generalization of {@link changedBlockIds}. Walks the diff's merged spine recursively
 * and routes each change to a `bar` or a `ring` by WHERE it sits and WHAT it is:
 *
 * - A **top-level** non-unchanged block → `bar`. The left-inset gutter bar aligns with the surface
 *   inset only at the top level, and being outside the prose box it is content-color-collision-safe
 *   (docs/038 §9) — so the top level keeps R6-I's behavior exactly. (A top-level OBJECT thus takes the
 *   bar too, not the ring docs/038 §8 sketches for objects: the bar is a sound breadcrumb, and the
 *   object's ring + drill-in to a scoped diff is the T3 affordance that rides the review cursor, J4.)
 * - A **nested** element with a *direct element-level* change — a node-attribute change (`attrs`: a
 *   cell's fill, alignment, indent) or an object field change (`object`) → `ring`. These invisibles
 *   have no in-prose glyph to decorate and sit where the inset bar cannot reach, so an on-content
 *   two-tone ring carries them (docs/038 §8, "a re-colored table cell shows its ring").
 *
 * What a nested element deliberately does NOT get a ring for: a text-run edit (T1 woven track-changes
 * — its wash/strike rides the optimistic-apply plumbing in J6, and this includes the rare nested
 * block-*type* change with UNCHANGED text, e.g. a paragraph retyped as a heading with the same
 * characters, which the diff carries as an all-`keep` `.text` with no `.attrs`), a whole
 * `added`/`removed` element (green content / a `GhostBlock`), or a pure bubble-up container that is
 * only `changed` because a descendant changed (that descendant carries the ring). In every such case
 * the top-level ancestor's bar still breadcrumbs "something in here differs" and the diff view holds
 * the detail — the ring's meaning stays the single "an element's attr/object changed" shape (§9).
 */
export function changedElements(diff: {
  readonly blocks: readonly ElementDiffNode[];
}): ReviewChangedElement[] {
  const out: ReviewChangedElement[] = [];
  const walk = (blocks: readonly ElementDiffNode[], depth: number) => {
    for (const block of blocks) {
      if (block.status === "unchanged") continue;
      if (depth === 0) {
        // Top-level: the left-inset gutter bar (R6-I, docs/039 R-GI). A `removed` block gets a RED
        // bar on its inert `GhostBlock` (which now carries `data-engine-block-id`, docs/039 R-RO), so
        // the removal reads in the same one-bar language as every other change — no card, no tick.
        out.push({
          id: block.id,
          marker: "bar",
          status: block.status as ReviewBlockStatus,
        });
      } else if (block.attrs || block.object) {
        // `attrs`/`object`, when present, are always non-empty diff objects (truthy); absent ⇒ undefined.
        // Nested + a direct element-level (attr / object) change → an on-content two-tone ring.
        out.push({
          id: block.id,
          marker: "ring",
          status: block.status as ReviewBlockStatus,
        });
      }
      // Recurse only into a matched container that survived (changed/moved) so we reach its changed
      // descendants; an added/removed container renders whole (docs/036 §6.3) — its one-sided
      // descendants are not marked individually — and an unchanged container omits `children`.
      if (
        block.children &&
        (block.status === "changed" || block.status === "moved")
      ) {
        walk(block.children, depth + 1);
      }
    }
  };
  walk(diff.blocks, 0);
  return out;
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
 * Decorate a live editor root's changed elements at any depth (docs/036 §6.2.1, docs/038 §7–§9).
 * Each wanted element (matched by its unique `data-engine-block-id`) gets the attribute its marker
 * names — `data-engine-review-changed` for a top-level gutter `bar`, `data-engine-review-ring` for a
 * nested on-content `ring` — and any element no longer wanted (or now `removed`, which has no live
 * element) is cleared. A `removed` block has no live element, so instead of a marker on it, its
 * surviving neighbor (from {@link deletionAnchors}) gets a `removed-before`/`-after` deletion tick, so
 * a removal still leaves a trace in the live editor. Accepts plain {@link ReviewChangedBlock}s too (no
 * `marker` ⇒ a `bar`, back-compat with {@link changedBlockIds} callers). Idempotent; safe on every
 * commit/remount.
 */
export function applyReviewIndicators(
  root: HTMLElement,
  changed: readonly (ReviewChangedBlock | ReviewChangedElement)[],
): void {
  // Partition by carrier: a `bar` sets the gutter attr, a `ring` sets the on-content ring attr. An
  // element with no `marker` field is a bar (a `ReviewChangedBlock` from `changedBlockIds`).
  const wantBar = new Map<string, string>();
  const wantRing = new Map<string, string>();
  for (const el of changed) {
    const ring = "marker" in el && el.marker === "ring";
    (ring ? wantRing : wantBar).set(el.id, el.status);
  }
  // Clear a marker whose element is no longer wanted. A `removed` block now HAS a live element — its
  // inert `GhostBlock` (docs/039 R-RO) carries `data-engine-block-id`, so it is decorated with a red
  // gutter bar like any other block. The vestigial deletion tick on a surviving neighbor is gone
  // (docs/039 D8): the rendered ghost with its own bar IS the removal's signal.
  const clearStale = (attr: string, want: Map<string, string>) => {
    for (const element of root.querySelectorAll(`[${attr}]`)) {
      const id = blockIdOf(element);
      if (!id || !want.has(id)) element.removeAttribute(attr);
    }
  };
  clearStale(REVIEW_ATTR, wantBar);
  clearStale(RING_ATTR, wantRing);
  const find = (id: string) =>
    root.querySelector(`[data-engine-block-id="${escapeId(id)}"]`);
  const setStatus = (want: Map<string, string>, attr: string) => {
    for (const [id, status] of want) {
      const element = find(id);
      if (element instanceof HTMLElement) element.setAttribute(attr, status);
    }
  };
  setStatus(wantBar, REVIEW_ATTR);
  setStatus(wantRing, RING_ATTR);
}

/**
 * Wire the change indicator to a live editor (docs/036 §6.2.1, docs/038 §7–§9). Diffs the captured
 * `baseline` against the live document (via the commit-coalesced `useReviewSnapshot`) and decorates
 * the changed elements under `rootRef` at ANY depth — a gutter bar on each changed top-level block, a
 * two-tone ring on each nested element whose attr/object changed (a re-colored cell, an object field)
 * — re-applying on each commit and on block remount (a `MutationObserver`, coalesced to a frame so a
 * typing burst is one pass). Returns the *top-level* changed-block list so a host can show a block
 * count (nested rings are applied to the DOM but not counted here). `enabled: false` or a `null`
 * baseline clears it.
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
  const { changed, elements } = useMemo(() => {
    if (!(enabled && baseline)) {
      return {
        changed: [] as ReviewChangedBlock[],
        elements: [] as ReviewChangedElement[],
      };
    }
    // One diff, two projections: `changed` (top-level, the returned count) and `elements` (any-depth,
    // the DOM markers — bars incl. the red bar on a removed block's ghost, rings on nested elements).
    const diff = diffSnapshots(baseline, current);
    return {
      changed: changedBlockIds(diff),
      elements: changedElements(diff),
    };
  }, [enabled, baseline, current]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Re-apply on every mutation burst so a block (or a ghost) that remounts under virtualization
    // re-decorates; coalesced to one frame (childList/subtree only, never `attributes`, so our own
    // writes do not re-trigger it — no loop). The commit-driven `elements` change re-runs this effect
    // too, so the non-virtualized case is covered without the observer ever firing.
    let raf = 0;
    const apply = () => {
      raf = 0;
      applyReviewIndicators(root, elements);
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(apply);
    };
    applyReviewIndicators(root, elements);
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (raf !== 0) cancelAnimationFrame(raf);
      applyReviewIndicators(root, []);
    };
  }, [rootRef, elements]);
  return changed;
}

/**
 * The change-indicator stylesheet (docs/036 §6.2.1, docs/038 §8–§9) — two zero-reflow marker
 * primitives: a **gutter bar OUTSIDE a top-level block** and an on-content **two-tone ring on a
 * nested element**. It began as one gutter bar; J3 added the ring so the passive layer reaches any
 * depth. Both obey the hard rule (docs/038 §8): a marker may only use mechanisms that do NOT touch
 * the live box model — here `::after` gradients (the bar/ticks) and `box-shadow` (the ring) — so the
 * prose never reflows.
 *
 * THE COLOR SYSTEM (docs/038 §9): status is carried by SHAPE, not by color, because in a live
 * document content can be any color and a status-by-color scheme would collide with content-by-color.
 * LOCATION then decides whether a hue is safe. The gutter bar sits in the left inset, OUTSIDE the
 * prose box, so it safely keeps a status hue (info/success/warning). An element **ring sits ON
 * content**, so a single-color ring would vanish when its hue matched the element's fill (a teal ring
 * on a teal cell); the ring is therefore a **two-tone box-shadow** — a dark inner edge, a status-hued
 * band, and a light outer edge — which keeps a luminance-contrasting edge on ANY background, the same
 * "one visible ring on any surface" property the `focusRing` token (`@idco/ui` `focus-ring.ts`) was
 * built for. (`@idco/editor` cannot import the token — it is a Tailwind class string, and the token
 * only paints on `:focus-visible`; this is the always-on review equivalent, expressed as raw CSS the
 * host injects.) Author identity is never an in-prose marker: under single-proposal review the author
 * is constant, so it lives in the floating chip (docs/038 §9, the chip is J4).
 *
 * The first cut drew a `box-shadow:inset` bar with rounded corners on the
 * block's own box: it overlapped the block's left edge (reading as "attached" to the content) and
 * its radius rounded the ends. This draws the bar as an `::after` positioned in the surface's left
 * inset (`SURFACE_PADDING` = 16px), 8px left of the block — so the prose stays untouched (no wash,
 * no inset, no radius) and the bar is a clean straight rail like a code editor's changed-line
 * marker. Same status palette as the diff view's cards. Tokens only. A host injects it once.
 *
 * ONE status bar per block (docs/039 R-GI, D8): a vertical `::after` in the left inset, colored per
 * `data-engine-review-changed` — info (changed), success (added), warning (moved), and ERROR (removed).
 * A removed block now renders as an inert `GhostBlock` that carries `data-engine-block-id`, so its bar
 * paints on the ghost itself (docs/039 R-RO); the vestigial deletion tick that rode a surviving neighbor
 * (from the pre-ghost R6-I era) is gone. The T1 run classes (`data-engine-review-op="insert"` wash +
 * underline, `data-engine-ghost-run` struck read-only) style the woven text track-changes (docs/039
 * R-T1) from this same host-injected sheet.
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
 *
 * The **ring** deliberately uses TWO channels — an `outline` AND an *inset* `box-shadow` — because
 * the two kinds of element that get a ring have OPPOSITE constraints, learned the hard way from two
 * adversarial passes:
 *   - A nested TEXT block (a re-aligned paragraph inside a callout) carries `blockStyle`, which sets
 *     inline `outline:none` (`styles.ts`) — an inline style beats a stylesheet rule, so an
 *     outline-only ring is DEAD on it. But nothing paints its `box-shadow`, so the inset box-shadow
 *     shows.
 *   - A nested OBJECT (an image/code block whose field changed) is painted by `ENGINE_OBJECT_CHROME_CSS`
 *     with a `box-shadow` hover/live ring at HIGHER specificity (`[data-engine-view-root] […]:hover`);
 *     `box-shadow` is a single property, so that chrome REPLACES a box-shadow ring on hover/live —
 *     the review ring would vanish exactly when you inspect it. But the chrome never sets `outline`,
 *     so the outline ring survives.
 *   - A `<td>` cell in a `border-collapse` table has neither, but an *outset* box-shadow there is
 *     painted over by the adjacent cell (J3's first screenshot shipped an invisible cell ring). An
 *     *inset* box-shadow is drawn inside the cell's own paint area, so no sibling occludes it.
 * `outline` and `box-shadow` are independent properties that COMPOSE (neither replaces the other), so
 * carrying both means at least one channel always paints: the outline for objects, the inset
 * box-shadow for text blocks and cells, and both together on a cell for maximum legibility. The inset
 * box-shadow's two layers (a dark edge, then a light inner line) plus the status-hued outline give the
 * two-tone luminance contrast that keeps the ring visible on ANY background — a status-hued cell fill,
 * a dark theme, a white page — the "one visible ring on any surface" property. `outline-offset` is
 * negative so the outline hugs just inside the element edge (never overlapping a neighbor cell), and
 * `color-mix` derives the edges from one `--rev-ring` token, the same `color-mix(in oklab, …)` the
 * ghost already relies on.
 */
export const REVIEW_INDICATOR_CSS = `
[data-engine-review-changed]{position:relative;--rev-bar:${diffStatusColor("changed")};}
[data-engine-review-changed="added"]{--rev-bar:${diffStatusColor("added")};}
[data-engine-review-changed="moved"]{--rev-bar:${diffStatusColor("moved")};}
[data-engine-review-changed="changed"]{--rev-bar:${diffStatusColor("changed")};}
[data-engine-review-changed="removed"]{--rev-bar:${diffStatusColor("removed")};}
[data-engine-review-changed]::after{content:"";position:absolute;left:-9px;top:4px;bottom:4px;width:3px;pointer-events:none;background:var(--rev-bar);border-radius:1px;}
[data-engine-review-active]{box-shadow:0 0 0 2px color-mix(in oklab, var(--rev-bar), transparent 62%);border-radius:3px;}
[data-engine-review-active]::after{width:5px;left:-10px;}
[data-engine-review-ring]{--rev-ring:${diffStatusColor("changed")};cursor:pointer;outline:2px solid var(--rev-ring);outline-offset:-1px;box-shadow:inset 0 0 0 1px color-mix(in oklab, var(--rev-ring), #000 40%),inset 0 0 0 3px color-mix(in oklab, var(--rev-ring), #fff 55%);}
[data-engine-review-ring="moved"]{--rev-ring:${diffStatusColor("moved")};}
[data-engine-review-op="insert"]{text-decoration:underline;text-decoration-color:${diffStatusColor("added")};text-decoration-thickness:2px;text-underline-offset:2px;background:color-mix(in oklab, ${diffStatusColor("added")} 12%, transparent);border-radius:2px;}
[data-engine-review-op="mark"]{text-decoration-line:underline;text-decoration-style:dotted;text-decoration-color:${diffStatusColor("changed")};text-underline-offset:3px;}
[data-engine-ghost-run]{text-decoration:line-through;text-decoration-color:color-mix(in oklab, ${diffStatusColor("removed")} 60%, currentColor);color:color-mix(in oklab, var(--color-base-content, currentColor) 55%, transparent);user-select:none;pointer-events:none;}
`;
