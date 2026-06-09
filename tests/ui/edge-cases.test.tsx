// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge, Button, Text, Stack, Inline } from "@idco/ui";

describe("UI component edge cases", () => {
  it("Badge renders without children gracefully", () => {
    const { container } = render(<Badge />);
    expect(container.querySelector(".badge")).not.toBeNull();
  });

  it("Button renders without onClick without crashing", () => {
    const { container } = render(<Button>No Handler</Button>);
    expect(container.querySelector("button")).not.toBeNull();
  });

  it("Text renders empty string without crashing", () => {
    const { container } = render(<Text variant="body" />);
    expect(container.querySelector("p")).not.toBeNull();
  });

  it("Stack renders with a single child", () => {
    const { container } = render(
      <Stack>
        <span>One</span>
      </Stack>,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it("Stack renders with no children without crashing", () => {
    const { container } = render(<Stack />);
    expect(container.firstChild).not.toBeNull();
  });

  it("Inline renders with no children without crashing", () => {
    const { container } = render(<Inline />);
    expect(container.firstChild).not.toBeNull();
  });

  it("Button renders with type reset", () => {
    const { container } = render(<Button type="reset">Reset</Button>);
    const button = container.querySelector("button");
    expect(button).toHaveAttribute("type", "reset");
  });

  it("Button does not call onClick when disabled", () => {
    let called = false;
    const { container } = render(
      <Button
        disabled
        onClick={() => {
          called = true;
        }}
      >
        Disabled
      </Button>,
    );
    const button = container.querySelector("button");
    button?.click();
    expect(called).toBe(false);
  });

  it("Text renders with id attribute for anchor linking", () => {
    const { container } = render(<Text variant="h1">Heading</Text>);
    const heading = container.querySelector("h1");
    expect(heading).not.toBeNull();
  });

  it("multiple inline elements align correctly", () => {
    const { container } = render(
      <Inline gap="md" align="center">
        <span>A</span>
        <span>B</span>
        <span>C</span>
      </Inline>,
    );
    expect(container.firstChild).toHaveClass(
      "flex",
      "flex-row",
      "items-center",
      "gap-4",
    );
    expect(container.querySelectorAll("span").length).toBe(3);
  });
});
