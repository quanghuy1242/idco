/**
 * The table's framework-free core half (docs/022): the `table`/`tablerow`/
 * `tablecell` structural definitions — how a table is seeded on insert, imported
 * from the legacy compat JSON, and exported back to it byte-stable.
 *
 * The table is a faithful grid of structural nodes (docs/022 §3): a `table` holds
 * `tablerow`s, a row holds `tablecell`s, and a cell holds normal block children (a
 * paragraph by default). A cell is a scope like any other (docs/019 §4.2), so cell
 * editing, in-cell insertion, and 2D caret movement all come from the engine's
 * general machinery — this file only declares the data shape, never grid geometry.
 *
 * Cell attributes are preserved verbatim across the round-trip — `headerState`
 * (the legacy `TableCellHeaderStates` bitfield, ROW=1/COLUMN=2), plus `colSpan`,
 * `rowSpan`, `backgroundColor`, and `verticalAlign` that every legacy Lexical cell
 * carries — so a stored table survives load→save even for features (merged cells,
 * cell background) the owned editor does not yet *edit*. The one place persistence
 * is not generic is the cell body: at runtime it holds a paragraph leaf, but the
 * saved JSON holds inline text directly under the cell, so `toCompatNode` flattens
 * a sole paragraph back to inline text (docs/022 §4.3). `editor-table` is the
 * legacy serialization alias; it shares the impl and keeps its own type.
 */
import {
  makeStructuralNode,
  makeTextNode,
  type EditorNode,
  type IdAllocator,
  type JsonObject,
  type JsonValue,
  type NodeId,
  type RichTextCompatNode,
  type StructuralNode,
} from "../model";
import type {
  StructuralDefinition,
  StructuralExportContext,
  StructuralSubtree,
} from "../registry";

// Per-cell header bitfield (legacy `TableCellHeaderStates`): ROW=1, COLUMN=2.
const HEADER_ROW = 1;
const HEADER_COLUMN = 2;
// Default seeded column width (px); the responsive layout renders it as a ratio.
const DEFAULT_COL_WIDTH = 160;
// Cell attrs preserved verbatim through import/export (legacy parity, B1/B5).
const CELL_ATTR_KEYS = [
  "headerState",
  "colSpan",
  "rowSpan",
  "backgroundColor",
  "verticalAlign",
] as const;

type CellSpec = { readonly text: string; readonly headerState?: number };

/** Build one `tablecell` wrapping a single paragraph leaf. */
function buildCell(
  allocator: IdAllocator,
  spec: CellSpec,
): { cell: StructuralNode; descendants: EditorNode[]; paragraphId: NodeId } {
  const paragraphId = allocator.createNodeId();
  const paragraph = makeTextNode({
    content: allocator.createTextSlice(spec.text),
    id: paragraphId,
    type: "paragraph",
  });
  const cell = makeStructuralNode({
    ...(spec.headerState ? { attrs: { headerState: spec.headerState } } : {}),
    children: [paragraphId],
    id: allocator.createNodeId(),
    type: "tablecell",
  });
  return { cell, descendants: [paragraph], paragraphId };
}

/** Build one `tablerow` of cells; returns the row + its full flat descendants. */
function buildRow(
  allocator: IdAllocator,
  cells: readonly CellSpec[],
): {
  row: StructuralNode;
  descendants: EditorNode[];
  paragraphIds: NodeId[];
} {
  const built = cells.map((spec) => buildCell(allocator, spec));
  const row = makeStructuralNode({
    children: built.map((b) => b.cell.id),
    id: allocator.createNodeId(),
    type: "tablerow",
  });
  const descendants = built.flatMap((b) => [b.cell, ...b.descendants]);
  return { descendants, paragraphIds: built.map((b) => b.paragraphId), row };
}

// Default table size when no dimension picker params arrive (the legacy 3×3 seed:
// a header row + two body rows, three columns). Clamp bounds keep a picker from
// seeding a pathological grid (a 0-row table is invalid; a huge one would jank).
const DEFAULT_TABLE_ROWS = 3;
const DEFAULT_TABLE_COLS = 3;
const MAX_TABLE_ROWS = 50;
const MAX_TABLE_COLS = 20;

