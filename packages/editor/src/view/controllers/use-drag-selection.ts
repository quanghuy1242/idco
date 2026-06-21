/**
 * Mouse/pointer drag-selection controller (docs/020 §4.3, R3).
 *
 * Owns drag-anchor tracking, per-frame drag-extend coalescing, autoscroll near
 * the viewport edge, and the document-level mouse/pointer listeners that keep a
 * drag extending past the editor bounds. Reads the model to extend the selection,
 * so a range stays valid across virtualized gaps. Lifted verbatim from
 * `react-view.tsx`.
 */
import { useCallback, useEffect } from "react";
import {
  pointAtOffset,
  type EditorStore,
  type EngineScheduler,
  type TextPoint,
} from "../../core";
import { clampOffset, resolveTextPointAt } from "../geometry";
import { cancelFrame, requestFrame } from "../raf";
import { AUTOSCROLL_STEP_PX } from "./constants";
import type { ViewRefs } from "./refs";

export type DragSelectionController = {
  readonly beginDrag: (anchor: TextPoint) => void;
  readonly extendDragToPointer: () => void;
  readonly scheduleDragExtend: () => void;
  readonly stopAutoscroll: () => void;
  readonly handleDragMove: (clientX: number, clientY: number) => void;
  readonly endDrag: () => void;
};

