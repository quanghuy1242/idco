/**
 * Table cell-range selection + the cell-action button (docs/022 §7).
 *
 * Dragging across cells paints a rectangular range overlay (a *view-layer*
 * selection — it never enters the core `EditorSelection` union). A single `…`
 * button floats at the *hovered* cell's top-right (not the focused cell), pinned
 * to that cell while its popover is open; the popover holds merge / unmerge /
 * fill color / vertical align. Targets are resolved *live at action time* — a
 * genuine ≥2-cell range the anchor is inside, else the anchor (hovered) cell — so
 * the button always acts on the cell it visually belongs to, and a stale range is
 * dropped as soon as the caret moves. Right-click stays the editor's
 * `EngineContextMenu` (one menu only). Pointer/layout-driven, so it is
 * typecheck/build-verified and exercised manually.
 */
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { ChromeButton, NavIcon, PopoverTrigger } from "@quanghuy1242/idco-ui";
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
const TABLE_SELECTOR =
  '[data-engine-structural="table"],[data-engine-structural="editor-table"]';

// A compact fill palette that reads on light and dark surfaces; "none" clears.
const FILL_COLORS: readonly string[] = [
  "#7f1d1d",
  "#7c2d12",
  "#713f12",
  "#14532d",
  "#0f766e",
  "#1e3a8a",
  "#4c1d95",
  "#831843",
  "#3f3f46",
];

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

