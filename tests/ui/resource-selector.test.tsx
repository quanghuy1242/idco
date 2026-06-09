// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ResourceSelector,
  type ResourceOption,
  type ResourceSource,
} from "@idco/ui";

const members: ResourceOption[] = [
  {
    id: "u1",
    label: "Alice Nguyen",
    sublabel: "alice@acme.com",
    badge: "member",
  },
  { id: "u2", label: "Bob Tran", sublabel: "bob@acme.com", badge: "admin" },
  { id: "u3", label: "Carol Lee", sublabel: "carol@acme.com", badge: "member" },
];

const syncSource: ResourceSource = { mode: "sync", items: members };

describe("ResourceSelector", () => {
  it("renders options from a sync source", async () => {
    render(
      <ResourceSelector
        kind="member"
        value=""
        onChange={() => {}}
        source={syncSource}
      />,
    );
    expect(await screen.findByText("Alice Nguyen")).toBeInTheDocument();
    expect(screen.getByText("Bob Tran")).toBeInTheDocument();
  });

  it("calls onChange with the id on single selection", async () => {
    const onChange = vi.fn<(next: string | string[]) => void>();
    render(
      <ResourceSelector
        kind="member"
        value=""
        onChange={onChange}
        source={syncSource}
      />,
    );
    fireEvent.click(await screen.findByText("Alice Nguyen"));
    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("supports a compact menu picker with search and animated popover", async () => {
    const onChange = vi.fn<(next: string | string[]) => void>();
    render(
      <ResourceSelector
        kind="member"
        value=""
        onChange={onChange}
        source={syncSource}
        variant="menu"
        width="compact"
        label="Add member"
      />,
    );

    expect(screen.queryByText("Alice Nguyen")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /add member/i }));

    expect(
      await screen.findByRole("searchbox", { name: /add member/i }),
    ).toBeInTheDocument();
    const menu = await screen.findByRole("menu");
    expect(menu.parentElement?.parentElement).toHaveClass(
      "data-[entering]:animate-popover-in",
      "data-[exiting]:animate-popover-out",
    );
    fireEvent.click(await screen.findByText("Alice Nguyen"));
    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("adds to the array in multiple mode", async () => {
    const onChange = vi.fn<(next: string | string[]) => void>();
    render(
      <ResourceSelector
        kind="member"
        selectionMode="multiple"
        value={[]}
        onChange={onChange}
        source={syncSource}
      />,
    );
    fireEvent.click(await screen.findByText("Bob Tran"));
    expect(onChange).toHaveBeenCalledWith(["u2"]);
  });

  it("hides excluded ids from the option list", async () => {
    render(
      <ResourceSelector
        kind="member"
        value=""
        onChange={() => {}}
        source={syncSource}
        excludeIds={["u1"]}
      />,
    );
    expect(await screen.findByText("Bob Tran")).toBeInTheDocument();
    expect(screen.queryByText("Alice Nguyen")).toBeNull();
  });

  it("filters sync results by the typed query", async () => {
    render(
      <ResourceSelector
        kind="member"
        value=""
        onChange={() => {}}
        source={syncSource}
      />,
    );
    await screen.findByText("Alice Nguyen");
    fireEvent.change(
      screen.getByRole("searchbox", { name: /search members/i }),
      { target: { value: "bob" } },
    );
    expect(screen.getByText("Bob Tran")).toBeInTheDocument();
    expect(screen.queryByText("Alice Nguyen")).toBeNull();
  });

  it("uses source labels for initially selected ids", async () => {
    render(
      <ResourceSelector
        kind="member"
        selectionMode="multiple"
        value={["u1"]}
        onChange={() => {}}
        source={syncSource}
      />,
    );
    expect(
      await screen.findByRole("button", { name: /remove alice nguyen/i }),
    ).toBeInTheDocument();
  });

  it("renders an avatar for the user/member kinds", async () => {
    const { container } = render(
      <ResourceSelector
        kind="user"
        value=""
        onChange={() => {}}
        source={syncSource}
      />,
    );
    await screen.findByText("Alice Nguyen");
    expect(container.querySelector(".avatar")).toBeInTheDocument();
  });

  it("loads from an async source with the typed query", async () => {
    const load = vi.fn<
      (query: string, signal: AbortSignal) => Promise<ResourceOption[]>
    >(async () => members);
    const asyncSource: ResourceSource = { mode: "async", load };
    render(
      <ResourceSelector
        kind="user"
        value=""
        onChange={() => {}}
        source={asyncSource}
      />,
    );
    expect(await screen.findByText("Alice Nguyen")).toBeInTheDocument();
    expect(load).toHaveBeenCalled();
    fireEvent.change(screen.getByRole("searchbox", { name: /search users/i }), {
      target: { value: "alice" },
    });
    expect(await screen.findByText("Alice Nguyen")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("alice", expect.any(AbortSignal));
  });

  it("serializes selected ids into a hidden field", async () => {
    const { container } = render(
      <ResourceSelector
        kind="member"
        selectionMode="multiple"
        name="userIds"
        value={["u1", "u2"]}
        onChange={() => {}}
        source={syncSource}
      />,
    );
    const hidden = container.querySelector(
      'input[type="hidden"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe("u1,u2");
  });
});
