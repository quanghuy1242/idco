/**
 * Word/Docs-style live table controls (docs/022 §6), a faithful port of the
 * legacy `TableControlsPlugin` to the owned model. A single hover overlay (one
 * `mousemove` listener, one portal) serves every table in the view: only the
 * insert "+" nearest the cursor reveals — a column "+" above a boundary when the
 * cursor is near the top edge, a row "+" left of a boundary when near the left;
 * a delete "−" reveals centred over the column/row by the cursor; internal column
 * boundaries expose a resize drag handle; and a whole-table chrome (layout select,
 * a header-row/header-column/numbered-column structure menu, remove) anchors at the
 * table's top-left. Every action calls a `table-operations` command-builder, so the
 * overlay owns no model logic and core keeps no table command.
 */
import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  BlockChrome,
  ChromeButton,
  ChromeSelect,
  Menu,
  MenuItem,
  MenuTrigger,
  NavIcon,
  type ChromeSelectOption,
} from "@quanghuy1242/idco-ui";
import type { EditorStore, NodeId, StructuralNode } from "../core";
import {
  deleteColumn,
  deleteRow,
  headerState,
  insertColumn,
  insertRow,
  resizeColumns,
  resizeColumnWidths,
  scaleColumnWidths,
  setTableLayout,
  toggleHeaderColumn,
  toggleHeaderRow,
  toggleRowNumbers,
} from "./table-operations";

const MIN_WIDTH = 48;
const BAND_LEFT = 28;
const BAND_TOP = 22;
const BAND_PAD = 8;
const NEAR = 18;

const TABLE_LAYOUTS: readonly ChromeSelectOption<string>[] = [
  { icon: "Columns3", label: "Fixed", value: "fixed" },
  { icon: "LayoutDashboard", label: "Responsive", value: "responsive" },
  { icon: "AlignJustify", label: "Full width", value: "full-width" },
];

type Geom = {
  readonly table: HTMLTableElement;
  readonly tableId: NodeId;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly cols: readonly number[];
  readonly rows: readonly number[];
  readonly colCenters: readonly number[];
  readonly rowCenters: readonly number[];
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

function centers(values: readonly number[]): number[] {
  return values
    .slice(0, -1)
    .map((value, index) => (value + values[index + 1]!) / 2);
}

/** The owned table wrapper under `el`, with its node id, or null. */
function tableUnder(
  el: HTMLElement,
): { table: HTMLTableElement; tableId: NodeId } | null {
  const table = el.querySelector("table");
  const id = el.getAttribute("data-engine-block-id");
  return table && id ? { table, tableId: id as NodeId } : null;
}

function computeGeom(
  wrapper: HTMLElement,
  mouseX: number,
  mouseY: number,
): Geom | null {
  const found = tableUnder(wrapper);
  if (!found) return null;
  const { table } = found;
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
    tableId: found.tableId,
    top: rect.top,
  };
}

function tableNode(store: EditorStore, id: NodeId): StructuralNode | null {
  const node = store.getNode(id);
  return node?.kind === "structural" ? node : null;
}

const overlayButtonClass =
  "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 hover:scale-110";

