/**
 * Table cell-range selection + the cell-action button (docs/022 §7, docs/029 R1-E).
 *
 * Dragging across cells paints a rectangular range overlay (a *view-layer* selection — it
 * never enters the core `EditorSelection`). A single `…` button floats at the *hovered*
 * cell's top-right; pressing it opens the cell `…` popover (merge / unmerge / fill / vertical
 * align) through the **overlay authority** (docs/029 R1-E) — a `cell`-target envelope whose
 * dismissal (outside press, Escape) and containment are owned centrally, so the old
 * per-site `keepCellPopoverOpen` + `pressInsideRef` focus-bounce guards are gone: under the
 * authority's `taking` focus-mode a swatch press is an interior press (not an outside
 * dismiss), and the editor's focus reclaim is suspended while the panel is open.
 *
 * Targets are resolved *live at action time* by the panel from the per-store `cell-range`
 * channel + the anchored cell, so the panel always acts on the cell it visually belongs to.
 * The same cell ops are ALSO contributed to the right-click context menu (`table-commands`);
 * both dispatch the same `core/table/operations`, so there is no drift. The drag range is
 * published to the `cell-range` channel for both the panel and the context menu. Phantom-drag
 * prevention (a press inside a body-portaled overlay must not start a cell drag) is now an
 * **ownership** check against the authority, not a `data-engine-view-root` selector.
 */
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { ChromeButton, NavIcon } from "@quanghuy1242/idco-ui";
import { Button as AriaButton } from "react-aria-components";
import type { EditorStore, NodeId } from "../../../core";
import {
  cellCoords,
  mergeCells,
  selectedCellRange,
  setCellBackground,
  setCellVerticalAlign,
  tableGrid,
  unmergeCell,
} from "../../../core/table/operations";
import {
  registerOverlay,
  useOverlayAuthorityRef,
  type OverlaySurfaceContext,
} from "../../spi";
import { getCellRange, setCellRange } from "./cell-range";
import { CellFillPalette } from "./cell-fill-palette";

/** Register the table's overlay contributors (docs/029 R1-E): the cell `…` popover. */
export function registerTableOverlays(): void {
  registerOverlay({
    contentKind: "card",
    focusMode: "taking",
    id: "cell.actions",
    render: (ctx) => <CellActionsPanel ctx={ctx} />,
    target: "cell",
  });
}

type Coords = { readonly row: number; readonly col: number };

type CellHit = {
  readonly tableId: NodeId;
  readonly cellId: NodeId;
  readonly coords: Coords;
};

type RangeState = {
  readonly tableId: NodeId;
  readonly anchor: Coords;
  readonly focus: Coords;
};

const CELL_SELECTOR = '[data-engine-structural="tablecell"]';
const TABLE_SELECTOR = '[data-engine-structural="table"]';

/** Resolve a client point to the table cell under it, with its grid coordinates. */
function cellHitAt(store: EditorStore, x: number, y: number): CellHit | null {
  if (typeof document.elementFromPoint !== "function") return null;
  const el = document.elementFromPoint(x, y);
  const cellEl = el?.closest<HTMLElement>(CELL_SELECTOR);
  const tableEl = el?.closest<HTMLElement>(TABLE_SELECTOR);
  const cellId = cellEl?.getAttribute("data-engine-block-id") as NodeId | null;
  const tableId = tableEl?.getAttribute(
    "data-engine-block-id",
  ) as NodeId | null;
  if (!cellId || !tableId) return null;
  const coords = cellCoords(tableGrid(store, tableId), cellId);
  return coords ? { cellId, coords, tableId } : null;
}

function cellRectOf(cellId: NodeId): DOMRect | null {
  const el = document.querySelector<HTMLElement>(
    `[data-engine-block-id="${cellId}"]`,
  );
  return el ? el.getBoundingClientRect() : null;
}

/** The table id enclosing a cell, from the mounted DOM (the panel renders over a live cell). */
function tableIdForCell(cellId: NodeId): NodeId | null {
  const el = document.querySelector<HTMLElement>(
    `[data-engine-block-id="${cellId}"]`,
  );
  const table = el?.closest<HTMLElement>(TABLE_SELECTOR);
  return (table?.getAttribute("data-engine-block-id") as NodeId | null) ?? null;
}

/** Whether a cell carries a span — drives the "Unmerge cell" affordance. */
function cellMerged(store: EditorStore, cellId: NodeId): boolean {
  const cell = store.getNode(cellId);
  if (cell?.kind !== "structural") return false;
  const cs = cell.attrs?.colSpan;
  const rs = cell.attrs?.rowSpan;
  return (
    (typeof cs === "number" && cs > 1) || (typeof rs === "number" && rs > 1)
  );
}

