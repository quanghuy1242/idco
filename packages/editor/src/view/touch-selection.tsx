/**
 * Touch-selection chrome: the draggable range handles and the floating
 * selection toolbar (docs/010 Phase 7 AC8 mobile selection).
 *
 * The engine owns selection as a model fact, so a touch device — which gets no
 * native selection loupe over a non-`contenteditable` surface — needs the engine
 * to paint its own grips and action bar. This layer is pure presentation: it
 * reads the model selection geometry through `selectionRects` (the same source
 * the caret/selection overlay paints from) and renders grips at the visual range
 * ends plus a Copy/Cut/Paste/format bar above it. All gesture handling lives in
 * `react-view.tsx`'s touch controller, which finds these elements by their
 * `data-engine-sel-handle` / `data-engine-sel-toolbar` attributes; the grips are
 * inert markers, not their own listeners, so scroll-vs-select stays one decision.
 */
import { useEffect, useState, type RefObject } from "react";
import type { EditorStore, EngineScheduler, TextMarkKind } from "../core";
import { selectionRects } from "./selection-overlay";
import { useSelectionFrameVersion } from "./store-hooks";
import type { RenderRegistry } from "./types";

export type TouchSelectionActions = {
  readonly copy: () => void;
  readonly cut: () => void;
  readonly paste: () => void;
  readonly toggleMark: (mark: TextMarkKind) => void;
};

const HANDLE_HIT = 40;
const HANDLE_DOT = 16;
const TOOLBAR_GAP = 10;

/** Keep a press on the toolbar/buttons from collapsing the model selection. */
const suppressMouseDown = (event: { preventDefault: () => void }): void =>
  event.preventDefault();

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
  readonly actions: TouchSelectionActions;
  /** True while a grip/long-press drag is live; hides the toolbar mid-drag. */
  readonly interacting: boolean;
}) {
  const { store, scheduler, containerRef, registry, actions, interacting } =
    props;
  // Repaint on the selection frame lane, exactly like the selection overlay, so
  // the grips and bar track the caret across edits and scroll.
  const version = useSelectionFrameVersion(store, scheduler);
  void version;

  const selection = store.selection;
  if (selection?.type !== "text") return null;
  const collapsed =
    selection.anchor.node === selection.focus.node &&
    selection.anchor.offset === selection.focus.offset;
  if (collapsed) return null;

  const ranges = selectionRects(
    store,
    containerRef.current,
    registry.blockRefs,
  ).filter((rect) => rect.kind === "range");
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

  const minLeft = Math.min(...ranges.map((r) => r.left));
  const maxRight = Math.max(...ranges.map((r) => r.left + r.width));
  const center = (minLeft + maxRight) / 2;
  const toolbarTop = Math.max(0, first.top - TOOLBAR_GAP - 40);

  return (
    <div
      aria-hidden="true"
      data-engine-touch-selection=""
      style={{ inset: 0, pointerEvents: "none", position: "absolute" }}
    >
      <Handle end="start" point={startPoint} />
      <Handle end="end" point={endPoint} />
      {!interacting && (
        <SelectionToolbar actions={actions} center={center} top={toolbarTop} />
      )}
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

function SelectionToolbar(props: {
  readonly actions: TouchSelectionActions;
  readonly center: number;
  readonly top: number;
}) {
  const { actions, center, top } = props;
  return (
    <div
      data-engine-sel-toolbar=""
      onMouseDown={suppressMouseDown}
      style={{
        background: "Canvas",
        borderRadius: 8,
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        color: "CanvasText",
        display: "flex",
        gap: 2,
        left: center,
        padding: 4,
        pointerEvents: "auto",
        position: "absolute",
        top,
        transform: "translateX(-50%)",
        zIndex: 2,
      }}
    >
      <ToolbarButton label="Copy" onPress={actions.copy} />
      <ToolbarButton label="Cut" onPress={actions.cut} />
      <ToolbarButton label="Paste" onPress={actions.paste} />
      <ToolbarButton
        label="B"
        onPress={() => actions.toggleMark("bold")}
        title="Bold"
      />
      <ToolbarButton
        label="I"
        onPress={() => actions.toggleMark("italic")}
        title="Italic"
      />
    </div>
  );
}

function ToolbarButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly title?: string;
}) {
  const { label, onPress, title } = props;
  return (
    <button
      data-engine-sel-action={title ?? label}
      onClick={onPress}
      onMouseDown={suppressMouseDown}
      style={{
        background: "transparent",
        border: "none",
        borderRadius: 6,
        color: "inherit",
        cursor: "pointer",
        font: "inherit",
        fontSize: 14,
        minWidth: 36,
        padding: "6px 10px",
      }}
      title={title ?? label}
      type="button"
    >
      {label}
    </button>
  );
}
