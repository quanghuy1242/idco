/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import {
  $isTableCellNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableNode,
  type TableCellNode,
  type SerializedTableNode,
} from "@lexical/table";
import type {
  EditorConfig,
  LexicalEditor,
  LexicalUpdateJSON,
  NodeKey,
  Spread,
} from "lexical";

/**
 * Table column-sizing modes. `fixed` keeps absolute pixel column widths (the
 * table can be wider/narrower than its container and scrolls); `responsive`
 * pins the columns to the container and distributes them proportionally, so the
 * table reflows like a Confluence table; `full-width` is responsive that also
 * bleeds to the full content width on the rendered page. See docs/003 §6.
 */
export type TableLayout = "fixed" | "responsive" | "full-width";

export const TABLE_LAYOUTS: readonly {
  readonly value: TableLayout;
  readonly label: string;
  readonly icon: string;
}[] = [
  { value: "fixed", label: "Fixed", icon: "Columns3" },
  { value: "responsive", label: "Responsive", icon: "LayoutDashboard" },
  { value: "full-width", label: "Full width", icon: "AlignJustify" },
];

/**
 * Stamp the layout mode and numbered-column state onto the rendered table.
 * `createDOM` may return Lexical's scroll wrapper or the bare table (depending
 * on `hasHorizontalScroll`), so resolve the actual `<table>` either way. CSS in
 * `preview.css` keys off `data-table-layout` (responsive fill) and the
 * `rt-table-numbered` class (the left row-number gutter).
 */
function applyTableLayoutDom(
  dom: HTMLElement,
  layout: TableLayout,
  showRowNumbers: boolean,
): void {
  const table =
    dom instanceof HTMLTableElement ? dom : dom.querySelector("table");
  const target = table ?? dom;
  target.setAttribute("data-table-layout", layout);
  target.classList.toggle("rt-table-numbered", showRowNumbers);
}

export function tableLayoutValue(value: unknown): TableLayout {
  return value === "fixed" || value === "responsive" || value === "full-width"
    ? value
    : "fixed";
}

/** True for the modes that fill their container (proportional columns). */
export function isResponsiveLayout(layout: TableLayout): boolean {
  return layout === "responsive" || layout === "full-width";
}

export type SerializedEditorTableNode = Spread<
  {
    id?: string;
    layout?: TableLayout;
    showRowNumbers?: boolean;
  },
  SerializedTableNode
>;

/**
 * `TableNode` extended with the two attributes Lexical's stock table can't carry
 * — the column-sizing `layout` and the opt-in numbered-column gutter. Both must
 * round-trip through `exportJSON`/`importJSON` because the persisted document is
 * the source of truth for the renderer. Registered via node replacement (see
 * `RichTextEditor.tsx`) so every `$createTableNode` / paste / insert produces
 * this subclass. New tables serialize as `"editor-table"`; the renderer and
 * normalize/serialize layer accept both it and legacy `"table"`.
 *
 * Newly created tables default to `responsive` (the field initializer);
 * documents imported without a `layout` field are treated as `fixed` (legacy
 * behavior), resolved in `updateFromJSON`.
 */
export class EditorTableNode extends TableNode {
  __idcoId: string | undefined;
  __layout: TableLayout = "responsive";
  __showRowNumbers = false;

  constructor(id?: string, key?: NodeKey) {
    super(key);
    this.__idcoId = cleanNodeId(id);
  }

  // A unique node type is mandatory for Lexical's node-replacement registry (a
  // same-type override registers the base klass for "table", so constructing the
  // subclass throws a type/klass mismatch). New tables therefore serialize as
  // "editor-table"; the renderer and normalize/serialize layer accept both it and
  // legacy "table". Legacy "table" still hydrates into this class because its
  // base `TableNode.importJSON` runs `$createTableNode` (replacement). §6.2.
  static getType(): string {
    return "editor-table";
  }

  static clone(node: EditorTableNode): EditorTableNode {
    return new EditorTableNode(node.__idcoId, node.__key);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__idcoId = prevNode.__idcoId;
    this.__layout = prevNode.__layout;
    this.__showRowNumbers = prevNode.__showRowNumbers;
  }

