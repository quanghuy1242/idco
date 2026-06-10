// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Panel, PanelFooter, Toolbar } from "@idco/ui";

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
});
