// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type DataTableColumn } from "@idco/ui";

type Item = {
  id: string;
  name: string;
  value: number;
};

const columns: DataTableColumn<Item>[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "value", label: "Value", sortable: true },
];

const rows: Item[] = [
  { id: "a", name: "Alpha", value: 1 },
  { id: "b", name: "Beta", value: 2 },
  { id: "c", name: "Gamma", value: 3 },
];

function pressTrigger(button: HTMLElement) {
  button.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
  );
  button.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }),
  );
  fireEvent.click(button);
}

describe("DataTable", () => {
  it("renders rows", () => {
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("renders column headers", () => {
    render(<DataTable columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });

  it("renders an empty table without crashing", () => {
    render(<DataTable columns={columns} rows={[]} getRowKey={(r) => r.id} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("calls onRowClick when a row is clicked", () => {
    const onRowClick = vi.fn<(row: Item) => void>();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("calls onSort when a sortable column header is clicked", () => {
    const onSort = vi.fn<(key: string, dir: "asc" | "desc") => void>();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        sortBy="name"
        sortDirection="asc"
        onSort={onSort}
      />,
    );
    fireEvent.click(screen.getByText("Name"));
    expect(onSort).toHaveBeenCalledWith("name", "desc");
  });

  it("calls onSort with asc when clicking an unsorted column", () => {
    const onSort = vi.fn<(key: string, dir: "asc" | "desc") => void>();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        sortBy="name"
        sortDirection="asc"
        onSort={onSort}
      />,
    );
    fireEvent.click(screen.getByText("Value"));
    expect(onSort).toHaveBeenCalledWith("value", "asc");
  });

  it("does not throw when onSort is omitted", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        sortBy="name"
      />,
    );
    expect(() => fireEvent.click(screen.getByText("Name"))).not.toThrow();
  });

  it("renders pagination controls", () => {
    const onChange = vi.fn<(offset: number) => void>();
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        pagination={{ total: 10, limit: 3, offset: 0, onChange }}
      />,
    );
    expect(screen.getByLabelText("Next page")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
  });

  it("hides pagination when single page", () => {
    render(
      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        pagination={{ total: 3, limit: 5, offset: 0, onChange: () => {} }}
      />,
    );
    expect(screen.queryByLabelText("Next page")).toBeNull();
  });

  it("renders custom cell content via render function", () => {
    const customColumns: DataTableColumn<Item>[] = [
      { key: "name", label: "Name" },
      { key: "value", label: "Value", render: (r) => `$${r.value}.00` },
    ];
    render(
      <DataTable columns={customColumns} rows={rows} getRowKey={(r) => r.id} />,
    );
    expect(screen.getByText("$2.00")).toBeInTheDocument();
  });

  it("supports fixed layout with contained overflow", () => {
    const fixedColumns: DataTableColumn<Item>[] = [
      { key: "name", label: "Name", width: "sm" },
      { key: "value", label: "Value" },
    ];
    const { container } = render(
      <DataTable
        columns={fixedColumns}
        rows={rows}
        getRowKey={(r) => r.id}
        layout="fixed"
        overflow="contained"
        minWidth="md"
      />,
    );
    expect(container.firstElementChild).toHaveClass(
      "overflow-x-auto",
      "min-w-0",
      "max-w-full",
    );
    expect(container.querySelector("table")).toHaveClass(
      "table-fixed",
      "min-w-[60rem]",
    );
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass(
      "w-32",
    );
    expect(screen.getByText("Alpha").closest("td")).toHaveClass(
      "overflow-hidden",
      "break-words",
      "align-top",
    );
  });

  it("renders a single action directly", () => {
    const onOpen = vi.fn<(id: string) => void>();
    const actionColumns: DataTableColumn<Item>[] = [
      { key: "name", label: "Name" },
      {
        key: "actions",
        label: "Actions",
        actions: (row) => [
          { id: "open", label: "Open", onAction: () => onOpen(row.id) },
        ],
      },
    ];
    render(
      <DataTable
        columns={actionColumns}
        rows={rows.slice(0, 1)}
        getRowKey={(r) => r.id}
      />,
    );
    expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("folds multiple actions into a menu", async () => {
    const onOpen = vi.fn<(id: string) => void>();
    const onDelete = vi.fn<(id: string) => void>();
    const actionColumns: DataTableColumn<Item>[] = [
      { key: "name", label: "Name" },
      {
        key: "actions",
        label: "Actions",
        actions: (row) => [
          { id: "open", label: "Open", onAction: () => onOpen(row.id) },
          {
            id: "delete",
            label: "Delete",
            variant: "danger",
            onAction: () => onDelete(row.id),
          },
        ],
      },
    ];
    render(
      <DataTable
        columns={actionColumns}
        rows={rows.slice(0, 1)}
        getRowKey={(r) => r.id}
      />,
    );
    pressTrigger(screen.getByRole("button", { name: "Actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("a");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("does not trigger row navigation from action clicks", () => {
    const onRowClick = vi.fn<(row: Item) => void>();
    const onOpen = vi.fn<(id: string) => void>();
    const actionColumns: DataTableColumn<Item>[] = [
      { key: "name", label: "Name" },
      {
        key: "actions",
        label: "Actions",
        actions: (row) => [
          { id: "open", label: "Open", onAction: () => onOpen(row.id) },
        ],
      },
    ];
    render(
      <DataTable
        columns={actionColumns}
        rows={rows.slice(0, 1)}
        getRowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledWith("a");
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