/**
 * The cell `…` popover body (docs/029 R1-E) — rendered by the overlay authority as the
 * `cell`-target envelope's content. It is decoupled from `TableInteractions`' refs: the
 * acted-on cells are recomputed at render from the `cell-range` channel + the anchored cell
 * (`ctx.anchor`), so it can live as a registered contributor. Applying any action dismisses
 * the popover (`ctx.dismiss`); the authority handles outside-press + Escape dismissal.
 */
export function CellActionsPanel(props: {
  readonly ctx: OverlaySurfaceContext;
}) {
  const { ctx } = props;
  const { store, anchor, dismiss } = ctx;
  if (anchor?.kind !== "cell") return null;
  const cellId = anchor.cellId;
  const range = getCellRange(store);

  /** The cells an action targets: a genuine ≥2-cell range the anchor is inside, else it. */
  const targets = (): readonly NodeId[] => {
    if (range) {
      const cells = selectedCellRange(
        tableGrid(store, range.tableId),
        range.anchor,
        range.focus,
      ).cellIds;
      if (cells.length >= 2 && cells.includes(cellId)) return cells;
    }
    return [cellId];
  };
  const rangeCount = range
    ? selectedCellRange(
        tableGrid(store, range.tableId),
        range.anchor,
        range.focus,
      ).cellIds.length
    : 0;
  const canMerge = rangeCount >= 2;
  const canUnmerge = cellMerged(store, cellId);

  return (
    <div className="flex w-56 flex-col gap-2" data-engine-cell-toolbar="">
      {canMerge ? (
        <AriaButton
          className="flex cursor-pointer items-center gap-2 rounded-field px-3 py-1.5 text-sm outline-none hover:bg-base-200"
          onPress={() => {
            if (range)
              mergeCells(store, range.tableId, range.anchor, range.focus);
            setCellRange(store, null);
            dismiss();
          }}
        >
          <NavIcon name="Combine" />
          Merge cells
        </AriaButton>
      ) : null}
      {canUnmerge ? (
        <AriaButton
          className="flex cursor-pointer items-center gap-2 rounded-field px-3 py-1.5 text-sm outline-none hover:bg-base-200"
          onPress={() => {
            const tableId = tableIdForCell(cellId);
            if (tableId) unmergeCell(store, tableId, cellId);
            dismiss();
          }}
        >
          <NavIcon name="Ungroup" />
          Unmerge cell
        </AriaButton>
      ) : null}
      <div className="px-1 text-xs font-medium text-base-content/60">
        Fill color
      </div>
      <CellFillPalette
        onPick={(color) => {
          setCellBackground(store, targets(), color);
          dismiss();
        }}
      />
      <div className="px-1 text-xs font-medium text-base-content/60">
        Vertical align
      </div>
      <div className="flex gap-1 px-1">
        {(["top", "middle", "bottom"] as const).map((align) => (
          <AriaButton
            className="flex-1 cursor-pointer rounded-field px-2 py-1 text-sm capitalize outline-none hover:bg-base-200"
            key={align}
            onPress={() => {
              setCellVerticalAlign(store, targets(), align);
              dismiss();
            }}
          >
            {align}
          </AriaButton>
        ))}
      </div>
    </div>
  );
}

