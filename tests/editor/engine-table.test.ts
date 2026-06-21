/**
 * The live editable table (docs/022): the table as a structural container.
 *
 * Covers the data/SPI core that validates docs/021 for a second, differently-shaped
 * consumer (after callout): insert seeding, byte-stable compat round-trip through
 * the new `toCompatNode` cell projection (docs/022 §4.3), cell addressability, and
 * the structure operations composed from the generic structural-child commands
 * (docs/022 §6) — no table-specific core command.
 */
import { describe, expect, it } from "vitest";
import {
  compatFromEditorStore,
  createEditorStore,
  createEditorStoreFromCompat,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type NodeId,
  type RichTextCompatDocument,
  type StructuralNode,
} from "../../packages/editor/src/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeCellContext,
  cellCoords,
  columnCount,
  deleteColumn,
  deleteRow,
  hasMergedCells,
  headerState,
  insertColumn,
  insertRow,
  mergeCells,
  moveArrayItem,
  moveColumn,
  moveRow,
  resizeColumns,
  resizeColumnWidths,
  scaleColumnWidths,
  selectedCellRange,
  selectionCell,
  setCellBackground,
  setCellVerticalAlign,
  setTableLayout,
  tabWithinTable,
  tableGrid,
  toggleHeaderColumn,
  toggleHeaderRow,
  toggleRowNumbers,
  unmergeCell,
} from "../../packages/editor/src/view/table-operations";

function structural(store: EditorStore, id: NodeId): StructuralNode {
  const node = store.getNode(id);
  if (!node || node.kind !== "structural")
    throw new Error(`not structural: ${id}`);
  return node;
}

function makeStore() {
  const allocator = createIdAllocator("idco_client_table");
  const paragraphId = allocator.createNodeId();
  const paragraph = makeTextNode({
    content: allocator.createTextSlice("intro"),
    id: paragraphId,
    type: "paragraph",
  });
  return createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [paragraphId]: paragraph }, order: [paragraphId] },
      settings: {},
      version: 1,
    },
  });
}

function insertedTable(store: EditorStore): StructuralNode {
  store.command({ structuralType: "table", type: "insert-structural" });
  const id = store.order.find((n) => store.getNode(n)?.type === "table");
  if (!id) throw new Error("no table");
  return structural(store, id);
}

/**
 * A legacy persisted table document (the saved compat shape, docs/022 §2),
 * id-bearing so import preserves the structural ids and export is comparable to
 * the source byte-for-byte (the `idco_node_` prefix is what `nodeId` keeps).
 */
function legacyTableDoc(
  type: "table" | "editor-table",
): RichTextCompatDocument {
  const cell = (id: string, text: string, headerState?: number) => ({
    children: [{ text, type: "text" }],
    ...(headerState ? { headerState } : {}),
    id,
    type: "tablecell",
  });
  return {
    root: {
      children: [
        {
          children: [
            {
              children: [
                cell("idco_node_c1", "Name", 3),
                cell("idco_node_c2", "Role", 3),
              ],
              id: "idco_node_r1",
              type: "tablerow",
            },
            {
              children: [
                cell("idco_node_c3", "Ada"),
                cell("idco_node_c4", "Eng"),
              ],
              id: "idco_node_r2",
              type: "tablerow",
            },
          ],
          colWidths: [120, 200],
          id: "idco_node_t1",
          type,
        },
      ],
    },
  } as RichTextCompatDocument;
}

/** Build a structural-model store from a simple rectangular grid of cell texts. */
function simpleTableStore(rows: readonly (readonly string[])[]): EditorStore {
  const doc = {
    root: {
      children: [
        {
          children: rows.map((cells) => ({
            children: cells.map((text) => ({
              children: [{ text, type: "text" }],
              type: "tablecell",
            })),
            type: "tablerow",
          })),
          type: "table",
        },
      ],
    },
  } as RichTextCompatDocument;
  return createEditorStoreFromCompat(doc);
}

/** Flatten a compat node's nested text to a plain string. */
function textOf(node: {
  text?: unknown;
  children?: readonly unknown[];
}): string {
  if (typeof node.text === "string") return node.text;
  return (node.children ?? [])
    .map((c) => textOf(c as { text?: unknown; children?: readonly unknown[] }))
    .join("");
}