/** Read a positive integer dimension off the insert params, clamped to [1, max]. */
function dimension(
  value: JsonValue | undefined,
  fallback: number,
  max: number,
) {
  const n = typeof value === "number" && Number.isFinite(value) ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.round(n)));
}

/**
 * Seed a `rows × cols` table with a header row and a header column (legacy
 * `includeHeaders` default; the corner cell carries both bits = 3), explicit
 * `colWidths` so resize is authoritative from the first drag, and `responsive`
 * layout so a new table fills its container. Without params it builds the legacy
 * 3×3 (header + two body rows); the toolbar's Insert → Table dimension picker
 * passes `{ rows, cols }` (docs/023 §7.2) — `rows` counts the header row, so a
 * "4 × 2" pick is a header row plus three body rows of two columns each. The caret
 * lands in the first data cell (the first body row), or the header's first cell
 * when the author picked a single row.
 */
function buildTableSubtree(
  allocator: IdAllocator,
  type: string,
  params?: { readonly rows?: JsonValue; readonly cols?: JsonValue },
): StructuralSubtree {
  const rows = dimension(params?.rows, DEFAULT_TABLE_ROWS, MAX_TABLE_ROWS);
  const cols = dimension(params?.cols, DEFAULT_TABLE_COLS, MAX_TABLE_COLS);
  const header = buildRow(
    allocator,
    Array.from({ length: cols }, (_, col) => ({
      headerState: col === 0 ? HEADER_ROW | HEADER_COLUMN : HEADER_ROW,
      text: `Column ${col + 1}`,
    })),
  );
  const bodyRows = Array.from({ length: rows - 1 }, () =>
    buildRow(
      allocator,
      Array.from({ length: cols }, (_, col) => ({
        ...(col === 0 ? { headerState: HEADER_COLUMN } : {}),
        text: "",
      })),
    ),
  );
  const root = makeStructuralNode({
    attrs: {
      colWidths: Array.from({ length: cols }, () => DEFAULT_COL_WIDTH),
      layout: "responsive",
    },
    children: [header.row.id, ...bodyRows.map((r) => r.row.id)],
    id: allocator.createNodeId(),
    type,
  });
  // Prefer the first body row's second cell (the old behavior); fall back to its
  // first cell, then to the header when the table has no body rows (rows === 1).
  const caret =
    bodyRows[0]?.paragraphIds[1] ??
    bodyRows[0]?.paragraphIds[0] ??
    header.paragraphIds[0];
  return {
    caret,
    descendants: [
      header.row,
      ...header.descendants,
      ...bodyRows.flatMap((r) => [r.row, ...r.descendants]),
    ],
    root,
  };
}

/** Coerce a legacy `colWidths` value to a number array, or undefined. */
function numberArray(value: unknown): readonly number[] | undefined {
  return Array.isArray(value) && value.every((n) => typeof n === "number")
    ? (value as readonly number[])
    : undefined;
}

/** The table node's own attrs from a legacy node (colWidths is an array, so it
 * cannot ride `pickAttrs`, which keeps JSON primitives only). */
