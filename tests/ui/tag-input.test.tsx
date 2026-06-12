// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TagInput, defaultDomainValidate } from "@idco/ui";

describe("defaultDomainValidate", () => {
  it("accepts well-formed domains", () => {
    expect(defaultDomainValidate("acme.com")).toBeUndefined();
    expect(defaultDomainValidate("mail.acme.co.uk")).toBeUndefined();
  });

  it("rejects malformed domains", () => {
    expect(defaultDomainValidate("not a domain")).toMatch(/valid domain/i);
    expect(defaultDomainValidate("acme")).toMatch(/valid domain/i);
  });
});

describe("TagInput", () => {
  it("renders one chip per value", () => {
    render(
      <TagInput
        label="Email domains"
        value={["acme.com", "globex.io"]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("acme.com")).toBeInTheDocument();
    expect(screen.getByText("globex.io")).toBeInTheDocument();
  });

  it("adds a tag on Enter", () => {
    const onChange = vi.fn<(next: string[]) => void>();
    render(<TagInput label="Email domains" value={[]} onChange={onChange} />);
    const input = screen.getByRole("textbox", { name: /email domains/i });
    fireEvent.change(input, { target: { value: "acme.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["acme.com"]);
  });

  it("removes the last tag on Backspace when the input is empty", () => {
    const onChange = vi.fn<(next: string[]) => void>();
    render(
      <TagInput
        label="Email domains"
        value={["acme.com", "globex.io"]}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("textbox", { name: /email domains/i });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenCalledWith(["acme.com"]);
  });

  it("blocks invalid tags and shows an error", () => {
    const onChange = vi.fn<(next: string[]) => void>();
    render(
      <TagInput
        label="Email domains"
        value={[]}
        onChange={onChange}
        validate={defaultDomainValidate}
      />,
    );
    const input = screen.getByRole("textbox", { name: /email domains/i });
    fireEvent.change(input, { target: { value: "bogus" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/valid domain/i);
  });

  it("serializes values into a hidden field with the configured separator", () => {
    const { container } = render(
      <TagInput
        label="Email domains"
        name="emailDomains"
        value={["acme.com", "globex.io"]}
        onChange={() => {}}
      />,
    );
    const hidden = container.querySelector(
      "input[type='hidden'][name='emailDomains']",
    ) as HTMLInputElement;
    expect(hidden.value).toBe("acme.com globex.io");
  });
});
