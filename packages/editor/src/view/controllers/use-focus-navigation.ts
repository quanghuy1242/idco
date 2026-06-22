/**
 * Focus + caret-navigation controller (docs/020 §4.3, R3).
 *
 * Owns DOM focus of the block the model selection names, caret reveal/scroll
 * into view, PageUp/PageDown caret paging, click-to-caret, selection text
 * serialization, and the deferred focus sync after a structural/clipboard edit.
 * Lifted verbatim from `react-view.tsx`.
 */
import { useCallback } from "react";
import {
  collectSelectionText,
  pointAtOffset,
  type EditorStore,
  type NodeId,
} from "../../core";
import { caretClientRect, clampOffset, resolveTextPointAt } from "../overlays";
import { pointForStoreOffset } from "../overlays";
import { requestFrame } from "../raf";
import { CARET_REVEAL_MARGIN_PX, PAGE_SCROLL_FRACTION } from "./constants";
import type { ViewRefs } from "./refs";

export type FocusNavigationController = {
  readonly selectText: (
    anchorNode: NodeId,
    anchorOffset: number,
    focusNode: NodeId,
    focusOffset: number,
  ) => void;
  readonly focusBlock: (id: NodeId) => boolean;
  readonly focusRoot: () => void;
  readonly scrollToBlock: (id: NodeId) => void;
  readonly revealBlock: (id: NodeId) => void;
  readonly pageCaret: (direction: -1 | 1, extend: boolean) => boolean;
  readonly serializeSelection: () => string;
  readonly placeCaretAt: (clientX: number, clientY: number) => void;
  readonly syncFocusToSelection: () => void;
};