export function useDragSelection(args: {
  readonly refs: ViewRefs;
  readonly store: EditorStore;
  readonly scheduler: EngineScheduler;
  readonly virtualize: boolean;
  readonly setScrollTop: (value: number) => void;
}): DragSelectionController {
  const { refs, store, scheduler, virtualize, setScrollTop } = args;
  const {
    dragAnchorRef,
    draggingRef,
    lastPointerRef,
    autoscrollFrameRef,
    dragMoveFrameRef,
    touchPointerOffsetRef,
    registryRef,
    rootRef,
  } = refs;

  const beginDrag = useCallback(
    (anchor: TextPoint) => {
      dragAnchorRef.current = anchor;
      draggingRef.current = true;
      registryRef.current.dragging = true;
      // Mouse and long-press drags hit-test at the pointer; a grip drag re-sets
      // this after begin. Reset here so a mouse drag never inherits a touch offset.
      touchPointerOffsetRef.current = 0;
    },
    [dragAnchorRef, draggingRef, registryRef, touchPointerOffsetRef],
  );

  const extendDragToPointer = useCallback(() => {
    // Extend the model selection from the drag anchor to whatever block/offset
    // the pointer is over (docs/011 §8.3). Reads the model, so the range is
    // valid even though only the mounted window is in the DOM.
    const anchor = dragAnchorRef.current;
    const pointer = lastPointerRef.current;
    const root = rootRef.current;
    if (!anchor || !pointer || !root) return;
    // Resolve to the nearest text leaf, so a drag passes through the `[list]`
    // placeholder and the gaps instead of stalling on a non-text block. The
    // touch offset lifts the hit-test above the fingertip for grip drags.
    const hit = resolveTextPointAt(
      store,
      root,
      pointer.x,
      pointer.y - touchPointerOffsetRef.current,
    );
    if (!hit) return;
    const target = store.getNode(hit.node);
    if (!target || target.kind !== "text") return;
    // Confine the text drag to the anchor's scope. A drag that wanders into
    // another container (a different table cell, a callout) must not form a
    // cross-scope text selection — that range is not editable and would corrupt
    // on delete (deleteRange's cross-scope guard). The cross-cell case is the
    // table cell-range overlay's job (`TableInteractions`), not a text range.
    if (
      store.parentEntry(hit.node)?.parent !==
      store.parentEntry(anchor.node)?.parent
    ) {
      return;
    }
    const focus = pointAtOffset(
      hit.node,
      target.content,
      clampOffset(hit.offset, target.content.text.length),
    );
    // Skip the dispatch when the pointer is still over the same model position —
    // a pixel move within one glyph should not churn a selection notify + repaint.
    const current = store.selection;
    if (
      current?.type === "text" &&
      current.focus.node === focus.node &&
      current.focus.offset === focus.offset &&
      current.anchor.node === anchor.node &&
      current.anchor.offset === anchor.offset
    ) {
      return;
    }
    store.dispatch({
      origin: "local",
      selectionAfter: { anchor, focus, type: "text" },
      steps: [],
    });
    // Paint the new selection in *this* frame. `extendDragToPointer` already runs
    // inside a rAF, so the overlay's frame task `dispatch` just queued would fire
    // on the next rAF — one frame behind the pointer. Draining the frame lane now
    // closes that gap so the painted selection tracks the drag (docs/010 §7.4).
    scheduler.flushLane("frame");
  }, [
    scheduler,
    store,
    dragAnchorRef,
    lastPointerRef,
    rootRef,
    touchPointerOffsetRef,
  ]);

  // Run a drag-extend at most once per animation frame, against the latest
  // pointer (`lastPointerRef`), so a burst of `mousemove`s collapses to one
  // hit-test + dispatch on the frame the browser is about to paint.
  const scheduleDragExtend = useCallback(() => {
    if (dragMoveFrameRef.current !== null) return;
    dragMoveFrameRef.current = requestFrame(() => {
      dragMoveFrameRef.current = null;
      extendDragToPointer();
    });
  }, [extendDragToPointer, dragMoveFrameRef]);

  const stopAutoscroll = useCallback(() => {
    if (autoscrollFrameRef.current !== null) {
      cancelFrame(autoscrollFrameRef.current);
      autoscrollFrameRef.current = null;
    }
  }, [autoscrollFrameRef]);

  const handleDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!draggingRef.current) return;
      lastPointerRef.current = { x: clientX, y: clientY };
      scheduleDragExtend();
      // Autoscroll while a drag is held near a viewport edge so the selection
      // can reach offscreen blocks (docs/010 Phase 5 AC4).
      const scroller = rootRef.current;
      if (!virtualize || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      const edge = 28;
      const below = clientY - rect.top < edge;
      const above = rect.bottom - clientY < edge;
      if (!below && !above) {
        stopAutoscroll();
        return;
      }
      if (autoscrollFrameRef.current !== null) return;
      const step = () => {
        if (!draggingRef.current) {
          autoscrollFrameRef.current = null;
          return;
        }
        const delta = below ? -AUTOSCROLL_STEP_PX : AUTOSCROLL_STEP_PX;
        scroller.scrollTop += delta;
        setScrollTop(scroller.scrollTop);
        extendDragToPointer();
        autoscrollFrameRef.current = requestFrame(step);
      };
      autoscrollFrameRef.current = requestFrame(step);
    },
    [
      extendDragToPointer,
      scheduleDragExtend,
      stopAutoscroll,
      virtualize,
      draggingRef,
      lastPointerRef,
      rootRef,
      autoscrollFrameRef,
      setScrollTop,
    ],
  );

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    registryRef.current.dragging = false;
    dragAnchorRef.current = null;
    lastPointerRef.current = null;
    if (dragMoveFrameRef.current !== null) {
      cancelFrame(dragMoveFrameRef.current);
      dragMoveFrameRef.current = null;
    }
    stopAutoscroll();
  }, [
    stopAutoscroll,
    draggingRef,
    registryRef,
    dragAnchorRef,
    lastPointerRef,
    dragMoveFrameRef,
  ]);

  // Track the drag on the document, not the editor element, so it keeps
  // extending when the pointer leaves the editor and resumes on re-entry, and
  // ends on pointerup anywhere — the way a real text drag behaves. The listeners
  // early-out unless a drag is active, so they are cheap when idle.
  useEffect(() => {
    const view = rootRef.current?.ownerDocument.defaultView ?? globalThis;
    // Track on BOTH mouse and pointer events. Desktop drag is mouse-driven and
    // every browser dispatches `mousemove`/`mouseup`; `pointermove` covers touch
    // but is not reliably synthesized from mouse input on WebKit/Firefox, which
    // is why a pointer-only listener let cross-browser drags stall (Phase 7).
    // `handleDragMove` is idempotent, so the overlap is harmless.
    const onMove = (event: MouseEvent) => {
      if (draggingRef.current) handleDragMove(event.clientX, event.clientY);
    };
    const onUp = () => {
      if (draggingRef.current) endDrag();
    };
    view.addEventListener("mousemove", onMove);
    view.addEventListener("pointermove", onMove);
    view.addEventListener("mouseup", onUp);
    view.addEventListener("pointerup", onUp);
    return () => {
      view.removeEventListener("mousemove", onMove);
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("mouseup", onUp);
      view.removeEventListener("pointerup", onUp);
    };
  }, [endDrag, handleDragMove, draggingRef, rootRef]);

  return {
    beginDrag,
    endDrag,
    extendDragToPointer,
    handleDragMove,
    scheduleDragExtend,
    stopAutoscroll,
  };
}