export function TableInteractions(props: { readonly store: EditorStore }) {
  const { store } = props;
  const authorityRef = useOverlayAuthorityRef();
  const [range, setRange] = useState<RangeState | null>(null);
  // The cell under the pointer drives the floating … button (hover, not focus).
  const [hovered, setHovered] = useState<CellHit | null>(null);
  const [, bump] = useState(0);
  const rangeRef = useRef<RangeState | null>(null);
  const dragRef = useRef<(CellHit & { moved: boolean }) | null>(null);
  const hoveredRef = useRef<CellHit | null>(null);
  // The floating `…` button's own element, so the popover anchors to the button (its bottom-left)
  // and drops from it, instead of the cell's origin (docs/029 R1-E; the cell anchor's `at`).
  const cellButtonRef = useRef<HTMLDivElement | null>(null);
  rangeRef.current = range;

  // Mirror the drag range into the per-store channel so both the cell `…` panel and the
  // right-click context menu's "Merge cells" contribution read it (docs/024 §7.4).
  useEffect(() => {
    setCellRange(store, range);
  }, [store, range]);

  // The cell the button is attached to: the hovered cell.
  const anchorCell: CellHit | null = hovered;

  // Re-render on commit and on selection move so the button tracks the caret; also drop a
  // stale range the moment the caret leaves it.
  useEffect(() => store.subscribeCommit(() => bump((n) => n + 1)), [store]);
  useEffect(
    () =>
      store.subscribeSelection(() => {
        if (rangeRef.current && !dragRef.current?.moved) setRange(null);
        bump((n) => n + 1);
      }),
    [store],
  );

  useEffect(() => {
    // The `…` button + the authority's cell panel both carry `data-engine-cell-toolbar`;
    // moving onto either keeps the hovered cell so the button does not vanish before a click.
    function inChrome(target: EventTarget | null): boolean {
      return (
        target instanceof Element &&
        target.closest("[data-engine-cell-toolbar]") !== null
      );
    }
    // Whether the press/move landed inside a body-portaled overlay (docs/029 §7.4 ownership
    // containment, replacing the old `data-engine-view-root` selector): the cell hit test is
    // geometric, so a press inside an overlay floating over the table must not start a cell
    // drag or paint hover/range overlays over it. Ownership covers *every* overlay, not just
    // those outside the view root.
    function onOverlay(target: EventTarget | null): boolean {
      return (
        target instanceof Node &&
        (authorityRef?.current?.ownership.isWithin(target) ?? false)
      );
    }
    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || inChrome(event.target)) return;
      if (rangeRef.current) setRange(null);
      if (onOverlay(event.target)) {
        dragRef.current = null;
        return;
      }
      const hit = cellHitAt(store, event.clientX, event.clientY);
      dragRef.current = hit ? { ...hit, moved: false } : null;
    }
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (drag && event.buttons !== 0) {
        const hit = cellHitAt(store, event.clientX, event.clientY);
        if (!hit || hit.tableId !== drag.tableId) return;
        if (hit.cellId === drag.cellId && !drag.moved) return;
        drag.moved = true;
        // Painting a cell range supersedes the native text drag-selection.
        event.preventDefault();
        document.getSelection()?.removeAllRanges();
        setRange({
          anchor: drag.coords,
          focus: hit.coords,
          tableId: drag.tableId,
        });
        return;
      }
      // Not dragging: hover-anchor the … button to the cell under the pointer. Over the
      // toolbar/panel keep the last hovered cell (inChrome); over any other overlay clear
      // the hover so the cell … button never renders on top of it.
      if (inChrome(event.target)) return;
      if (onOverlay(event.target)) {
        if (hoveredRef.current) {
          hoveredRef.current = null;
          setHovered(null);
        }
        return;
      }
      const hit = cellHitAt(store, event.clientX, event.clientY);
      if ((hit?.cellId ?? null) !== (hoveredRef.current?.cellId ?? null)) {
        hoveredRef.current = hit;
        setHovered(hit);
      }
    }
    function onPointerUp() {
      dragRef.current = null;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && rangeRef.current) setRange(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [store, authorityRef]);

  const rangeRects = range
    ? selectedCellRange(
        tableGrid(store, range.tableId),
        range.anchor,
        range.focus,
      ).cellIds.flatMap((id) => {
        const el = document.querySelector<HTMLElement>(
          `[data-engine-block-id="${id}"]`,
        );
        return el ? [el.getBoundingClientRect()] : [];
      })
    : [];

  // The button anchors to the hovered cell.
  const anchorRect = anchorCell ? cellRectOf(anchorCell.cellId) : null;

  return (
    <>
      {rangeRects.length > 0
        ? createPortal(
            <div
              className="pointer-events-none fixed inset-0 z-30"
              data-engine-table-selection=""
            >
              {rangeRects.map((rect, index) => (
                <div
                  className="absolute border border-primary bg-primary/20"
                  key={index}
                  style={{
                    height: rect.height,
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                  }}
                />
              ))}
            </div>,
            document.body,
          )
        : null}

      {anchorRect && anchorCell
        ? createPortal(
            <div
              className="pointer-events-auto fixed z-40"
              data-engine-cell-toolbar=""
              ref={cellButtonRef}
              style={{
                left: Math.max(4, anchorRect.right - 34),
                top: anchorRect.top + 6,
              }}
            >
              <ChromeButton
                icon="Ellipsis"
                label="Cell actions"
                onPress={() => {
                  // Anchor the panel to the button's live rect so it drops from the button, not
                  // the cell's far corner (the resolver's `at` override, docs/029 R1-E).
                  const r = cellButtonRef.current?.getBoundingClientRect();
                  authorityRef?.current?.open(
                    {
                      at: r ? { x: r.left, y: r.bottom } : undefined,
                      cellId: anchorCell.cellId,
                      kind: "cell",
                    },
                    "cell.actions",
                  );
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