export function useFocusNavigation(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly virtualize: boolean;
  readonly setScrollTop: (value: number) => void;
}): FocusNavigationController {
  const { refs, store, virtualize, setScrollTop } = args;
  const {
    rootRef,
    registryRef,
    heightCacheRef,
    estimateRef,
    pendingScrollRef,
    goalColumnRef,
  } = refs;

  const selectText = useCallback(
    (
      anchorNode: NodeId,
      anchorOffset: number,
      focusNode: NodeId,
      focusOffset: number,
    ) => {
      store.dispatch({
        origin: "local",
        selectionAfter: {
          anchor: pointForStoreOffset(store, anchorNode, anchorOffset),
          focus: pointForStoreOffset(store, focusNode, focusOffset),
          type: "text",
        },
        steps: [],
      });
    },
    [store],
  );

  // Returns whether the block was mounted and focused. The caller uses this to
  // tell "focused synchronously, now" from "not mounted yet" so it can focus a
  // merge survivor in the same gesture but defer a split's new block a frame
  // (B1, the mobile-keyboard fix in `focusSelectionSoon`).
  const focusBlock = useCallback(
    (id: NodeId): boolean => {
      const element = registryRef.current.blockRefs.get(id);
      if (!element) return false;
      element.focus({ preventScroll: true });
      return true;
    },
    [registryRef],
  );

  // A gap/node selection has no EditContext host, so the surface root takes focus
  // and the root key handler drives it (docs/019 §4.9). The root carries
  // `tabIndex={-1}` so it is focusable programmatically without joining tab order.
  const focusRoot = useCallback(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, [rootRef]);

  const scrollToBlock = useCallback(
    (id: NodeId) => {
      const index = store.order.indexOf(id);
      if (index < 0) return;
      if (!virtualize) {
        registryRef.current.blockRefs
          .get(id)
          ?.scrollIntoView({ block: "start" });
        return;
      }
      let offset = 0;
      for (let i = 0; i < index; i += 1) {
        offset +=
          heightCacheRef.current.get(store.order[i]!) ?? estimateRef.current;
      }
      // First jump uses estimated offset; the measure effect then corrects it
      // to the target's real layout position, iterating until stable (AC3).
      pendingScrollRef.current = { attempts: 0, id };
      if (rootRef.current) rootRef.current.scrollTop = offset;
      setScrollTop(offset);
    },
    [
      store,
      virtualize,
      registryRef,
      heightCacheRef,
      estimateRef,
      pendingScrollRef,
      rootRef,
      setScrollTop,
    ],
  );

  // Keyboard caret/selection movement must keep the focus visible, the way a
  // browser scrolls a contenteditable caret into view. We paint the caret and
  // pass `preventScroll` on focus, so nothing scrolls for free; worse, under
  // virtualization a focus that crosses the mounted window+overscan band would
  // unmount, stranding the overlay. `revealBlock` reveals the *caret line*, not
  // the whole block: a block-granular reveal would yank an entire multi-line
  // block into view on a one-line move, the aggressive jump a native editor
  // never makes. It scrolls the minimum needed (with a small lead margin so the
  // caret is not flush to the edge) and only estimate-jumps when the target is
  // off the mounted window entirely.
  const revealBlock = useCallback(
    (id: NodeId) => {
      const scroller = rootRef.current;
      if (!scroller) return;
      const element = registryRef.current.blockRefs.get(id);
      if (!virtualize) {
        element?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (element) {
        const selection = store.selection;
        const focusOffset =
          selection?.type === "text" && selection.focus.node === id
            ? selection.focus.offset
            : null;
        const targetRect =
          focusOffset === null
            ? element.getBoundingClientRect()
            : (caretClientRect(element, focusOffset) ??
              element.getBoundingClientRect());
        const viewRect = scroller.getBoundingClientRect();
        const top = targetRect.top - viewRect.top;
        const bottom = targetRect.bottom - viewRect.top;
        const margin = CARET_REVEAL_MARGIN_PX;
        let delta = 0;
        if (top < margin) delta = top - margin;
        else if (bottom > scroller.clientHeight - margin)
          delta = bottom - (scroller.clientHeight - margin);
        if (Math.abs(delta) > 0.5) {
          scroller.scrollTop += delta;
          setScrollTop(scroller.scrollTop);
        }
        // Horizontal reveal of a long unwrapped line (docs/018 §2.4): if the
        // caret sits past the scroller's horizontal viewport, nudge scrollLeft so
        // it stays visible. No-op when the content fits (the common wrapped case).
        if (focusOffset !== null) {
          const left = targetRect.left - viewRect.left;
          const right = targetRect.right - viewRect.left;
          let dx = 0;
          if (left < margin) dx = left - margin;
          else if (right > scroller.clientWidth - margin)
            dx = right - (scroller.clientWidth - margin);
          if (Math.abs(dx) > 0.5) scroller.scrollLeft += dx;
        }
        return;
      }
      // Focus jumped past the mounted window: estimate the target offset so it
      // mounts near the viewport bottom; the next reveal settles it precisely.
      const index = store.order.indexOf(id);
      if (index < 0) return;
      let offset = 0;
      for (let i = 0; i < index; i += 1) {
        offset +=
          heightCacheRef.current.get(store.order[i]!) ?? estimateRef.current;
      }
      const next = Math.max(
        0,
        offset - scroller.clientHeight + estimateRef.current,
      );
      scroller.scrollTop = next;
      setScrollTop(next);
    },
    [
      store,
      virtualize,
      rootRef,
      registryRef,
      heightCacheRef,
      estimateRef,
      setScrollTop,
    ],
  );

  // PageUp/PageDown caret paging (docs/018 §2.4). The caret jumps to the line at
  // the far edge of the viewport (same goal column), then `revealBlock` scrolls
  // it back to a margin — so a second press pages again. No model mutation: this
  // is scroll + a selection-only dispatch. Returns whether it moved the caret.
  const pageCaret = useCallback(
    (direction: -1 | 1, extend: boolean): boolean => {
      const scroller = rootRef.current;
      const sel = store.selection;
      if (!scroller || sel?.type !== "text") return false;
      const viewRect = scroller.getBoundingClientRect();
      const focusEl = registryRef.current.blockRefs.get(sel.focus.node);
      const caretRect = focusEl
        ? caretClientRect(focusEl, sel.focus.offset)
        : null;
      const x = goalColumnRef.current ?? caretRect?.left ?? viewRect.left + 8;
      const margin = CARET_REVEAL_MARGIN_PX;
      const probeY =
        direction < 0 ? viewRect.top + margin : viewRect.bottom - margin;
      const point = resolveTextPointAt(store, scroller, x, probeY);
      if (point) {
        const node = store.getNode(point.node);
        if (node && node.kind === "text") {
          const focus = pointAtOffset(
            point.node,
            node.content,
            clampOffset(point.offset, node.content.text.length),
          );
          const moved =
            focus.node !== sel.focus.node || focus.offset !== sel.focus.offset;
          if (moved) {
            store.dispatch({
              origin: "local",
              selectionAfter: {
                anchor: extend ? sel.anchor : focus,
                focus,
                type: "text",
              },
              steps: [],
            });
            goalColumnRef.current = x;
            if (focus.node !== sel.focus.node) focusBlock(focus.node);
            revealBlock(focus.node);
            return true;
          }
        }
      }
      // No resolvable line at the edge (e.g. the empty area past the last block):
      // fall back to a plain page scroll so the surface still pages.
      const page = scroller.clientHeight * PAGE_SCROLL_FRACTION;
      const next = Math.max(0, scroller.scrollTop + direction * page);
      if (Math.abs(next - scroller.scrollTop) < 0.5) return false;
      scroller.scrollTop = next;
      setScrollTop(next);
      return true;
    },
    [
      focusBlock,
      goalColumnRef,
      revealBlock,
      store,
      rootRef,
      registryRef,
      setScrollTop,
    ],
  );

  const serializeSelection = useCallback(
    () => collectSelectionText(store, store.selection),
    [store],
  );

  const placeCaretAt = useCallback(
    (clientX: number, clientY: number) => {
      const root = rootRef.current;
      if (!root) return;
      const point = resolveTextPointAt(store, root, clientX, clientY);
      if (!point) return;
      const node = store.requireTextNode(point.node);
      const focus = pointAtOffset(
        point.node,
        node.content,
        clampOffset(point.offset, node.content.text.length),
      );
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor: focus, focus, type: "text" },
        steps: [],
      });
    },
    [store, rootRef],
  );

  // Focus and reveal the block the model selection now points at, after a
  // structural/clipboard command moves the caret. Deferred a frame so the new
  // block has mounted (React flushes the order change after the handler).
  const syncFocusToSelection = useCallback(() => {
    // Sync-first focus (B1): when an edit (cut, delete-selection) removes the
    // focused block and the caret lands in an already-mounted block, focus it
    // now — in the same gesture, before React commits the unmount of the removed
    // block — so the mobile soft keyboard never sees a focusless moment and does
    // not flicker. Only fall back to the next frame when the destination is not
    // mounted yet (e.g. paste inserting fresh blocks above the caret).
    const apply = (): boolean => {
      const sel = store.selection;
      const focusNode = sel?.type === "text" ? sel.focus.node : null;
      if (!focusNode) return false;
      return focusBlock(focusNode);
    };
    if (!apply()) requestFrame(apply);
  }, [focusBlock, store]);

  return {
    focusBlock,
    focusRoot,
    pageCaret,
    placeCaretAt,
    revealBlock,
    scrollToBlock,
    selectText,
    serializeSelection,
    syncFocusToSelection,
  };
}
