// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, LinkButton } from "@idco/ui";

describe("Button", () => {
  it("renders with default props", () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole("button", { name: /click me/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "button");
  });

  it("applies primary variant class by default", () => {
    render(<Button>Primary</Button>);
    const button = screen.getByRole("button", { name: /primary/i });
    expect(button).toHaveClass("btn-primary");
    expect(button).not.toHaveClass("btn-sm");
  });

  it("applies secondary variant class", () => {
    render(<Button variant="secondary">Secondary</Button>);
    const button = screen.getByRole("button", { name: /secondary/i });
    expect(button).toHaveClass("btn-outline");
  });

  it("applies danger variant class", () => {
    render(<Button variant="danger">Danger</Button>);
    const button = screen.getByRole("button", { name: /danger/i });
    expect(button).toHaveClass("btn-error");
  });

  it("uses medium size by default", () => {
    render(<Button>Medium</Button>);
    const button = screen.getByRole("button", { name: /medium/i });
    expect(button).not.toHaveClass("btn-sm");
    expect(button).not.toHaveClass("btn-md");
  });

  it("applies sm size when specified", () => {
    render(<Button size="sm">Small</Button>);
    const button = screen.getByRole("button", { name: /small/i });
    expect(button).toHaveClass("btn-sm");
  });

  it("passes through name and value attributes", () => {
    render(
      <Button name="action" value="submit">
        Submit
      </Button>,
    );
    const button = screen.getByRole("button", { name: /submit/i });
    expect(button).toHaveAttribute("name", "action");
    expect(button).toHaveAttribute("value", "submit");
  });

  it("disables the button when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole("button", { name: /disabled/i });
    expect(button).toBeDisabled();
  });

  it("calls onClick when clicked", () => {
    const onClick = vi.fn<() => void>();
    render(<Button onClick={onClick}>Click</Button>);
    screen.getByRole("button", { name: /click/i }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders as submit type when specified", () => {
    render(<Button type="submit">Submit</Button>);
    const button = screen.getByRole("button", { name: /submit/i });
    expect(button).toHaveAttribute("type", "submit");
  });
});

describe("LinkButton", () => {
  it("renders as an anchor element", () => {
    render(<LinkButton href="/test">Link</LinkButton>);
    const link = screen.getByRole("link", { name: /link/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/test");
  });

  it("applies primary variant by default", () => {
    render(<LinkButton href="/test">Primary Link</LinkButton>);
    const link = screen.getByRole("link", { name: /primary link/i });
    expect(link).toHaveClass("btn-primary");
    expect(link).not.toHaveClass("btn-sm");
  });

  it("applies secondary variant when specified", () => {
    render(
      <LinkButton href="/test" variant="secondary">
        Secondary
      </LinkButton>,
    );
    const link = screen.getByRole("link", { name: /secondary/i });
    expect(link).toHaveClass("btn-outline");
  });

  it("applies danger variant when specified", () => {
    render(
      <LinkButton href="/test" variant="danger">
        Danger
      </LinkButton>,
    );
    const link = screen.getByRole("link", { name: /danger/i });
    expect(link).toHaveClass("btn-error");
  });

  it("applies sm size when specified", () => {
    render(
      <LinkButton href="/test" size="sm">
        Small Link
      </LinkButton>,
    );
    const link = screen.getByRole("link", { name: /small link/i });
    expect(link).toHaveClass("btn-sm");
  });

  it("applies hideOnMobile visibility class", () => {
    render(
      <LinkButton href="/test" hideOnMobile>
        Hidden on mobile
      </LinkButton>,
    );
    const link = screen.getByRole("link", { name: /hidden on mobile/i });
    expect(link).toHaveClass("hidden");
    expect(link).toHaveClass("lg:inline-flex");
  });

  it("does not have hideOnMobile class when not set", () => {
    render(<LinkButton href="/test">No hide</LinkButton>);
    const link = screen.getByRole("link", { name: /no hide/i });
    expect(link).not.toHaveClass("hidden");
  });
});

describe("Button visibility props", () => {
  it("hideOnDesktop adds lg:hidden class", () => {
    render(<Button hideOnDesktop>Desktop Hidden</Button>);
    const button = screen.getByRole("button", { name: /desktop hidden/i });
    expect(button).toHaveClass("lg:hidden");
  });

  it("hideOnMobile adds hidden lg:inline-flex classes", () => {
    render(<Button hideOnMobile>Mobile Hidden</Button>);
    const button = screen.getByRole("button", { name: /mobile hidden/i });
    expect(button).toHaveClass("hidden");
    expect(button).toHaveClass("lg:inline-flex");
  });
});

describe("Button circle prop", () => {
  it("adds btn-circle when circle is true", () => {
    render(<Button circle>Circle</Button>);
    const button = screen.getByRole("button", { name: /circle/i });
    expect(button).toHaveClass("btn-circle");
  });

  it("does not auto-apply btn-circle when icon-only without children", () => {
    render(<Button iconName="Plus" ariaLabel="Add" />);
    const button = screen.getByRole("button", { name: /add/i });
    expect(button).not.toHaveClass("btn-circle");
  });

  it("applies btn-circle when both circle and iconName are set", () => {
    render(<Button iconName="Plus" circle ariaLabel="Add" />);
    const button = screen.getByRole("button", { name: /add/i });
    expect(button).toHaveClass("btn-circle");
  });
});

describe("Button square and attached props", () => {
  it("adds btn-square when square is true", () => {
    render(<Button iconName="Plus" square ariaLabel="Add" />);
    const button = screen.getByRole("button", { name: /add/i });
    expect(button).toHaveClass("btn-square");
    expect(button).not.toHaveClass("btn-circle");
  });

  it("removes the left radius when attached on the left side", () => {
    render(<Button iconName="X" square attached="left" ariaLabel="Remove" />);
    const button = screen.getByRole("button", { name: /remove/i });
    expect(button).toHaveClass("rounded-l-none");
    expect(button).toHaveClass("-ml-px");
  });
});
