/**
 * Table scope contributions (docs/024 §5.3/§7.4) — the table's cell + structure
 * commands, folded out of the bespoke `table-interactions`/`table-controls` menus into
 * the one command model.
 *
 * `tablecell` and `table` structural views implement `contributeCommands` (wired in
 * `table.tsx`); the command surfaces enumerate the caret's `scopePath` and merge these
 * with the global commands (docs/024 §6.4), so right-clicking a cell exposes merge / fill /
 * align + insert/delete row+column + header toggles in the *one* context menu. They are
 * all tagged `{ contextMenu: "more" }` — they live in the menu's "More" overflow, not
 * inline — so the primary right-click menu stays the lean text menu and does not become a
 * wall (docs/024 §9 "group explosion"; the direct path is the restored hover chrome).
 * They dispatch the *existing* `core/table/operations`, so no new table logic. The
 * genuinely-spatial affordances (drag-to-resize columns, the inter-cell insert/delete
 * handles, the cell-range drag) stay in `table-controls`/`table-interactions` (§7.4).
 *
 * The cell-range a merge targets is the drag selection, read from the per-store
 * `cell-range` channel at menu-open time (docs/024 §7.4) — the drag layer is spatial, but
 * the *command* over its result lives here.
 *
 * DaisyUI 5 + React Aria: the fill palette + vertical-align rows render inside the
 * surface's React Aria submenu/popover; the color swatches are small bespoke buttons (no
 * primitive models a "swatch grid"), kept accessible with native button labels.
 */
import { NavIcon } from "@quanghuy1242/idco-ui";
import { Button as AriaButton } from "react-aria-components";
import type { EditorStore, NodeId } from "../../../core";
import {
  activeCellContext,
  cellCoords,
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  mergeCells,
  selectedCellRange,
  setCellBackground,
  setCellVerticalAlign,
  setTableLayout,
  tableGrid,
  toggleHeaderColumn,
  toggleHeaderRow,
  toggleRowNumbers,
  unmergeCell,
} from "../../../core/table/operations";
import type { Command, CommandContext, CommandRenderContext } from "../../spi";
import { getCellRange } from "./cell-range";

// A compact fill palette that reads on light and dark surfaces; "none" clears (moved
// here from `table-interactions` — the menu now lives in `contributeCommands`).
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

const TABLE_LAYOUTS: readonly { value: string; label: string; icon: string }[] =
  [
    { icon: "Columns3", label: "Fixed", value: "fixed" },
    { icon: "LayoutDashboard", label: "Responsive", value: "responsive" },
    { icon: "AlignJustify", label: "Full width", value: "full-width" },
  ];

/** The cells an action targets: a genuine ≥2-cell drag range the caret cell is in, else
 *  the caret cell (docs/024 §7.4). Resolved live at run time, so a stale range cannot
 *  hijack a single-cell action. */
function liveTargets(store: EditorStore): readonly NodeId[] {
  const active = activeCellContext(store);
  if (!active) return [];
  const range = getCellRange(store);
  if (range && range.tableId === active.tableId) {
    const cells = selectedCellRange(
      tableGrid(store, range.tableId),
      range.anchor,
      range.focus,
    ).cellIds;
    if (cells.length >= 2 && cells.includes(active.cellId)) return cells;
  }
  return [active.cellId];
}

/** Whether the drag range over this table covers ≥2 cells including the caret cell. */
function hasMergeRange(store: EditorStore): boolean {
  const active = activeCellContext(store);
  const range = getCellRange(store);
  if (!active || !range || range.tableId !== active.tableId) return false;
  const cells = selectedCellRange(
    tableGrid(store, range.tableId),
    range.anchor,
    range.focus,
  ).cellIds;
  return cells.length >= 2 && cells.includes(active.cellId);
}

function FillPaletteBody({ ctx }: { readonly ctx: CommandRenderContext }) {
  const apply = (color: string | undefined) => {
    setCellBackground(ctx.store, liveTargets(ctx.store), color);
    ctx.close();
  };
  return (
    <div className="flex w-56 flex-col gap-2" data-engine-surface-child>
      <div className="px-1 text-xs font-medium text-base-content/60">
        Fill color
      </div>
      <div className="flex flex-wrap gap-2 px-1">
        {FILL_COLORS.map((color) => (
          <button
            aria-label={`Fill ${color}`}
            className="size-6 rounded-full border border-base-300 transition hover:scale-110"
            key={color}
            onClick={() => apply(color)}
            style={{ background: color }}
            type="button"
          />
        ))}
        <button
          aria-label="Clear fill"
          className="grid size-6 place-items-center rounded-full border border-base-300 text-base-content/60 transition hover:scale-110"
          onClick={() => apply(undefined)}
          type="button"
        >
          <NavIcon name="X" />
        </button>
      </div>
    </div>
  );
}

