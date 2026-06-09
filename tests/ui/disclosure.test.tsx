// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Disclosure, DisclosureGroup } from "@idco/ui";

describe("Disclosure", () => {
  it("renders the trigger title", () => {
    render(
      <Disclosure title="Advanced">
        <p>Panel body</p>
      </Disclosure>,
    );
    expect(
      screen.getByRole("button", { name: /advanced/i }),
    ).toBeInTheDocument();
  });

  it("is collapsed by default", () => {
    const { unmount } = render(
      <Disclosure title="Advanced">
        <p>Panel body</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: /advanced/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    unmount();
  });

  it("is expanded with defaultExpanded", () => {
    render(
      <Disclosure title="Advanced" defaultExpanded>
        <p>Panel body</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: /advanced/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("calls onExpandedChange when the trigger is clicked", () => {
    const onExpandedChange = vi.fn<(v: boolean) => void>();
    render(
      <Disclosure title="Advanced" onExpandedChange={onExpandedChange}>
        <p>Panel body</p>
      </Disclosure>,
    );
    fireEvent.click(screen.getByRole("button", { name: /advanced/i }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it("honors the controlled expanded prop", () => {
    render(
      <Disclosure title="Advanced" expanded>
        <p>Panel body</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: /advanced/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("renders an explicit icon for the plus variant", () => {
    const { container } = render(
      <Disclosure title="Advanced" icon="plus">
        <p>Panel body</p>
      </Disclosure>,
    );
    expect(container.querySelector(".collapse-title svg")).toBeInTheDocument();
  });

  it("can contain wide panel content", () => {
    const { container } = render(
      <Disclosure title="Payload" width="contained" defaultExpanded>
        <pre>{"x".repeat(200)}</pre>
      </Disclosure>,
    );
    expect(container.querySelector(".collapse")).toHaveClass(
      "w-full",
      "min-w-0",
      "max-w-full",
    );
    expect(container.querySelector(".collapse-content")).toHaveClass(
      "min-w-0",
      "overflow-hidden",
    );
  });

  it("renders multiple disclosures inside a group", () => {
    render(
      <DisclosureGroup allowsMultiple>
        <Disclosure title="One">
          <p>1</p>
        </Disclosure>
        <Disclosure title="Two">
          <p>2</p>
        </Disclosure>
      </DisclosureGroup>,
    );
    expect(screen.getByRole("button", { name: /one/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /two/i })).toBeInTheDocument();
  });
});
