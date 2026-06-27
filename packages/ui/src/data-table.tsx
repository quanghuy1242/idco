// DaisyUI 5: https://daisyui.com/components/table/
"use client";

/**
 * Data table: React Aria Table behavior (sorting, selection, keyboard) with DaisyUI 5 table styling.
 *
 * @categoryDefault Data Display
 */

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import {
  Cell as AriaCell,
  Column as AriaColumn,
  Row as AriaRow,
  Table as AriaTable,
  TableBody as AriaTableBody,
  TableHeader as AriaTableHeader,
  type SortDescriptor,
} from "react-aria-components";
import { Button } from "./button";
import { Menu, MenuItem, MenuTrigger } from "./menu";

/** Sort order of the active column. */
export type SortDirection = "asc" | "desc";
/** Column-sizing mode: `auto` content-fit or `fixed` equal-width layout. */
export type DataTableLayout = "auto" | "fixed";
/** How the table reacts when it exceeds its container: scroll the page (`responsive`) or scroll inside the box (`contained`). */
export type DataTableOverflow = "responsive" | "contained";
/** Preset width for a fixed-layout column. */
export type DataTableColumnWidth = "xs" | "sm" | "md" | "lg" | "xl";
/** Minimum table width before horizontal scrolling kicks in. */
export type DataTableMinWidth = "none" | "md" | "lg";

/** Visual intent of a per-row action button. */
type DataTableActionVariant = "primary" | "secondary" | "danger" | "ghost";

/** A per-row action rendered as a button or menu item in an actions column. */
export type DataTableAction = {
  /** Stable identity for the action within its row. */
  readonly id: string;
  /** Visible action label. */
  readonly label: string;
  /** Button intent; defaults to a neutral action. */
  readonly variant?: DataTableActionVariant;
  /** Registered icon name shown on the action. */
  readonly iconName?: string;
  /** Accessible name when the action is icon-only. */
  readonly ariaLabel?: string;
  /** Hover hint. */
  readonly tooltip?: string;
  readonly disabled?: boolean;
  /** Omit this action from the row entirely. */
  readonly isHidden?: boolean;
  /** Invoked when the action is pressed. */
  readonly onAction: () => void;
};

/** A typed column definition: how a row's cell renders and whether the column sorts. */
export type DataTableColumn<T extends object> = {
  /** Field key matched against the sort descriptor and used as the column id. */
  readonly key: string;
  /** Header label. */
  readonly label: string;
  /** Enable header-click sorting for this column. */
  readonly sortable?: boolean;
  /** Fixed-layout width preset. */
  readonly width?: DataTableColumnWidth;
  /** Custom cell renderer; defaults to the row's `key` value. */
  readonly render?: (row: T) => ReactNode;
  /** Produce the row's action set, rendered as buttons/menu in this column. */
  readonly actions?: (row: T) => readonly DataTableAction[];
};

/** Controlled multi-row selection wiring for the table's checkbox column. */
export type DataTableRowSelection<T extends object> = {
  /** Currently selected row keys (controlled). */
  readonly selectedKeys: ReadonlySet<string>;
  /** Called with the next selection when checkboxes change. */
  readonly onChange: (next: Set<string>) => void;
  /** Mark specific rows as non-selectable. */
  readonly getRowDisabled?: (row: T) => boolean;
  /** Accessible label for the selection column. */
  readonly ariaLabel?: string;
};

/** Offset-based pagination wiring for the table footer. */
type Pagination = {
  /** Total row count across all pages. */
  readonly total: number;
  /** Page size. */
  readonly limit: number;
  /** Current row offset. */
  readonly offset: number;
  /** Called with the next offset when a page is selected. */
  readonly onChange: (offset: number) => void;
};

/** Props for {@link DataTable}. */
type DataTableProps<T extends object> = {
  /** Ordered column definitions. */
  readonly columns: ReadonlyArray<DataTableColumn<T>>;
  /** Row data to render. */
  readonly rows: ReadonlyArray<T>;
  /** Derive a stable key per row. */
  readonly getRowKey: (row: T) => string;
  /** Invoked when a row is activated (click/Enter). */
  readonly onRowClick?: (row: T) => void;
  /** Key of the currently sorted column (controlled). */
  readonly sortBy?: string;
  /** Direction of the active sort. */
  readonly sortDirection?: SortDirection;
  /** Called when a sortable header is toggled. */
  readonly onSort?: (key: string, direction: SortDirection) => void;
  /** Enable the offset-based pagination footer. */
  readonly pagination?: Pagination;
  /** Enable the controlled row-selection column. */
  readonly rowSelection?: DataTableRowSelection<T>;
  /** Column-sizing mode; defaults to `auto`. */
  readonly layout?: DataTableLayout;
  /** Overflow behavior; defaults to `responsive`. */
  readonly overflow?: DataTableOverflow;
  /** Minimum width before horizontal scroll; defaults to `none`. */
  readonly minWidth?: DataTableMinWidth;
};

