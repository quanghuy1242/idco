/**
 * Table structure operations (docs/022 §6) — the table feature's command-builders.
 *
 * Every operation composes the engine's *general* primitives: row insert/delete go
 * through the generic `insert-structural-child`/`remove-structural-child` commands
 * (docs/021 §8.2); column ops and header toggles batch the same step kinds into one
 * `TransactionBuilder` so a single undo reverses the whole column (docs/022 §6);
 * resize is a generic `set-block-attr`. Core gains no table verb — the grid
 * invariant ("every row has the same cell count") lives here, in the consumer.
 */
import {
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  type EditorNode,
  type EditorStore,
  type NodeId,
} from "../core";

function structuralChildren(store: EditorStore, id: NodeId): readonly NodeId[] {
  const node = store.getNode(id);
  return node && node.kind === "structural" ? node.children : [];
}

/** The grid's column count, read off the first row (rows are kept rectangular). */
export function columnCount(store: EditorStore, tableId: NodeId): number {
  const rows = structuralChildren(store, tableId);
  return rows.length > 0 ? structuralChildren(store, rows[0]!).length : 0;
}

function buildCell(store: EditorStore): {
  cell: EditorNode;
  descendants: EditorNode[];
} {
  const paragraphId = store.allocator.createNodeId();
  const paragraph = makeTextNode({
    content: store.allocator.createTextSlice(""),
    id: paragraphId,
    type: "paragraph",
  });
  const cell = makeStructuralNode({
    children: [paragraphId],
    id: store.allocator.createNodeId(),
    type: "tablecell",
  });
  return { cell, descendants: [paragraph] };
}

function buildRow(
  store: EditorStore,
  colCount: number,
): { row: EditorNode; descendants: EditorNode[] } {
  const cells = Array.from({ length: Math.max(1, colCount) }, () =>
    buildCell(store),
  );
  const row = makeStructuralNode({
    children: cells.map((c) => c.cell.id),
    id: store.allocator.createNodeId(),
    type: "tablerow",
  });
  return { descendants: cells.flatMap((c) => [c.cell, ...c.descendants]), row };
}

/** Insert an empty row at `atIndex` (clamped), matching the current column count. */
export function insertRow(
  store: EditorStore,
  tableId: NodeId,
  atIndex: number,
): void {
  const rows = structuralChildren(store, tableId);
  const { row, descendants } = buildRow(store, columnCount(store, tableId));
  store.command({
    descendants,
    index: Math.max(0, Math.min(atIndex, rows.length)),
    node: row,
    scope: tableId,
    type: "insert-structural-child",
  });
}

/** Delete row `rowIndex`; refuses the last row so the table stays 1×1 (docs/022 §11). */
export function deleteRow(
  store: EditorStore,
  tableId: NodeId,
  rowIndex: number,
): void {
  const rows = structuralChildren(store, tableId);
  if (rows.length <= 1 || rowIndex < 0 || rowIndex >= rows.length) return;
  store.command({
    index: rowIndex,
    scope: tableId,
    type: "remove-structural-child",
  });
}

/** Insert a column at `atColIndex` in every row, as one undoable transaction. */
export function insertColumn(
  store: EditorStore,
  tableId: NodeId,
  atColIndex: number,
): void {
  const rows = structuralChildren(store, tableId);
  if (rows.length === 0) return;
  const tr = store.transaction();
  for (const rowId of rows) {
    const cells = structuralChildren(store, rowId);
    const { cell, descendants } = buildCell(store);
    tr.push({
      descendants,
      index: Math.max(0, Math.min(atColIndex, cells.length)),
      node: cell,
      parent: rowId,
      type: "insert-node",
    });
  }
  syncColWidths(store, tableId, tr, (widths) => {
    const i = Math.max(0, Math.min(atColIndex, widths.length));
    const width = widths[i] ?? widths.at(-1) ?? DEFAULT_COL_WIDTH;
    return [...widths.slice(0, i), width, ...widths.slice(i)];
  });
  store.dispatch(tr);
}

