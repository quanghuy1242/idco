/**
 * The built-in table structural views (docs/022 §4.4).
 *
 * A table is a faithful grid of structural nodes — `table → tablerow → tablecell
 * → blocks` — so it renders through the recursive `EngineBlock`/resting dispatch
 * the same way a callout does (docs/020 §3.7): the `table` view wraps its rendered
 * rows, the `tablerow` view wraps its cells, the `tablecell` view wraps its block
 * children. A cell holds normal block children, so editing inside a cell is normal
 * block editing on a scope (docs/019 §4.2) — these views own only the grid chrome.
 *
 * Live and resting are co-located per type so the editor surface and the published
 * page cannot drift. Resting reuses the shared reader components
 * (`RichTextTable`/`Row`/`Cell`); live wraps the same frame but renders raw cells
 * carrying the engine's block hooks (`data-engine-block-id`, `registerBlock`) the
 * shared components do not expose. The legacy `editor-table` serialization name is
 * normalized to the canonical `table` on import (the `table` core's `aliases`), so
 * there is one table type and one view — no alias view, no per-instance branch.
 */
import {
  RichTextTable,
  RichTextTableCell,
  RichTextTableRow,
  readableTextColor,
  verticalAlignClass,
} from "@quanghuy1242/idco-ui";
import { type JsonValue, type StructuralNode } from "../../../core";
import { tabWithinTable } from "../../../core/table/operations";
import { type StructuralNodeView } from "../../spi";
import { TableControls } from "./table-controls";
import { TableInteractions } from "./table-interactions";
import {
  contributeCellCommands,
  contributeTableCommands,
} from "./table-commands";

/** Cell classes copied from the reader `RichTextTableCell` so live matches rest. */
const CELL_CLASS =
  "border-b border-r border-base-300 px-5 py-2.5 text-base-content";
const HEADER_CLASS = "bg-base-200 text-left font-semibold";

function numberArray(
  value: JsonValue | undefined,
): readonly number[] | undefined {
  return Array.isArray(value) && value.every((n) => typeof n === "number")
    ? (value as readonly number[])
    : undefined;
}

function isHeaderCell(node: StructuralNode): boolean {
  const state = node.attrs?.headerState;
  return typeof state === "number" && state > 0;
}

function numberAttr(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && value > 1 ? value : undefined;
}

