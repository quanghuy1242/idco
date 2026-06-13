// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScopeBuilder, defaultScopeValidate } from "@idco/ui";

// The ComboBox opens its popover on focus (menuTrigger="focus").
async function openCombo(name: RegExp): Promise<HTMLElement> {
  const input = screen.getByRole("combobox", { name });
  await act(async () => {
    input.focus();
    fireEvent.focus(input);
  });
  return input;
}

const suggestions = [
  { value: "openid", description: "OpenID" },
  { value: "profile", description: "Profile" },
  { value: "content:read", description: "Content API" },
];

describe("defaultScopeValidate", () => {
  it("accepts valid scope strings", () => {
    expect(defaultScopeValidate("content:read")).toBeUndefined();
    expect(defaultScopeValidate("openid")).toBeUndefined();
  });

  it("rejects invalid scope strings", () => {
    expect(defaultScopeValidate("Bad Scope")).toMatch(/lowercase/i);
    expect(defaultScopeValidate("1leading")).toMatch(/lowercase/i);
  });
});

describe("ScopeBuilder", () => {
  it("renders selected scopes as chips", () => {
    render(
      <ScopeBuilder
        label="Scopes"
        value={["openid", "profile"]}
        onChange={() => {}}
        suggestions={suggestions}
      />,
    );
    expect(
      screen.getByRole("button", { name: /remove openid/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove profile/i }),
    ).toBeInTheDocument();
  });

  it("removes a scope when the chip remove button is pressed", () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <ScopeBuilder
        label="Scopes"
        value={["openid", "profile"]}
        onChange={onChange}
        suggestions={suggestions}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove openid/i }));
    expect(onChange).toHaveBeenCalledWith(["profile"]);
  });

  it("excludes already-selected scopes from the suggestion list", () => {
    render(
      <ScopeBuilder
        label="Scopes"
        value={["openid"]}
        onChange={() => {}}
        suggestions={suggestions}
      />,
    );
    // "openid" should appear once (the chip), not also as an option.
    expect(screen.getAllByText("openid")).toHaveLength(1);
  });

  it("adds a scope when a suggestion is selected", async () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <ScopeBuilder
        label="Scopes"
        value={[]}
        onChange={onChange}
        suggestions={suggestions}
      />,
    );
    await openCombo(/scopes/i);
    fireEvent.click(await screen.findByText("content:read"));
    expect(onChange).toHaveBeenCalledWith(["content:read"]);
  });

  it("opens an animated popover listbox of suggestions", async () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <ScopeBuilder
        label="Scope filters"
        value={[]}
        onChange={onChange}
        suggestions={suggestions}
      />,
    );

    expect(screen.queryByText("content:read")).toBeNull();
    await openCombo(/scope filters/i);

    const listbox = await screen.findByRole("listbox");
    expect(listbox.closest(".z-50")).toHaveClass(
      "data-[entering]:animate-popover-in",
      "data-[exiting]:animate-popover-out",
    );
    fireEvent.click(await screen.findByText("content:read"));
    expect(onChange).toHaveBeenCalledWith(["content:read"]);
  });

  it("can route-control the search value", async () => {
    const onSearchValueChange = vi.fn<(v: string) => void>();
    render(
      <ScopeBuilder
        label="Scope filters"
        value={[]}
        onChange={() => {}}
        suggestions={suggestions}
        searchValue="content"
        onSearchValueChange={onSearchValueChange}
      />,
    );

    const input = screen.getByRole("combobox", { name: /scope filters/i });
    expect(input).toHaveValue("content");
    fireEvent.change(input, { target: { value: "profile" } });
    expect(onSearchValueChange).toHaveBeenCalledWith("profile");
  });

  it("filters suggestions while typing", async () => {
    render(
      <ScopeBuilder
        label="Scopes"
        value={[]}
        onChange={() => {}}
        suggestions={suggestions}
      />,
    );
    const input = await openCombo(/scopes/i);
    fireEvent.change(input, { target: { value: "content" } });
    expect(await screen.findByText("content:read")).toBeInTheDocument();
    expect(screen.queryByText("profile")).toBeNull();
  });

  it("adds the filtered scope when Enter is pressed", () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <ScopeBuilder
        label="Scopes"
        value={[]}
        onChange={onChange}
        suggestions={suggestions}
      />,
    );
    const input = screen.getByRole("combobox", { name: /scopes/i });
    fireEvent.change(input, { target: { value: "content" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["content:read"]);
  });

  it("adds a valid custom scope with Enter when custom values are allowed", () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <ScopeBuilder
        label="Scopes"
        value={[]}
        onChange={onChange}
        suggestions={suggestions}
        allowCustom
      />,
    );
    const input = screen.getByRole("combobox", { name: /scopes/i });
    fireEvent.change(input, { target: { value: "billing:read" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["billing:read"]);
  });

  it("removes the last chip on Backspace from an empty input", () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <ScopeBuilder
        label="Scopes"
        value={["openid", "profile"]}
        onChange={onChange}
        suggestions={suggestions}
      />,
    );
    fireEvent.keyDown(screen.getByRole("combobox", { name: /scopes/i }), {
      key: "Backspace",
    });
    expect(onChange).toHaveBeenCalledWith(["openid"]);
  });

  it("serializes selected scopes into a hidden space-joined field", () => {
    const { container } = render(
      <ScopeBuilder
        label="Scopes"
        name="scope"
        value={["openid", "profile"]}
        onChange={() => {}}
        suggestions={suggestions}
      />,
    );
    const hidden = container.querySelector(
      'input[type="hidden"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe("openid profile");
  });
});
