// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  BlockChrome,
  ChromeButton,
} from "../../packages/editor/src/legacy/nodes/chrome";

describe("BlockChrome", () => {
  it("standardizes the block title on the left and actions on the right", () => {
    render(
      <div className="group/block relative">
        <BlockChrome
          icon="Table"
          label="Table"
          actions={<ChromeButton icon="Settings" label="Table settings" />}
          removeLabel="Remove table"
          onRemove={() => {}}
        />
      </div>,
    );

    const badgeSlot = screen.getByText("Table").closest("span")?.parentElement;
    expect(screen.getByText("Table").closest("span")).toHaveClass(
      "h-6",
      "leading-none",
    );
    expect(badgeSlot).toHaveClass("-top-2.5", "left-3");
    expect(badgeSlot).toHaveClass(
      "opacity-0",
      "group-hover/block:opacity-100",
      "group-focus-within/block:opacity-100",
    );

    const actionCluster = screen.getByRole("button", {
      name: "Table settings",
    }).parentElement;
    expect(actionCluster).toHaveClass(
      "opacity-0",
      "group-hover/block:opacity-100",
      "group-focus-within/block:opacity-100",
    );
    expect(actionCluster?.parentElement).toHaveClass("-top-2.5", "right-2");
  });

  it("can render visible portal-hosted chrome with the same slots", () => {
    render(
      <div className="relative">
        <BlockChrome
          icon="Table"
          label="Table"
          visibility="visible"
          actions={<ChromeButton icon="Settings" label="Table settings" />}
          removeLabel="Remove table"
          onRemove={() => {}}
        />
      </div>,
    );

    const badgeSlot = screen.getByText("Table").closest("span")?.parentElement;
    expect(screen.getByText("Table").closest("span")).toHaveClass(
      "h-6",
      "leading-none",
    );
    expect(badgeSlot).toHaveClass("-top-2.5", "left-3");
    expect(badgeSlot).not.toHaveClass("opacity-0");

    const actionCluster = screen.getByRole("button", {
      name: "Table settings",
    }).parentElement;
    expect(actionCluster).not.toHaveClass("opacity-0");
    expect(actionCluster?.parentElement).toHaveClass("-top-2.5", "right-2");
  });
});