/** Delete column `colIndex` from every row; refuses the last column (docs/022 §11). */
export function deleteColumn(
  store: EditorStore,
  tableId: NodeId,
  colIndex: number,
): void {
  const rows = structuralChildren(store, tableId);
  if (columnCount(store, tableId) <= 1) return;
  const tr = store.transaction();
  for (const rowId of rows) {
    const cells = structuralChildren(store, rowId);
    const cellId = cells[colIndex];
    if (!cellId) continue;
    const cell = store.getNode(cellId);
    if (cell) tr.removeNode(rowId, colIndex, cell);
  }
  syncColWidths(store, tableId, tr, (widths) => {
    // Conserve the table's total width: rescale the remaining columns to the
    // pre-delete total so the table keeps filling its frame (legacy parity, B2).
    const remaining = widths.filter((_w, i) => i !== colIndex);
    const total = widths.reduce((sum, w) => sum + w, 0);
    return scaleColumnWidths(remaining, total);
  });
  store.dispatch(tr);
}

const DEFAULT_COL_WIDTH = 160;

/**
 * Keep `colWidths` length in sync with the column count on add/delete column
 * (docs/022 §6, §10.4), in the same transaction as the structure change so a
 * single undo reverses both. A no-op when the table has no `colWidths` (the
 * renderer auto-sizes), so untouched tables stay byte-stable.
 */
function syncColWidths(
  store: EditorStore,
  tableId: NodeId,
  tr: ReturnType<EditorStore["transaction"]>,
  next: (widths: readonly number[]) => readonly number[],
): void {
  const table = store.getNode(tableId);
  const current =
    table?.kind === "structural" ? table.attrs?.colWidths : undefined;
  if (!Array.isArray(current) || !current.every((n) => typeof n === "number")) {
    return;
  }
  tr.push({
    from: current,
    key: "colWidths",
    node: tableId,
    to: next(current as readonly number[]),
    type: "set-node-attr",
  });
}

// Per-cell header bitfield, matching the legacy Lexical `TableCellHeaderStates`
// (NO_STATUS=0, ROW=1, COLUMN=2). A corner cell can be both (3). Header is per
// cell, not a table property, so the toggles flip one axis's bit across the
// relevant cells, preserving the other axis (legacy `$setHeaderRow`/`Column`).
export const HEADER_ROW = 1;
export const HEADER_COLUMN = 2;

function headerStateOf(store: EditorStore, cellId: NodeId): number {
  const cell = store.getNode(cellId);
  return cell?.kind === "structural" &&
    typeof cell.attrs?.headerState === "number"
    ? cell.attrs.headerState
    : 0;
}

/** Set/clear one header `bit` across `cellIds`, preserving the other axis. */
function setHeaderBit(
  store: EditorStore,
  cellIds: readonly NodeId[],
  bit: number,
  on: boolean,
): void {
  const tr = store.transaction();
  let changed = false;
  for (const id of cellIds) {
    const cell = store.getNode(id);
    if (!cell || cell.kind !== "structural") continue;
    const current = headerStateOf(store, id);
    const next = on ? current | bit : current & ~bit;
    const to = next === 0 ? undefined : next;
    const from = cell.attrs?.headerState;
    if (from === to) continue;
    tr.push({ from, key: "headerState", node: id, to, type: "set-node-attr" });
    changed = true;
  }
  if (changed) store.dispatch(tr);
}

/** Flip the header-ROW bit across the first row's cells (legacy `$setHeaderRow`). */
export function toggleHeaderRow(store: EditorStore, tableId: NodeId): void {
  const rows = structuralChildren(store, tableId);
  if (rows.length === 0) return;
  const cells = structuralChildren(store, rows[0]!);
  const on = (headerStateOf(store, cells[0] ?? rows[0]!) & HEADER_ROW) === 0;
  setHeaderBit(store, cells, HEADER_ROW, on);
}