function stringAttr(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * The `table` structural view (docs/022 §3). One canonical type: the legacy
 * `editor-table` serialization name is normalized to `table` on import (see the
 * `table` core's `aliases`), so the model never holds it and this view needs no
 * per-instance identity branch.
 */
export const tableStructuralView: StructuralNodeView = {
  insert: {
    createCommand: () => ({
      structuralType: "table",
      type: "insert-structural",
    }),
    group: "Blocks",
    icon: "Table",
    keywords: ["table", "grid", "rows", "columns"],
    label: "Table",
  },
  // The whole-table hover controls and the cell-range/cell-action layer are a
  // single pair of portals that scan the surface for every table (docs/022 §6/§7),
  // so they mount once for the whole view, not per node.
  renderOverlay: ({ store, rootRef }) => (
    <>
      <TableControls rootRef={rootRef} store={store} />
      <TableInteractions store={store} />
    </>
  ),
  // Tab/Shift-Tab walks to the next/previous cell when the caret is in a table
  // (docs/022 §5), registered through the structural `handleTab` SPI slot (note.md
  // VP6) so this table-specific behavior lives with the table; `tabWithinTable`
  // self-checks the caret and returns false when it is not in a table.
  handleTab: ({ store, forward }) => tabWithinTable(store, forward),
  // The table's structure ops (insert/delete row+column, header toggles, row numbers,
  // layout, remove) are scope contributions now (docs/024 §7.4), so right-clicking a
  // cell shows them in the one context menu. The hover handles in `TableControls` stay
  // for the genuinely-spatial insert/delete/resize gestures.
  contributeCommands: contributeTableCommands,
  renderContainer: ({ node, registerBlock, children }) => {
    const colWidths = numberArray(node.attrs?.colWidths);
    const layout =
      typeof node.attrs?.layout === "string" ? node.attrs.layout : undefined;
    const numbered = node.attrs?.showRowNumbers === true;
    // The whole-table chrome + the live insert/delete/resize affordances are a
    // single hover overlay (`TableControls`, mounted once in the view), so the
    // table itself only renders the measured grid with the engine block hooks.
    return (
      <div
        data-engine-block-id={node.id}
        data-engine-structural="table"
        ref={(element) => registerBlock(node.id, element)}
      >
        <RichTextTable
          colWidths={colWidths}
          layout={layout}
          numbered={numbered}
        >
          {children}
        </RichTextTable>
      </div>
    );
  },
  renderResting: ({ node, children, renderSequence }) => {
    const colWidths = numberArray(node.attrs?.colWidths);
    const layout =
      typeof node.attrs?.layout === "string" ? node.attrs.layout : undefined;
    const numbered = node.attrs?.showRowNumbers === true;
    return (
      <div data-engine-resting-block={node.id} key={node.id}>
        <RichTextTable
          colWidths={colWidths}
          layout={layout}
          numbered={numbered}
        >
          {renderSequence(children)}
        </RichTextTable>
      </div>
    );
  },
  type: "table",
};

export const tableRowStructuralView: StructuralNodeView = {
  renderContainer: ({ node, registerBlock, children }) => (
    <tr
      data-engine-block-id={node.id}
      data-engine-structural="tablerow"
      ref={(element) => registerBlock(node.id, element)}
    >
      {children}
    </tr>
  ),
  renderResting: ({ children, renderSequence }) => (
    <RichTextTableRow>{renderSequence(children)}</RichTextTableRow>
  ),
  type: "tablerow",
};

export const tableCellStructuralView: StructuralNodeView = {
  renderContainer: ({ node, registerBlock, children }) => {
    const header = isHeaderCell(node);
    const valign = verticalAlignClass(stringAttr(node.attrs?.verticalAlign));
    const base = `${CELL_CLASS} ${valign}`;
    const className = header ? `${base} ${HEADER_CLASS}` : base;
    const colSpan = numberAttr(node.attrs?.colSpan);
    const rowSpan = numberAttr(node.attrs?.rowSpan);
    const background = stringAttr(node.attrs?.backgroundColor);
    const Tag = header ? "th" : "td";
    return (
      <Tag
        className={className}
        colSpan={colSpan}
        data-engine-block-id={node.id}
        data-engine-structural="tablecell"
        ref={(element: HTMLTableCellElement | null) =>
          registerBlock(node.id, element)
        }
        rowSpan={rowSpan}
        style={
          background
            ? { background, color: readableTextColor(background) }
            : undefined
        }
      >
        {children}
      </Tag>
    );
  },
  renderResting: ({ node, children, renderSequence }) => (
    <RichTextTableCell
      backgroundColor={stringAttr(node.attrs?.backgroundColor)}
      colSpan={numberAttr(node.attrs?.colSpan)}
      header={isHeaderCell(node)}
      key={node.id}
      rowSpan={numberAttr(node.attrs?.rowSpan)}
      verticalAlign={stringAttr(node.attrs?.verticalAlign)}
    >
      {renderSequence(children)}
    </RichTextTableCell>
  ),
  // A colored cell paints its text with `readableTextColor(background)` (above);
  // the engine's painted caret/gap cursor matches that same auto-contrast ink so
  // it stays legible on a dark fill — CSS `caret-color` cannot reach a painted
  // caret. The selection overlay walks ancestors and asks for this (docs/022 §7).
  caretInk: (node) => {
    const background = stringAttr(node.attrs?.backgroundColor);
    return background ? readableTextColor(background) : undefined;
  },
  // Cell ops (merge/unmerge/fill/align) are scope contributions now (docs/024 §7.4):
  // the former floating `…` popover is gone; the cell-range drag that feeds "Merge"
  // stays spatial in `TableInteractions`.
  contributeCommands: contributeCellCommands,
  type: "tablecell",
};
