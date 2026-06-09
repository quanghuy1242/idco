// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UrlListBuilder, defaultUrlValidate } from "@idco/ui";

describe("defaultUrlValidate", () => {
  it("accepts https and localhost URLs", () => {
    expect(
      defaultUrlValidate("https://app.example.com/callback"),
    ).toBeUndefined();
    expect(
      defaultUrlValidate("http://localhost:3000/callback"),
    ).toBeUndefined();
  });

  it("rejects fragments and non-absolute or non-https URLs", () => {
    expect(defaultUrlValidate("https://app.example.com/cb#frag")).toMatch(
      /fragment/i,
    );
    expect(defaultUrlValidate("/relative")).toMatch(/absolute/i);
    expect(defaultUrlValidate("http://app.example.com")).toMatch(
      /https or localhost/i,
    );
  });
});

describe("UrlListBuilder", () => {
  it("renders a row per value", () => {
    render(
      <UrlListBuilder
        label="Redirect URIs"
        value={["https://a.com/cb", "https://b.com/cb"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByDisplayValue("https://a.com/cb")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://b.com/cb")).toBeInTheDocument();
  });

  it("adds a row via the add button", () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <UrlListBuilder
        label="Redirect URIs"
        value={["https://a.com/cb"]}
        onChange={onChange}
        addLabel="Add redirect URI"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add redirect uri/i }));
    expect(onChange).toHaveBeenCalledWith(["https://a.com/cb", ""]);
  });

  it("removes a row via the remove button", () => {
    const onChange = vi.fn<(v: string[]) => void>();
    render(
      <UrlListBuilder
        label="Redirect URIs"
        value={["https://a.com/cb", "https://b.com/cb"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /remove redirect uris 1/i }),
    );
    expect(onChange).toHaveBeenCalledWith(["https://b.com/cb"]);
  });

  it("renders attached square remove buttons with the configured size", () => {
    render(
      <UrlListBuilder
        label="Redirect URIs"
        value={["https://a.com/cb", "https://b.com/cb"]}
        onChange={() => {}}
        size="sm"
      />,
    );
    expect(
      screen.getByRole("button", { name: /remove redirect uris 1/i }),
    ).toHaveClass("btn-square");
    expect(
      screen.getByRole("button", { name: /remove redirect uris 1/i }),
    ).toHaveClass("rounded-l-none");
    expect(
      screen.getByRole("button", { name: /remove redirect uris 1/i }),
    ).not.toHaveClass("btn-circle");
    expect(
      screen.getByRole("button", { name: /remove redirect uris 1/i }),
    ).toHaveClass("btn-sm");
    expect(screen.getByDisplayValue("https://a.com/cb")).toHaveClass(
      "input-sm",
    );
    expect(screen.getByDisplayValue("https://a.com/cb")).toHaveClass(
      "rounded-r-none",
    );
  });

  it("shows a per-row validation error", () => {
    render(
      <UrlListBuilder
        label="Redirect URIs"
        value={["http://app.example.com"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/https or localhost/i);
  });

  it("serializes values into a hidden newline-joined field", () => {
    const { container } = render(
      <UrlListBuilder
        label="Redirect URIs"
        name="redirect_uris"
        value={["https://a.com/cb", "https://b.com/cb"]}
        onChange={() => {}}
      />,
    );
    const hidden = container.querySelector(
      'input[type="hidden"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe("https://a.com/cb\nhttps://b.com/cb");
  });

  it("disables removal at minRows", () => {
    render(
      <UrlListBuilder
        label="Redirect URIs"
        value={["https://a.com/cb"]}
        onChange={() => {}}
        minRows={1}
      />,
    );
    expect(
      screen.getByRole("button", { name: /remove redirect uris 1/i }),
    ).toBeDisabled();
  });
});
