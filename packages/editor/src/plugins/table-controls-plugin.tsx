import { NavIcon } from "@quanghuy1242/idco-ui";
import {
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableNode,
} from "@lexical/table";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNearestNodeFromDOMNode, $getNodeByKey } from "lexical";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { resizeColumnWidths } from "../model/layout";

const CTRL_ATTR = "data-idco-table-controls";
const MIN_WIDTH = 48;
// How far outside the table the cursor can be while controls stay visible —
// wide enough on the left/top to reach the insert buttons sitting in the gutter.
const BAND_LEFT = 28;
const BAND_TOP = 22;
const BAND_PAD = 8;

// Cursor must be within this far of a boundary (and near the matching edge) for
// that single insert button to reveal — keeps the controls calm instead of
// flashing every boundary at once.
const NEAR = 18;

type Geom = {
  readonly table: HTMLTableElement;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  /** Viewport x of every column boundary, including the table's left/right edge. */
  readonly cols: readonly number[];
  /** Viewport y of every row boundary, including the table's top/bottom edge. */
  readonly rows: readonly number[];
  /** Current cursor position, used to reveal only the nearest insert button. */
  readonly mouseX: number;
  readonly mouseY: number;
};

function nearestIndex(values: readonly number[], target: number): number {
  let best = 0;
  let bestDistance = Infinity;
  values.forEach((value, index) => {
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function computeGeom(
  table: HTMLTableElement,
  mouseX: number,
  mouseY: number,
): Geom | null {
  const rect = table.getBoundingClientRect();
  const headerRow = table.rows[0];
  if (!headerRow) return null;
  const cols = [rect.left];
  for (const cell of Array.from(headerRow.cells)) {
    cols.push(cell.getBoundingClientRect().right);
  }
  const rows = [rect.top];
  for (const row of Array.from(table.rows)) {
    rows.push(row.getBoundingClientRect().bottom);
  }
  return {
    bottom: rect.bottom,
    cols,
    left: rect.left,
    mouseX,
    mouseY,
    right: rect.right,
    rows,
    table,
    top: rect.top,
  };
}

/**
 * Word/Docs-style live table controls. Only the single insert "+" nearest the
 * cursor reveals — a column "+" above the boundary when the cursor is near the
 * top edge, a row "+" left of the boundary when near the left edge — so the
 * controls stay calm instead of flashing every boundary at once. Internal column
 * boundaries also expose a drag handle to resize the column (revealed on hover).
 * Row/column *deletion* stays in the toolbar.
 */
export function TableControlsPlugin() {
  const [editor] = useLexicalComposerContext();
  const [geom, setGeom] = useState<Geom | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    function onMove(event: MouseEvent) {
      if (dragging.current) return;
      const tables = Array.from(
        root!.querySelectorAll("table"),
      ) as HTMLTableElement[];
      const active = tables.find((table) => {
        const r = table.getBoundingClientRect();
        return (
          event.clientX >= r.left - BAND_LEFT &&
          event.clientX <= r.right + BAND_PAD &&
          event.clientY >= r.top - BAND_TOP &&
          event.clientY <= r.bottom + BAND_PAD
        );
      });
      setGeom(
        active ? computeGeom(active, event.clientX, event.clientY) : null,
      );
    }

    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, [editor]);

  function cellAt(
    rowIndex: number,
    colIndex: number,
  ): HTMLTableCellElement | null {
    const row = geom?.table.rows[rowIndex];
    return (row?.cells[colIndex] as HTMLTableCellElement | undefined) ?? null;
  }

  function insertColumn(boundary: number) {
    // boundary 0 = before first column; boundary N = after last column.
    const targetCol = boundary === 0 ? 0 : boundary - 1;
    const after = boundary !== 0;
    const cell = cellAt(0, targetCol);
    if (!cell) return;
    editor.update(() => {
      const cellNode = $getTableCellNodeFromLexicalNode(
        $getNearestNodeFromDOMNode(cell)!,
      );
      if (!cellNode) return;
      cellNode.selectEnd();
      $insertTableColumnAtSelection(after);
    });
    requestAnimationFrame(() => editor.focus());
  }

  function insertRow(boundary: number) {
    const targetRow = boundary === 0 ? 0 : boundary - 1;
    const after = boundary !== 0;
    const cell = cellAt(targetRow, 0);
    if (!cell) return;
    editor.update(() => {
      const cellNode = $getTableCellNodeFromLexicalNode(
        $getNearestNodeFromDOMNode(cell)!,
      );
      if (!cellNode) return;
      cellNode.selectEnd();
      $insertTableRowAtSelection(after);
    });
    requestAnimationFrame(() => editor.focus());
  }

  function startResize(event: React.PointerEvent, boundary: number) {
    if (!geom) return;
    event.preventDefault();
    event.stopPropagation();
    const colIndex = boundary - 1;
    const headerCells = geom.table.rows[0]?.cells;
    const cols = geom.table.querySelector("colgroup")?.children;
    if (!headerCells || !cols) return;
    const widths = Array.from(headerCells).map((cell) =>
      Math.round(cell.getBoundingClientRect().width),
    );
    let tableKey = "";
    // `editor.read` (not `editorState.read`) sets the active editor that
    // `$getNearestNodeFromDOMNode` requires — without it the lookup throws and
    // the drag silently no-ops.
    editor.read(() => {
      const node = $getNearestNodeFromDOMNode(geom.table);
      if (node) tableKey = $getTableNodeFromLexicalNodeOrThrow(node).getKey();
    });
    if (!tableKey) return;
    dragging.current = true;
    const startX = event.clientX;
    let committed = [...widths];
    const rightIndex = colIndex + 1;

    // Resize live by writing the `<col>` widths straight to the DOM. Routing
    // every move through `editor.update` instead would emit a controlled-value
    // change per frame; the document-sync plugin then races the lagging `value`
    // and reverts the drag. So preview on the DOM (no reconcile runs mid-drag)
    // and commit to the model once on release. `resizeColumnWidths` trades width
    // with the adjacent column so the table's total width stays constant.
    function onDragMove(moveEvent: PointerEvent) {
      const next = resizeColumnWidths(
        widths,
        colIndex,
        moveEvent.clientX - startX,
        MIN_WIDTH,
      );
      committed = next;
      const leftCol = cols![colIndex] as HTMLElement | undefined;
      const rightCol = cols![rightIndex] as HTMLElement | undefined;
      if (leftCol) leftCol.style.width = `${next[colIndex]}px`;
      if (rightCol) rightCol.style.width = `${next[rightIndex]}px`;
    }
    function endDrag() {
      dragging.current = false;
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", endDrag);
      editor.update(() => {
        const node = $getNodeByKey(tableKey);
        if ($isTableNode(node)) node.setColWidths(committed);
      });
    }
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
  }

  if (!geom) return null;

  const insertButtonClass =
    "pointer-events-auto absolute grid size-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-base-300 bg-base-100 text-base-content/80 shadow-sm transition hover:scale-110 hover:border-primary hover:bg-primary hover:text-primary-content";

  // Reveal only the single nearest insert button, and only when the cursor is by
  // the matching edge: a column "+" when near the top, a row "+" when near the
  // left. The cursor reaching up/left to the button (just outside the table)
  // keeps it shown.
  const nearTop = geom.mouseY <= geom.top + NEAR;
  const nearLeft = geom.mouseX <= geom.left + NEAR;
  const activeCol = nearTop ? nearestIndex(geom.cols, geom.mouseX) : -1;
  const activeRow = nearLeft ? nearestIndex(geom.rows, geom.mouseY) : -1;

  return createPortal(
    <div
      {...{ [CTRL_ATTR]: "" }}
      className="pointer-events-none fixed inset-0 z-40"
    >
      {/* Column resize handles at each internal boundary (revealed on hover). */}
      {geom.cols.map((x, index) =>
        index > 0 && index < geom.cols.length - 1 ? (
          <div
            key={`resize-${index}`}
            role="separator"
            aria-label="Resize column"
            onPointerDown={(event) => startResize(event, index)}
            className="pointer-events-auto absolute w-2 -translate-x-1/2 cursor-col-resize bg-primary/0 transition-colors hover:bg-primary/40"
            style={{ height: geom.bottom - geom.top, left: x, top: geom.top }}
          />
        ) : null,
      )}

      {/* Nearest column insert button, just above the boundary by the cursor. */}
      {activeCol >= 0 ? (
        <button
          type="button"
          aria-label={
            activeCol === 0
              ? "Insert column at start"
              : activeCol === geom.cols.length - 1
                ? "Insert column at end"
                : "Insert column"
          }
          onClick={() => insertColumn(activeCol)}
          className={insertButtonClass}
          style={{ left: geom.cols[activeCol], top: geom.top - 13 }}
        >
          <NavIcon name="Plus" variant="timeline" />
        </button>
      ) : null}

      {/* Nearest row insert button, just left of the boundary by the cursor. */}
      {activeRow >= 0 ? (
        <button
          type="button"
          aria-label={
            activeRow === 0
              ? "Insert row at start"
              : activeRow === geom.rows.length - 1
                ? "Insert row at end"
                : "Insert row"
          }
          onClick={() => insertRow(activeRow)}
          className={insertButtonClass}
          style={{ left: geom.left - 13, top: geom.rows[activeRow] }}
        >
          <NavIcon name="Plus" variant="timeline" />
        </button>
      ) : null}
    </div>,
    document.body,
  );
}