const tableLayoutClass: Record<DataTableLayout, string> = {
  auto: "",
  fixed: "table-fixed",
};

const tableOverflowClass: Record<DataTableOverflow, string> = {
  responsive:
    "w-full overflow-x-auto sm:overflow-x-visible data-table-responsive",
  contained: "w-full min-w-0 max-w-full overflow-x-auto data-table-responsive",
};

const columnWidthClass: Record<DataTableColumnWidth, string> = {
  xs: "w-24",
  sm: "w-32",
  md: "w-40",
  lg: "w-52",
  xl: "w-64",
};

const tableMinWidthClass: Record<DataTableMinWidth, string> = {
  none: "",
  md: "min-w-[60rem]",
  lg: "min-w-[72rem]",
};

const cellLayoutClass: Record<DataTableLayout, string> = {
  auto: "text-sm text-base-content",
  fixed:
    "min-w-0 overflow-hidden break-words align-top text-sm text-base-content",
};

function SortIcon({
  direction,
  active,
}: {
  direction?: SortDirection;
  active: boolean;
}) {
  if (!active)
    return <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />;
  if (direction === "asc")
    return <ChevronUp className="h-3 w-3" aria-hidden="true" />;
  return <ChevronDown className="h-3 w-3" aria-hidden="true" />;
}

function PaginationBar({ total, limit, offset, onChange }: Pagination) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;
  const currentPage = Math.floor(offset / limit);

  const pages: number[] = [];
  const start = Math.max(0, currentPage - 2);
  const end = Math.min(totalPages - 1, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex items-center justify-end gap-1 px-4 py-3 border-t border-base-300">
      <button
        className="btn btn-ghost"
        disabled={currentPage === 0}
        onClick={() => onChange((currentPage - 1) * limit)}
        aria-label="Previous page"
      >
        ‹
      </button>
      {pages.map((p) => (
        <button
          key={p}
          className={`btn ${p === currentPage ? "btn-primary" : "btn-ghost"}`}
          onClick={() => onChange(p * limit)}
          aria-current={p === currentPage ? "page" : undefined}
        >
          {p + 1}
        </button>
      ))}
      <button
        className="btn btn-ghost"
        disabled={currentPage === totalPages - 1}
        onClick={() => onChange((currentPage + 1) * limit)}
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  );
}

