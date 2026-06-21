/**
 * Block-type registry tests (note.md W5 / C3).
 *
 * The registry is the single source for the block-type chooser (toolbar + context
 * menu, deduped in W6) and the aria role read by `selection-overlay`. These lock
 * the contract: the chooser set + order, the stable ids, the aria-role mapping,
 * and that a host can register a new block type without editing chrome.
 */
import { describe, expect, it } from "vitest";
import {
  blockTypeKey,
  blockTypeRole,
  getBlockType,
  listBlockTypes,
  registerBlockType,
} from "../../packages/editor/src/view/block-type-registry";

describe("block-type registry (view SPI, note.md W5)", () => {
  it("exposes the six chooser entries in order, list item excluded", () => {
    const chooser = listBlockTypes().filter((entry) => entry.chooser);
    expect(chooser.map((entry) => entry.id)).toEqual([
      "paragraph:",
      "heading:h1",
      "heading:h2",
      "heading:h3",
      "heading:h4",
      "quote:",
    ]);
    // The list item is registered (for aria) but is not a chooser entry.
    expect(getBlockType(blockTypeKey("listitem"))?.chooser).toBeUndefined();
    expect(getBlockType(blockTypeKey("listitem"))).toBeDefined();
  });

  it("keys entries by `${blockType}:${tag}` independent of order", () => {
    expect(getBlockType("heading:h3")?.label).toBe("Heading 3");
    expect(getBlockType("heading:h3")?.tag).toBe("h3");
    expect(getBlockType(blockTypeKey("paragraph"))?.label).toBe("Paragraph");
  });

  it("maps each text-leaf type to its aria role", () => {
    expect(blockTypeRole("heading")).toBe("Heading");
    expect(blockTypeRole("listitem")).toBe("List item");
    expect(blockTypeRole("quote")).toBe("Quote");
    expect(blockTypeRole("paragraph")).toBe("Paragraph");
  });

  it("lets a host register a new block type without editing chrome", () => {
    // Registered render/aria-only (no `chooser`) on purpose: the registry is a
    // shared module singleton with no unregister, so adding a chooser entry here
    // would leak a phantom item into the toolbar set that W6 reads via
    // `filter((b) => b.chooser)`. This mirrors W4's render-only custom-mark test.
    registerBlockType({
      ariaRole: "Heading",
      blockType: "heading",
      icon: "Heading5",
      id: blockTypeKey("heading", "h5"),
      label: "Heading 5",
      tag: "h5",
    });
    expect(getBlockType("heading:h5")?.label).toBe("Heading 5");
    expect(listBlockTypes().some((entry) => entry.id === "heading:h5")).toBe(
      true,
    );
  });
});