describe("table — structural model + insert (docs/022 §3, §4.1)", () => {
  it("insert-structural seeds a 3×3 grid with header row+column, caret in a data cell", () => {
    const store = makeStore();
    const table = insertedTable(store);
    expect(table.children).toHaveLength(3); // header row + 2 body rows (legacy 3×3)
    expect(table.attrs?.colWidths).toHaveLength(3); // seeded widths (B3)

    const headerRow = structural(store, table.children[0]!);
    const bodyRow = structural(store, table.children[1]!);
    expect(headerRow.children).toHaveLength(3);
    expect(bodyRow.children).toHaveLength(3);

    // Corner carries ROW|COLUMN (3); other header-row cells carry ROW (1).
    expect(structural(store, headerRow.children[0]!).attrs?.headerState).toBe(
      3,
    );
    expect(structural(store, headerRow.children[1]!).attrs?.headerState).toBe(
      1,
    );
    // First body row's first cell is a header-column cell (COLUMN bit = 2).
    expect(structural(store, bodyRow.children[0]!).attrs?.headerState).toBe(2);

    // The caret lands in the first data cell (row 1, col 1) — not a header cell.
    const dataCell = structural(store, bodyRow.children[1]!);
    const leafId = dataCell.children[0]!;
    expect(store.getNode(leafId)?.kind).toBe("text");
    const focus =
      store.selection?.type === "text" ? store.selection.focus.node : null;
    expect(focus).toBe(leafId);
  });
});

describe("table — byte-stable compat round-trip (docs/022 §4.3)", () => {
  for (const type of ["table", "editor-table"] as const) {
    it(`imports a legacy ${type} structurally and exports it with full fidelity`, () => {
      const doc = legacyTableDoc(type);
      const store = createEditorStoreFromCompat(doc);

      // The in-memory model is structural (table → row → cell → paragraph)…
      const table = structural(store, store.order[0]!);
      expect(table.type).toBe(type);
      expect(table.attrs?.colWidths).toEqual([120, 200]);
      const firstCell = structural(
        store,
        structural(store, table.children[0]!).children[0]!,
      );
      expect(store.getNode(firstCell.children[0]!)?.kind).toBe("text");

      // …and export reproduces the table faithfully: structural ids preserved,
      // colWidths, header state, and every cell's text — the cell paragraph
      // projected back to inline text (docs/022 §4.3).
      const exported = compatFromEditorStore(store);
      const outTable = exported.root.children[0]!;
      expect(outTable.id).toBe("idco_node_t1");
      expect(outTable.type).toBe(type);
      expect(outTable.colWidths).toEqual([120, 200]);
      const rows = outTable.children ?? [];
      expect(rows.map((r) => r.id)).toEqual(["idco_node_r1", "idco_node_r2"]);
      expect(rows.map((r) => r.type)).toEqual(["tablerow", "tablerow"]);
      const cells = rows.flatMap((r) => r.children ?? []);
      expect(cells.map((c) => c.id)).toEqual([
        "idco_node_c1",
        "idco_node_c2",
        "idco_node_c3",
        "idco_node_c4",
      ]);
      expect(cells.every((c) => c.type === "tablecell")).toBe(true);
      expect(cells.map((c) => c.headerState ?? 0)).toEqual([3, 3, 0, 0]);
      expect(cells.map((c) => textOf(c))).toEqual([
        "Name",
        "Role",
        "Ada",
        "Eng",
      ]);

      // And export is a fixpoint: re-import → re-export is byte-identical.
      const reexported = compatFromEditorStore(
        createEditorStoreFromCompat(exported),
      );
      expect(reexported).toEqual(exported);
    });
  }

  it("preserves merged-cell + background attrs through the round-trip (B1/B5)", () => {
    // Every legacy Lexical cell carries colSpan/rowSpan/backgroundColor; they must
    // survive load→save even though merge isn't editable yet.
    const doc = {
      root: {
        children: [
          {
            children: [
              {
                children: [
                  {
                    backgroundColor: "#fee",
                    children: [{ text: "merged", type: "text" }],
                    colSpan: 2,
                    headerState: 1,
                    id: "idco_node_m1",
                    rowSpan: 1,
                    type: "tablecell",
                  },
                ],
                id: "idco_node_mr",
                type: "tablerow",
              },
            ],
            id: "idco_node_mt",
            type: "table",
          },
        ],
      },
    } as RichTextCompatDocument;
    const store = createEditorStoreFromCompat(doc);
    const exported = compatFromEditorStore(store);
    const cell = (exported.root.children[0]!.children ?? [])[0]!.children?.[0];
    expect(cell?.colSpan).toBe(2);
    expect(cell?.rowSpan).toBe(1);
    expect(cell?.backgroundColor).toBe("#fee");
    expect(cell?.headerState).toBe(1);
    // A merged (short) row is not padded — the grid shape is preserved (B5).
    const row = exported.root.children[0]!.children?.[0];
    expect(row?.children).toHaveLength(1);
  });

  it("keeps a multi-block cell's blocks (the non-flatten branch, docs/022 §4.3)", () => {
    const doc = {
      root: {
        children: [
          {
            children: [
              {
                children: [
                  {
                    children: [
                      {
                        children: [{ text: "a", type: "text" }],
                        type: "paragraph",
                      },
                      {
                        children: [{ text: "b", type: "text" }],
                        type: "paragraph",
                      },
                    ],
                    id: "idco_node_mc",
                    type: "tablecell",
                  },
                ],
                type: "tablerow",
              },
            ],
            type: "table",
          },
        ],
      },
    } as RichTextCompatDocument;
    const store = createEditorStoreFromCompat(doc);
    const exported = compatFromEditorStore(store);
    const cell = (exported.root.children[0]!.children ?? [])[0]!.children?.[0];
    // Two blocks → exported as blocks (not flattened to inline), text preserved.
    expect(cell?.children).toHaveLength(2);
    expect(cell?.children?.every((c) => c.type === "paragraph")).toBe(true);
    expect(textOf(cell!)).toBe("ab");
  });

  it("pads a ragged source to a rectangle on import (docs/022 §11)", () => {
    const doc = {
      root: {
        children: [
          {
            children: [
              {
                children: [
                  {
                    children: [{ text: "a", type: "text" }],
                    type: "tablecell",
                  },
                  {
                    children: [{ text: "b", type: "text" }],
                    type: "tablecell",
                  },
                ],
                type: "tablerow",
              },
              {
                children: [
                  {
                    children: [{ text: "c", type: "text" }],
                    type: "tablecell",
                  },
                ],
                type: "tablerow",
              },
            ],
            type: "table",
          },
        ],
      },
    } as RichTextCompatDocument;
    const store = createEditorStoreFromCompat(doc);
    const table = structural(store, store.order[0]!);
    // The short second row was padded to the 2-column width.
    for (const rowId of table.children) {
      expect(structural(store, rowId).children).toHaveLength(2);
    }
  });
});

