// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "@idco/ui";

function renderPalette(onAction = vi.fn<(id: string) => void>()) {
  render(
    <CommandPalette
      open
      onOpenChange={() => {}}
      searchValue=""
      onSearchChange={() => {}}
      groups={[
        {
          id: "collections",
          label: "Collections",
          items: [
            { id: "collection:posts", label: "Posts", meta: "Collection" },
          ],
        },
        {
          id: "records",
          label: "Records",
          items: [
            { id: "record:posts:1", label: "Hello world", meta: "Posts" },
          ],
        },
      ]}
      onAction={onAction}
    />,
  );
  return onAction;
}

describe("CommandPalette", () => {
  it("renders grouped command items", () => {
    renderPalette();

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getAllByText("Posts")).toHaveLength(2);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("calls onAction when a command is selected", async () => {
    const onAction = renderPalette();

    fireEvent.click(screen.getByText("Hello world"));

    await waitFor(() => {
      expect(onAction).toHaveBeenCalledWith("record:posts:1");
    });
  });

  it("uses DaisyUI modal classes and applies the active theme to the panel", () => {
    document.documentElement.setAttribute("data-theme", "idco-dark");

    renderPalette();

    expect(document.querySelector(".modal")).toHaveClass("bg-black/40");
    expect(document.querySelector(".modal-box")).toHaveAttribute(
      "data-theme",
      "idco-dark",
    );
  });

  it("renders an empty state", () => {
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        searchValue=""
        onSearchChange={() => {}}
        groups={[]}
        emptyMessage="Nothing here"
        onAction={() => {}}
      />,
    );

    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });
});
