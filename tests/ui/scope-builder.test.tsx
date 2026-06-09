// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScopeBuilder, defaultScopeValidate } from "@idco/ui";

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

  it("adds a scope when a suggestion is selected", () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <ScopeBuilder
        label="Scopes"
        value={[]}
        onChange={onChange}
        suggestions={suggestions}
      />,
    );
    fireEvent.click(screen.getByText("content:read"));
    expect(onChange).toHaveBeenCalledWith(["content:read"]);
  });

  it("supports a menu variant with search and animated popover", async () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <ScopeBuilder
        label="Scope filters"
        value={[]}
        onChange={onChange}
        suggestions={suggestions}
        variant="menu"
      />,
    );

    expect(screen.queryByText("content:read")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /scope filters/i }));

    expect(
      await screen.findByRole("searchbox", { name: /search scope filters/i }),
    ).toBeInTheDocument();
    const menu = await screen.findByRole("menu");
    expect(menu.parentElement?.parentElement).toHaveClass(
      "data-[entering]:animate-popover-in",
      "data-[exiting]:animate-popover-out",
    );
    fireEvent.click(await screen.findByText("content:read"));
    expect(onChange).toHaveBeenCalledWith(["content:read"]);
  });

  it("can route-control the menu search value", async () => {
    const onSearchValueChange = vi.fn<(v: string) => void>();
    render(
      <ScopeBuilder
        label="Scope filters"
        value={[]}
        onChange={() => {}}
        suggestions={suggestions}
        variant="menu"
        searchValue="content"
        onSearchValueChange={onSearchValueChange}
      />,
    );

    expect(
      screen.getByRole("button", { name: /scope filters/i }),
    ).toHaveTextContent("content");
    fireEvent.click(screen.getByRole("button", { name: /scope filters/i }));
    const input = await screen.findByRole("searchbox", {
      name: /search scope filters/i,
    });
    expect(input).toHaveValue("content");
    fireEvent.change(input, { target: { value: "profile" } });
    expect(onSearchValueChange).toHaveBeenCalledWith("profile");
  });

  it("filters suggestions while typing", () => {
    render(
      <ScopeBuilder
        label="Scopes"
        value={[]}
        onChange={() => {}}
        suggestions={suggestions}
      />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: /search scopes/i }),
      { target: { value: "content" } },
    );
    expect(screen.getByText("content:read")).toBeInTheDocument();
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
    const input = screen.getByRole("searchbox", { name: /search scopes/i });
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
    const input = screen.getByRole("searchbox", { name: /search scopes/i });
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
    fireEvent.keyDown(
      screen.getByRole("searchbox", { name: /search scopes/i }),
      { key: "Backspace" },
    );
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
