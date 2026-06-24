/**
 * Touch-gesture controller (docs/010 Phase 7 AC8, docs/020 §4.3 R3).
 *
 * Owns the scroll-vs-select decision on a touch device: a plain drag scrolls, a
 * long-press selects a word then extends, a grip drag adjusts an end, a tap
 * places the caret, and a long-press on a collapsed caret opens the paste
 * popover. Also owns the touch-chrome state and the `touchActions` for the
 * floating toolbar. Lifted verbatim from `react-view.tsx`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collectSelectionText,
  pointAtOffset,
  type EditorStore,
  type NodeId,
  type TextMarkKind,
  type TextPoint,
} from "../../core";
import { caretClientRect, clampOffset, resolveTextPointAt } from "../overlays";
import { wordRangeAt } from "../overlays";
import { useTouchDevice, type TouchSelectionActions } from "../overlays";
import {
  HANDLE_TOUCH_LIFT_PX,
  TOUCH_CARET_HIT_SLOP_X,
  TOUCH_CARET_HIT_SLOP_Y,
  TOUCH_HANDLE_DRAG_START_PX,
  TOUCH_LONG_PRESS_MS,
  TOUCH_MOVE_CANCEL_PX,
  TOUCH_SELECTION_DRAG_START_PX,
} from "./constants";
import type { ViewRefs } from "./refs";

export type TouchSelectionController = {
  readonly touchActions: TouchSelectionActions;
  readonly touchInteracting: boolean;
  readonly touchCaretActionsOpen: boolean;
  readonly setTouchCaretActionsOpen: (open: boolean) => void;
  readonly isTouchDevice: boolean;
};

export function useTouchSelection(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly syncFocusToSelection: () => void;
  readonly focusBlock: (id: NodeId) => boolean;
  readonly placeCaretAt: (clientX: number, clientY: number) => void;
  readonly beginDrag: (anchor: TextPoint) => void;
  readonly extendDragToPointer: () => void;
  readonly handleDragMove: (clientX: number, clientY: number) => void;
  readonly endDrag: () => void;
}): TouchSelectionController {
  const {
    refs,
    store,
    syncFocusToSelection,
    focusBlock,
    placeCaretAt,
    beginDrag,
    extendDragToPointer,
    handleDragMove,
    endDrag,
  } = args;
  const { rootRef, registryRef, lastPointerRef, touchPointerOffsetRef } = refs;
  const [touchInteracting, setTouchInteracting] = useState(false);
  const [touchCaretActionsOpen, setTouchCaretActionsOpen] = useState(false);
  const isTouchDevice = useTouchDevice();

  // Place the caret at a touch point and focus its block (so the soft keyboard
  // opens), the touch equivalent of a click. Used for a tap (press + release, no
  // drag, no long-press).
  const caretAtPointAndFocus = useCallback(
    (clientX: number, clientY: number) => {
      placeCaretAt(clientX, clientY);
      const sel = store.selection;
      if (sel?.type === "text") focusBlock(sel.focus.node);
    },
    [focusBlock, placeCaretAt, store],
  );

  // Select the word under a touch point and arm a drag from its start, so a
  // long-press selects a word and keeping the finger down extends the range —
  // the mobile gesture that stands in for double-click + drag.
  const selectWordAtPoint = useCallback(
    (clientX: number, clientY: number): boolean => {
      const root = rootRef.current;
      if (!root) return false;
      const hit = resolveTextPointAt(store, root, clientX, clientY);
      if (!hit) return false;
      const node = store.getNode(hit.node);
      if (!node || node.kind !== "text") return false;
      const [from, to] = wordRangeAt(
        node.content.text,
        clampOffset(hit.offset, node.content.text.length),
      );
      const anchor = pointAtOffset(hit.node, node.content, from);
      const focus = pointAtOffset(hit.node, node.content, to);
      store.activateTextLeaf(hit.node);
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor, focus, type: "text" },
        steps: [],
      });
      focusBlock(hit.node);
      beginDrag(anchor);
      return true;
    },
    [beginDrag, focusBlock, store, rootRef],
  );

  // Arm a drag from a selection grip: dragging a grip moves THAT end of the
  // range, so the opposite end becomes the fixed drag anchor. The touch offset
  // lifts the hit-test above the fingertip so it tracks the line under the grip.
  const armHandleDrag = useCallback(
    (end: "start" | "end") => {
      const sel = store.selection;
      if (sel?.type !== "text") return;
      const forward = store.comparePoints(sel.anchor, sel.focus) <= 0;
      const startPt = forward ? sel.anchor : sel.focus;
      const endPt = forward ? sel.focus : sel.anchor;
      beginDrag(end === "start" ? endPt : startPt);
      touchPointerOffsetRef.current = HANDLE_TOUCH_LIFT_PX;
    },
    [beginDrag, store, touchPointerOffsetRef],
  );

  const isTouchOnCollapsedCaret = useCallback(
    (clientX: number, clientY: number): boolean => {
      const selection = store.selection;
      if (
        selection?.type !== "text" ||
        selection.anchor.node !== selection.focus.node ||
        selection.anchor.offset !== selection.focus.offset
      ) {
        return false;
      }
      const element = registryRef.current.blockRefs.get(selection.focus.node);
      if (!element) return false;
      const rect = caretClientRect(element, selection.focus.offset);
      if (!rect) return false;
      return (
        clientX >= rect.left - TOUCH_CARET_HIT_SLOP_X &&
        clientX <= rect.right + TOUCH_CARET_HIT_SLOP_X &&
        clientY >= rect.top - TOUCH_CARET_HIT_SLOP_Y &&
        clientY <= rect.bottom + TOUCH_CARET_HIT_SLOP_Y
      );
    },
    [store, registryRef],
  );

  const touchActions = useMemo<TouchSelectionActions>(
    () => ({
      copy: () => {
        const text = collectSelectionText(store, store.selection);
        if (text) void navigator.clipboard?.writeText(text).catch(() => {});
      },
      cut: () => {
        const text = collectSelectionText(store, store.selection);
        if (text) void navigator.clipboard?.writeText(text).catch(() => {});
        store.breakUndoCoalescing();
        if (store.command({ type: "delete-selection" })) syncFocusToSelection();
      },
      paste: () => {
        void (async () => {
          try {
            const text = await navigator.clipboard?.readText();
            store.breakUndoCoalescing();
            if (text && store.command({ text, type: "insert-text" })) {
              syncFocusToSelection();
            }
          } catch {
            // Clipboard read unavailable or denied; nothing to paste.
          }
        })();
      },
      toggleMark: (mark: TextMarkKind) => {
        store.command({ mark, type: "toggle-mark" });
      },
    }),
    [store, syncFocusToSelection],
  );

  // Touch gesture controller (docs/010 Phase 7 AC8). Owns the scroll-vs-select
  // decision on the touch device: a plain drag scrolls (we never preventDefault
  // it), a long-press selects a word and then extends, a grip drag adjusts an
  // end, and a tap places the caret. Once selecting, `preventDefault` on
  // `touchmove` claims the gesture from the scroller; `preventDefault` on
  // `touchend` suppresses the synthesized mouse events that would otherwise
  // re-place the caret and collapse the selection.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let mode:
      | "idle"
      | "pressing"
      | "scrolling"
      | "selecting"
      | "handle"
      | "caret" = "idle";
    let startX = 0;
    let startY = 0;
    let dragActivated = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return; // ignore pinch/multi-touch
      const touch = event.touches[0]!;
      const target = touch.target as Element | null;
      if (
        target?.closest(
          "[data-engine-sel-toolbar], [data-engine-caret-toolbar]",
        )
      ) {
        return; // action popover button press
      }
      setTouchCaretActionsOpen(false);
      startX = touch.clientX;
      startY = touch.clientY;
      dragActivated = false;
      const handle = target?.closest("[data-engine-sel-handle]");
      if (handle) {
        event.preventDefault();
        mode = "handle";
        armHandleDrag(
          handle.getAttribute("data-engine-sel-handle") === "start"
            ? "start"
            : "end",
        );
        setTouchInteracting(true);
        return;
      }
      if (!target?.closest("[data-engine-block-id]")) {
        mode = "idle";
        return;
      }
      mode = "pressing";
      clearTimer();
      // Deliberately a raw timer, not an engine-scheduler task (note.md §7 P4): a
      // single-shot gesture-classification deadline ("finger held this long without
      // moving → long-press select"), armed once per touch and cleared the moment
      // the gesture reclassifies (move → scroll, lift → tap). There is nothing to
      // coalesce and no shared budget to honour — it is control flow, not derived
      // work — so a lane would only obscure it.
      timer = setTimeout(() => {
        timer = null;
        if (mode !== "pressing") return;
        if (isTouchOnCollapsedCaret(startX, startY)) {
          mode = "caret";
          setTouchCaretActionsOpen(true);
          return;
        }
        if (selectWordAtPoint(startX, startY)) {
          mode = "selecting";
          setTouchInteracting(true);
        }
      }, TOUCH_LONG_PRESS_MS);
    };
    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      if (mode === "pressing") {
        if (
          Math.hypot(touch.clientX - startX, touch.clientY - startY) >
          TOUCH_MOVE_CANCEL_PX
        ) {
          clearTimer();
          mode = "scrolling"; // a pre-long-press drag is a scroll; let it scroll
        }
        return;
      }
      if (mode === "selecting" || mode === "handle") {
        event.preventDefault(); // claim the gesture from the scroller
        if (!dragActivated) {
          const threshold =
            mode === "handle"
              ? TOUCH_HANDLE_DRAG_START_PX
              : TOUCH_SELECTION_DRAG_START_PX;
          if (
            Math.hypot(touch.clientX - startX, touch.clientY - startY) <
            threshold
          ) {
            return;
          }
          dragActivated = true;
        }
        handleDragMove(touch.clientX, touch.clientY);
        return;
      }
      if (mode === "caret") {
        event.preventDefault();
        if (
          Math.hypot(touch.clientX - startX, touch.clientY - startY) >
          TOUCH_SELECTION_DRAG_START_PX
        ) {
          setTouchCaretActionsOpen(false);
          mode = "idle";
        }
      }
    };
    const onEnd = (event: TouchEvent) => {
      if (mode === "pressing") {
        clearTimer();
        event.preventDefault(); // suppress the synthesized mouse tap
        caretAtPointAndFocus(startX, startY);
      } else if (mode === "selecting" || mode === "handle") {
        event.preventDefault(); // keep the range; no synthesized mousedown
        const touch = event.changedTouches[0];
        if (touch && dragActivated) {
          lastPointerRef.current = { x: touch.clientX, y: touch.clientY };
          extendDragToPointer();
        }
        endDrag();
        setTouchInteracting(false);
      } else if (mode === "caret") {
        event.preventDefault(); // keep the paste popover; no synthesized tap
      }
      mode = "idle";
    };
    const onCancel = () => {
      clearTimer();
      if (mode === "selecting" || mode === "handle") {
        endDrag();
        setTouchInteracting(false);
      } else if (mode === "caret") {
        setTouchCaretActionsOpen(false);
      }
      mode = "idle";
    };
    root.addEventListener("touchstart", onStart, { passive: false });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd, { passive: false });
    root.addEventListener("touchcancel", onCancel);
    return () => {
      clearTimer();
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onCancel);
    };
  }, [
    armHandleDrag,
    caretAtPointAndFocus,
    endDrag,
    extendDragToPointer,
    handleDragMove,
    isTouchOnCollapsedCaret,
    selectWordAtPoint,
    rootRef,
    lastPointerRef,
  ]);

  return {
    isTouchDevice,
    setTouchCaretActionsOpen,
    touchActions,
    touchCaretActionsOpen,
    touchInteracting,
  };
}
