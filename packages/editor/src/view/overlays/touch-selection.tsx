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
 * `data-engine-sel-handle` attributes; the grips are inert markers, not their
 * own listeners, so scroll-vs-select stays one decision. Action chrome is an
 * `@idco/ui` anchored popover (React Aria `Popover` + `Dialog`, DaisyUI tokens),
 * not an editor-local floating div: outside dismissal, focus, portal placement,
 * and viewport flipping all stay in the shared overlay primitive.
 */
import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";
import { AnchoredPopover, Button } from "@quanghuy1242/idco-ui";
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
  readonly actions: TouchSelectionActions;
  /** True while a grip/long-press drag is live; hides the toolbar mid-drag. */
  readonly interacting: boolean;
  /** True after holding the collapsed caret; shows the paste affordance. */
  readonly caretActionsOpen: boolean;
  readonly onCaretActionsOpenChange: (isOpen: boolean) => void;
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

  const rects = selectionRects(store, containerRef.current, registry.blockRefs);

  if (collapsed) {
    const caret = rects.find((rect) => rect.kind === "caret");
    if (!caret) return null;
    return (
      <div
        data-engine-touch-selection=""
        style={{ inset: 0, pointerEvents: "none", position: "absolute" }}
      >
        <PopoverAnchor
          left={caret.left + caret.width / 2}
          top={caret.top + caret.height}
          variant="caret"
        >
          {(anchorRef) => (
            <AnchoredPopover
              ariaLabel="Caret actions"
              isNonModal
              isOpen={props.caretActionsOpen && !interacting}
              onOpenChange={props.onCaretActionsOpenChange}
              placement="top"
              shouldCloseOnInteractOutside={() => true}
              triggerRef={anchorRef}
            >
              <ActionRow dataAttr="data-engine-caret-toolbar">
                <ActionButton
                  label="Paste"
                  onPress={() => {
                    actions.paste();
                    props.onCaretActionsOpenChange(false);
                  }}
                />
              </ActionRow>
            </AnchoredPopover>
          )}
        </PopoverAnchor>
      </div>
    );
  }

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
      {/* Grips only. The range selection toolbar merged into the overlay authority's one
          device-adaptive selection bar (docs/029 R1-D §8.3), so this layer is now pure
          geometry (the draggable range handles) plus the collapsed-caret paste affordance
          below — the touch half of the split. */}
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

function PopoverAnchor(props: {
  readonly left: number;
  readonly top: number;
  readonly variant: "caret" | "selection";
  readonly children: (ref: RefObject<HTMLElement | null>) => ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  return (
    <>
      <span
        ref={anchorRef}
        aria-hidden="true"
        data-engine-touch-popover-anchor={props.variant}
        style={{
          height: 1,
          left: props.left,
          pointerEvents: "none",
          position: "absolute",
          top: props.top,
          transform: "translate(-50%, -50%)",
          width: 1,
        }}
      />
      {props.children(anchorRef)}
    </>
  );
}

function ActionRow(props: {
  readonly children: ReactNode;
  readonly dataAttr: "data-engine-caret-toolbar" | "data-engine-sel-toolbar";
}) {
  return (
    <div
      {...{ [props.dataAttr]: "" }}
      className="flex items-center gap-1"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {props.children}
    </div>
  );
}

function ActionButton(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly title?: string;
}) {
  const { label, onPress, title } = props;
  return (
    <span
      data-engine-sel-action={title ?? label}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Button
        ariaLabel={title ?? label}
        onClick={onPress}
        size="sm"
        tooltip={title}
        variant="ghost"
      >
        {label}
      </Button>
    </span>
  );
}