function VerticalAlignBody({ ctx }: { readonly ctx: CommandRenderContext }) {
  const apply = (align: "top" | "middle" | "bottom") => {
    setCellVerticalAlign(ctx.store, liveTargets(ctx.store), align);
    ctx.close();
  };
  return (
    <div className="flex w-40 flex-col gap-1" data-engine-surface-child>
      <div className="px-1 text-xs font-medium text-base-content/60">
        Vertical align
      </div>
      {(["top", "middle", "bottom"] as const).map((align) => (
        <AriaButton
          className="flex cursor-pointer items-center gap-2 rounded-field px-3 py-1.5 text-sm capitalize outline-none hover:bg-base-200"
          key={align}
          onPress={() => apply(align)}
        >
          {align}
        </AriaButton>
      ))}
    </div>
  );
}

function TableLayoutBody({ ctx }: { readonly ctx: CommandRenderContext }) {
  const table = activeCellContext(ctx.store);
  const apply = (layout: string) => {
    if (table) setTableLayout(ctx.store, table.tableId, layout);
    ctx.close();
  };
  return (
    <div className="flex w-44 flex-col gap-1" data-engine-surface-child>
      <div className="px-1 text-xs font-medium text-base-content/60">
        Table layout
      </div>
      {TABLE_LAYOUTS.map((option) => (
        <AriaButton
          className="flex cursor-pointer items-center gap-2 rounded-field px-3 py-1.5 text-sm outline-none hover:bg-base-200"
          key={option.value}
          onPress={() => apply(option.value)}
        >
          <NavIcon name={option.icon} />
          {option.label}
        </AriaButton>
      ))}
    </div>
  );
}

/** The cell-scoped commands (group `structure`) a `tablecell` view contributes. */
export function contributeCellCommands(
  ctx: CommandContext,
): readonly Command[] {
  const active = activeCellContext(ctx.store);
  if (!active) return [];
  return [
    {
      group: "structure",
      icon: "Combine",
      id: "table.merge",
      isAvailable: (c) => hasMergeRange(c.store),
      kind: "button",
      label: "Merge cells",
      order: 0,
      run: (c) => {
        const range = getCellRange(c.store);
        if (range)
          mergeCells(c.store, range.tableId, range.anchor, range.focus);
      },
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "Ungroup",
      id: "table.unmerge",
      isAvailable: () => active.merged,
      kind: "button",
      label: "Unmerge cell",
      order: 1,
      run: (c) => {
        const cell = activeCellContext(c.store);
        if (cell) unmergeCell(c.store, cell.tableId, cell.cellId);
      },
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "PaintBucket",
      id: "table.fill",
      kind: "popover",
      label: "Fill color",
      order: 2,
      render: (c) => <FillPaletteBody ctx={c} />,
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "AlignVerticalSpaceAround",
      id: "table.valign",
      kind: "popover",
      label: "Vertical align",
      order: 3,
      render: (c) => <VerticalAlignBody ctx={c} />,
      surfaces: { contextMenu: "more" },
    },
  ];
}

/** The table-scoped commands (group `structure`) a `table` view contributes. */
export function contributeTableCommands(
  ctx: CommandContext,
): readonly Command[] {
  const active = activeCellContext(ctx.store);
  if (!active) return [];
  const coords = cellCoords(
    tableGrid(ctx.store, active.tableId),
    active.cellId,
  );
  if (!coords) return [];
  const { tableId } = active;
  const { row, col } = coords;
  return [
    {
      group: "structure",
      icon: "Plus",
      id: "table.row-above",
      kind: "button",
      label: "Insert row above",
      order: 10,
      run: (c) => insertRow(c.store, tableId, row),
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "Plus",
      id: "table.row-below",
      kind: "button",
      label: "Insert row below",
      order: 11,
      run: (c) => insertRow(c.store, tableId, row + 1),
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "Plus",
      id: "table.col-left",
      kind: "button",
      label: "Insert column left",
      order: 12,
      run: (c) => insertColumn(c.store, tableId, col),
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "Plus",
      id: "table.col-right",
      kind: "button",
      label: "Insert column right",
      order: 13,
      run: (c) => insertColumn(c.store, tableId, col + 1),
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "Minus",
      id: "table.row-delete",
      kind: "button",
      label: "Delete row",
      order: 14,
      run: (c) => deleteRow(c.store, tableId, row),
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "Minus",
      id: "table.col-delete",
      kind: "button",
      label: "Delete column",
      order: 15,
      run: (c) => deleteColumn(c.store, tableId, col),
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "Rows3",
      id: "table.header-row",
      kind: "button",
      label: "Toggle header row",
      order: 20,
      run: (c) => toggleHeaderRow(c.store, tableId),
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "Columns3",
      id: "table.header-col",
      kind: "button",
      label: "Toggle header column",
      order: 21,
      run: (c) => toggleHeaderColumn(c.store, tableId),
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "ListOrdered",
      id: "table.row-numbers",
      kind: "button",
      label: "Toggle numbered column",
      order: 22,
      run: (c) => toggleRowNumbers(c.store, tableId),
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "LayoutDashboard",
      id: "table.layout",
      kind: "popover",
      label: "Table layout",
      order: 23,
      render: (c) => <TableLayoutBody ctx={c} />,
      surfaces: { contextMenu: "more" },
    },
    {
      group: "structure",
      icon: "Trash2",
      id: "table.remove",
      kind: "button",
      label: "Remove table",
      order: 24,
      run: (c) => c.store.command({ node: tableId, type: "remove-block" }),
      surfaces: { contextMenu: "more" },
    },
  ];
}
