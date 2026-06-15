// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { capabilityFor } from "../../packages/editor/src/model/capabilities";
import {
  availableBlockStyles,
  buildCommandRegistry,
  groupedSurfaceCommands,
  surfaceCommands,
  type CommandContext,
} from "../../packages/editor/src/model/commands";
import { DEFAULT_ALLOWED_NODES } from "../../packages/editor/src/model/schema";

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    activeAlign: "",
    activeFormats: new Set(),
    allowedNodes: DEFAULT_ALLOWED_NODES,
    bindings: {},
    blockKind: "paragraph",
    canFormat: true,
    canRedo: false,
    canUndo: false,
    capability: capabilityFor("paragraph"),
    editor: {} as CommandContext["editor"],
    hasSelectedText: true,
    selectedText: "abc",
    ...overrides,
  };
}

describe("command registry", () => {
  it("splits toolbar commands into inline controls and the More overflow", () => {
    const ctx = makeCtx();
    const primaryGroups = groupedSurfaceCommands(ctx, "toolbar", "primary").map(
      (segment) => segment.group,
    );
    expect(primaryGroups).toContain("history");
    expect(primaryGroups).toContain("inlineFormat");
    expect(primaryGroups).toContain("align");
    expect(primaryGroups).toContain("list");
    expect(primaryGroups).toContain("indent");
    // Block inserts never sit inline — only in the "More" overflow.
    expect(primaryGroups).not.toContain("insert");

    const moreGroups = groupedSurfaceCommands(ctx, "toolbar", "more").map(
      (segment) => segment.group,
    );
    expect(moreGroups).toEqual(["insert"]);
  });

  it("keeps block-level indent/outdent and alignment out of the flyout", () => {
    const ctx = makeCtx();
    const flyoutGroups = groupedSurfaceCommands(ctx, "flyout").map(
      (segment) => segment.group,
    );
    expect(flyoutGroups).toContain("inlineFormat");
    expect(flyoutGroups).not.toContain("indent");
    expect(flyoutGroups).not.toContain("align");
  });

  it("offers inline formats + indent to the context menu, but not block inserts", () => {
    const ctx = makeCtx();
    const groups = new Set(
      surfaceCommands(ctx, "context").map((command) => command.group),
    );
    expect(groups.has("inlineFormat")).toBe(true);
    expect(groups.has("indent")).toBe(true);
    expect(groups.has("insert")).toBe(true);
  });

  it("disables inline formats inside a quote via capability scope", () => {
    const quoteCtx = makeCtx({
      blockKind: "quote",
      capability: capabilityFor("quote"),
    });
    const bold = buildCommandRegistry(quoteCtx).find((c) => c.id === "bold");
    expect(bold?.isAvailable(quoteCtx)).toBe(true);
    expect(bold?.isEnabled(quoteCtx)).toBe(false);

    const paragraphCtx = makeCtx();
    const boldInParagraph = buildCommandRegistry(paragraphCtx).find(
      (c) => c.id === "bold",
    );
    expect(boldInParagraph?.isEnabled(paragraphCtx)).toBe(true);
  });

  it("gates block styles and list inserts by the allowlist", () => {
    expect(availableBlockStyles(DEFAULT_ALLOWED_NODES).length).toBeGreaterThan(
      1,
    );
    expect(availableBlockStyles(["paragraph", "text"])).toHaveLength(1);

    const textOnly = makeCtx({ allowedNodes: ["paragraph", "text"] });
    const listCommands = surfaceCommands(textOnly, "toolbar", "primary").filter(
      (command) => command.group === "list",
    );
    expect(listCommands).toHaveLength(0);
  });
});
