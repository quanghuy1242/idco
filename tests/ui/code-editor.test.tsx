// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodeEditor } from "@idco/ui";

describe("CodeEditor", () => {
  it("renders a textarea with the value", () => {
    render(<CodeEditor value='{"a":1}' onChange={() => {}} label="Metadata" />);
    expect(screen.getByRole("textbox", { name: /metadata/i })).toHaveValue(
      '{"a":1}',
    );
  });

  it("emits onChange when edited", () => {
    const onChange = vi.fn<(v: string) => void>();
    render(<CodeEditor value="" onChange={onChange} label="Metadata" />);
    fireEvent.change(screen.getByRole("textbox", { name: /metadata/i }), {
      target: { value: "{}" },
    });
    expect(onChange).toHaveBeenCalledWith("{}");
  });

  it("surfaces an error and flags the editor as invalid", () => {
    render(
      <CodeEditor
        value="{"
        onChange={() => {}}
        label="Metadata"
        error="Invalid JSON"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid JSON");
    expect(screen.getByRole("textbox", { name: /metadata/i })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("respects readOnly", () => {
    render(
      <CodeEditor value="{}" onChange={() => {}} label="Metadata" readOnly />,
    );
    expect(screen.getByRole("textbox", { name: /metadata/i })).toHaveAttribute(
      "readonly",
    );
  });

  it("passes a name through for form posts", () => {
    render(
      <CodeEditor
        value="{}"
        onChange={() => {}}
        label="Metadata"
        name="metadata"
        placeholder='{"a":1}'
      />,
    );
    expect(screen.getByRole("textbox", { name: /metadata/i })).toHaveAttribute(
      "name",
      "metadata",
    );
    expect(screen.getByRole("textbox", { name: /metadata/i })).toHaveAttribute(
      "placeholder",
      '{"a":1}',
    );
  });

  it("highlights the value inline with Prism tokens", () => {
    const { container } = render(
      <CodeEditor
        value="const value = true;"
        onChange={() => {}}
        label="Snippet"
        language="ts"
      />,
    );
    expect(container.querySelector("pre code .token.keyword")).not.toBeNull();
  });

  it("renders a line-number gutter for each line", () => {
    const { container } = render(
      <CodeEditor
        value={"a\nb\nc"}
        onChange={() => {}}
        label="Snippet"
        language="text"
      />,
    );
    const gutter = container.querySelector(".tabular-nums");
    expect(gutter?.textContent).toBe("123");
  });

  it("inserts spaces on Tab instead of moving focus", () => {
    const onChange = vi.fn<(v: string) => void>();
    render(<CodeEditor value="x" onChange={onChange} label="Snippet" />);
    const textarea = screen.getByRole("textbox", { name: /snippet/i });
    textarea.focus();
    (textarea as HTMLTextAreaElement).setSelectionRange(1, 1);
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(onChange).toHaveBeenCalledWith("x  ");
  });
});