describe("table — structure operations (docs/022 §6)", () => {
  it("insertRow / deleteRow keep the grid rectangular and are undoable", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    expect(structural(store, tableId).children).toHaveLength(3);

    insertRow(store, tableId, 3);
    expect(structural(store, tableId).children).toHaveLength(4);
    // The new row matches the column count.
    const newRow = structural(store, structural(store, tableId).children[3]!);
    expect(newRow.children).toHaveLength(columnCount(store, tableId));

    store.undo();
    expect(structural(store, tableId).children).toHaveLength(3);

    deleteRow(store, tableId, 1);
    expect(structural(store, tableId).children).toHaveLength(2);
    store.undo();
    expect(structural(store, tableId).children).toHaveLength(3);
  });

  it("refuses to delete the last row", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    deleteRow(store, tableId, 0);
    deleteRow(store, tableId, 0);
    deleteRow(store, tableId, 0);
    expect(structural(store, tableId).children.length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("insertColumn / deleteColumn touch every row in one undoable transaction", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    expect(columnCount(store, tableId)).toBe(3);

    insertColumn(store, tableId, 3);
    expect(columnCount(store, tableId)).toBe(4);
    // Every row gained a cell (rectangular).
    for (const rowId of structural(store, tableId).children) {
      expect(structural(store, rowId).children).toHaveLength(4);
    }
    // One undo reverses the whole column.
    store.undo();
    expect(columnCount(store, tableId)).toBe(3);
    for (const rowId of structural(store, tableId).children) {
      expect(structural(store, rowId).children).toHaveLength(3);
    }

    deleteColumn(store, tableId, 1);
    expect(columnCount(store, tableId)).toBe(2);
    for (const rowId of structural(store, tableId).children) {
      expect(structural(store, rowId).children).toHaveLength(2);
    }
    store.undo();
    expect(columnCount(store, tableId)).toBe(3);
  });

  it("inserted column inherits the ROW header bit (header row continues)", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id; // seeded header row + header column
    insertColumn(store, tableId, 3); // new last column
    const headerRow = structural(
      store,
      structural(store, tableId).children[0]!,
    );
    // The new header-row cell carries the ROW bit; a new body-row cell does not.
    expect(
      Number(
        structural(store, headerRow.children[3]!).attrs?.headerState ?? 0,
      ) & 1,
    ).toBe(1);
    const bodyRow = structural(store, structural(store, tableId).children[1]!);
    expect(
      structural(store, bodyRow.children[3]!).attrs?.headerState ?? 0,
    ).toBe(0);
  });

  it("inserted row inherits the COLUMN header bit (header column continues)", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id; // seeded header row + header column
    insertRow(store, tableId, 3); // new last row
    const newRow = structural(store, structural(store, tableId).children[3]!);
    // The new first cell carries the COLUMN bit; interior cells do not.
    expect(
      Number(structural(store, newRow.children[0]!).attrs?.headerState ?? 0) &
        2,
    ).toBe(2);
    expect(structural(store, newRow.children[1]!).attrs?.headerState ?? 0).toBe(
      0,
    );
  });

  it("refuses to delete the last column", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    deleteColumn(store, tableId, 0);
    deleteColumn(store, tableId, 0);
    deleteColumn(store, tableId, 0);
    expect(columnCount(store, tableId)).toBeGreaterThanOrEqual(1);
  });

  it("toggleHeaderRow flips the ROW bit across the first row, preserving COLUMN", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    const firstRow = () =>
      structural(store, structural(store, tableId).children[0]!);
    const rowBits = () =>
      firstRow().children.map(
        (id) => Number(structural(store, id).attrs?.headerState ?? 0) & 1,
      );
    // Seeded header row carries the ROW bit; toggling clears it, then restores it.
    expect(rowBits().every((b) => b === 1)).toBe(true);
    toggleHeaderRow(store, tableId);
    expect(rowBits().every((b) => b === 0)).toBe(true);
    toggleHeaderRow(store, tableId);
    expect(rowBits().every((b) => b === 1)).toBe(true);
  });

  it("toggleHeaderColumn flips the COLUMN bit across the first column, preserving ROW", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    const colState = () =>
      structural(store, tableId).children.map((rowId) =>
        Number(
          structural(store, structural(store, rowId).children[0]!).attrs
            ?.headerState ?? 0,
        ),
      );
    // The seed already has a header column; toggling clears it, then restores it.
    expect(colState().every((s) => (s & 2) !== 0)).toBe(true);
    expect(colState()[0]! & 1).toBe(1); // corner is also a header row
    toggleHeaderColumn(store, tableId);
    expect(colState().every((s) => (s & 2) === 0)).toBe(true);
    expect(colState()[0]! & 1).toBe(1); // ROW bit preserved through the toggle
    toggleHeaderColumn(store, tableId);
    expect(colState().every((s) => (s & 2) !== 0)).toBe(true);
  });

  it("resizeColumns writes the table's colWidths attr", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    resizeColumns(store, tableId, [80, 240, 160]);
    expect(structural(store, tableId).attrs?.colWidths).toEqual([80, 240, 160]);
    store.undo();
    // Reverts to the seeded widths (B3: new tables seed colWidths).
    expect(structural(store, tableId).attrs?.colWidths).toEqual([
      160, 160, 160,
    ]);
  });

  it("toggleRowNumbers flips the table's showRowNumbers attr", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    expect(structural(store, tableId).attrs?.showRowNumbers).toBeUndefined();
    toggleRowNumbers(store, tableId);
    expect(structural(store, tableId).attrs?.showRowNumbers).toBe(true);
    toggleRowNumbers(store, tableId);
    expect(structural(store, tableId).attrs?.showRowNumbers).toBeUndefined();
  });

  it("tabWithinTable walks cells row-major and appends a row past the end", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    // insert-structural landed the caret in the first data cell (row 1, col 1).
    expect(selectionCell(store, tableId)).toEqual({ colIndex: 1, rowIndex: 1 });

    expect(tabWithinTable(store, true)).toBe(true);
    expect(selectionCell(store, tableId)).toEqual({ colIndex: 2, rowIndex: 1 });
    expect(tabWithinTable(store, true)).toBe(true);
    expect(selectionCell(store, tableId)).toEqual({ colIndex: 0, rowIndex: 2 });
    // Walk to the last cell of the last row, then Tab past it to append a row.
    expect(tabWithinTable(store, true)).toBe(true); // {1,2}
    expect(tabWithinTable(store, true)).toBe(true); // {2,2}
    expect(tabWithinTable(store, true)).toBe(true); // append row 3 → {0,3}
    expect(structural(store, tableId).children).toHaveLength(4);
    expect(selectionCell(store, tableId)).toEqual({ colIndex: 0, rowIndex: 3 });

    // Shift+Tab walks backward, wrapping to the previous row's last cell.
    expect(tabWithinTable(store, false)).toBe(true);
    expect(selectionCell(store, tableId)).toEqual({ colIndex: 2, rowIndex: 2 });
  });

  it("tabWithinTable is a no-op (returns false) outside a table", () => {
    const store = makeStore();
    insertedTable(store);
    // Move the caret out of the table, onto the intro paragraph.
    const introId = store.order[0]!;
    const intro = store.getNode(introId);
    if (intro?.kind !== "text") throw new Error("no intro");
    const point = pointAtOffset(introId, intro.content, 0);
    store.dispatch({
      origin: "local",
      selectionAfter: { anchor: point, focus: point, type: "text" },
      steps: [],
    });
    expect(tabWithinTable(store, true)).toBe(false);
  });

  it("keeps colWidths in sync with the column count (docs/022 §6, §10.4)", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    resizeColumns(store, tableId, [90, 90, 120]); // total 300, 3 columns

    insertColumn(store, tableId, 1);
    expect(structural(store, tableId).attrs?.colWidths).toHaveLength(4);
    // The width change rode the same transaction as the structure change.
    store.undo();
    expect(structural(store, tableId).attrs?.colWidths).toEqual([90, 90, 120]);

    // Delete conserves the total width by rescaling the remainder (B2).
    deleteColumn(store, tableId, 0);
    const widths = structural(store, tableId).attrs?.colWidths as number[];
    expect(widths).toHaveLength(2);
    expect(widths.reduce((sum, w) => sum + w, 0)).toBe(300);
  });
});

