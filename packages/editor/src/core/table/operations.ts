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
  type NodeId,
} from "../model";
import type { EditorStore } from "../store";

function structuralChildren(store: EditorStore, id: NodeId): readonly NodeId[] {
  const node = store.getNode(id);
  return node && node.kind === "structural" ? node.children : [];
}

/** The grid's column count, read off the first row (rows are kept rectangular). */
export function columnCount(store: EditorStore, tableId: NodeId): number {
  const rows = structuralChildren(store, tableId);
  return rows.length > 0 ? structuralChildren(store, rows[0]!).length : 0;
}

function buildCell(
  store: EditorStore,
  header = 0,
): {
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
    ...(header ? { attrs: { headerState: header } } : {}),
    children: [paragraphId],
    id: store.allocator.createNodeId(),
    type: "tablecell",
  });
  return { cell, descendants: [paragraph] };
}

function buildRow(
  store: EditorStore,
  colCount: number,
  headerStates: readonly number[] = [],
): { row: EditorNode; descendants: EditorNode[] } {
  const cells = Array.from({ length: Math.max(1, colCount) }, (_v, c) =>
    buildCell(store, headerStates[c] ?? 0),
  );
  const row = makeStructuralNode({
    children: cells.map((c) => c.cell.id),
    id: store.allocator.createNodeId(),
    type: "tablerow",
  });
  return { descendants: cells.flatMap((c) => [c.cell, ...c.descendants]), row };
}

// Insert/delete row/column take *visual* grid indices. On a rectangular (un-merged)
// grid the fast path below composes physical child indices directly (visual ===
// physical). On a merged grid they delegate to the grid-map-aware variants, which
// extend spans that cross the edit line, place new cells at the right physical
// index, and move/shrink span-origin cells — so structure editing works without
// unmerging (legacy TableObserver parity).