/** Flip the header-COLUMN bit across the first column's cells (`$setHeaderColumn`). */
export function toggleHeaderColumn(store: EditorStore, tableId: NodeId): void {
  const rows = structuralChildren(store, tableId);
  if (rows.length === 0) return;
  const firstCol = rows
    .map((rowId) => structuralChildren(store, rowId)[0])
    .filter((id): id is NodeId => id !== undefined);
  const on =
    (headerStateOf(store, firstCol[0] ?? rows[0]!) & HEADER_COLUMN) === 0;
  setHeaderBit(store, firstCol, HEADER_COLUMN, on);
}

/** Whether the first row / first column currently carries its header bit. */
export function headerState(
  store: EditorStore,
  tableId: NodeId,
): { headerRow: boolean; headerColumn: boolean } {
  const rows = structuralChildren(store, tableId);
  const corner = rows[0] ? structuralChildren(store, rows[0]!)[0] : undefined;
  const state = corner ? headerStateOf(store, corner) : 0;
  return {
    headerColumn: (state & HEADER_COLUMN) !== 0,
    headerRow: (state & HEADER_ROW) !== 0,
  };
}

/** Set the table's column-sizing layout (docs/003 §6: fixed/responsive/full-width). */
export function setTableLayout(
  store: EditorStore,
  tableId: NodeId,
  layout: string,
): void {
  store.command({
    key: "layout",
    node: tableId,
    type: "set-block-attr",
    value: layout,
  });
}

/**
 * New column widths after dragging the boundary right of `colIndex` by `deltaX`,
 * trading width with the adjacent column so the total is conserved (legacy
 * `resizeColumnWidths`). Pure, so the drag math is unit-testable.
 */
export function resizeColumnWidths(
  widths: readonly number[],
  colIndex: number,
  deltaX: number,
  minWidth: number,
): number[] {
  const rightIndex = colIndex + 1;
  const leftStart = widths[colIndex] ?? minWidth;
  const rightStart = widths[rightIndex] ?? minWidth;
  const delta = Math.max(
    minWidth - leftStart,
    Math.min(rightStart - minWidth, deltaX),
  );
  const next = [...widths];
  next[colIndex] = leftStart + delta;
  next[rightIndex] = rightStart - delta;
  return next;
}

/** Scale widths proportionally to sum to `targetTotal` (legacy `scaleColumnWidths`). */
export function scaleColumnWidths(
  widths: readonly number[],
  targetTotal: number,
): number[] {
  if (widths.length === 0 || targetTotal <= 0) return [];
  const current = widths.reduce((sum, width) => sum + width, 0);
  if (current <= 0) {
    const base = Math.floor(targetTotal / widths.length);
    return widths.map((_w, i) =>
      i === widths.length - 1 ? targetTotal - base * (widths.length - 1) : base,
    );
  }
  const scaled = widths.map((width) =>
    Math.max(1, Math.round((width / current) * targetTotal)),
  );
  const drift = targetTotal - scaled.reduce((sum, width) => sum + width, 0);
  scaled[scaled.length - 1] = Math.max(1, scaled[scaled.length - 1]! + drift);
  return scaled;
}

/**
 * The {row, col} of the cell the selection is in, scoped to `tableId`, or null.
 * Lets the chrome insert/delete relative to the caret rather than always at the
 * grid edge (docs/022 §6).
 */
export function selectionCell(
  store: EditorStore,
  tableId: NodeId,
): { rowIndex: number; colIndex: number } | null {
  const sel = store.selection;
  const start: NodeId | null =
    sel?.type === "text"
      ? sel.focus.node
      : sel?.type === "node"
        ? sel.node
        : sel?.type === "gap"
          ? sel.scope
          : null;
  let id: NodeId | undefined = start ?? undefined;
  const seen = new Set<NodeId>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = store.getNode(id);
    if (node?.kind === "structural" && node.type === "tablecell") {
      const cellEntry = store.parentEntry(id);
      if (!cellEntry) return null;
      const rowEntry = store.parentEntry(cellEntry.parent);
      if (!rowEntry || rowEntry.parent !== tableId) return null;
      return { colIndex: cellEntry.index, rowIndex: rowEntry.index };
    }
    id = store.parentEntry(id)?.parent;
  }
  return null;
}