describe("table — layout, width math, and header state (docs/022 §6, §10.4)", () => {
  it("setTableLayout writes the layout attr; new tables seed responsive", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    expect(structural(store, tableId).attrs?.layout).toBe("responsive");
    setTableLayout(store, tableId, "full-width");
    expect(structural(store, tableId).attrs?.layout).toBe("full-width");
  });

  it("headerState reflects the seed and the toggles", () => {
    const store = makeStore();
    const tableId = insertedTable(store).id;
    // The seed is a header row + header column (legacy `includeHeaders`).
    expect(headerState(store, tableId)).toEqual({
      headerColumn: true,
      headerRow: true,
    });
    toggleHeaderColumn(store, tableId);
    expect(headerState(store, tableId)).toEqual({
      headerColumn: false,
      headerRow: true,
    });
    toggleHeaderRow(store, tableId);
    expect(headerState(store, tableId)).toEqual({
      headerColumn: false,
      headerRow: false,
    });
  });

  it("resizeColumnWidths trades width with the neighbor, conserving the total", () => {
    expect(resizeColumnWidths([100, 100], 0, 30, 48)).toEqual([130, 70]);
    // Clamp: cannot push the neighbor below the minimum.
    expect(resizeColumnWidths([100, 100], 0, 1000, 48)).toEqual([152, 48]);
    expect(resizeColumnWidths([100, 100], 0, -1000, 48)).toEqual([48, 152]);
  });

  it("scaleColumnWidths rescales proportionally to the target total", () => {
    expect(scaleColumnWidths([100, 300], 200)).toEqual([50, 150]);
    expect(scaleColumnWidths([1, 1, 1], 100)).toEqual([33, 33, 34]);
  });
});

