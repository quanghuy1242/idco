// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Columns, Panel, PanelFooter, Toolbar, focusRing } from "@idco/ui";

describe("layout primitives", () => {
  it("renders a responsive toolbar without product-local class exposure", () => {
    render(
      <Toolbar>
        <span>Search</span>
        <span>Filters</span>
      </Toolbar>,
    );

    expect(screen.getByText("Search").parentElement).toHaveClass(
      "flex",
      "flex-col",
      "md:flex-row",
    );
  });

  it("renders a panel footer for repeated panel actions", () => {
    render(
      <Panel padding="none">
        <PanelFooter>
          <span>Loaded</span>
          <span>More</span>
        </PanelFooter>
      </Panel>,
    );

    expect(screen.getByText("Loaded").parentElement).toHaveClass(
      "border-t",
      "border-base-300",
      "justify-between",
    );
  });

  it("maps the 3-step elevation scale onto base-100/200/300 (R1)", () => {
    const { rerender } = render(<Panel tone="base">page</Panel>);
    expect(screen.getByText("page").closest("section")).toHaveClass(
      "bg-base-100",
    );

    rerender(<Panel tone="muted">recessed</Panel>);
    expect(screen.getByText("recessed").closest("section")).toHaveClass(
      "bg-base-200",
    );

    rerender(<Panel tone="raised">rail</Panel>);
    expect(screen.getByText("rail").closest("section")).toHaveClass(
      "bg-base-300",
    );
  });

  it("exposes a single visible focus-ring token (R1)", () => {
    // The token is a shared class string so consumers do not author a ring in
    // globals.css; assert the ring's shape stays stable.
    expect(focusRing).toContain("focus-visible:ring-2");
    expect(focusRing).toContain("focus-visible:ring-primary");
  });
});

describe("Columns (R3)", () => {
  it("caps and centers the main column at a readable measure", () => {
    render(
      <Columns mainMaxWidth="prose">
        <div>writing</div>
        <div>rail</div>
      </Columns>,
    );
    // The main child is wrapped in a centered measure box; the sidebar is not.
    expect(screen.getByText("writing").parentElement).toHaveClass(
      "mx-auto",
      "max-w-[45rem]",
    );
  });

  it("applies the sized sidebar track width", () => {
    const { container } = render(
      <Columns sidebarWidth="md">
        <div>main</div>
        <div>rail</div>
      </Columns>,
    );
    expect(container.firstElementChild).toHaveClass(
      "lg:grid-cols-[minmax(0,1fr)_22.5rem]",
    );
  });

  it("collapses the sidebar to an icon rail and reclaims the width", () => {
    const { container } = render(
      <Columns collapsibleSidebar defaultCollapsed sidebarLabel="inspector">
        <div>main</div>
        <div>rail contents</div>
      </Columns>,
    );

    // Collapsed: the sidebar content is hidden behind an expand affordance and the
    // track drops to `auto` so the main column grows into the gutter.
    expect(screen.queryByText("rail contents")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "lg:grid-cols-[minmax(0,1fr)_auto]",
    );

    // Expanding reveals the content and restores the two-track layout.
    fireEvent.click(
      screen.getByRole("button", { name: /expand the inspector/i }),
    );
    expect(screen.getByText("rail contents")).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "lg:grid-cols-[minmax(0,1fr)_20rem]",
    );
  });
});