/** Set the table's column widths (the resize commit; docs/022 §6, §10.4). */
export function resizeColumns(
  store: EditorStore,
  tableId: NodeId,
  colWidths: readonly number[],
): void {
  store.command({
    key: "colWidths",
    node: tableId,
    type: "set-block-attr",
    value: [...colWidths],
  });
}

/** Toggle the table's row-number gutter (docs/022 §9). */
export function toggleRowNumbers(store: EditorStore, tableId: NodeId): void {
  const table = store.getNode(tableId);
  const on =
    table?.kind === "structural" && table.attrs?.showRowNumbers === true;
  store.command({
    key: "showRowNumbers",
    node: tableId,
    type: "set-block-attr",
    value: on ? undefined : true,
  });
}

/** The first text leaf at or under `id`, descending structural children. */
function firstTextLeaf(store: EditorStore, id: NodeId): NodeId | null {
  const node = store.getNode(id);
  if (!node) return null;
  if (node.kind === "text") return id;
  if (node.kind === "structural") {
    for (const child of node.children) {
      const leaf = firstTextLeaf(store, child);
      if (leaf) return leaf;
    }
  }
  return null;
}

/** Place a collapsed caret at the start of a text leaf (no content change). */
function selectLeafStart(store: EditorStore, leafId: NodeId): void {
  const leaf = store.getNode(leafId);
  if (leaf?.kind !== "text") return;
  const point = pointAtOffset(leafId, leaf.content, 0);
  store.dispatch({
    origin: "local",
    selectionAfter: { anchor: point, focus: point, type: "text" },
    steps: [],
  });
}

/** The table cell enclosing the current selection, with its grid coordinates. */
function enclosingCell(store: EditorStore): {
  tableId: NodeId;
  rowIndex: number;
  colIndex: number;
} | null {
  const sel = store.selection;
  let id: NodeId | undefined =
    sel?.type === "text"
      ? sel.focus.node
      : sel?.type === "node"
        ? sel.node
        : sel?.type === "gap"
          ? sel.scope
          : undefined;
  const seen = new Set<NodeId>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = store.getNode(id);
    if (node?.kind === "structural" && node.type === "tablecell") {
      const cellEntry = store.parentEntry(id);
      const rowEntry = cellEntry && store.parentEntry(cellEntry.parent);
      if (!cellEntry || !rowEntry) return null;
      const table = store.getNode(rowEntry.parent);
      if (
        table?.kind !== "structural" ||
        (table.type !== "table" && table.type !== "editor-table")
      ) {
        return null;
      }
      return {
        colIndex: cellEntry.index,
        rowIndex: rowEntry.index,
        tableId: rowEntry.parent,
      };
    }
    id = store.parentEntry(id)?.parent;
  }
  return null;
}

/**
 * Move the caret to the next (or previous) cell, row-major (docs/022 §5). Tabbing
 * past the last cell appends a row. Returns false when the caret is not in a
 * table, so the caller falls back to its default Tab behaviour (indent).
 */
export function tabWithinTable(store: EditorStore, forward: boolean): boolean {
  const loc = enclosingCell(store);
  if (!loc) return false;
  const cols = columnCount(store, loc.tableId);
  let row = loc.rowIndex;
  let col = loc.colIndex + (forward ? 1 : -1);
  if (col >= cols) {
    col = 0;
    row += 1;
  } else if (col < 0) {
    col = cols - 1;
    row -= 1;
  }
  if (row < 0) return true; // at the first cell: handled (no indent), no move
  if (row >= structuralChildren(store, loc.tableId).length) {
    insertRow(store, loc.tableId, row); // append a fresh row to tab into
  }
  const rows = structuralChildren(store, loc.tableId);
  const rowId = rows[row];
  const cellId = rowId ? structuralChildren(store, rowId)[col] : undefined;
  const leafId = cellId ? firstTextLeaf(store, cellId) : null;
  if (leafId) selectLeafStart(store, leafId);
  return true;
}