describe("table — span-aware grid map + cell-range (docs/022 §7)", () => {
  it("tableGrid resolves a merged cell across the positions it covers", () => {
    const doc = {
      root: {
        children: [
          {
            children: [
              {
                children: [
                  {
                    children: [{ text: "wide", type: "text" }],
                    colSpan: 2,
                    type: "tablecell",
                  },
                ],
                type: "tablerow",
              },
              {
                children: [
                  {
                    children: [{ text: "x", type: "text" }],
                    type: "tablecell",
                  },
                  {
                    children: [{ text: "y", type: "text" }],
                    type: "tablecell",
                  },
                ],
                type: "tablerow",
              },
            ],
            type: "table",
          },
        ],
      },
    } as RichTextCompatDocument;
    const store = createEditorStoreFromCompat(doc);
    const tableId = store.order[0]!;
    const grid = tableGrid(store, tableId);
    expect(grid.colCount).toBe(2);
    expect(grid.rowCount).toBe(2);
    // The two top positions are the same (spanning) cell; the bottom row is two.
    expect(grid.map[0]![0]!.cellId).toBe(grid.map[0]![1]!.cellId);
    expect(grid.map[0]![0]!.colSpan).toBe(2);
    expect(grid.map[1]![0]!.cellId).not.toBe(grid.map[1]![1]!.cellId);
  });

  it("selectedCellRange returns the rectangle's distinct cells", () => {
    const store = simpleTableStore([
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h", "i"],
    ]);
    const grid = tableGrid(store, store.order[0]!);
    const range = selectedCellRange(
      grid,
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    );
    expect(range.rect).toEqual({ maxCol: 1, maxRow: 1, minCol: 0, minRow: 0 });
    expect(range.cellIds).toHaveLength(4);
  });

  it("moveArrayItem reorders without mutating the source", () => {
    const source = ["a", "b", "c"];
    expect(moveArrayItem(source, 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveArrayItem(source, 2, 0)).toEqual(["c", "a", "b"]);
    expect(source).toEqual(["a", "b", "c"]);
    expect(moveArrayItem(source, 5, 0)).toEqual(["a", "b", "c"]);
  });
});

describe("table — column / row move (docs/022 §7, legacy $moveTableColumn)", () => {
  it("moveColumn reorders every row's cell and the matching colWidths entry", () => {
    const store = simpleTableStore([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    const tableId = store.order[0]!;
    resizeColumns(store, tableId, [100, 160, 200]);
    moveColumn(store, tableId, 0, 2);
    // Each row now reads b, c, a (the first column moved to the end).
    const cellText = (cellId: NodeId) =>
      store.requireTextNode(structural(store, cellId).children[0]!).content
        .text;
    const rowText = (rowIndex: number) =>
      structural(store, structural(store, tableId).children[rowIndex]!)
        .children.map((id) => cellText(id))
        .join("");
    expect(rowText(0)).toBe("bca");
    expect(rowText(1)).toBe("efd");
    expect(structural(store, tableId).attrs?.colWidths).toEqual([
      160, 200, 100,
    ]);
    store.undo();
    expect(rowText(0)).toBe("abc");
    expect(structural(store, tableId).attrs?.colWidths).toEqual([
      100, 160, 200,
    ]);
  });

  it("moveRow reorders the table's rows in one undoable step", () => {
    const store = simpleTableStore([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
    const tableId = store.order[0]!;
    const firstCellText = (rowIndex: number) => {
      const cellId = structural(
        store,
        structural(store, tableId).children[rowIndex]!,
      ).children[0]!;
      return store.requireTextNode(structural(store, cellId).children[0]!)
        .content.text;
    };
    moveRow(store, tableId, 0, 2);
    expect([firstCellText(0), firstCellText(1), firstCellText(2)]).toEqual([
      "c",
      "e",
      "a",
    ]);
    store.undo();
    expect([firstCellText(0), firstCellText(1), firstCellText(2)]).toEqual([
      "a",
      "c",
      "e",
    ]);
  });

  it("move is refused on a merged table (legacy $isSimpleTable guard)", () => {
    const store = simpleTableStore([
      ["a", "b"],
      ["c", "d"],
    ]);
    const tableId = store.order[0]!;
    mergeCells(store, tableId, { col: 0, row: 0 }, { col: 1, row: 0 });
    expect(hasMergedCells(store, tableId)).toBe(true);
    const before = compatFromEditorStore(store);
    moveColumn(store, tableId, 0, 1);
    moveRow(store, tableId, 0, 1);
    // No-ops: the exported document is unchanged.
    expect(compatFromEditorStore(store)).toEqual(before);
  });

  it("insert/delete row/column are refused on a merged table (no grid corruption)", () => {
    const store = simpleTableStore([
      ["a", "b"],
      ["c", "d"],
    ]);
    const tableId = store.order[0]!;
    mergeCells(store, tableId, { col: 0, row: 0 }, { col: 1, row: 0 });
    const before = compatFromEditorStore(store);
    insertRow(store, tableId, 1);
    deleteRow(store, tableId, 1);
    insertColumn(store, tableId, 1);
    deleteColumn(store, tableId, 1);
    expect(compatFromEditorStore(store)).toEqual(before);
  });
});

describe("table — cell merge / unmerge (docs/022 §7, legacy $mergeCells)", () => {
  it("merges a 2×2 range into the top-left cell, carrying content", () => {
    const store = simpleTableStore([
      ["a", "b"],
      ["c", "d"],
    ]);
    const tableId = store.order[0]!;
    const target = mergeCells(
      store,
      tableId,
      { col: 0, row: 0 },
      { col: 1, row: 1 },
    );
    expect(target).not.toBeNull();
    const cell = structural(store, target!);
    expect(cell.attrs?.colSpan).toBe(2);
    expect(cell.attrs?.rowSpan).toBe(2);
    // The covered cells were removed; their content moved into the target.
    expect(
      structural(store, structural(store, tableId).children[0]!).children,
    ).toHaveLength(1);
    const exported = compatFromEditorStore(store);
    const merged = exported.root.children[0]!.children?.[0]?.children?.[0];
    expect(merged?.colSpan).toBe(2);
    expect(merged?.rowSpan).toBe(2);
    expect(textOf(merged!)).toBe("abcd");
  });

  it("a 1×1 range is a no-op merge", () => {
    const store = simpleTableStore([
      ["a", "b"],
      ["c", "d"],
    ]);
    const tableId = store.order[0]!;
    expect(
      mergeCells(store, tableId, { col: 0, row: 0 }, { col: 0, row: 0 }),
    ).toBeNull();
    expect(hasMergedCells(store, tableId)).toBe(false);
  });

  it("undo reverses a merge atomically", () => {
    const store = simpleTableStore([
      ["a", "b"],
      ["c", "d"],
    ]);
    const tableId = store.order[0]!;
    const before = compatFromEditorStore(store);
    mergeCells(store, tableId, { col: 0, row: 0 }, { col: 1, row: 1 });
    store.undo();
    expect(compatFromEditorStore(store)).toEqual(before);
  });

  it("unmergeCell restores the covered cells and clears the spans", () => {
    const store = simpleTableStore([
      ["a", "b", "c"],
      ["d", "e", "f"],
      ["g", "h", "i"],
    ]);
    const tableId = store.order[0]!;
    const target = mergeCells(
      store,
      tableId,
      { col: 1, row: 1 },
      { col: 2, row: 2 },
    );
    expect(hasMergedCells(store, tableId)).toBe(true);
    unmergeCell(store, tableId, target!);
    expect(hasMergedCells(store, tableId)).toBe(false);
    // The grid is rectangular again (3 cells per row).
    for (const rowId of structural(store, tableId).children) {
      expect(structural(store, rowId).children).toHaveLength(3);
    }
    expect(cellCoords(tableGrid(store, tableId), target!)).toEqual({
      col: 1,
      row: 1,
    });
  });
});

describe("table — cross-cell selection is non-corrupting (deleteRange scope guard)", () => {
  it("delete-selection across two cells is a safe no-op, not a grid corruption", () => {
    const store = simpleTableStore([
      ["ab", "cd"],
      ["ef", "gh"],
    ]);
    const tableId = store.order[0]!;
    const row0 = structural(store, tableId).children[0]!;
    const cellA = structural(store, row0).children[0]!;
    const cellB = structural(store, row0).children[1]!;
    const leafA = structural(store, cellA).children[0]!;
    const leafB = structural(store, cellB).children[0]!;
    const a = store.requireTextNode(leafA);
    const b = store.requireTextNode(leafB);
    // A text selection that spans two cells (anchor in A, focus in B).
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(leafA, a.content, 1),
        focus: pointAtOffset(leafB, b.content, 1),
        type: "text",
      },
      steps: [],
    });
    store.command({ type: "delete-selection" });
    // Neither cell is emptied or merged; both keep their paragraph and text.
    expect(store.requireTextNode(leafA).content.text).toBe("ab");
    expect(store.requireTextNode(leafB).content.text).toBe("cd");
    expect(structural(store, cellB).children).toHaveLength(1);
    // Typing over the same cross-cell selection collapses to the start cell, never
    // splices the far cell's text in.
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(leafA, store.requireTextNode(leafA).content, 1),
        focus: pointAtOffset(leafB, store.requireTextNode(leafB).content, 1),
        type: "text",
      },
      steps: [],
    });
    store.command({ type: "insert-text", text: "X" });
    expect(store.requireTextNode(leafB).content.text).toBe("cd");
  });
});

