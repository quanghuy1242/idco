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

  it("surfaces an error and applies the error class", () => {
    render(
      <CodeEditor
        value="{"
        onChange={() => {}}
        label="Metadata"
        error="Invalid JSON"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid JSON");
    expect(screen.getByRole("textbox", { name: /metadata/i })).toHaveClass(
      "textarea-error",
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
});
