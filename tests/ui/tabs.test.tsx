// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Tabs, type LinkTabItem, type PanelTabItem } from "@idco/ui";

const panelItems: PanelTabItem[] = [
  { id: "overview", label: "Overview", content: "Overview panel" },
  { id: "members", label: "Members", content: "Members panel" },
  {
    id: "settings",
    label: "Settings",
    content: "Settings panel",
    disabled: true,
  },
];

const linkItems: LinkTabItem[] = [
  { id: "users", href: "/admin/identity/users", label: "Users" },
  {
    id: "organizations",
    href: "/admin/identity/organizations",
    label: "Organizations",
  },
];

describe("Tabs", () => {
  it("renders panel tabs with DaisyUI tab classes", () => {
    render(
      <Tabs
        ariaLabel="Organization tabs"
        items={panelItems}
        defaultSelectedKey="overview"
      />,
    );

    expect(
      screen.getByRole("tablist", { name: "Organization tabs" }),
    ).toHaveClass("tabs", "tabs-border");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveClass(
      "tab",
      "tab-active",
    );
    expect(screen.getByText("Overview panel")).toBeInTheDocument();
  });

  it("calls onSelectionChange when a tab is selected", () => {
    const onSelectionChange = vi.fn<(key: string) => void>();
    render(
      <Tabs
        ariaLabel="Organization tabs"
        items={panelItems}
        defaultSelectedKey="overview"
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Members" }));

    expect(onSelectionChange).toHaveBeenCalledWith("members");
  });

  it("uses default md size without a DaisyUI size modifier", () => {
    render(
      <Tabs
        ariaLabel="Organization tabs"
        items={panelItems}
        defaultSelectedKey="overview"
      />,
    );

    expect(
      screen.getByRole("tablist", { name: "Organization tabs" }),
    ).not.toHaveClass("tabs-sm");
  });

  it("applies the small size modifier when requested", () => {
    render(
      <Tabs
        ariaLabel="Organization tabs"
        items={panelItems}
        defaultSelectedKey="overview"
        size="sm"
      />,
    );

    expect(
      screen.getByRole("tablist", { name: "Organization tabs" }),
    ).toHaveClass("tabs-sm");
  });

  it("marks disabled tabs with DaisyUI disabled styling", () => {
    render(
      <Tabs
        ariaLabel="Organization tabs"
        items={panelItems}
        defaultSelectedKey="overview"
      />,
    );

    expect(screen.getByRole("tab", { name: "Settings" })).toHaveClass(
      "tab-disabled",
    );
  });

  it("supports DaisyUI boxed tabs", () => {
    render(
      <Tabs
        ariaLabel="Organization tabs"
        items={panelItems}
        defaultSelectedKey="overview"
        variant="box"
      />,
    );

    expect(
      screen.getByRole("tablist", { name: "Organization tabs" }),
    ).toHaveClass("tabs-box");
  });

  it("renders URL tabs as Next links with the same Tabs component", () => {
    render(
      <Tabs ariaLabel="Identity tabs" items={linkItems} selectedKey="users" />,
    );

    expect(screen.getByRole("tab", { name: "Users" })).toHaveClass(
      "tab",
      "tab-active",
    );
    expect(screen.getByRole("tab", { name: "Users" })).toHaveAttribute(
      "href",
      "/admin/identity/users",
    );
    expect(screen.getByRole("tab", { name: "Organizations" })).toHaveAttribute(
      "href",
      "/admin/identity/organizations",
    );
  });

  it("applies the small size modifier when requested", () => {
    render(
      <Tabs
        ariaLabel="Identity tabs"
        size="sm"
        items={linkItems}
        selectedKey="users"
      />,
    );

    expect(screen.getByRole("tablist")).toHaveClass("tabs-sm");
  });
});