function tableAttrs(node: RichTextCompatNode): JsonObject | undefined {
  const attrs: Record<string, JsonValue> = {};
  const colWidths = numberArray(node.colWidths);
  if (colWidths) attrs.colWidths = [...colWidths];
  if (typeof node.layout === "string") attrs.layout = node.layout;
  if (typeof node.showRowNumbers === "boolean") {
    attrs.showRowNumbers = node.showRowNumbers;
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
}

/** Whether any cell in the rows carries a real span (a merged cell). */
function hasMergedCells(
  rows: readonly RichTextCompatNode[] | undefined,
): boolean {
  return (rows ?? []).some(
    (row) =>
      row.type === "tablerow" &&
      (row.children ?? []).some(
        (cell) =>
          (typeof cell.colSpan === "number" && cell.colSpan > 1) ||
          (typeof cell.rowSpan === "number" && cell.rowSpan > 1),
      ),
  );
}

/**
 * Pad every short row with empty cells to the widest row's width, so a malformed
 * (ragged) source still imports as a rectangle — the §3 invariant (docs/022 §11).
 * Skipped when the table has merged cells, whose rows are intentionally short
 * (padding would corrupt the grid); those import verbatim, spans preserved (B5).
 */
function rectangularRows(
  rows: readonly RichTextCompatNode[] | undefined,
): readonly RichTextCompatNode[] {
  const list = rows ?? [];
  if (hasMergedCells(list)) return list;
  const maxCols = list.reduce(
    (max, row) =>
      row.type === "tablerow"
        ? Math.max(max, (row.children ?? []).length)
        : max,
    0,
  );
  return list.map((row) => {
    if (row.type !== "tablerow") return row;
    const cells = row.children ?? [];
    if (cells.length >= maxCols) return row;
    const padding = Array.from({ length: maxCols - cells.length }, () => ({
      children: [],
      type: "tablecell",
    }));
    return { ...row, children: [...cells, ...padding] };
  });
}

function tableDefinition(): StructuralDefinition {
  return {
    // The legacy Lexical serialization called the table `editor-table`; it imports
    // as the canonical `table` (and re-saves as `table`), so the engine no longer
    // carries a second `editor-table` type. One name, everywhere.
    aliases: ["editor-table"],
    createSubtree: (allocator, params) =>
      buildTableSubtree(allocator, "table", params),
    fromCompatNode: (node, ctx) => ({
      attrs: tableAttrs(node),
      // Rows import through the registry recursion (the `tablerow` definition),
      // padded to a rectangle first so a ragged source cannot break the invariant.
      children: ctx.importChildren(rectangularRows(node.children)),
    }),
    type: "table",
    // A table exports generically (attrs + recursed rows); no `toCompatNode`.
  };
}

function tableRowDefinition(): StructuralDefinition {
  return {
    createSubtree(allocator) {
      const row = buildRow(allocator, [{ text: "" }]);
      return {
        caret: row.paragraphIds[0],
        descendants: row.descendants,
        root: row.row,
      };
    },
    fromCompatNode: (node, ctx) => ({
      children: ctx.importChildren(node.children),
    }),
    type: "tablerow",
    // A row exports generically (recursed cells); no `toCompatNode`.
  };
}

function tableCellDefinition(): StructuralDefinition {
  return {
    createSubtree(allocator) {
      const built = buildCell(allocator, { text: "" });
      return {
        caret: built.paragraphId,
        descendants: built.descendants,
        root: built.cell,
      };
    },
    fromCompatNode(node, ctx) {
      // Inline cell text becomes one paragraph (the scope a caret enters); a cell
      // already carrying blocks keeps them. All cell attrs (header bits, spans,
      // background, vertical-align) are preserved verbatim (legacy parity, B1/B5).
      const children = ctx.hasBlockChildren(node.children)
        ? ctx.importChildren(node.children)
        : ctx.importInlineAsParagraph(node);
      return { attrs: ctx.pickAttrs(node, CELL_ATTR_KEYS), children };
    },
    toCompatNode(node: StructuralNode, ctx: StructuralExportContext) {
      // Persist inline text directly under the cell (byte-stable, docs/022 §4.3):
      // a sole paragraph child flattens to its inline children; a multi-block cell
      // exports its blocks as-is. `node.attrs` carries the cell attrs back out.
      const onlyChild =
        node.children.length === 1 ? ctx.getNode(node.children[0]!) : undefined;
      const children =
        onlyChild && onlyChild.kind === "text" && onlyChild.type === "paragraph"
          ? ctx.inlineChildren(onlyChild)
          : ctx.exportChildren(node.children);
      return { attrs: node.attrs, children };
    },
    type: "tablecell",
  };
}

/** The built-in table family for `BUILT_IN_STRUCTURAL_DEFINITIONS` (docs/022 §3). */
export function tableStructuralDefinitions(): readonly StructuralDefinition[] {
  return [tableDefinition(), tableRowDefinition(), tableCellDefinition()];
}