function DataTableActions({
  actions,
}: {
  readonly actions: readonly DataTableAction[];
}) {
  const visibleActions = actions.filter((action) => !action.isHidden);
  if (visibleActions.length === 0) return null;
  if (visibleActions.length === 1) {
    const action = visibleActions[0]!;
    return (
      <Button
        size="sm"
        variant={action.variant ?? "secondary"}
        iconName={action.iconName}
        ariaLabel={action.ariaLabel}
        tooltip={action.tooltip}
        disabled={action.disabled}
        onClick={action.onAction}
      >
        {action.iconName ? undefined : action.label}
      </Button>
    );
  }
  const actionById = new Map(
    visibleActions.map((action) => [action.id, action]),
  );
  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        size="sm"
        iconName="Ellipsis"
        ariaLabel="Actions"
        tooltip="More actions"
      />
      <Menu
        onAction={(key) => {
          const action = actionById.get(String(key));
          if (!action || action.disabled) return;
          action.onAction();
        }}
      >
        {visibleActions.map((action) => (
          <MenuItem key={action.id} id={action.id} isDisabled={action.disabled}>
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

function DataTableSelectionCheckbox({
  ariaLabel,
  checked,
  disabled,
  indeterminate,
  onChange,
}: {
  readonly ariaLabel: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly indeterminate?: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate);
    }
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      className="checkbox checkbox-primary checkbox-sm"
      onChange={(event) => onChange(event.currentTarget.checked)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

/**
 * A data table with typed columns, header-click sorting, row selection, per-row actions, and pagination.
 *
 * @example
 * <DataTable columns={cols} rows={posts} getRowKey={(p) => p.id}
 *   sortBy={sort} sortDirection={dir} onSort={setSort} />
 */
export function DataTable<T extends object>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  sortBy,
  sortDirection,
  onSort,
  pagination,
  rowSelection,
  layout = "auto",
  overflow = "responsive",
  minWidth = "none",
}: DataTableProps<T>) {
  const sortDescriptor: SortDescriptor | undefined = sortBy
    ? {
        column: sortBy,
        direction: sortDirection === "desc" ? "descending" : "ascending",
      }
    : undefined;

  function handleSortChange(descriptor: SortDescriptor) {
    if (!onSort) return;
    const dir: SortDirection =
      descriptor.direction === "descending" ? "desc" : "asc";
    onSort(String(descriptor.column), dir);
  }

  const selectableRows = rowSelection
    ? rows.filter((row) => !rowSelection.getRowDisabled?.(row))
    : [];
  const selectableKeys = selectableRows.map(getRowKey);
  const selectedVisibleKeys = selectableKeys.filter((key) =>
    rowSelection?.selectedKeys.has(key),
  );
  const allVisibleSelected =
    selectableKeys.length > 0 &&
    selectedVisibleKeys.length === selectableKeys.length;
  const someVisibleSelected = selectedVisibleKeys.length > 0;

  function selectVisibleRows(checked: boolean) {
    if (!rowSelection) return;
    const next = new Set(rowSelection.selectedKeys);
    for (const key of selectableKeys) {
      if (checked) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    rowSelection.onChange(next);
  }

  function selectRow(row: T, checked: boolean) {
    if (!rowSelection) return;
    const key = getRowKey(row);
    const next = new Set(rowSelection.selectedKeys);
    if (checked) {
      next.add(key);
    } else {
      next.delete(key);
    }
    rowSelection.onChange(next);
  }

  return (
    <div className={tableOverflowClass[overflow]}>
      <AriaTable
        aria-label="Data table"
        className={`table w-full ${tableLayoutClass[layout]} ${tableMinWidthClass[minWidth]}`}
        sortDescriptor={sortDescriptor}
        onSortChange={handleSortChange}
        onRowAction={
          onRowClick
            ? (key) => {
                const row = rows.find((r) => getRowKey(r) === String(key));
                if (row) onRowClick(row);
              }
            : undefined
        }
      >
        <AriaTableHeader>
          {rowSelection ? (
            <AriaColumn
              id="__selection"
              className="w-12 text-center"
              allowsSorting={false}
            >
              <DataTableSelectionCheckbox
                ariaLabel={rowSelection.ariaLabel ?? "Select visible rows"}
                checked={allVisibleSelected}
                disabled={selectableKeys.length === 0}
                indeterminate={someVisibleSelected && !allVisibleSelected}
                onChange={selectVisibleRows}
              />
            </AriaColumn>
          ) : null}
          {columns.map((col) => (
            <AriaColumn
              key={col.key}
              id={col.key}
              isRowHeader={col.key === columns[0]?.key}
              allowsSorting={col.sortable}
              className={`font-medium text-base-content/70 text-xs uppercase tracking-wide ${col.width ? columnWidthClass[col.width] : ""}`}
            >
              <div className="flex items-center gap-1">
                {col.label}
                {col.sortable ? (
                  <SortIcon
                    direction={sortBy === col.key ? sortDirection : undefined}
                    active={sortBy === col.key}
                  />
                ) : null}
              </div>
            </AriaColumn>
          ))}
        </AriaTableHeader>
        <AriaTableBody items={rows}>
          {(row) => (
            <AriaRow
              id={getRowKey(row)}
              className={
                onRowClick ? "cursor-pointer hover:bg-base-200/60" : ""
              }
            >
              {rowSelection ? (
                <AriaCell className="w-12 text-center align-top">
                  <DataTableSelectionCheckbox
                    ariaLabel={`Select row ${getRowKey(row)}`}
                    checked={rowSelection.selectedKeys.has(getRowKey(row))}
                    disabled={rowSelection.getRowDisabled?.(row)}
                    onChange={(checked) => selectRow(row, checked)}
                  />
                </AriaCell>
              ) : null}
              {columns.map((col) => (
                <AriaCell
                  key={col.key}
                  className={cellLayoutClass[layout]}
                  data-label={col.label}
                >
                  {col.actions ? (
                    <DataTableActions actions={col.actions(row)} />
                  ) : col.render ? (
                    col.render(row)
                  ) : (
                    String((row as Record<string, unknown>)[col.key] ?? "")
                  )}
                </AriaCell>
              ))}
            </AriaRow>
          )}
        </AriaTableBody>
      </AriaTable>
      {pagination && <PaginationBar {...pagination} />}
    </div>
  );
}
