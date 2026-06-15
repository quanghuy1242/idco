import { describe, expect, it } from "vitest";
import { shouldSelectionFlyoutCloseOnInteractOutside } from "../../packages/editor/src/plugins/selection-flyout-plugin";

function fixture() {
  document.body.innerHTML = `
    <div data-editor-selection-flyout>
      <button id="root-trigger">Root trigger</button>
    </div>
    <div data-editor-selection-action-popover>
      <button id="child-popover">Child popover</button>
    </div>
    <div role="menu">
      <button id="child-menu">Child menu</button>
    </div>
    <button id="outside">Outside</button>
  `;
  return {
    childMenu: document.getElementById("child-menu")!,
    childPopover: document.getElementById("child-popover")!,
    outside: document.getElementById("outside")!,
    rootTrigger: document.getElementById("root-trigger")!,
  };
}

describe("selection flyout outside interactions", () => {
  it("keeps the parent open when a child overlay folds back to the root flyout", () => {
    const { rootTrigger } = fixture();

    expect(
      shouldSelectionFlyoutCloseOnInteractOutside(rootTrigger, {
        childOverlayClosing: false,
        childOverlayOpen: true,
      }),
    ).toBe(false);
  });

  it("keeps the parent open for child popovers and menus", () => {
    const { childMenu, childPopover } = fixture();

    for (const element of [childPopover, childMenu]) {
      expect(
        shouldSelectionFlyoutCloseOnInteractOutside(element, {
          childOverlayClosing: false,
          childOverlayOpen: false,
        }),
      ).toBe(false);
    }
  });

  it("dismisses the parent on true outside interactions", () => {
    const { outside } = fixture();

    expect(
      shouldSelectionFlyoutCloseOnInteractOutside(outside, {
        childOverlayClosing: false,
        childOverlayOpen: false,
      }),
    ).toBe(true);
    expect(
      shouldSelectionFlyoutCloseOnInteractOutside(outside, {
        childOverlayClosing: true,
        childOverlayOpen: false,
      }),
    ).toBe(true);
  });
});
