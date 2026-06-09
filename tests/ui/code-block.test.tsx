// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, CodeBlock } from "@idco/ui";

describe("CodeBlock", () => {
  it("renders preformatted code with the default scroll height", () => {
    render(<CodeBlock value={'{\n  "kid": "abc"\n}'} />);
    const code = screen.getByText(/"kid"/i);
    expect(code.tagName.toLowerCase()).toBe("code");
    expect(code.closest("pre")).toHaveClass("whitespace-pre", "max-h-72");
  });

  it("renders a label and action", () => {
    render(
      <CodeBlock
        label="Public JWK"
        value="{}"
        action={<Button variant="secondary">Copy</Button>}
      />,
    );
    expect(screen.getByText("Public JWK")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("supports compact height", () => {
    render(<CodeBlock value="short" maxHeight="sm" />);
    expect(screen.getByText("short").closest("pre")).toHaveClass("max-h-40");
  });
});