  static importJSON(
    serializedNode: SerializedEditorTableNode,
  ): EditorTableNode {
    return new EditorTableNode().updateFromJSON(serializedNode);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedEditorTableNode>,
  ): this {
    const self = super.updateFromJSON(serializedNode);
    // Absent `layout` means a legacy document predating layout modes → fixed.
    return self
      .setId(serializedNode.id)
      .setLayout(tableLayoutValue(serializedNode.layout ?? "fixed"))
      .setShowRowNumbers(serializedNode.showRowNumbers === true);
  }

  exportJSON(): SerializedEditorTableNode {
    // Type is the internal "editor-table" (Lexical validates exportJSON().type
    // === getType()). The renderer and normalize/serialize layer recognise both
    // "editor-table" (new) and legacy "table". `layout` is always written so a
    // `responsive` table re-imports as responsive instead of the `fixed` default.
    return {
      ...super.exportJSON(),
      ...(this.getId() ? { id: this.getId() } : {}),
      layout: this.getLayout(),
      ...(this.getShowRowNumbers() ? { showRowNumbers: true } : {}),
    };
  }

  createDOM(config: EditorConfig, editor?: LexicalEditor): HTMLElement {
    const dom = super.createDOM(config, editor);
    applyTableLayoutDom(dom, this.__layout, this.__showRowNumbers);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const recreate = super.updateDOM(prevNode, dom, config);
    if (!recreate) {
      applyTableLayoutDom(dom, this.__layout, this.__showRowNumbers);
    }
    return recreate;
  }

  getLayout(): TableLayout {
    return this.getLatest().__layout;
  }

  getId(): string | undefined {
    return this.getLatest().__idcoId;
  }

  setId(id: string | undefined): this {
    const self = this.getWritable();
    self.__idcoId = cleanNodeId(id);
    return self;
  }

  setLayout(layout: TableLayout): this {
    const self = this.getWritable();
    self.__layout = layout;
    return self;
  }

  getShowRowNumbers(): boolean {
    return this.getLatest().__showRowNumbers;
  }

  setShowRowNumbers(showRowNumbers: boolean): this {
    const self = this.getWritable();
    self.__showRowNumbers = showRowNumbers;
    return self;
  }
}

function cleanNodeId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Live structural state of a table, read for the controls chrome: its layout
 * mode, the numbered-column toggle, and whether the header row / header column
 * are on (sampled from the top-left cell's per-cell header bits — see
 * `setHeaderStyles`). Header is per-cell in Lexical, not a table property, so
 * the toggle reflects and drives those bits across the relevant axis.
 */
export type TableMeta = {
  readonly key: string;
  readonly layout: TableLayout;
  readonly showRowNumbers: boolean;
  readonly headerRow: boolean;
  readonly headerColumn: boolean;
};

export function $readTableMeta(node: EditorTableNode): TableMeta {
  const corner = $firstCell(node);
  const state = corner?.getHeaderStyles() ?? TableCellHeaderStates.NO_STATUS;
  return {
    key: node.getKey(),
    layout: node.getLayout(),
    showRowNumbers: node.getShowRowNumbers(),
    headerRow: (state & TableCellHeaderStates.ROW) !== 0,
    headerColumn: (state & TableCellHeaderStates.COLUMN) !== 0,
  };
}

function $firstCell(node: EditorTableNode): TableCellNode | null {
  const row = node.getChildAtIndex(0);
  if (!$isTableRowNode(row)) return null;
  const cell = row.getChildAtIndex(0);
  return $isTableCellNode(cell) ? cell : null;
}

/** Flip the header-ROW bit on every cell of the first row, leaving COLUMN intact. */
export function $setHeaderRow(node: EditorTableNode, on: boolean): void {
  const row = node.getChildAtIndex(0);
  if (!$isTableRowNode(row)) return;
  const next = on ? TableCellHeaderStates.ROW : TableCellHeaderStates.NO_STATUS;
  for (const cell of row.getChildren()) {
    if ($isTableCellNode(cell)) {
      cell.setHeaderStyles(next, TableCellHeaderStates.ROW);
    }
  }
}

/** Flip the header-COLUMN bit on every first-column cell, leaving ROW intact. */
export function $setHeaderColumn(node: EditorTableNode, on: boolean): void {
  const next = on
    ? TableCellHeaderStates.COLUMN
    : TableCellHeaderStates.NO_STATUS;
  for (const row of node.getChildren()) {
    if (!$isTableRowNode(row)) continue;
    const cell = row.getChildAtIndex(0);
    if ($isTableCellNode(cell)) {
      cell.setHeaderStyles(next, TableCellHeaderStates.COLUMN);
    }
  }
}
