// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponsiveActions } from "@idco/ui";

const originalResizeObserver = globalThis.ResizeObserver;
const originalMatchMedia = window.matchMedia;
const clientWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientWidth",
);
const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);
const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollWidth",
);
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;
let measuredContainerWidth: number | (() => number) = 0;

function currentContainerWidth() {
  return typeof measuredContainerWidth === "function"
    ? measuredContainerWidth()
    : measuredContainerWidth;
}

function getMockBoundingClientRect(this: HTMLElement): DOMRect {
  if (
    this.hasAttribute?.("data-responsive-action") ||
    this.hasAttribute?.("data-responsive-measure-action")
  ) {
    return {
      x: 0,
      y: 0,
      width: 80,
      height: 32,
      top: 0,
      right: 80,
      bottom: 32,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
  if (
    this.hasAttribute?.("data-responsive-menu") ||
    this.hasAttribute?.("data-responsive-measure-menu")
  ) {
    return {
      x: 0,
      y: 0,
      width: 40,
      height: 32,
      top: 0,
      right: 40,
      bottom: 32,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
  if (this.querySelector?.("[data-responsive-action]")) {
    const width = currentContainerWidth();
    return {
      x: 0,
      y: 0,
      width,
      height: 32,
      top: 0,
      right: width,
      bottom: 32,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect;
  }
  return originalGetBoundingClientRect.call(this);
}

function pressTrigger(button: HTMLElement) {
  button.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
  );
  button.dispatchEvent(
    new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }),
  );
  fireEvent.click(button);
}

function mockMeasuredContainer(width: number | (() => number)) {
  measuredContainerWidth = width;

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
      return element.querySelector("[data-responsive-action]")
        ? currentContainerWidth()
        : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      const element = this as HTMLElement;
      if (
        element.hasAttribute("data-responsive-action") ||
        element.hasAttribute("data-responsive-measure-action")
      )
        return 80;
      if (
        element.hasAttribute("data-responsive-menu") ||
        element.hasAttribute("data-responsive-measure-menu")
      )
        return 40;
      return 0;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = getMockBoundingClientRect;
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get() {
      const element = this as HTMLElement;
      if (!element.querySelector("[data-responsive-action]")) return 0;
      const directActions = Array.from(
        element.querySelectorAll<HTMLElement>("[data-responsive-action]"),
      ).filter((el) => el.style.display !== "none").length;
      const menu = element.querySelector<HTMLElement>("[data-responsive-menu]");
      return (
        directActions * 80 + (menu && menu.style.display !== "none" ? 40 : 0)
      );
    },
  });
}

function mockViewport(matches: boolean | (() => boolean)) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn<(query: string) => MediaQueryList>().mockImplementation(
      (query: string) =>
        ({
          get matches() {
            return typeof matches === "function" ? matches() : matches;
          },
          media: query,
          onchange: null,
          addListener:
            vi.fn<
              (
                listener: (
                  this: MediaQueryList,
                  ev: MediaQueryListEvent,
                ) => void,
              ) => void
            >(),
          removeListener:
            vi.fn<
              (
                listener: (
                  this: MediaQueryList,
                  ev: MediaQueryListEvent,
                ) => void,
              ) => void
            >(),
          addEventListener:
            vi.fn<
              (
                type: string,
                listener: EventListenerOrEventListenerObject | null,
              ) => void
            >(),
          removeEventListener:
            vi.fn<
              (
                type: string,
                listener: EventListenerOrEventListenerObject | null,
              ) => void
            >(),
          dispatchEvent: vi
            .fn<(event: Event) => boolean>()
            .mockReturnValue(false),
        }) as MediaQueryList,
    ),
  });
}

afterEach(() => {
  measuredContainerWidth = 0;
  globalThis.ResizeObserver = originalResizeObserver;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  if (clientWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      clientWidthDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  }
  if (offsetWidthDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      offsetWidthDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
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

describe("ResponsiveActions", () => {
  it("renders one visible action directly", () => {
    const onAction = vi.fn<() => void>();
    render(
      <ResponsiveActions
        actions={[{ id: "edit", label: "Edit Profile", onAction }]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Actions" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit Profile" }).parentElement,
    ).toHaveClass("whitespace-nowrap");
    fireEvent.click(screen.getByRole("button", { name: "Edit Profile" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("collapses trailing actions into a menu when the row overflows", async () => {
    mockMeasuredContainer(120);
    const onDelete = vi.fn<() => void>();
    render(
      <ResponsiveActions
        ariaLabel="User actions"
        actions={[
          { id: "edit", label: "Edit Profile", onAction: vi.fn<() => void>() },
          { id: "role", label: "Set Role", onAction: vi.fn<() => void>() },
          {
            id: "delete",
            label: "Delete User",
            variant: "danger",
            onAction: onDelete,
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "User actions" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete User" })).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Edit Profile" }),
    ).toBeInTheDocument();
    pressTrigger(screen.getByRole("button", { name: "User actions" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete User" }),
    );
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("fully collapses multi-action groups when no direct action fits", async () => {
    mockMeasuredContainer(32);
    const onEdit = vi.fn<() => void>();
    render(
      <ResponsiveActions
        ariaLabel="User actions"
        actions={[
          { id: "edit", label: "Edit Profile", onAction: onEdit },
          {
            id: "delete",
            label: "Delete User",
            variant: "danger",
            onAction: vi.fn<() => void>(),
          },
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "User actions" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
    pressTrigger(screen.getByRole("button", { name: "User actions" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Edit Profile" }),
    );
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("fully collapses multi-action groups on narrow viewports", async () => {
    mockMeasuredContainer(640);
    mockViewport(true);
    const onRole = vi.fn<() => void>();
    render(
      <ResponsiveActions
        ariaLabel="User actions"
        actions={[
          { id: "edit", label: "Edit Profile", onAction: vi.fn<() => void>() },
          { id: "role", label: "Set Role", onAction: onRole },
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "User actions" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
    pressTrigger(screen.getByRole("button", { name: "User actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Set Role" }));
    expect(onRole).toHaveBeenCalledTimes(1);
  });

  it("recalculates when the viewport is resized across the narrow breakpoint", async () => {
    let containerWidth = 640;
    let isNarrow = true;
    mockMeasuredContainer(() => containerWidth);
    mockViewport(() => isNarrow);

    render(
      <ResponsiveActions
        ariaLabel="User actions"
        actions={[
          { id: "edit", label: "Edit Profile", onAction: vi.fn<() => void>() },
          { id: "role", label: "Set Role", onAction: vi.fn<() => void>() },
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "User actions" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();

    isNarrow = false;
    containerWidth = 640;
    window.dispatchEvent(new Event("resize"));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit Profile" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "User actions" })).toBeNull();
  });

  it("recalculates from expanded back to collapsed after resize", async () => {
    let containerWidth = 640;
    mockMeasuredContainer(() => containerWidth);
    mockViewport(false);

    render(
      <ResponsiveActions
        ariaLabel="User actions"
        actions={[
          { id: "edit", label: "Edit Profile", onAction: vi.fn<() => void>() },
          { id: "role", label: "Set Role", onAction: vi.fn<() => void>() },
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit Profile" }),
      ).toBeInTheDocument(),
    );

    containerWidth = 80;
    window.dispatchEvent(new Event("resize"));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "User actions" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
  });
});
