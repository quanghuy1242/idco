/**
 * Touch-selection chrome: the draggable range handles (docs/010 Phase 7 AC8 mobile
 * selection) plus the body of the caret long-press "Paste" affordance.
 *
 * The engine owns selection as a model fact, so a touch device — which gets no native
 * selection loupe over a non-`contenteditable` surface — needs the engine to paint its own
 * grips. This layer is pure presentation: it reads the model selection geometry through
 * `selectionRects` (the same source the caret/selection overlay paints from) and renders
 * grips at the visual range ends. All gesture handling lives in `react-view.tsx`'s touch
 * controller, which finds these elements by their `data-engine-sel-handle` attributes; the
 * grips are inert markers, not their own listeners, so scroll-vs-select stays one decision.
 *
 * The two action surfaces this layer used to host are gone (docs/029 R1-G): the *range*
 * toolbar merged into the overlay authority's one device-adaptive selection bar (R1-D), and
 * the *caret-paste* toolbar is now an overlay-authority `caret` actions surface opened by the
 * controller through `authority.openCaretActions` — its body is {@link TouchPasteAction}. So
 * this file no longer reaches for `AnchoredPopover`/`shouldCloseOnInteractOutside`: outside
 * dismissal, focus, portal placement, and viewport flipping are the authority's.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@quanghuy1242/idco-ui";
import type { EditorStore, EngineScheduler, TextMarkKind } from "../../core";
import { selectionRects } from "./selection-overlay";
import { useSelectionFrameVersion } from "../store-hooks";
import type { RenderRegistry } from "../types";

export type TouchSelectionActions = {
  readonly copy: () => void;
  readonly cut: () => void;
  readonly paste: () => void;
  readonly toggleMark: (mark: TextMarkKind) => void;
};

const HANDLE_HIT = 40;
const HANDLE_DOT = 16;

/** True on a touch-capable device, so grips show for touch but never on a pure
 * mouse desktop. Combines the coarse-pointer media query with a touch-points
 * check so it holds under mobile emulation, where the media query can lag. */
export function useTouchDevice(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia?.("(pointer: coarse)");
    const compute = () =>
      (query?.matches ?? false) ||
      (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
      "ontouchstart" in window;
    setTouch(compute());
    if (!query) return;
    const update = () => setTouch(compute());
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return touch;
}

export function TouchSelectionLayer(props: {
  readonly store: EditorStore;
  readonly scheduler: EngineScheduler;
  readonly containerRef: RefObject<HTMLElement | null>;
  readonly registry: RenderRegistry;
}) {
  const { store, scheduler, containerRef, registry } = props;
  // Repaint on the selection frame lane, exactly like the selection overlay, so
  // the grips track the caret across edits and scroll.
  const version = useSelectionFrameVersion(store, scheduler);
  void version;

  const selection = store.selection;
  if (selection?.type !== "text") return null;
  const collapsed =
    selection.anchor.node === selection.focus.node &&
    selection.anchor.offset === selection.focus.offset;
  // A collapsed caret paints no grips; its long-press paste affordance is an overlay-authority
  // surface now (docs/029 R1-G), opened by the touch controller, not rendered here.
  if (collapsed) return null;

  const rects = selectionRects(store, containerRef.current, registry.blockRefs);
  const ranges = rects.filter((rect) => rect.kind === "range");
  if (ranges.length === 0) return null;

  const first = ranges[0]!;
  const last = ranges.at(-1)!;
  // Both grips hang below their line (Android-style): start at the bottom-left of
  // the first rect, end at the bottom-right of the last. The gesture controller
  // lifts the resolved point above the fingertip so it targets the line, not the
  // grip.
  const startPoint = { left: first.left, top: first.top + first.height };
  const endPoint = {
    left: last.left + last.width,
    top: last.top + last.height,
  };

  return (
    <div
      data-engine-touch-selection=""
      style={{ inset: 0, pointerEvents: "none", position: "absolute" }}
    >
      <Handle end="start" point={startPoint} />
      <Handle end="end" point={endPoint} />
    </div>
  );
}

function Handle(props: {
  readonly end: "start" | "end";
  readonly point: { left: number; top: number };
}) {
  const { end, point } = props;
  return (
    <div
      aria-hidden="true"
      data-engine-sel-handle={end}
      style={{
        alignItems: "flex-start",
        display: "flex",
        height: HANDLE_HIT,
        justifyContent: "center",
        left: point.left,
        pointerEvents: "auto",
        position: "absolute",
        // Center the hit area horizontally on the grip point; the dot sits at its
        // top so the visible knob hangs just under the selected line.
        top: point.top,
        touchAction: "none",
        transform: `translate(-50%, -2px)`,
        width: HANDLE_HIT,
      }}
    >
      <div
        style={{
          background: "Highlight",
          border: "1px solid Canvas",
          borderRadius: "50%",
          boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
          height: HANDLE_DOT,
          width: HANDLE_DOT,
        }}
      />
    </div>
  );
}

/**
 * The body of the touch caret long-press "Paste" affordance (docs/029 R1-G), rendered inside
 * the overlay authority's `ephemeral.caretActions` envelope (via `openCaretActions`). On
 * unmount it calls `onClose` so the authority's dismissal (an outside touch, Escape) syncs
 * back to the touch controller's long-press flag — the one bit of two-way state this surface
 * needs, kept here rather than in a `shouldCloseOnInteractOutside` predicate at a call site.
 */
export function TouchPasteAction(props: {
  readonly onPaste: () => void;
  readonly onClose: () => void;
}) {
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => () => onCloseRef.current(), []);
  return (
    <div className="flex items-center gap-1" data-engine-caret-toolbar="">
      <span data-engine-sel-action="Paste">
        <Button
          ariaLabel="Paste"
          onClick={props.onPaste}
          size="sm"
          variant="ghost"
        >
          Paste
        </Button>
      </span>
    </div>
  );
}