export function TableControls(props: {
  readonly store: EditorStore;
  readonly rootRef: RefObject<HTMLElement | null>;
}) {
  const { store, rootRef } = props;
  const [geom, setGeom] = useState<Geom | null>(null);
  const [, bump] = useState(0);
  const dragging = useRef(false);
  const pinned = useRef(false);

  // Re-render on every commit so the structure menu's checks and the geometry
  // reflect a just-applied op even without a mouse move (legacy refreshed meta on
  // each editor update).
  useEffect(() => store.subscribeCommit(() => bump((n) => n + 1)), [store]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    function onMove(event: MouseEvent) {
      if (dragging.current || pinned.current) return;
      const wrappers = Array.from(
        root!.querySelectorAll<HTMLElement>(
          '[data-engine-structural="table"],[data-engine-structural="editor-table"]',
        ),
      );
      const active = wrappers.find((wrapper) => {
        const found = tableUnder(wrapper);
        if (!found) return false;
        const r = found.table.getBoundingClientRect();
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
  }, [rootRef]);

  if (!geom) return null;
  const node = tableNode(store, geom.tableId);
  if (!node) return null;
  const layout =
    typeof node.attrs?.layout === "string" ? node.attrs.layout : "fixed";
  const { headerRow, headerColumn } = headerState(store, geom.tableId);
  const showRowNumbers = node.attrs?.showRowNumbers === true;

  function startResize(event: ReactPointerEvent, boundary: number) {
    event.preventDefault();
    event.stopPropagation();
    const colIndex = boundary - 1;
    const headerCells = geom!.table.rows[0]?.cells;
    const cols = geom!.table.querySelector("colgroup")?.children;
    if (!headerCells) return;
    const widths = Array.from(headerCells).map((cell) =>
      Math.round(cell.getBoundingClientRect().width),
    );
    dragging.current = true;
    const startX = event.clientX;
    let committed = [...widths];
    const rightIndex = colIndex + 1;
    function onDragMove(moveEvent: PointerEvent) {
      committed = resizeColumnWidths(
        widths,
        colIndex,
        moveEvent.clientX - startX,
        MIN_WIDTH,
      );
      // Preview on the DOM `<col>` widths (no model write per frame); the model
      // commit happens once on release.
      const leftCol = cols?.[colIndex] as HTMLElement | undefined;
      const rightCol = cols?.[rightIndex] as HTMLElement | undefined;
      if (leftCol) leftCol.style.width = `${committed[colIndex]}px`;
      if (rightCol) rightCol.style.width = `${committed[rightIndex]}px`;
    }
    function endDrag() {
      dragging.current = false;
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", endDrag);
      resizeColumns(store, geom!.tableId, committed);
    }
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", endDrag);
  }

  function changeLayout(next: string) {
    setTableLayout(store, geom!.tableId, next);
    // Entering a responsive mode pins the columns to the container so the table
    // starts filling it; proportions are preserved (legacy `changeLayout`).
    if (next === "responsive" || next === "full-width") {
      const widths = node?.attrs?.colWidths;
      const container =
        geom!.table.parentElement?.getBoundingClientRect().width;
      if (
        Array.isArray(widths) &&
        widths.every((w) => typeof w === "number") &&
        container &&
        container > 0
      ) {
        resizeColumns(
          store,
          geom!.tableId,
          scaleColumnWidths(widths as number[], Math.round(container)),
        );
      }
    }
  }

  // Reveal only the single nearest insert button, by the matching edge. The
  // header-edge guard suppresses "insert before the header" (boundary 0) so a
  // header row/column stays the table's boundary (legacy §controls).
  const nearTop = geom.mouseY <= geom.top + NEAR;
  const nearLeft = geom.mouseX <= geom.left + NEAR;
  const rawCol = nearTop ? nearestIndex(geom.cols, geom.mouseX) : -1;
  const rawRow = nearLeft ? nearestIndex(geom.rows, geom.mouseY) : -1;
  const activeCol = headerColumn && rawCol === 0 ? -1 : rawCol;
  const activeRow = headerRow && rawRow === 0 ? -1 : rawRow;
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
      data-engine-table-controls=""
      className="pointer-events-none fixed inset-0 z-40"
    >
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
          onPress={() => insertColumn(store, geom.tableId, activeCol)}
          className={overlayButtonClass}
          style={{ left: geom.cols[activeCol], top: geom.top - 13 }}
        />
      ) : null}

      {activeDeleteCol >= 0 ? (
        <ChromeButton
          size="sm"
          intent="danger"
          fill
          icon="Minus"
          label="Delete column"
          onPress={() => deleteColumn(store, geom.tableId, activeDeleteCol)}
          className={overlayButtonClass}
          style={{ left: geom.colCenters[activeDeleteCol], top: geom.top - 13 }}
        />
      ) : null}

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
          onPress={() => insertRow(store, geom.tableId, activeRow)}
          className={overlayButtonClass}
          style={{ left: geom.left - 13, top: geom.rows[activeRow] }}
        />
      ) : null}

      {activeDeleteRow >= 0 ? (
        <ChromeButton
          size="sm"
          intent="danger"
          fill
          icon="Minus"
          label="Delete row"
          onPress={() => deleteRow(store, geom.tableId, activeDeleteRow)}
          className={overlayButtonClass}
          style={{
            left: geom.left - 13,
            top: geom.rowCenters[activeDeleteRow],
          }}
        />
      ) : null}

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
              <ChromeSelect
                label="Table layout"
                value={layout}
                options={TABLE_LAYOUTS}
                onChange={changeLayout}
                onOpenChange={(open) => {
                  pinned.current = open;
                }}
              />
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
                  selectedKeys={toggleKeys(
                    headerRow,
                    headerColumn,
                    showRowNumbers,
                  )}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    if (keys.has("header-row") !== headerRow) {
                      toggleHeaderRow(store, geom.tableId);
                    }
                    if (keys.has("header-column") !== headerColumn) {
                      toggleHeaderColumn(store, geom.tableId);
                    }
                    if (keys.has("row-numbers") !== showRowNumbers) {
                      toggleRowNumbers(store, geom.tableId);
                    }
                  }}
                >
                  <MenuItem id="header-row" textValue="Header row">
                    <ToggleRow icon="Rows3" label="Header row" on={headerRow} />
                  </MenuItem>
                  <MenuItem id="header-column" textValue="Header column">
                    <ToggleRow
                      icon="Columns3"
                      label="Header column"
                      on={headerColumn}
                    />
                  </MenuItem>
                  <MenuItem id="row-numbers" textValue="Numbered column">
                    <ToggleRow
                      icon="ListOrdered"
                      label="Numbered column"
                      on={showRowNumbers}
                    />
                  </MenuItem>
                </Menu>
              </MenuTrigger>
            </>
          }
          removeLabel="Remove table"
          onRemove={() =>
            store.command({ node: geom.tableId, type: "remove-block" })
          }
        />
      </div>
    </div>,
    document.body,
  );
}

function ToggleRow(props: {
  readonly on: boolean;
  readonly icon: string;
  readonly label: string;
}) {
  return (
    <span className="flex flex-1 items-center gap-2">
      <NavIcon name={props.icon} />
      <span className="flex-1">{props.label}</span>
      {props.on ? (
        <NavIcon name="Check" />
      ) : (
        <span aria-hidden className="inline-block w-4" />
      )}
    </span>
  );
}

function toggleKeys(
  headerRow: boolean,
  headerColumn: boolean,
  rowNumbers: boolean,
): Set<string> {
  const keys = new Set<string>();
  if (headerRow) keys.add("header-row");
  if (headerColumn) keys.add("header-column");
  if (rowNumbers) keys.add("row-numbers");
  return keys;
}