describe("table — cell attributes (fill + vertical align, docs/022 §7)", () => {
  it("setCellBackground sets/clears the attr across cells in one undo", () => {
    const store = simpleTableStore([["a", "b", "c"]]);
    const tableId = store.order[0]!;
    const cells = structural(
      store,
      structural(store, tableId).children[0]!,
    ).children;
    setCellBackground(store, [cells[0]!, cells[1]!], "#14532d");
    expect(structural(store, cells[0]!).attrs?.backgroundColor).toBe("#14532d");
    expect(structural(store, cells[1]!).attrs?.backgroundColor).toBe("#14532d");
    expect(structural(store, cells[2]!).attrs?.backgroundColor).toBeUndefined();
    store.undo(); // one undo reverses both
    expect(structural(store, cells[0]!).attrs?.backgroundColor).toBeUndefined();
    expect(structural(store, cells[1]!).attrs?.backgroundColor).toBeUndefined();
    // Clearing removes the attr.
    setCellBackground(store, [cells[0]!], "#333");
    setCellBackground(store, [cells[0]!], undefined);
    expect(structural(store, cells[0]!).attrs?.backgroundColor).toBeUndefined();
  });

  it("setCellVerticalAlign stores middle/bottom and clears for top", () => {
    const store = simpleTableStore([["a"]]);
    const tableId = store.order[0]!;
    const cell = structural(store, structural(store, tableId).children[0]!)
      .children[0]!;
    setCellVerticalAlign(store, [cell], "middle");
    expect(structural(store, cell).attrs?.verticalAlign).toBe("middle");
    setCellVerticalAlign(store, [cell], "top");
    expect(structural(store, cell).attrs?.verticalAlign).toBeUndefined();
  });

  it("activeCellContext finds the caret's cell and its merged flag", () => {
    const store = simpleTableStore([
      ["a", "b"],
      ["c", "d"],
    ]);
    const tableId = store.order[0]!;
    const cellA = structural(store, structural(store, tableId).children[0]!)
      .children[0]!;
    const leafA = structural(store, cellA).children[0]!;
    const a = store.requireTextNode(leafA);
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(leafA, a.content, 0),
        focus: pointAtOffset(leafA, a.content, 0),
        type: "text",
      },
      steps: [],
    });
    expect(activeCellContext(store)).toEqual({
      cellId: cellA,
      merged: false,
      tableId,
    });
    const target = mergeCells(
      store,
      tableId,
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    );
    // After merge the caret lands in the merged cell; it reports merged.
    expect(activeCellContext(store)?.cellId).toBe(target);
    expect(activeCellContext(store)?.merged).toBe(true);
  });
});

