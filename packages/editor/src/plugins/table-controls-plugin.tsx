import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $insertTableColumnAtSelection,
  $insertTableRowAtSelection,
  $isTableNode,
} from "@lexical/table";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { Menu, MenuItem, MenuTrigger, NavIcon } from "@quanghuy1242/idco-ui";
import { $getNearestNodeFromDOMNode, $getNodeByKey } from "lexical";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BlockChrome, ChromeButton, ChromeSelect } from "../nodes/chrome";
import {
  resizeColumnWidths,
  scaleColumnWidths,
  splitColumnWidths,
} from "../model/layout";
import {
  $readTableMeta,
  $setHeaderColumn,
  $setHeaderRow,
  EditorTableNode,
  isResponsiveLayout,
  TABLE_LAYOUTS,
  type TableLayout,
  type TableMeta,
} from "../nodes/table-node";

const CTRL_ATTR = "data-idco-table-controls";
const MIN_WIDTH = 48;
// How far outside the table the cursor can be while controls stay visible.
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
  /** Viewport x of every column center. */
  readonly colCenters: readonly number[];
  /** Viewport y of every row center. */
  readonly rowCenters: readonly number[];
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

function centers(values: readonly number[]) {
  return values
    .slice(0, -1)
    .map((value, index) => (value + values[index + 1]!) / 2);
}

function selectTableCell(cell: HTMLTableCellElement): boolean {
  const lexicalNode = $getNearestNodeFromDOMNode(cell);
  if (!lexicalNode) return false;
  const cellNode = $getTableCellNodeFromLexicalNode(lexicalNode);
  if (!cellNode) return false;
  cellNode.selectEnd();
  return true;
}

function measuredWidth(element: HTMLElement | null | undefined): number {
  if (!element) return 0;
  return Math.round(
    element.clientWidth || element.getBoundingClientRect().width || 0,
  );
}