export function TableInteractions(props: { readonly store: EditorStore }) {
  const { store } = props;
  const [range, setRange] = useState<RangeState | null>(null);
  // The cell under the pointer drives the floating … button (hover, not focus).
  const [hovered, setHovered] = useState<CellHit | null>(null);
  // The popover is controlled so its cell can be *pinned* while it is open — the
  // pointer is then free to roam onto the popover or off the table without
  // moving or dismissing the menu.
  const [open, setOpen] = useState(false);
  const [, bump] = useState(0);
  const rangeRef = useRef<RangeState | null>(null);
  const dragRef = useRef<(CellHit & { moved: boolean }) | null>(null);
  const hoveredRef = useRef<CellHit | null>(null);
  const pinnedRef = useRef<CellHit | null>(null);
  const anchorRef = useRef<CellHit | null>(null);
  rangeRef.current = range;

  // The cell the button is attached to: the pinned cell while the menu is open,
  // else the hovered cell. Actions hit this cell (the one the button visually
  // belongs to), so the button and its effect never disagree.
  const anchorCell: CellHit | null =
    (open ? pinnedRef.current : null) ?? hovered;
  anchorRef.current = anchorCell;

  /** The cells an action targets, resolved live at click time: a genuine ≥2-cell
   *  range the anchor is inside, else the anchor cell. */
  const liveTargets = (): readonly NodeId[] => {
    const cell = anchorRef.current;
    if (!cell) return [];
    const r = rangeRef.current;
    if (r) {
      const cells = selectedCellRange(
        tableGrid(store, r.tableId),
        r.anchor,
        r.focus,
      ).cellIds;
      if (cells.length >= 2 && cells.includes(cell.cellId)) {
        return cells;
      }
    }
    return [cell.cellId];
  };

  // Re-render on commit and on selection move so the button + targets track the
  // caret; also drop a stale range the moment the caret leaves it.
  useEffect(() => store.subscribeCommit(() => bump((n) => n + 1)), [store]);
  useEffect(
    () =>
      store.subscribeSelection(() => {
        // A caret move ends the transient cell range. The drag paints the range
        // through pointermove without dispatching a store selection, so a
        // `subscribeSelection` fire means the editor caret genuinely moved — the
        // user has left the drag, so the range collapses, exactly as selecting a
        // new caret clears a block selection. This is the wrong-cell-fill fix: a
        // stale range can no longer outlive the caret and hijack a single-cell
        // action. The drag guard keeps an in-progress paint from self-clearing.
        if (rangeRef.current && !dragRef.current?.moved) setRange(null);
        bump((n) => n + 1);
      }),
    [store],
  );

  useEffect(() => {
    function inChrome(target: EventTarget | null): boolean {
      return (
        target instanceof Element &&
        target.closest("[data-engine-cell-toolbar]") !== null
      );
    }
    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || inChrome(event.target)) return;
      if (rangeRef.current) setRange(null);
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
      // Not dragging: hover-anchor the … button to the cell under the pointer.
      // Over the toolbar/popover we keep the last hovered cell (inChrome), so
      // moving onto the button does not dismiss it.
      if (inChrome(event.target)) return;
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
  }, [store]);

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

  // The button anchors to the hovered (or pinned-while-open) cell.
  const anchorRect = anchorCell ? cellRectOf(anchorCell.cellId) : null;
  const rangeCellCount = range
    ? selectedCellRange(
        tableGrid(store, range.tableId),
        range.anchor,
        range.focus,
      ).cellIds.length
    : 0;
  const canMerge = rangeCellCount >= 2;
  const canUnmerge = !!anchorCell && cellMerged(store, anchorCell.cellId);

  function applyFill(color: string | undefined) {
    setCellBackground(store, liveTargets(), color);
  }
  function applyAlign(align: "top" | "middle" | "bottom") {
    setCellVerticalAlign(store, liveTargets(), align);
  }

  return (
    <>
      {rangeRects.length > 0
        ? createPortal(
            <div
              data-engine-table-selection=""
              className="pointer-events-none fixed inset-0 z-30"
            >
              {rangeRects.map((rect, index) => (
                <div
                  key={index}
                  className="absolute border border-primary bg-primary/20"
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

      {anchorRect
        ? createPortal(
            <div
              data-engine-cell-toolbar=""
              className="pointer-events-auto fixed z-40"
              style={{
                left: Math.max(4, anchorRect.right - 34),
                top: anchorRect.top + 6,
              }}
            >
              <PopoverTrigger
                ariaLabel="Cell actions"
                placement="bottom end"
                isOpen={open}
                onOpenChange={(next) => {
                  // Pin the cell the menu was opened on, so it stays put while
                  // the pointer roams onto the popover or off the table.
                  pinnedRef.current = next ? anchorRef.current : null;
                  setOpen(next);
                }}
                trigger={<ChromeButton icon="Ellipsis" label="Cell actions" />}
              >
                {(close) => (
                  <div
                    data-engine-cell-toolbar=""
                    className="flex w-56 flex-col gap-2"
                  >
                    {canMerge ? (
                      <AriaButton
                        className="flex cursor-pointer items-center gap-2 rounded-field px-3 py-1.5 text-sm outline-none hover:bg-base-200"
                        onPress={() => {
                          const r = rangeRef.current;
                          if (r)
                            mergeCells(store, r.tableId, r.anchor, r.focus);
                          setRange(null);
                          close();
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
                          const c = anchorRef.current;
                          if (c) unmergeCell(store, c.tableId, c.cellId);
                          close();
                        }}
                      >
                        <NavIcon name="Ungroup" />
                        Unmerge cell
                      </AriaButton>
                    ) : null}
                    <div className="px-1 text-xs font-medium text-base-content/60">
                      Fill color
                    </div>
                    <div className="flex flex-wrap gap-2 px-1">
                      {FILL_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          aria-label={`Fill ${color}`}
                          className="size-6 rounded-full border border-base-300 transition hover:scale-110"
                          style={{ background: color }}
                          onClick={() => {
                            applyFill(color);
                            close();
                          }}
                        />
                      ))}
                      <button
                        type="button"
                        aria-label="Clear fill"
                        className="grid size-6 place-items-center rounded-full border border-base-300 text-base-content/60 transition hover:scale-110"
                        onClick={() => {
                          applyFill(undefined);
                          close();
                        }}
                      >
                        <NavIcon name="X" />
                      </button>
                    </div>
                    <div className="px-1 text-xs font-medium text-base-content/60">
                      Vertical align
                    </div>
                    <div className="flex gap-1 px-1">
                      {(["top", "middle", "bottom"] as const).map((align) => (
                        <AriaButton
                          key={align}
                          className="flex-1 cursor-pointer rounded-field px-2 py-1 text-sm capitalize outline-none hover:bg-base-200"
                          onPress={() => {
                            applyAlign(align);
                            close();
                          }}
                        >
                          {align}
                        </AriaButton>
                      ))}
                    </div>
                  </div>
                )}
              </PopoverTrigger>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