/** A table with a 2-row span on the first cell (a non-rectangular grid). */
function spanTableStore(): EditorStore {
  const cell = (text: string, extra?: Record<string, unknown>) => ({
    children: [{ text, type: "text" }],
    ...extra,
    type: "tablecell",
  });
  const doc = {
    root: {
      children: [
        {
          children: [
            {
              children: [cell("A", { rowSpan: 2 }), cell("B"), cell("C")],
              type: "tablerow",
            },
            { children: [cell("D"), cell("E")], type: "tablerow" },
            { children: [cell("F"), cell("G"), cell("H")], type: "tablerow" },
          ],
          type: "table",
        },
      ],
    },
  } as RichTextCompatDocument;
  return createEditorStoreFromCompat(doc);
}

describe("table — in-cell paragraph merge (Backspace folds within a cell)", () => {
  it("Backspace at the start of a cell's 2nd paragraph merges it into the 1st", () => {
    const doc = {
      root: {
        children: [
          {
            children: [
              {
                children: [
                  {
                    children: [
                      {
                        children: [{ text: "Widgets", type: "text" }],
                        type: "paragraph",
                      },
                      {
                        children: [{ text: "12400", type: "text" }],
                        type: "paragraph",
                      },
                    ],
                    type: "tablecell",
                  },
                ],
                type: "tablerow",
              },
            ],
            type: "table",
          },
        ],
      },
    } as RichTextCompatDocument;
    const store = createEditorStoreFromCompat(doc);
    const tableId = store.order[0]!;
    const cell = structural(
      store,
      structural(store, structural(store, tableId).children[0]!).children[0]!,
    );
    expect(cell.children).toHaveLength(2);
    const para2 = cell.children[1]!;
    const p2 = store.requireTextNode(para2);
    // Caret at the very start of the 2nd paragraph.
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(para2, p2.content, 0),
        focus: pointAtOffset(para2, p2.content, 0),
        type: "text",
      },
      steps: [],
    });
    store.command({ type: "delete-backward" });
    const after = structural(
      store,
      structural(store, structural(store, tableId).children[0]!).children[0]!,
    );
    expect(after.children).toHaveLength(1); // the two paragraphs folded into one
    expect(store.requireTextNode(after.children[0]!).content.text).toBe(
      "Widgets12400",
    );
  });
});

