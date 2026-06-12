// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => {
  vi.useRealTimers();
});

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
        searchDebounceMs={0}
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

  it("debounces async search input before loading", async () => {
    vi.useFakeTimers();
    const load = vi.fn<
      (query: string, signal: AbortSignal) => Promise<ResourceOption[]>
    >(async (query) =>
      query === "ali" ? [members[0]!] : query ? [] : members,
    );
    render(
      <ResourceSelector
        kind="user"
        value=""
        onChange={() => {}}
        source={{ mode: "async", load }}
        minQueryLength={1}
        searchDebounceMs={300}
      />,
    );

    load.mockClear();
    const input = screen.getByRole("searchbox", { name: /search users/i });
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "al" } });
    fireEvent.change(input, { target: { value: "ali" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });
    expect(load).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("ali", expect.any(AbortSignal));
  });

  it("renders a preset single value from initialOptions in async mode", async () => {
    render(
      <ResourceSelector
        kind="oauth-client"
        label="Client"
        value="cli_content"
        onChange={() => {}}
        source={{ mode: "async", load: async () => [] }}
        initialOptions={[
          {
            id: "cli_content",
            label: "Content Web",
            sublabel: "cli_content",
          },
        ]}
        variant="menu"
      />,
    );

    expect(
      await screen.findByRole("button", { name: /client/i }),
    ).toHaveTextContent("Content Web");
  });

  it("replaces placeholder cached labels when initialOptions hydrate later", async () => {
    const { rerender } = render(
      <ResourceSelector
        kind="oauth-client"
        label="Client"
        value="cli_content"
        onChange={() => {}}
        source={{ mode: "async", load: async () => [] }}
        initialOptions={[{ id: "cli_content", label: "cli_content" }]}
        variant="menu"
      />,
    );

    expect(
      await screen.findByRole("button", { name: /client/i }),
    ).toHaveTextContent("cli_content");

    rerender(
      <ResourceSelector
        kind="oauth-client"
        label="Client"
        value="cli_content"
        onChange={() => {}}
        source={{ mode: "async", load: async () => [] }}
        initialOptions={[
          {
            id: "cli_content",
            label: "Content Web",
            sublabel: "cli_content",
          },
        ]}
        variant="menu"
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /client/i })).toHaveTextContent(
        "Content Web",
      ),
    );
  });

  it("renders preset multi-value chips from initialOptions in async mode", async () => {
    render(
      <ResourceSelector
        kind="team"
        label="Default teams"
        selectionMode="multiple"
        value={["team_ops", "team_editorial"]}
        onChange={() => {}}
        source={{ mode: "async", load: async () => [] }}
        initialOptions={[
          { id: "team_ops", label: "Operations" },
          { id: "team_editorial", label: "Editorial" },
        ]}
      />,
    );

    expect(
      await screen.findByRole("button", { name: /remove operations/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove editorial/i }),
    ).toBeInTheDocument();
  });

  it("suppresses async loading below minQueryLength", async () => {
    const load = vi.fn<
      (query: string, signal: AbortSignal) => Promise<ResourceOption[]>
    >(async () => members);
    render(
      <ResourceSelector
        kind="user"
        value=""
        onChange={() => {}}
        source={{ mode: "async", load }}
        minQueryLength={3}
        searchDebounceMs={0}
      />,
    );

    expect(await screen.findByText("Type to search")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("searchbox", { name: /search users/i }), {
      target: { value: "al" },
    });
    expect(await screen.findByText("Type to search")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("searchbox", { name: /search users/i }), {
      target: { value: "ali" },
    });
    expect(await screen.findByText("Alice Nguyen")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("ali", expect.any(AbortSignal));
  });

  it("keeps the latest async query results when an older load resolves late", async () => {
    let resolveA: ((items: ResourceOption[]) => void) | undefined;
    let resolveAl: ((items: ResourceOption[]) => void) | undefined;
    const load = vi.fn<
      (query: string, signal: AbortSignal) => Promise<ResourceOption[]>
    >((query) => {
      if (query === "a") {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      if (query === "al") {
        return new Promise((resolve) => {
          resolveAl = resolve;
        });
      }
      return Promise.resolve([]);
    });

    render(
      <ResourceSelector
        kind="user"
        value=""
        onChange={() => {}}
        source={{ mode: "async", load }}
        searchDebounceMs={0}
      />,
    );

    const input = screen.getByRole("searchbox", { name: /search users/i });
    fireEvent.change(input, { target: { value: "a" } });
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith("a", expect.any(AbortSignal)),
    );
    fireEvent.change(input, { target: { value: "al" } });
    await waitFor(() =>
      expect(load).toHaveBeenCalledWith("al", expect.any(AbortSignal)),
    );

    await act(async () => {
      resolveAl?.([members[1]!]);
    });
    expect(await screen.findByText("Bob Tran")).toBeInTheDocument();

    await act(async () => {
      resolveA?.([members[0]!]);
    });
    expect(screen.getByText("Bob Tran")).toBeInTheDocument();
    expect(screen.queryByText("Alice Nguyen")).toBeNull();
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

  it("supports the oauth-client kind without an avatar figure", async () => {
    const { container } = render(
      <ResourceSelector
        kind="oauth-client"
        label="OAuth client"
        value=""
        onChange={() => {}}
        source={{
          mode: "sync",
          items: [{ id: "cli_web", label: "Web app", sublabel: "cli_web" }],
        }}
      />,
    );
    expect(await screen.findByText("Web app")).toBeInTheDocument();
    expect(container.querySelector(".avatar")).toBeNull();
  });

  it("supports the resource-server kind", async () => {
    render(
      <ResourceSelector
        kind="resource-server"
        label="Resource server"
        value=""
        onChange={() => {}}
        source={{
          mode: "sync",
          items: [
            { id: "rs_content", label: "Content API", sublabel: "rs_content" },
          ],
        }}
      />,
    );
    expect(await screen.findByText("Content API")).toBeInTheDocument();
  });
});
