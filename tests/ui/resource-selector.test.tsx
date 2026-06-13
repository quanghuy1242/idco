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

// The ComboBox opens its popover on focus (menuTrigger="focus").
async function openCombo(name: RegExp): Promise<HTMLElement> {
  const input = screen.getByRole("combobox", { name });
  await act(async () => {
    input.focus();
    fireEvent.focus(input);
  });
  return input;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ResourceSelector", () => {
  it("renders options from a sync source when opened", async () => {
    render(
      <ResourceSelector
        kind="member"
        value=""
        onChange={() => {}}
        source={syncSource}
      />,
    );
    await openCombo(/search members/i);
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
    await openCombo(/search members/i);
    fireEvent.click(await screen.findByText("Alice Nguyen"));
    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("opens an animated popover listbox", async () => {
    render(
      <ResourceSelector
        kind="member"
        value=""
        onChange={() => {}}
        source={syncSource}
        width="compact"
        label="Add member"
      />,
    );
    await openCombo(/add member/i);
    const listbox = await screen.findByRole("listbox");
    expect(listbox.closest(".z-50")).toHaveClass(
      "data-[entering]:animate-popover-in",
      "data-[exiting]:animate-popover-out",
    );
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
    await openCombo(/search members/i);
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
    await openCombo(/search members/i);
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
    const input = await openCombo(/search members/i);
    await screen.findByText("Alice Nguyen");
    fireEvent.change(input, { target: { value: "bob" } });
    expect(await screen.findByText("Bob Tran")).toBeInTheDocument();
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
    render(
      <ResourceSelector
        kind="user"
        value=""
        onChange={() => {}}
        source={syncSource}
      />,
    );
    await openCombo(/search users/i);
    await screen.findByText("Alice Nguyen");
    // The popover listbox renders in a portal, outside the render container.
    expect(document.querySelector(".avatar")).toBeInTheDocument();
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
    const input = await openCombo(/search users/i);
    expect(await screen.findByText("Alice Nguyen")).toBeInTheDocument();
    expect(load).toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "alice" } });
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
    const input = screen.getByRole("combobox", { name: /search users/i });
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

  it("shows a preset single value's label from initialOptions in async mode", async () => {
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
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /client/i })).toHaveValue(
        "Content Web",
      ),
    );
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
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /client/i })).toHaveValue(
        "cli_content",
      ),
    );

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
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /client/i })).toHaveValue(
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

    const input = await openCombo(/search users/i);
    expect(await screen.findByText("Type to search")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "al" } });
    expect(await screen.findByText("Type to search")).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "ali" } });
    expect(await screen.findByText("Alice Nguyen")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith("ali", expect.any(AbortSignal));
  });

  it("loads the first page of a paginated source on mount", async () => {
    const load = vi.fn<
      (params: {
        query: string;
        cursor?: string;
        signal: AbortSignal;
      }) => Promise<{ items: ResourceOption[]; cursor?: string }>
    >(async ({ cursor }) => ({
      items: cursor ? [members[2]!] : [members[0]!, members[1]!],
      cursor: cursor ? undefined : "2",
    }));

    render(
      <ResourceSelector
        kind="user"
        value=""
        onChange={() => {}}
        source={{ mode: "paginated", load }}
        searchDebounceMs={0}
      />,
    );

    await openCombo(/search users/i);
    expect(await screen.findByText("Alice Nguyen")).toBeInTheDocument();
    expect(screen.getByText("Bob Tran")).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith(
      expect.objectContaining({ query: "", cursor: undefined }),
    );
  });

  it("re-queries a paginated source from page one on search", async () => {
    const load = vi.fn<
      (params: {
        query: string;
        cursor?: string;
        signal: AbortSignal;
      }) => Promise<{ items: ResourceOption[]; cursor?: string }>
    >(async ({ query }) => ({
      items: query
        ? members.filter((m) => m.label.toLowerCase().includes(query))
        : members,
      cursor: undefined,
    }));

    render(
      <ResourceSelector
        kind="user"
        value=""
        onChange={() => {}}
        source={{ mode: "paginated", load }}
        searchDebounceMs={0}
      />,
    );

    const input = await openCombo(/search users/i);
    await screen.findByText("Alice Nguyen");
    fireEvent.change(input, { target: { value: "bob" } });

    expect(await screen.findByText("Bob Tran")).toBeInTheDocument();
    expect(screen.queryByText("Alice Nguyen")).toBeNull();
    expect(load).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "bob", cursor: undefined }),
    );
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
    render(
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
    await openCombo(/oauth client/i);
    expect(await screen.findByText("Web app")).toBeInTheDocument();
    expect(document.querySelector(".avatar")).toBeNull();
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
    await openCombo(/resource server/i);
    expect(await screen.findByText("Content API")).toBeInTheDocument();
  });
});