describe("table — merge-aware insert/delete (docs/022 §7)", () => {
  function span(store: EditorStore, cellId: NodeId, key: string): number {
    const c = structural(store, cellId);
    const v = c.attrs?.[key];
    return typeof v === "number" ? v : 1;
  }

  it("insertColumn on a merged grid places cells at the right physical index", () => {
    const store = spanTableStore();
    const tableId = store.order[0]!;
    const aId = tableGrid(store, tableId).map[0]![0]!.cellId; // the rowSpan cell
    insertColumn(store, tableId, 1);
    const grid = tableGrid(store, tableId);
    expect(grid.colCount).toBe(4);
    // The rowSpan cell still covers (0,0) and (1,0).
    expect(grid.map[0]![0]!.cellId).toBe(aId);
    expect(grid.map[1]![0]!.cellId).toBe(aId);
    expect(span(store, aId, "rowSpan")).toBe(2);
  });

  it("insertRow across a rowSpan extends the span instead of splitting it", () => {
    const store = spanTableStore();
    const tableId = store.order[0]!;
    const aId = tableGrid(store, tableId).map[0]![0]!.cellId;
    insertRow(store, tableId, 1); // between the two rows the span covers
    const grid = tableGrid(store, tableId);
    expect(grid.rowCount).toBe(4);
    expect(span(store, aId, "rowSpan")).toBe(3); // extended to cover the new row
    expect(grid.map[2]![0]!.cellId).toBe(aId); // still covers the new middle row
  });

  it("deleteColumn removes a 1×1 column and keeps the rowSpan cell's content", () => {
    const store = spanTableStore();
    const tableId = store.order[0]!;
    deleteColumn(store, tableId, 1); // the B/D/G column (all 1×1)
    const grid = tableGrid(store, tableId);
    expect(grid.colCount).toBe(2);
    // The span cell survives at (0,0)..(1,0).
    expect(grid.map[0]![0]!.cellId).toBe(grid.map[1]![0]!.cellId);
  });

  it("deleteRow moves a span-origin cell into the next row and shrinks it", () => {
    const store = spanTableStore();
    const tableId = store.order[0]!;
    const aId = tableGrid(store, tableId).map[0]![0]!.cellId;
    deleteRow(store, tableId, 0); // row 0 is where the rowSpan begins
    const grid = tableGrid(store, tableId);
    expect(grid.rowCount).toBe(2);
    // The span cell moved down to the new row 0 and is now 1×1, content intact.
    expect(grid.map[0]![0]!.cellId).toBe(aId);
    expect(span(store, aId, "rowSpan")).toBe(1);
    expect(cellCoords(grid, aId)).toEqual({ col: 0, row: 0 });
    const exported = compatFromEditorStore(store);
    const firstCell = exported.root.children[0]!.children?.[0]?.children?.[0];
    expect(textOf(firstCell!)).toBe("A");
  });
});

describe("table — the SPI guardrail (docs/021 §10, docs/022 §12)", () => {
  it("keeps no per-type table branch in the core command/compat layer", () => {
    // docs/021 §10 / docs/022 §12: grid semantics compose general primitives; no
    // `if (type === "tablecell"/"tablerow"/"editor-table")` welded into a core
    // command compiler or a compat branch. The table family lives only in the
    // registered `core/table.ts` definition and the view/feature layer.
    const coreDir = join(process.cwd(), "packages/editor/src/core");
    const guardedFiles = [
      "commands/objects.ts",
      "commands/index.ts",
      "commands/blocks.ts",
      "commands/text.ts",
      "commands/shared.ts",
      "compat.ts",
    ];
    for (const file of guardedFiles) {
      const source = readFileSync(join(coreDir, file), "utf8");
      for (const literal of [
        '"tablecell"',
        '"tablerow"',
        '"editor-table"',
        '=== "table"',
      ]) {
        expect(`${file}:${source.includes(literal)}`).toBe(`${file}:false`);
      }
    }
  });
});
