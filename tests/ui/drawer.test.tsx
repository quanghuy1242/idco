// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Drawer } from "@idco/ui";

describe("Drawer", () => {
  it("does not render content when closed", () => {
    render(
      <Drawer open={false} onOpenChange={() => {}} title="Key detail">
        <p>Body</p>
      </Drawer>,
    );
    expect(screen.queryByText("Key detail")).toBeNull();
  });

  it("renders the title and children when open", () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Key detail">
        <p>Body content</p>
      </Drawer>,
    );
    expect(screen.getByText("Key detail")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
    expect(document.body.querySelector("[data-theme]")).toHaveClass(
      "data-[entering]:animate-drawer-right-in",
    );
  });

  it("uses a left-side drawer animation when anchored left", () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Filters" side="left">
        <p>Body</p>
      </Drawer>,
    );
    expect(document.body.querySelector("[data-theme]")).toHaveClass(
      "data-[entering]:animate-drawer-left-in",
    );
  });

  it("calls onOpenChange(false) when the close button is clicked", () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <Drawer open onOpenChange={onOpenChange} title="Key detail">
        <p>Body</p>
      </Drawer>,
    );
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