function tableAvailableWidth(table: HTMLTableElement): number {
  return measuredWidth(table.parentElement) || measuredWidth(table);
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
    colCenters: centers(cols),
    cols,
    left: rect.left,
    mouseX,
    mouseY,
    right: rect.right,
    rowCenters: centers(rows),
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
 * Row/column deletion and whole-table removal live here so table structure is
 * managed next to the table instead of in the global formatting toolbar.
 */
export function TableControlsPlugin() {
  const [editor] = useLexicalComposerContext();
  const [geom, setGeom] = useState<Geom | null>(null);
  const [meta, setMeta] = useState<TableMeta | null>(null);
  const dragging = useRef(false);
  // Pin the chrome while one of its menus (layout select, structure toggles) is
  // open: the menu Popover renders outside the table's hover band, so without
  // this a mousemove onto it would clear `geom` and unmount the menu mid-click.
  const pinned = useRef(false);

  // Read the active table's layout/header/numbers state from the model whenever
  // the hovered table changes — drives the chrome selectors and the header-edge
  // insert guard. Re-read on every editor update so a toggle reflects instantly.
  const tableEl = geom?.table ?? null;
  useEffect(() => {
    if (!tableEl) {
      setMeta(null);
      return;
    }
    function refresh() {
      setMeta(
        editor.read(() => {
          const node = $getNearestNodeFromDOMNode(tableEl!);
          const table = node ? $getTableNodeFromLexicalNodeOrThrow(node) : null;
          return table instanceof EditorTableNode
            ? $readTableMeta(table)
            : null;
        }),
      );
    }
    refresh();
    return editor.registerUpdateListener(refresh);
  }, [editor, tableEl]);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    function onMove(event: MouseEvent) {
      if (dragging.current || pinned.current) return;
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

  function deleteColumn(colIndex: number) {
    const cell = cellAt(0, colIndex);
    const table = geom?.table;
    if (!cell || !table) return;
    const width = tableAvailableWidth(table);
    editor.update(() => {
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(
        $getNearestNodeFromDOMNode(table)!,
      );
      const tableKey = tableNode.getKey();
      if (!selectTableCell(cell)) return;
      $deleteTableColumnAtSelection();
      const nextTable = $getNodeByKey(tableKey);
      if ($isTableNode(nextTable) && width > 0) {
        nextTable.setColWidths(
          splitColumnWidths(width, nextTable.getColumnCount()),
        );
      }
    });
    setGeom(null);
    requestAnimationFrame(() => editor.focus());
  }

  function deleteRow(rowIndex: number) {
    const cell = cellAt(rowIndex, 0);
    if (!cell) return;
    editor.update(() => {
      if (!selectTableCell(cell)) return;
      $deleteTableRowAtSelection();
    });
    setGeom(null);
    requestAnimationFrame(() => editor.focus());
  }

  function removeTable() {
    const table = geom?.table;
    if (!table) return;
    editor.update(() => {
      const node = $getNearestNodeFromDOMNode(table);
      if (!node) return;
      $getTableNodeFromLexicalNodeOrThrow(node).remove();
    });
    setGeom(null);
    requestAnimationFrame(() => editor.focus());
  }

  // Run `mutate` against the EditorTableNode behind the active table. `refocus`
  // is skipped for the structure toggles so the multi-select menu stays open
  // across taps (refocusing the editor would close it).
  function withTableNode(
    mutate: (node: EditorTableNode) => void,
    refocus = true,
  ) {
    const table = geom?.table;
    if (!table) return;
    editor.update(() => {
      const node = $getNearestNodeFromDOMNode(table);
      if (!node) return;
      const tableNode = $getTableNodeFromLexicalNodeOrThrow(node);
      if (tableNode instanceof EditorTableNode) mutate(tableNode);
    });
    if (refocus) requestAnimationFrame(() => editor.focus());
  }

  function changeLayout(layout: TableLayout) {
    const container = measuredWidth(geom?.table.parentElement);
    withTableNode((node) => {
      node.setLayout(layout);
      // Entering a responsive mode pins the columns to the container so the
      // table starts filling it; proportions are preserved by scaleColumnWidths.
      const widths = node.getColWidths();
      if (isResponsiveLayout(layout) && widths && container > 0) {
        node.setColWidths(scaleColumnWidths(widths, container));
      }
    });
  }

  function toggleHeaderRow(on: boolean) {
    withTableNode((node) => $setHeaderRow(node, on), false);
  }

  function toggleHeaderColumn(on: boolean) {
    withTableNode((node) => $setHeaderColumn(node, on), false);
  }

  function toggleRowNumbers(on: boolean) {
    withTableNode((node) => node.setShowRowNumbers(on), false);
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

  // Position a portal-overlay chrome button at a viewport point, centered on it.
  const overlayButtonClass =
    "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 hover:scale-110";

  // Reveal only the single nearest insert button, and only when the cursor is by
  // the matching edge: a column "+" when near the top, a row "+" when near the
  // left. The cursor reaching up/left to the button (just outside the table)
  // keeps it shown.
  const nearTop = geom.mouseY <= geom.top + NEAR;
  const nearLeft = geom.mouseX <= geom.left + NEAR;
  const rawActiveCol = nearTop ? nearestIndex(geom.cols, geom.mouseX) : -1;
  const rawActiveRow = nearLeft ? nearestIndex(geom.rows, geom.mouseY) : -1;
  // Header-edge guard: a header row/column must stay the table's boundary, so we
  // suppress the "insert before the header" affordance (boundary 0). Inserting a
  // non-header row above the header row — or column before the header column —
  // is what pushed the header into the table's interior. Other inserts stand.
  const activeCol =
    meta?.headerColumn && rawActiveCol === 0 ? -1 : rawActiveCol;
  const activeRow = meta?.headerRow && rawActiveRow === 0 ? -1 : rawActiveRow;
  const activeDeleteCol =
    nearTop && geom.colCenters.length > 1
      ? nearestIndex(geom.colCenters, geom.mouseX)
      : -1;
  const activeDeleteRow =
    nearLeft && geom.rowCenters.length > 1
      ? nearestIndex(geom.rowCenters, geom.mouseY)
      : -1;

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
        <ChromeButton
          size="sm"
          intent="primary"
          fill
          icon="Plus"
          label={
            activeCol === 0
              ? "Insert column at start"
              : activeCol === geom.cols.length - 1
                ? "Insert column at end"
                : "Insert column"
          }
          onPress={() => insertColumn(activeCol)}
          className={overlayButtonClass}
          style={{ left: geom.cols[activeCol], top: geom.top - 13 }}
        />
      ) : null}

      {/* Column delete button, centred above the column by the cursor. */}
      {activeDeleteCol >= 0 ? (
        <ChromeButton
          size="sm"
          intent="danger"
          fill
          icon="Minus"
          label="Delete column"
          onPress={() => deleteColumn(activeDeleteCol)}
          className={overlayButtonClass}
          style={{ left: geom.colCenters[activeDeleteCol], top: geom.top - 13 }}
        />
      ) : null}

      {/* Nearest row insert button, just left of the boundary by the cursor. */}
      {activeRow >= 0 ? (
        <ChromeButton
          size="sm"
          intent="primary"
          fill
          icon="Plus"
          label={
            activeRow === 0
              ? "Insert row at start"
              : activeRow === geom.rows.length - 1
                ? "Insert row at end"
                : "Insert row"
          }
          onPress={() => insertRow(activeRow)}
          className={overlayButtonClass}
          style={{ left: geom.left - 13, top: geom.rows[activeRow] }}
        />
      ) : null}

      {/* Row delete button, centred left of the row by the cursor. */}
      {activeDeleteRow >= 0 ? (
        <ChromeButton
          size="sm"
          intent="danger"
          fill
          icon="Minus"
          label="Delete row"
          onPress={() => deleteRow(activeDeleteRow)}
          className={overlayButtonClass}
          style={{
            left: geom.left - 13,
            top: geom.rowCenters[activeDeleteRow],
          }}
        />
      ) : null}

      {/* Whole-table chrome uses the same top-left badge and top-right action
          slots as decorator blocks; only the host positioning is portalled. */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: geom.left,
          top: geom.top,
          width: geom.right - geom.left,
        }}
      >
        <BlockChrome
          icon="Table"
          label="Table"
          visibility="visible"
          actions={
            <>
              {meta ? (
                <ChromeSelect
                  label="Table layout"
                  value={meta.layout}
                  options={TABLE_LAYOUTS}
                  onChange={changeLayout}
                  onOpenChange={(open) => {
                    pinned.current = open;
                  }}
                />
              ) : null}
              <MenuTrigger
                onOpenChange={(open) => {
                  pinned.current = open;
                }}
              >
                <ChromeButton icon="Settings" label="Table structure" />
                <Menu
                  aria-label="Table structure"
                  className="w-52"
                  selectionMode="multiple"
                  selectedKeys={tableToggleKeys(meta)}
                  onSelectionChange={(keys) => applyToggleSelection(keys)}
                >
                  <MenuItem id="header-row" textValue="Header row">
                    <ToggleRow
                      on={meta?.headerRow}
                      icon="Rows3"
                      label="Header row"
                    />
                  </MenuItem>
                  <MenuItem id="header-column" textValue="Header column">
                    <ToggleRow
                      on={meta?.headerColumn}
                      icon="Columns3"
                      label="Header column"
                    />
                  </MenuItem>
                  <MenuItem id="row-numbers" textValue="Numbered column">
                    <ToggleRow
                      on={meta?.showRowNumbers}
                      icon="ListOrdered"
                      label="Numbered column"
                    />
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            </>
          }
          removeLabel="Remove table"
          onRemove={removeTable}
        />
      </div>
    </div>,
    document.body,
  );

  function applyToggleSelection(keys: "all" | Set<React.Key>) {
    if (keys === "all" || !meta) return;
    const has = (key: string) => keys.has(key);
    if (has("header-row") !== meta.headerRow)
      toggleHeaderRow(has("header-row"));
    if (has("header-column") !== meta.headerColumn) {
      toggleHeaderColumn(has("header-column"));
    }
    if (has("row-numbers") !== meta.showRowNumbers) {
      toggleRowNumbers(has("row-numbers"));
    }
  }
}

/** A structure-menu row: feature icon + label, with a leading check when on. */
function ToggleRow({
  on,
  icon,
  label,
}: {
  readonly on: boolean | undefined;
  readonly icon: string;
  readonly label: string;
}) {
  return (
    <span className="flex flex-1 items-center gap-2">
      <NavIcon name={icon} />
      <span className="flex-1">{label}</span>
      {on ? (
        <NavIcon name="Check" />
      ) : (
        <span aria-hidden className="inline-block w-4" />
      )}
    </span>
  );
}

/** Selected keys for the structure menu, derived from the table's live meta. */
function tableToggleKeys(meta: TableMeta | null): Set<string> {
  const keys = new Set<string>();
  if (meta?.headerRow) keys.add("header-row");
  if (meta?.headerColumn) keys.add("header-column");
  if (meta?.showRowNumbers) keys.add("row-numbers");
  return keys;
}
