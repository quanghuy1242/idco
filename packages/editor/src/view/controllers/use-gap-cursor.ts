/**
 * Gap-cursor + root-pointer/key controller (docs/019, docs/020 §4.3 R3).
 *
 * Owns the body-level gap cursor (docs/019 §4.9): hit-testing inter-block gaps,
 * materializing a paragraph at a gap, gap navigation/deletion/dismiss, the root
 * key handler for a gap selection, and the root mousedown that maps a click in
 * empty space to a gap or the nearest text caret. Lifted verbatim from
 * `react-view.tsx`.
 */
import { useCallback } from "react";
import type React from "react";
import {
  childrenOf,
  makeTextNode,
  pointAtOffset,
  type EditorSelection,
  type EditorStore,
  type GapSelection,
  type NodeId,
  type TextPoint,
} from "../../core";
import { clampOffset, resolveTextPointAt } from "../overlays";
import { gapAtY, gapCandidates, type RectLike } from "../overlays";
import { selectionForGapNavigation } from "../overlays";
import { GAP_NAV_KEYS } from "./constants";
import type { ViewRefs } from "./refs";

export type GapCursorController = {
  readonly onRootKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly onRootMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
};

export function useGapCursor(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly focusBlock: (id: NodeId) => boolean;
  readonly focusRoot: () => void;
  readonly syncFocusToSelection: () => void;
  readonly beginDrag: (anchor: TextPoint) => void;
}): GapCursorController {
  const {
    refs,
    store,
    focusBlock,
    focusRoot,
    syncFocusToSelection,
    beginDrag,
  } = args;
  const { rootRef, registryRef } = refs;

  // Hit-test a pointer against a scope's inter-block gaps; returns a gap
  // selection only when the slot is adjacent to an atom (an object) or a
  // structural container (a callout) — the position a text caret cannot occupy,
  // since a caret there would land *inside* the container or its sibling, never
  // between them (docs/019 §4.9/§5.8). Elsewhere the caller falls back to the
  // nearest-text-leaf caret. The scope is the body for a click in empty space,
  // or a structural container (a table cell) for a click in its own box — so a
  // click beside an in-cell object places the gap cursor there, not only in the
  // body. `scopeEl` supplies the scope's content box for the edge slots.
  const gapAtPointer = useCallback(
    (
      clientX: number,
      clientY: number,
      scope: NodeId,
      scopeEl: HTMLElement,
    ): GapSelection | null => {
      void clientX;
      const children = childrenOf(store, scope);
      const rects: RectLike[] = [];
      const atomicFlags: boolean[] = [];
      const childIndex: number[] = [];
      for (let i = 0; i < children.length; i += 1) {
        const element = registryRef.current.blockRefs.get(children[i]!);
        if (!element) continue;
        const r = element.getBoundingClientRect();
        rects.push({
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          top: r.top,
        });
        const kind = store.getNode(children[i]!)?.kind;
        atomicFlags.push(kind === "object" || kind === "structural");
        childIndex.push(i);
      }
      if (rects.length === 0) return null;
      const scopeRect = scopeEl.getBoundingClientRect();
      const hit = gapAtY(
        gapCandidates({
          atomicFlags,
          rects,
          scopeBottom: scopeRect.bottom,
          scopeTop: scopeRect.top,
        }),
        clientY,
      );
      if (!hit || !hit.atomic) return null;
      const index =
        hit.index < rects.length
          ? childIndex[hit.index]!
          : childIndex[rects.length - 1]! + 1;
      return { index, scope, type: "gap" };
    },
    [store, registryRef],
  );

  // Insert a real paragraph at the gap and land a text caret in it (docs/019
  // §4.9 materialize). The pending gap is the live selection, so `insert-blocks`
  // resolves to it (identity) and the typed first character seeds the new leaf.
  const materializeGap = useCallback(
    (initial: string) => {
      const paragraph = makeTextNode({
        content: store.allocator.createTextSlice(initial),
        id: store.allocator.createNodeId(),
        type: "paragraph",
      });
      store.command({ nodes: [paragraph], type: "insert-blocks" });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  // Apply a gap-navigation result: a text caret focuses its leaf; a still-gap
  // result keeps the root focused so the next arrow continues the walk.
  const applyGapMove = useCallback(
    (next: EditorSelection) => {
      store.dispatch({ origin: "local", selectionAfter: next, steps: [] });
      if (next.type === "text") syncFocusToSelection();
      else focusRoot();
    },
    [focusRoot, store, syncFocusToSelection],
  );

  // Delete the block flanking a gap (docs/019 §4.12.6): an atom (divider/image),
  // or an empty placeholder paragraph — the "remove this block from here"
  // gesture. A non-empty text/container neighbour is left to ordinary editing.
  const deleteAtGap = useCallback(
    (selection: GapSelection, direction: -1 | 1) => {
      const children = childrenOf(store, selection.scope);
      const targetIndex = direction < 0 ? selection.index - 1 : selection.index;
      const targetId = children[targetIndex];
      const target = targetId ? store.getNode(targetId) : undefined;
      const removable =
        target?.kind === "object" ||
        (target?.kind === "text" &&
          target.type === "paragraph" &&
          target.content.text.length === 0);
      if (!targetId || !removable) return;
      store.command({ node: targetId, type: "remove-block" });
      // Backspace removes the block before the gap, so the gap slides down one;
      // Delete removes the block after it, so the index is unchanged.
      const nextIndex = direction < 0 ? selection.index - 1 : selection.index;
      store.dispatch({
        origin: "local",
        selectionAfter: {
          index: Math.max(0, nextIndex),
          scope: selection.scope,
          type: "gap",
        },
        steps: [],
      });
      focusRoot();
    },
    [focusRoot, store],
  );

  // Escape leaves the gap for the nearest real caret (docs/019 §4.9 dismiss).
  const dismissGap = useCallback(
    (selection: GapSelection) => {
      const back = selectionForGapNavigation(store, selection, "ArrowLeft");
      const forward = selectionForGapNavigation(store, selection, "ArrowRight");
      const target =
        back?.type === "text"
          ? back
          : forward?.type === "text"
            ? forward
            : null;
      if (!target) return;
      store.dispatch({ origin: "local", selectionAfter: target, steps: [] });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  // The document key handler for a gap selection (docs/019 §4.9). The per-leaf
  // handlers early-out when the selection is not their text, so a gap's keys
  // bubble here: arrows walk/escape the gap, Enter/printable materialize a
  // paragraph, Escape dismisses, and undo/redo stay available.
  const onRootKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const selection = store.selection;
      if (selection?.type !== "gap") return;
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
          syncFocusToSelection();
        } else if (key === "y") {
          event.preventDefault();
          store.redo();
          syncFocusToSelection();
        }
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        dismissGap(selection);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        // Delete the atom on the relevant side of the gap (docs/019 §4.12.6) —
        // "remove this block from here." Backspace eats the block before the
        // gap, Delete the one after; the gap stays put across the removal.
        event.preventDefault();
        deleteAtGap(selection, event.key === "Backspace" ? -1 : 1);
        return;
      }
      if (GAP_NAV_KEYS.has(event.key)) {
        event.preventDefault();
        const next = selectionForGapNavigation(store, selection, event.key);
        if (next) applyGapMove(next);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        materializeGap("");
        return;
      }
      // A single printable character (no Alt/AltGr combo) materializes and seeds.
      if (event.key.length === 1 && !event.altKey) {
        event.preventDefault();
        materializeGap(event.key);
      }
    },
    [
      applyGapMove,
      deleteAtGap,
      dismissGap,
      materializeGap,
      store,
      syncFocusToSelection,
    ],
  );

  // A click in the white gaps around the content (most visibly the empty area
  // below the last block) places the caret in the nearest text leaf, the way a
  // real editor maps a click in empty space to the closest text position. Block
  // clicks are handled per-block; this only fires when the click misses them.
  const onRootMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Left button only: a right-click must not move the caret / collapse the
      // selection (it opens the context menu instead, mirrors the per-block rule).
      if (event.button !== 0) return;
      const target = event.target as Element;
      const root = rootRef.current;
      if (!root) return;
      // Resolve which scope a click in empty space belongs to. A click that
      // missed every block resolves in the body. A click on a structural
      // container's own box — a table cell's padding, the inter-child gap inside
      // a callout — resolves in that container's scope, so a gap cursor can land
      // beside an in-cell object (docs/019 §4.9). A click on a leaf block
      // (text/object) is owned by that block's own handler: bail.
      const block = target.closest<HTMLElement>("[data-engine-block-id]");
      let scope: NodeId = store.bodyId;
      let scopeEl: HTMLElement = root;
      if (block) {
        const id = block.getAttribute("data-engine-block-id") as NodeId | null;
        const node = id ? store.getNode(id) : null;
        if (!id || node?.kind !== "structural") return;
        scope = id;
        scopeEl = block;
      }
      // A click in the inter-block whitespace adjacent to an atom places a gap
      // cursor there (docs/019 §4.9, legacy Part C), the position a text caret
      // cannot represent. Elsewhere the click maps to the nearest text leaf.
      const gap = gapAtPointer(event.clientX, event.clientY, scope, scopeEl);
      if (gap) {
        store.dispatch({ origin: "local", selectionAfter: gap, steps: [] });
        focusRoot();
        return;
      }
      const point = resolveTextPointAt(
        store,
        root,
        event.clientX,
        event.clientY,
      );
      if (!point) return;
      const node = store.requireTextNode(point.node);
      const focus = pointAtOffset(
        point.node,
        node.content,
        clampOffset(point.offset, node.content.text.length),
      );
      const existing = store.selection;
      const anchor =
        event.shiftKey && existing?.type === "text" ? existing.anchor : focus;
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor, focus, type: "text" },
        steps: [],
      });
      focusBlock(point.node);
      beginDrag(anchor);
    },
    [beginDrag, focusBlock, focusRoot, gapAtPointer, store, rootRef],
  );

  return { onRootKeyDown, onRootMouseDown };
}