/** Insert an empty row at `atIndex` (clamped), matching the current column count. */
export function insertRow(
  store: EditorStore,
  tableId: NodeId,
  atIndex: number,
): void {
  if (hasMergedCells(store, tableId)) {
    insertRowMergeAware(store, tableId, atIndex);
    return;
  }
  const rows = structuralChildren(store, tableId);
  const index = Math.max(0, Math.min(atIndex, rows.length));
  // New cells inherit the COLUMN header bit (and so the header-column stripe
  // continues) from the cell above or below in the same column — the legacy
  // `$insertTableRow` neighbor-inheritance.
  const above =
    index - 1 >= 0 ? structuralChildren(store, rows[index - 1]!) : [];
  const below =
    index < rows.length ? structuralChildren(store, rows[index]!) : [];
  const headerStates = Array.from(
    { length: columnCount(store, tableId) },
    (_v, c) =>
      ((above[c] ? headerStateOf(store, above[c]!) : 0) |
        (below[c] ? headerStateOf(store, below[c]!) : 0)) &
      HEADER_COLUMN,
  );
  const { row, descendants } = buildRow(
    store,
    columnCount(store, tableId),
    headerStates,
  );
  store.command({
    descendants,
    index,
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
  if (hasMergedCells(store, tableId)) {
    deleteRowMergeAware(store, tableId, rowIndex);
    return;
  }
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
  if (hasMergedCells(store, tableId)) {
    insertColumnMergeAware(store, tableId, atColIndex);
    return;
  }
  const rows = structuralChildren(store, tableId);
  if (rows.length === 0) return;
  const tr = store.transaction();
  for (const rowId of rows) {
    const cells = structuralChildren(store, rowId);
    const i = Math.max(0, Math.min(atColIndex, cells.length));
    // A new cell inherits the ROW header bit (so a header row continues across
    // the new column) from its left or right neighbor — legacy `$insertTableColumn`.
    const rowBit =
      ((cells[i - 1] ? headerStateOf(store, cells[i - 1]!) : 0) |
        (cells[i] ? headerStateOf(store, cells[i]!) : 0)) &
      HEADER_ROW;
    const { cell, descendants } = buildCell(store, rowBit);
    tr.push({
      descendants,
      index: i,
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
  if (hasMergedCells(store, tableId)) {
    deleteColumnMergeAware(store, tableId, colIndex);
    return;
  }
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

// ---------------------------------------------------------------------------
// Merge-aware insert/delete (docs/022 §7). These take *visual* grid indices and
// use the span-aware grid map: a span crossing the edit line is extended (insert)
// or shrunk (delete); a cell that begins on a deleted row and spans down is moved
// into the next row; new cells land at the correct physical index for their visual
// column. The legacy `TableObserver` insert/delete-at-selection behavior, ported.
// ---------------------------------------------------------------------------

/** Physical child index in `visualRow` for a new cell at visual column `targetCol`. */
function physicalIndexForCol(
  grid: TableGrid,
  visualRow: number,
  targetCol: number,
): number {
  let count = 0;
  for (let c = 0; c < targetCol; c += 1) {
    const cell = grid.map[visualRow]?.[c];
    // Count only cells that *begin* in this row at this column (its own children),
    // not positions covered by a span from an earlier row/column.
    if (cell && cell.startRow === visualRow && cell.startCol === c) count += 1;
  }
  return count;
}

function insertRowMergeAware(
  store: EditorStore,
  tableId: NodeId,
  atIndex: number,
): void {
  const grid = tableGrid(store, tableId);
  const at = Math.max(0, Math.min(atIndex, grid.rowCount));
  const tr = store.transaction();
  const extended = new Set<NodeId>();
  const states: number[] = [];
  for (let c = 0; c < grid.colCount; c += 1) {
    const cell = at < grid.rowCount ? grid.map[at]?.[c] : null;
    if (cell && cell.startRow < at) {
      // A rowSpan crosses the insert boundary → extend it once (no new cell here).
      if (!extended.has(cell.cellId)) {
        extended.add(cell.cellId);
        setSpanStep(
          tr,
          store,
          cell.cellId,
          "rowSpan",
          spanAttr(store, cell.cellId, "rowSpan") + 1,
        );
      }
      continue;
    }
    const above = at - 1 >= 0 ? grid.map[at - 1]?.[c] : null;
    const below = at < grid.rowCount ? grid.map[at]?.[c] : null;
    const bit =
      ((above ? headerStateOf(store, above.cellId) : 0) |
        (below ? headerStateOf(store, below.cellId) : 0)) &
      HEADER_COLUMN;
    states.push(bit);
  }
  const finalStates = states.length > 0 ? states : [0];
  const { row, descendants } = buildRow(store, finalStates.length, finalStates);
  tr.push({
    descendants,
    index: at,
    node: row,
    parent: tableId,
    type: "insert-node",
  });
  store.dispatch(tr);
}

function insertColumnMergeAware(
  store: EditorStore,
  tableId: NodeId,
  atColIndex: number,
): void {
  const grid = tableGrid(store, tableId);
  const at = Math.max(0, Math.min(atColIndex, grid.colCount));
  const rows = structuralChildren(store, tableId);
  const tr = store.transaction();
  const extended = new Set<NodeId>();
  for (let r = 0; r < grid.rowCount; r += 1) {
    const cell = at < grid.colCount ? grid.map[r]?.[at] : null;
    if (cell && cell.startCol < at) {
      if (!extended.has(cell.cellId)) {
        extended.add(cell.cellId);
        setSpanStep(
          tr,
          store,
          cell.cellId,
          "colSpan",
          spanAttr(store, cell.cellId, "colSpan") + 1,
        );
      }
      continue;
    }
    const left = at - 1 >= 0 ? grid.map[r]?.[at - 1] : null;
    const right = at < grid.colCount ? grid.map[r]?.[at] : null;
    const bit =
      ((left ? headerStateOf(store, left.cellId) : 0) |
        (right ? headerStateOf(store, right.cellId) : 0)) &
      HEADER_ROW;
    const { cell: newCell, descendants } = buildCell(store, bit);
    tr.push({
      descendants,
      index: physicalIndexForCol(grid, r, at),
      node: newCell,
      parent: rows[r]!,
      type: "insert-node",
    });
  }
  syncColWidths(store, tableId, tr, (widths) => {
    const i = Math.max(0, Math.min(at, widths.length));
    const width = widths[i] ?? widths.at(-1) ?? DEFAULT_COL_WIDTH;
    return [...widths.slice(0, i), width, ...widths.slice(i)];
  });
  store.dispatch(tr);
}

function deleteColumnMergeAware(
  store: EditorStore,
  tableId: NodeId,
  colIndex: number,
): void {
  const grid = tableGrid(store, tableId);
  if (grid.colCount <= 1 || colIndex < 0 || colIndex >= grid.colCount) return;
  const rows = structuralChildren(store, tableId);
  const tr = store.transaction();
  const handled = new Set<NodeId>();
  const removeByRow = new Map<NodeId, number[]>();
  for (let r = 0; r < grid.rowCount; r += 1) {
    const cell = grid.map[r]?.[colIndex];
    if (!cell || handled.has(cell.cellId)) continue;
    handled.add(cell.cellId);
    const colSpan = spanAttr(store, cell.cellId, "colSpan");
    if (colSpan > 1) {
      // The column is part of a span → shrink it; the cell node stays.
      setSpanStep(tr, store, cell.cellId, "colSpan", colSpan - 1);
    } else {
      const rowId = rows[cell.rowIndex]!;
      const list = removeByRow.get(rowId) ?? [];
      list.push(cell.cellIndex);
      removeByRow.set(rowId, list);
    }
  }
  for (const [rowId, indices] of removeByRow) {
    for (const idx of indices.sort((a, b) => b - a)) {
      const cellNode = store.getNode(structuralChildren(store, rowId)[idx]!);
      if (cellNode) tr.removeNode(rowId, idx, cellNode);
    }
  }
  syncColWidths(store, tableId, tr, (widths) => {
    const remaining = widths.filter((_w, i) => i !== colIndex);
    const total = widths.reduce((sum, w) => sum + w, 0);
    return scaleColumnWidths(remaining, total);
  });
  store.dispatch(tr);
}

function deleteRowMergeAware(
  store: EditorStore,
  tableId: NodeId,
  rowIndex: number,
): void {
  const grid = tableGrid(store, tableId);
  if (grid.rowCount <= 1 || rowIndex < 0 || rowIndex >= grid.rowCount) return;
  const rows = structuralChildren(store, tableId);
  const targetRowId = rows[rowIndex + 1];
  const tr = store.transaction();
  const handled = new Set<NodeId>();
  const moves: { cellId: NodeId; fromIndex: number; startCol: number }[] = [];
  for (let c = 0; c < grid.colCount; c += 1) {
    const cell = grid.map[rowIndex]?.[c];
    if (!cell || handled.has(cell.cellId)) continue;
    handled.add(cell.cellId);
    const rowSpan = spanAttr(store, cell.cellId, "rowSpan");
    if (cell.startRow < rowIndex) {
      setSpanStep(tr, store, cell.cellId, "rowSpan", rowSpan - 1);
    } else if (rowSpan > 1 && targetRowId) {
      // Begins on the deleted row and spans down → move it into the next row
      // (which becomes this row) and shrink the span.
      moves.push({
        cellId: cell.cellId,
        fromIndex: cell.cellIndex,
        startCol: cell.startCol,
      });
    }
    // else a plain 1×1 cell → removed with the row node below.
  }
  // Descending source index keeps each move's from-index valid as the row shrinks,
  // and (because source order tracks column order) lands the moved cells in the
  // correct target order against the pre-computed insert indices.
  for (const mv of moves.sort((a, b) => b.fromIndex - a.fromIndex)) {
    setSpanStep(
      tr,
      store,
      mv.cellId,
      "rowSpan",
      spanAttr(store, mv.cellId, "rowSpan") - 1,
    );
    tr.push({
      from: { index: mv.fromIndex, parent: rows[rowIndex]! },
      node: mv.cellId,
      to: {
        index: physicalIndexForCol(grid, rowIndex + 1, mv.startCol),
        parent: targetRowId!,
      },
      type: "move-node",
    });
  }
  const rowNode = store.getNode(rows[rowIndex]!);
  if (rowNode) tr.removeNode(tableId, rowIndex, rowNode);
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

// ---------------------------------------------------------------------------
// The span-aware grid map (docs/022 §7) — the foundation for cell-range
// selection, merge/unmerge, and column/row move. A row's `children` hold only
// the *real* cells; a merged cell's covered positions have no cell node, so the
// physical {row,cellIndex} of a cell is not its visual {row,col}. The grid map
// resolves every visual coordinate to the cell occupying it, mirroring the
// legacy `@lexical/table` `$computeTableMap`. Pure (reads the store only), so the
// coordinate math is unit-testable without a browser.
// ---------------------------------------------------------------------------

/** One occupied grid position's owning cell, with its anchor and span. */
export type GridCell = {
  readonly cellId: NodeId;
  /** Physical row index in `table.children`. */
  readonly rowIndex: number;
  /** Physical index of the cell within its row's `children`. */
  readonly cellIndex: number;
  /** Visual top-left coordinates (account for the spans above/left of it). */
  readonly startRow: number;
  readonly startCol: number;
  readonly rowSpan: number;
  readonly colSpan: number;
};

export type TableGrid = {
  /** `map[row][col]` is the cell occupying that visual position, or null. */
  readonly map: readonly (GridCell | null)[][];
  readonly rowCount: number;
  readonly colCount: number;
};

/** A cell span attr (colSpan/rowSpan); absent or <2 reads as 1 (legacy parity). */
function spanAttr(store: EditorStore, cellId: NodeId, key: string): number {
  const cell = store.getNode(cellId);
  const value = cell?.kind === "structural" ? cell.attrs?.[key] : undefined;
  return typeof value === "number" && value > 1 ? value : 1;
}

/** Build the span-aware grid map (legacy `$computeTableMap`). */
export function tableGrid(store: EditorStore, tableId: NodeId): TableGrid {
  const rows = structuralChildren(store, tableId);
  const occupied = new Set<string>();
  const map: (GridCell | null)[][] = rows.map(() => []);
  let colCount = 0;
  rows.forEach((rowId, rowIndex) => {
    let col = 0;
    structuralChildren(store, rowId).forEach((cellId, cellIndex) => {
      while (occupied.has(`${rowIndex},${col}`)) col += 1;
      const rowSpan = spanAttr(store, cellId, "rowSpan");
      const colSpan = spanAttr(store, cellId, "colSpan");
      const gridCell: GridCell = {
        cellId,
        cellIndex,
        colSpan,
        rowIndex,
        rowSpan,
        startCol: col,
        startRow: rowIndex,
      };
      for (let dr = 0; dr < rowSpan; dr += 1) {
        // Don't synthesize phantom rows past the table's real height for a
        // rowSpan that overflows the grid (legacy `$computeTableMap` bounds the
        // same way); `map` length stays `rows.length`.
        if (rowIndex + dr >= rows.length) break;
        for (let dc = 0; dc < colSpan; dc += 1) {
          occupied.add(`${rowIndex + dr},${col + dc}`);
          (map[rowIndex + dr] ??= [])[col + dc] = gridCell;
        }
      }
      col += colSpan;
    });
    colCount = Math.max(colCount, col);
  });
  for (const row of map) {
    for (let c = 0; c < colCount; c += 1)
      if (row[c] === undefined) row[c] = null;
  }
  return { colCount, map, rowCount: rows.length };
}

/**
 * Whether the header row (row 0) carries a horizontal span. The hover controls
 * derive their column boundaries from row 0's cells, so a colSpan there desyncs
 * the column "+/−"/resize geometry; row affordances (from row boundaries) stay
 * correct. Used to suppress only the column controls in that case.
 */
export function headerRowHasColSpan(
  store: EditorStore,
  tableId: NodeId,
): boolean {
  const rows = structuralChildren(store, tableId);
  if (rows.length === 0) return false;
  return structuralChildren(store, rows[0]!).some(
    (id) => spanAttr(store, id, "colSpan") > 1,
  );
}

/** Whether any cell in the table carries a real span (a merged table). */
export function hasMergedCells(store: EditorStore, tableId: NodeId): boolean {
  return structuralChildren(store, tableId).some((rowId) =>
    structuralChildren(store, rowId).some(
      (cellId) =>
        spanAttr(store, cellId, "colSpan") > 1 ||
        spanAttr(store, cellId, "rowSpan") > 1,
    ),
  );
}

/** The {row,col} grid coordinates of a cell by id (its visual top-left), or null. */
export function cellCoords(
  grid: TableGrid,
  cellId: NodeId,
): { row: number; col: number } | null {
  for (let r = 0; r < grid.rowCount; r += 1) {
    for (let c = 0; c < grid.colCount; c += 1) {
      const cell = grid.map[r]?.[c];
      if (
        cell &&
        cell.cellId === cellId &&
        cell.startRow === r &&
        cell.startCol === c
      ) {
        return { col: c, row: r };
      }
    }
  }
  return null;
}

type Rect = {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
};

function normalizeRect(
  a: { row: number; col: number },
  b: { row: number; col: number },
): Rect {
  return {
    maxCol: Math.max(a.col, b.col),
    maxRow: Math.max(a.row, b.row),
    minCol: Math.min(a.col, b.col),
    minRow: Math.min(a.row, b.row),
  };
}

/** Expand a rect to fully contain every cell it partially covers (to a fixpoint). */
function expandRectToSpans(grid: TableGrid, rect: Rect): Rect {
  let current = rect;
  for (;;) {
    let { minRow, maxRow, minCol, maxCol } = current;
    for (let r = current.minRow; r <= current.maxRow; r += 1) {
      for (let c = current.minCol; c <= current.maxCol; c += 1) {
        const cell = grid.map[r]?.[c];
        if (!cell) continue;
        minRow = Math.min(minRow, cell.startRow);
        maxRow = Math.max(maxRow, cell.startRow + cell.rowSpan - 1);
        minCol = Math.min(minCol, cell.startCol);
        maxCol = Math.max(maxCol, cell.startCol + cell.colSpan - 1);
      }
    }
    if (
      minRow === current.minRow &&
      maxRow === current.maxRow &&
      minCol === current.minCol &&
      maxCol === current.maxCol
    ) {
      return current;
    }
    current = { maxCol, maxRow, minCol, minRow };
  }
}

/**
 * The selected cell range between two grid anchors (docs/022 §7): the span-expanded
 * rectangle plus the distinct cells inside it. The view paints this range and the
 * structure ops (merge, grid delete) act over it.
 */
export function selectedCellRange(
  grid: TableGrid,
  anchor: { row: number; col: number },
  focus: { row: number; col: number },
): { rect: Rect; cellIds: readonly NodeId[] } {
  const rect = expandRectToSpans(grid, normalizeRect(anchor, focus));
  const seen = new Set<NodeId>();
  const cellIds: NodeId[] = [];
  for (let r = rect.minRow; r <= rect.maxRow; r += 1) {
    for (let c = rect.minCol; c <= rect.maxCol; c += 1) {
      const cell = grid.map[r]?.[c];
      if (!cell || seen.has(cell.cellId)) continue;
      seen.add(cell.cellId);
      cellIds.push(cell.cellId);
    }
  }
  return { cellIds, rect };
}

/** Move the item at `from` to `to`, returning a new array (legacy `moveArrayItem`). */
export function moveArrayItem<T>(
  items: readonly T[],
  from: number,
  to: number,
): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

/**
 * Move row `from` to index `to`, one undoable `move-node` (legacy `$moveTableRow`
 * shape). Refused on a merged table — a span crossing the moved row would corrupt
 * the grid — matching the legacy `$isSimpleTable` guard.
 */
export function moveRow(
  store: EditorStore,
  tableId: NodeId,
  from: number,
  to: number,
): void {
  if (from === to || hasMergedCells(store, tableId)) return;
  const rows = structuralChildren(store, tableId);
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return;
  const tr = store.transaction();
  tr.push({
    from: { index: from, parent: tableId },
    node: rows[from]!,
    to: { index: to, parent: tableId },
    type: "move-node",
  });
  store.dispatch(tr);
}

/**
 * Move column `from` to index `to` across every row, plus the matching `colWidths`
 * entry, in one undoable transaction (legacy `$moveTableColumn` + `moveArrayItem`).
 * Refused on a merged table (the legacy `$isSimpleTable` guard).
 */
export function moveColumn(
  store: EditorStore,
  tableId: NodeId,
  from: number,
  to: number,
): void {
  if (from === to || hasMergedCells(store, tableId)) return;
  const cols = columnCount(store, tableId);
  if (from < 0 || from >= cols || to < 0 || to >= cols) return;
  const tr = store.transaction();
  for (const rowId of structuralChildren(store, tableId)) {
    const cellId = structuralChildren(store, rowId)[from];
    if (!cellId) continue;
    tr.push({
      from: { index: from, parent: rowId },
      node: cellId,
      to: { index: to, parent: rowId },
      type: "move-node",
    });
  }
  syncColWidths(store, tableId, tr, (widths) =>
    moveArrayItem(widths, from, to),
  );
  store.dispatch(tr);
}

// ---------------------------------------------------------------------------
// Cell merge / unmerge (docs/022 §7, legacy `@lexical/table` `$mergeCells` /
// `$unmergeCellNode`). Both compose the generic structural steps — `set-node-attr`
// for the spans, `move-node` to carry covered-cell content into the anchor,
// `remove-node`/`insert-node` for the covered cells — so core gains no table verb.
// ---------------------------------------------------------------------------

/** Set/clear a span attr on a cell (clears to undefined when 1). */
function setSpanStep(
  tr: ReturnType<EditorStore["transaction"]>,
  store: EditorStore,
  cellId: NodeId,
  key: "colSpan" | "rowSpan",
  value: number,
): void {
  const cell = store.getNode(cellId);
  if (cell?.kind !== "structural") return;
  const from = cell.attrs?.[key];
  const to = value > 1 ? value : undefined;
  if (from === to) return;
  tr.push({ from, key, node: cellId, to, type: "set-node-attr" });
}

/** Whether a cell holds only a single empty paragraph (legacy `$cellContainsEmptyParagraph`). */
function cellContainsEmptyParagraph(
  store: EditorStore,
  cellId: NodeId,
): boolean {
  const kids = structuralChildren(store, cellId);
  if (kids.length !== 1) return false;
  const child = store.getNode(kids[0]!);
  return child?.kind === "text" && child.content.text.length === 0;
}

/**
 * Merge the cell range between two grid anchors into the top-left cell (legacy
 * `$mergeCells`): the anchor cell takes the range's total col/row span, the
 * covered cells' non-empty content moves into it, and the covered cells are
 * removed — all in one undoable transaction. A 1×1 range is a no-op. Returns the
 * surviving anchor cell id, or null.
 */
export function mergeCells(
  store: EditorStore,
  tableId: NodeId,
  anchor: { row: number; col: number },
  focus: { row: number; col: number },
): NodeId | null {
  const grid = tableGrid(store, tableId);
  const rect = expandRectToSpans(grid, normalizeRect(anchor, focus));
  const totalRowSpan = rect.maxRow - rect.minRow + 1;
  const totalColSpan = rect.maxCol - rect.minCol + 1;
  if (totalRowSpan === 1 && totalColSpan === 1) return null;
  const target = grid.map[rect.minRow]?.[rect.minCol];
  if (
    !target ||
    target.startRow !== rect.minRow ||
    target.startCol !== rect.minCol
  ) {
    return null;
  }

  const seen = new Set<NodeId>([target.cellId]);
  const covered: GridCell[] = [];
  for (let r = rect.minRow; r <= rect.maxRow; r += 1) {
    for (let c = rect.minCol; c <= rect.maxCol; c += 1) {
      const cell = grid.map[r]?.[c];
      if (!cell || seen.has(cell.cellId)) continue;
      seen.add(cell.cellId);
      covered.push(cell);
    }
  }

  const tr = store.transaction();
  setSpanStep(tr, store, target.cellId, "colSpan", totalColSpan);
  setSpanStep(tr, store, target.cellId, "rowSpan", totalRowSpan);
  // Move each non-empty covered cell's blocks to the end of the target. Each block
  // leaves its source at index 0, so all `from` indices are 0 in source order; the
  // target's length grows by one per moved block (deterministic `to` indices).
  let targetLen = structuralChildren(store, target.cellId).length;
  for (const cell of covered) {
    if (cellContainsEmptyParagraph(store, cell.cellId)) continue;
    for (const blockId of structuralChildren(store, cell.cellId)) {
      tr.push({
        from: { index: 0, parent: cell.cellId },
        node: blockId,
        to: { index: targetLen, parent: target.cellId },
        type: "move-node",
      });
      targetLen += 1;
    }
  }
  // Remove the covered cells. Group by row and delete high index first so each
  // `remove-node` index stays valid as its row shrinks.
  const rows = structuralChildren(store, tableId);
  const byRow = new Map<NodeId, number[]>();
  for (const cell of covered) {
    const rowId = rows[cell.rowIndex]!;
    const list = byRow.get(rowId) ?? [];
    list.push(cell.cellIndex);
    byRow.set(rowId, list);
  }
  for (const [rowId, indices] of byRow) {
    for (const index of indices.sort((a, b) => b - a)) {
      const cellNode = store.getNode(structuralChildren(store, rowId)[index]!);
      if (cellNode) tr.removeNode(rowId, index, cellNode);
    }
  }
  const leaf = firstTextLeaf(store, target.cellId);
  if (leaf) {
    const node = store.getNode(leaf);
    if (node?.kind === "text") {
      const point = pointAtOffset(leaf, node.content, 0);
      tr.setSelection({ anchor: point, focus: point, type: "text" });
    }
  }
  store.dispatch(tr);
  return target.cellId;
}

/**
 * Unmerge a merged cell back to 1×1, restoring the cells it covered (legacy
 * `$unmergeCellNode`). New cells are empty paragraphs whose header bits follow the
 * legacy heuristic: a restored cell keeps the COLUMN bit only if the merged cell
 * had it *and* every cell already in that whole column is a header column, and the
 * ROW bit only if the merged cell had it *and* the whole row is a header row (the
 * bit is AND-reduced across the column/row of the pre-unmerge grid). One undoable
 * transaction. A 1×1 cell is a no-op.
 */
export function unmergeCell(
  store: EditorStore,
  tableId: NodeId,
  cellId: NodeId,
): void {
  const colSpan = spanAttr(store, cellId, "colSpan");
  const rowSpan = spanAttr(store, cellId, "rowSpan");
  if (colSpan === 1 && rowSpan === 1) return;
  const grid = tableGrid(store, tableId);
  const coords = cellCoords(grid, cellId);
  if (!coords) return;
  const { row: startRow, col: startCol } = coords;
  const baseHeader = headerStateOf(store, cellId);
  // colStyles[i]: COLUMN survives for column offset i only if every cell in that
  // absolute column already carries it; rowStyles[i]: likewise for ROW per row.
  const colStyles = Array.from({ length: colSpan }, (_v, i) => {
    let style = baseHeader & HEADER_COLUMN;
    for (let r = 0; style !== 0 && r < grid.rowCount; r += 1) {
      const gc = grid.map[r]?.[startCol + i];
      style &= gc ? headerStateOf(store, gc.cellId) : 0;
    }
    return style;
  });
  const rowStyles = Array.from({ length: rowSpan }, (_v, i) => {
    let style = baseHeader & HEADER_ROW;
    for (let c = 0; style !== 0 && c < grid.colCount; c += 1) {
      const gc = grid.map[startRow + i]?.[c];
      style &= gc ? headerStateOf(store, gc.cellId) : 0;
    }
    return style;
  });
  const headerFor = (rowOffset: number, colOffset: number): number =>
    (colStyles[colOffset] ?? 0) | (rowStyles[rowOffset] ?? 0);

  const rows = structuralChildren(store, tableId);
  const tr = store.transaction();
  setSpanStep(tr, store, cellId, "colSpan", 1);
  setSpanStep(tr, store, cellId, "rowSpan", 1);

  // Restore the rest of the anchor's own row (the colSpan>1 columns).
  const anchorIndex = grid.map[startRow]![startCol]!.cellIndex;
  for (let dc = 1; dc < colSpan; dc += 1) {
    placeRestoredCell(
      tr,
      store,
      rows[startRow]!,
      anchorIndex + dc,
      headerFor(0, dc),
    );
  }
  // Restore each subsequent spanned row (rowSpan>1): find where, in the model row,
  // the new cells go by scanning the grid columns left of startCol.
  for (let dr = 1; dr < rowSpan; dr += 1) {
    const currentRow = startRow + dr;
    const rowId = rows[currentRow];
    if (!rowId) continue;
    let insertAt = 0;
    for (let c = 0; c < startCol; c += 1) {
      const cell = grid.map[currentRow]?.[c];
      if (cell && cell.startRow === currentRow) {
        insertAt = cell.cellIndex + 1;
      }
      if (cell && cell.colSpan > 1) c += cell.colSpan - 1;
    }
    for (let dc = 0; dc < colSpan; dc += 1) {
      placeRestoredCell(tr, store, rowId, insertAt + dc, headerFor(dr, dc));
    }
  }
  store.dispatch(tr);
}

/** Insert one fresh empty cell (with its paragraph) into `rowId` at `index`. */
function placeRestoredCell(
  tr: ReturnType<EditorStore["transaction"]>,
  store: EditorStore,
  rowId: NodeId,
  index: number,
  header: number,
): void {
  const paragraphId = store.allocator.createNodeId();
  const paragraph = makeTextNode({
    content: store.allocator.createTextSlice(""),
    id: paragraphId,
    type: "paragraph",
  });
  const cell = makeStructuralNode({
    ...(header ? { attrs: { headerState: header } } : {}),
    children: [paragraphId],
    id: store.allocator.createNodeId(),
    type: "tablecell",
  });
  tr.push({
    descendants: [paragraph],
    index,
    node: cell,
    parent: rowId,
    type: "insert-node",
  });
}

// ---------------------------------------------------------------------------
// Cell attribute editing (docs/022 §7) — background + vertical-align, driven by
// the cell-action toolbar. Generic `set-node-attr` per cell, batched so a range
// edit is one undo. The attrs already round-trip (CELL_ATTR_KEYS) and render.
// ---------------------------------------------------------------------------

/** Set (or clear, with `undefined`) one cell attr across cells, in one undo. */
function setCellAttr(
  store: EditorStore,
  cellIds: readonly NodeId[],
  key: "backgroundColor" | "verticalAlign",
  value: string | undefined,
): void {
  const tr = store.transaction();
  let changed = false;
  for (const id of cellIds) {
    const cell = store.getNode(id);
    if (cell?.kind !== "structural") continue;
    const from = cell.attrs?.[key];
    const to = value || undefined;
    if (from === to) continue;
    tr.push({ from, key, node: id, to, type: "set-node-attr" });
    changed = true;
  }
  if (changed) store.dispatch(tr);
}

/** Set the cells' background color (clear with `undefined`); legacy `backgroundColor`. */
export function setCellBackground(
  store: EditorStore,
  cellIds: readonly NodeId[],
  color: string | undefined,
): void {
  setCellAttr(store, cellIds, "backgroundColor", color);
}

/** Set the cells' vertical alignment (`top` clears to the default). */
export function setCellVerticalAlign(
  store: EditorStore,
  cellIds: readonly NodeId[],
  align: "top" | "middle" | "bottom",
): void {
  setCellAttr(
    store,
    cellIds,
    "verticalAlign",
    align === "top" ? undefined : align,
  );
}

/** The cell the model caret/selection currently sits in, with its merged flag. */
export function activeCellContext(
  store: EditorStore,
): { tableId: NodeId; cellId: NodeId; merged: boolean } | null {
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
      const rowEntry = store.parentEntry(id);
      const tableEntry = rowEntry && store.parentEntry(rowEntry.parent);
      if (!tableEntry) return null;
      const table = store.getNode(tableEntry.parent);
      if (
        table?.kind !== "structural" ||
        (table.type !== "table" && table.type !== "editor-table")
      ) {
        return null;
      }
      return {
        cellId: id,
        merged:
          spanAttr(store, id, "colSpan") > 1 ||
          spanAttr(store, id, "rowSpan") > 1,
        tableId: tableEntry.parent,
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
