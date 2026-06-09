// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { JsonViewer } from "@idco/ui";

describe("JsonViewer", () => {
  it("renders and highlights an object value", () => {
    const { container } = render(
      <JsonViewer value={{ name: "Content API", count: 3, active: true }} />,
    );
    expect(screen.getByText(/Content API/)).toBeInTheDocument();
    // keys highlighted as info, strings as success, numbers as warning, booleans as secondary
    expect(container.querySelector(".text-info")).toBeInTheDocument();
    expect(container.querySelector(".text-warning")).toBeInTheDocument();
    expect(container.querySelector(".text-secondary")).toBeInTheDocument();
  });

  it("pretty-prints a JSON string value", () => {
    render(<JsonViewer value='{"a":1}' />);
    expect(screen.getByText(/"a"/)).toBeInTheDocument();
  });

  it("falls back to raw text for invalid JSON strings", () => {
    render(<JsonViewer value="not json" />);
    expect(screen.getByText(/not json/)).toBeInTheDocument();
  });

  it("renders a label and an action slot", () => {
    render(
      <JsonViewer
        value={{ a: 1 }}
        label="Public JWK"
        action={<button>Copy</button>}
      />,
    );
    expect(screen.getByText("Public JWK")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("contains wide payloads within the parent width", () => {
    const { container } = render(
      <JsonViewer value={{ token: "x".repeat(200) }} />,
    );
    expect(container.firstElementChild).toHaveClass(
      "w-full",
      "min-w-0",
      "max-w-full",
      "overflow-hidden",
    );
    expect(container.querySelector("pre")).toHaveClass(
      "overflow-auto",
      "whitespace-pre",
    );
  });
});
