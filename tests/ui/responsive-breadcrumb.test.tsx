// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResponsiveBreadcrumb } from "@idco/ui";

const originalResizeObserver = globalThis.ResizeObserver;
const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth",
);
const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollWidth",
);

function mockMeasuredBreadcrumb(width: number) {
  class TestResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe() {
      this.callback([], this);
    }

    disconnect() {}

    unobserve() {}
  }

  globalThis.ResizeObserver = TestResizeObserver as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      const element = this as HTMLElement;
      return element.getAttribute("aria-label") === "Breadcrumb" ? width : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      const element = this as HTMLElement;
      if (element.tagName !== "OL") return 0;
      const visibleItems = Array.from(
        element.querySelectorAll<HTMLElement>("[data-breadcrumb-item]"),
      ).filter((item) => item.style.display !== "none").length;
      const leadingItem = element.querySelector<HTMLElement>(
        "li:not([data-breadcrumb-item]):not([data-breadcrumb-menu])",
      );
      const collapsedMenu = element.querySelector<HTMLElement>(
        "[data-breadcrumb-menu]",
      );
      const leadingWidth =
        leadingItem && leadingItem.style.display !== "none" ? 110 : 0;
      const menuWidth =
        collapsedMenu && collapsedMenu.style.display !== "none" ? 40 : 0;
      return leadingWidth + menuWidth + visibleItems * 90;
    },
  });
}

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  if (clientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      clientWidthDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  }
  if (scrollWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollWidth",
      scrollWidthDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
  }
});

describe("ResponsiveBreadcrumb", () => {
  it("renders breadcrumb items without a leading selector", () => {
    render(<ResponsiveBreadcrumb items={["Admin", "Dashboard"]} />);

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(breadcrumb).toHaveClass("overflow-hidden");
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show more breadcrumbs" }),
    ).toBeNull();
  });

  it("renders a leading selector as the first breadcrumb item", () => {
    render(
      <ResponsiveBreadcrumb
        leadingItem={<button type="button">Platform</button>}
        items={["Users"]}
      />,
    );

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      screen.getByRole("button", { name: "Platform" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(breadcrumb).toHaveTextContent("Platform/Users");
  });

  it("keeps the leading selector visible while collapsing earlier breadcrumb items", async () => {
    mockMeasuredBreadcrumb(170);
    render(
      <ResponsiveBreadcrumb
        leadingItem={<button type="button">Acme Publishing</button>}
        items={["Identity", "Members"]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Show more breadcrumbs" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Acme Publishing" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("Identity").closest("li")).toHaveStyle({
      display: "none",
    });
  });
});
