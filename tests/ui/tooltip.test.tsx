// @vitest-environment jsdom

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, Tooltip } from "@idco/ui";

// React Aria only shows a tooltip on focus when the focus came from the
// keyboard. Establish keyboard modality, then focus the trigger.
function focusViaKeyboard(el: HTMLElement): void {
  fireEvent.keyDown(document.body, { key: "Tab" });
  fireEvent.keyUp(document.body, { key: "Tab" });
  el.focus();
  fireEvent.focus(el);
}

describe("Tooltip", () => {
  it("renders the trigger child", () => {
    render(
      <Tooltip content="Edit user">
        <Button ariaLabel="Edit" iconName="Pencil" />
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("shows tooltip content on keyboard focus", async () => {
    render(
      <Tooltip content="Edit user">
        <Button ariaLabel="Edit" iconName="Pencil" />
      </Tooltip>,
    );
    focusViaKeyboard(screen.getByRole("button", { name: /edit/i }));
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent("Edit user");
    });
  });

  it("renders the child without a tooltip when content is empty", () => {
    render(
      <Tooltip content="">
        <Button ariaLabel="Edit" iconName="Pencil" />
      </Tooltip>,
    );
    focusViaKeyboard(screen.getByRole("button", { name: /edit/i }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});

describe("Button tooltip prop", () => {
  it("exposes its tooltip on keyboard focus", async () => {
    render(
      <Button
        iconName="Trash2"
        ariaLabel="Delete"
        tooltip="Delete application"
      />,
    );
    focusViaKeyboard(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => {
      expect(screen.getByRole("tooltip")).toHaveTextContent(
        "Delete application",
      );
    });
  });

  it("renders normally without a tooltip prop", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument();
  });
});
