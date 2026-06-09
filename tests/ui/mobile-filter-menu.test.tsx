// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileFilterMenu } from "@idco/ui";

const roleOptions = [
  { value: "all", label: "All Roles" },
  { value: "admin", label: "Admin" },
  { value: "user", label: "User" },
] as const;

const statusOptions = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "banned", label: "Banned" },
] as const;

const defaultOnChange = vi.fn<(value: string) => void>();
const defaultGroups = [
  {
    key: "role",
    label: "Role",
    options: roleOptions,
    value: "all",
    onChange: defaultOnChange,
  },
  {
    key: "status",
    label: "Status",
    options: statusOptions,
    value: "all",
    onChange: defaultOnChange,
  },
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

describe("MobileFilterMenu", () => {
  it("renders a trigger button with aria-label", () => {
    render(<MobileFilterMenu groups={defaultGroups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).toBeInTheDocument();
  });

  it("shows ... icon button when no filters are active", () => {
    render(<MobileFilterMenu groups={defaultGroups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button.textContent).toBe("");
  });

  it("shows active filter label in the trigger when one filter is set", () => {
    const groups = [
      {
        key: "role",
        label: "Role",
        options: roleOptions,
        value: "admin",
        onChange: vi.fn<(value: string) => void>(),
      },
      {
        key: "status",
        label: "Status",
        options: statusOptions,
        value: "all",
        onChange: vi.fn<(value: string) => void>(),
      },
    ];
    render(<MobileFilterMenu groups={groups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button.textContent).toContain("Admin");
  });

  it("shows joined filter labels when two filters are active", () => {
    const groups = [
      {
        key: "role",
        label: "Role",
        options: roleOptions,
        value: "admin",
        onChange: vi.fn<(value: string) => void>(),
      },
      {
        key: "status",
        label: "Status",
        options: statusOptions,
        value: "banned",
        onChange: vi.fn<(value: string) => void>(),
      },
    ];
    render(<MobileFilterMenu groups={groups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button.textContent).toContain("Admin, Banned");
  });

  it("shows X applied when three or more filters are active", () => {
    const onChange = vi.fn<(value: string) => void>();
    const groups = [
      {
        key: "a",
        label: "A",
        options: [
          { value: "all", label: "All" },
          { value: "x", label: "X" },
        ],
        value: "x",
        onChange,
      },
      {
        key: "b",
        label: "B",
        options: [
          { value: "all", label: "All" },
          { value: "y", label: "Y" },
        ],
        value: "y",
        onChange,
      },
      {
        key: "c",
        label: "C",
        options: [
          { value: "all", label: "All" },
          { value: "z", label: "Z" },
        ],
        value: "z",
        onChange,
      },
    ];
    render(<MobileFilterMenu groups={groups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button.textContent).toContain("3 applied");
  });

  it("applies sm size class when size=sm", () => {
    render(<MobileFilterMenu groups={defaultGroups} size="sm" />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).toHaveClass("btn-sm");
  });

  it("does not have btn-sm class at default md size", () => {
    render(<MobileFilterMenu groups={defaultGroups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    expect(button).not.toHaveClass("btn-sm");
  });

  it("opens a menu on click and calls onChange on menu item selection", async () => {
    const roleOnChange = vi.fn<(value: string) => void>();
    const statusOnChange = vi.fn<(value: string) => void>();
    const groups = [
      {
        key: "role",
        label: "Role",
        options: roleOptions,
        value: "all",
        onChange: roleOnChange,
      },
      {
        key: "status",
        label: "Status",
        options: statusOptions,
        value: "all",
        onChange: statusOnChange,
      },
    ];

    render(<MobileFilterMenu groups={groups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    pressTrigger(button);

    const adminItem = await screen.findByRole("menuitem", {
      name: "Role: Admin",
    });
    expect(adminItem).toBeInTheDocument();

    fireEvent.click(adminItem);
    expect(roleOnChange).toHaveBeenCalledWith("admin");
    expect(statusOnChange).not.toHaveBeenCalled();
  });

  it("shows menu items for all non-all options", async () => {
    const groups = [
      {
        key: "role",
        label: "Role",
        options: roleOptions,
        value: "all",
        onChange: vi.fn<(value: string) => void>(),
      },
      {
        key: "status",
        label: "Status",
        options: statusOptions,
        value: "all",
        onChange: vi.fn<(value: string) => void>(),
      },
    ];
    render(<MobileFilterMenu groups={groups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    pressTrigger(button);

    expect(screen.getByRole("menuitem", { name: /all/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Role: Admin/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Role: User/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Status: Active/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Status: Banned/i }),
    ).toBeInTheDocument();
  });

  it("does not show all-option entries from filter groups in the menu", async () => {
    const groups = [
      {
        key: "role",
        label: "Role",
        options: roleOptions,
        value: "all",
        onChange: vi.fn<(value: string) => void>(),
      },
      {
        key: "status",
        label: "Status",
        options: statusOptions,
        value: "all",
        onChange: vi.fn<(value: string) => void>(),
      },
    ];
    render(<MobileFilterMenu groups={groups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    pressTrigger(button);

    expect(
      screen.queryByRole("menuitem", { name: "Role: All Roles" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Status: All" }),
    ).not.toBeInTheDocument();
  });

  it("resets all filters when the All menu item is clicked", async () => {
    const roleOnChange = vi.fn<(value: string) => void>();
    const statusOnChange = vi.fn<(value: string) => void>();
    const groups = [
      {
        key: "role",
        label: "Role",
        options: roleOptions,
        value: "admin",
        onChange: roleOnChange,
      },
      {
        key: "status",
        label: "Status",
        options: statusOptions,
        value: "banned",
        onChange: statusOnChange,
      },
    ];

    render(<MobileFilterMenu groups={groups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    pressTrigger(button);

    const allItem = screen.getByRole("menuitem", { name: /^all$/i });
    fireEvent.click(allItem);

    expect(roleOnChange).toHaveBeenCalledWith("all");
    expect(statusOnChange).toHaveBeenCalledWith("all");
  });

  it("shows checkmark for currently selected filter items", async () => {
    const groups = [
      {
        key: "role",
        label: "Role",
        options: roleOptions,
        value: "admin",
        onChange: vi.fn<(value: string) => void>(),
      },
      {
        key: "status",
        label: "Status",
        options: statusOptions,
        value: "all",
        onChange: vi.fn<(value: string) => void>(),
      },
    ];

    render(<MobileFilterMenu groups={groups} />);
    const button = screen.getByRole("button", { name: "Filters" });
    pressTrigger(button);

    const adminItem = screen.getByRole("menuitem", { name: /Role: Admin/ });
    expect(adminItem.textContent).toContain("✓");
  });
});
