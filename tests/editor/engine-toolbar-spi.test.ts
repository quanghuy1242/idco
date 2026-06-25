// @vitest-environment jsdom
/**
 * Ribbon SPI — the tab/slot layout, command registry, capability gating, migration
 * parity, and the parameterized table insert (docs/023 §10, docs/024 §5.8).
 *
 * These prove the ribbon *mechanism*, not pixels (docs/023 §5.5): a feature's
 * appearance is asserted by calling the pure `computeToolbarLayout`, with a fake store
 * for structure and a real store for command dispatch. docs/024 renamed the descriptor
 * (`ToolbarAction → Command`, `surfaces` is now a placement map); the flat-surface
 * resolver (`resolveCommandList`) is covered in `engine-command-surface.test.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type NodeId,
  type StructuralNode,
} from "../../packages/editor/src/core";
import {
  commandTargetsSurface,
  computeToolbarLayout,
  DEFAULT_TOOLBAR_LAYOUT,
  getCommand,
  listCommands,
  registerBuiltInBlockTypes,
  registerCommand,
  registerToolbarSlot,
  registerToolbarTab,
  unregisterCommand,
  unregisterToolbarSlot,
  unregisterToolbarTab,
  type Command,
  type CommandContext,
  type CommandScope,
  type ResolvedToolbarLayout,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { registerBuiltInCommands } from "../../packages/editor/src/view/chrome";

// Populate every registry the layout reads: marks (home.format), block types
// (home.text chooser), node views (the Insert `inserts` projection), and the
// ribbon tabs/slots/commands themselves. All idempotent.
beforeAll(() => {
  registerBuiltInMarks();
  registerBuiltInBlockTypes();
  registerBuiltInNodeViews();
  registerBuiltInCommands();
});

type QueryResult = string | boolean | null;

/** A minimal store stub: the layout only reads `query` + `canUndo`/`canRedo`. */
function fakeStore(
  over: Partial<{
    query: (q: { type: string }) => QueryResult;
    canUndo: boolean;
    canRedo: boolean;
    command: (c: unknown) => void;
    undo: () => void;
    redo: () => void;
  }> = {},
): EditorStore {
  return {
    canRedo: false,
    canUndo: false,
    command: () => {},
    query: (q: { type: string }): QueryResult => {
      switch (q.type) {
        case "is-mark-active":
          return false;
        case "current-list-type":
          return null;
        case "active-link-href":
          return null;
        case "current-block-type":
          return "paragraph";
        default:
          return null;
      }
    },
    redo: () => {},
    undo: () => {},
    ...over,
  } as unknown as EditorStore;
}

// The ribbon resolver does not read `scope`, so a root-scope literal suffices here.
const FAKE_SCOPE: CommandScope = {
  activeObject: null,
  innermost: "body" as NodeId,
  innermostKind: "root",
  path: [],
};

function makeCtx(
  store: EditorStore,
  caps: Partial<ToolbarCapabilities> = {},
): CommandContext {
  return {
    capabilities: {
      ai: false,
      insertTable: true,
      media: false,
      review: false,
      ...caps,
    } as ToolbarCapabilities,
    scope: FAKE_SCOPE,
    selection: {
      activeMarks: new Set(),
      blockType: "paragraph",
      hasSelection: false,
      inObject: false,
      selectedText: "",
    },
    store,
  };
}

function tab(layout: ResolvedToolbarLayout, id: string) {
  return layout.tabs.find((t) => t.id === id);
}

function slotItemIds(
  layout: ResolvedToolbarLayout,
  tabId: string,
  slotId: string,
): string[] {
  const slot = tab(layout, tabId)?.slots.find((s) => s.id === slotId);
  return (slot?.items ?? []).map((item) => item.id);
}

function persistentItemIds(
  layout: ResolvedToolbarLayout,
  side: "start" | "end",
  slotId: string,
): string[] {
  const slots =
    side === "start" ? layout.persistentStart : layout.persistentEnd;
  const slot = slots.find((s) => s.id === slotId);
  return (slot?.items ?? []).map((item) => item.id);
}

/** A real store with one paragraph and the caret at offset 0 (migration tests). */
function realStore(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_toolbar_spi");
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(node.id, node.content, 0),
      focus: pointAtOffset(node.id, node.content, 0),
      type: "text",
    },
    steps: [],
  });
  return { id: node.id, store };
}

/** A real store with one paragraph (the table-insert tests insert at its caret). */
function tableStore(): EditorStore {
  return realStore("intro").store;
}

/** The first table inserted into a store (table-insert tests). */
function insertedTable(store: EditorStore): StructuralNode {
  const id = store.order.find((n) => store.getNode(n)?.type === "table");
  if (!id) throw new Error("no table");
  const node = store.getNode(id);
  if (!node || node.kind !== "structural") throw new Error("not structural");
  return node;
}

describe("ribbon layout — Home + Insert resolve (docs/023 §5.5/§7)", () => {
  it("resolves Home and Insert under first-release capabilities, Home default", () => {
    const layout = computeToolbarLayout(makeCtx(fakeStore()));
    const ids = layout.tabs.map((t) => t.id);
    expect(ids).toContain("home");
    expect(ids).toContain("insert");
    expect(layout.defaultTab).toBe("home");
  });

  it("shows View (Outline) and Review (Insights), drops capability-gated Data/AI", () => {
    const ids = computeToolbarLayout(makeCtx(fakeStore())).tabs.map(
      (t) => t.id,
    );
    // View ships the Outline dock command and Review ships the always-available
    // Insights command (docs/027 §8.2/§9.4), so both resolve non-empty and are
    // registry-driven (§7.7); Data/AI stay capability-gated off.
    expect(ids).toContain("view");
    expect(ids).toContain("review");
    expect(ids).not.toContain("data");
    expect(ids).not.toContain("ai");
  });

  it("orders home.text (block-type) before home.format (marks)", () => {
    const home = tab(computeToolbarLayout(makeCtx(fakeStore())), "home")!;
    const slotIds = home.slots.map((s) => s.id);
    expect(slotIds.indexOf("home.text")).toBeLessThan(
      slotIds.indexOf("home.format"),
    );
  });

  it("renders the block-type chooser as a single control", () => {
    const layout = computeToolbarLayout(makeCtx(fakeStore()));
    const items = tab(layout, "home")!.slots.find(
      (s) => s.id === "home.text",
    )!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("blockType");
  });

  it("places lists/indent and link into their Home slots", () => {
    const layout = computeToolbarLayout(makeCtx(fakeStore()));
    expect(slotItemIds(layout, "home", "home.lists")).toEqual([
      "list-bulleted",
      "list-numbered",
      "list-checklist",
      "outdent",
      "indent",
    ]);
    expect(slotItemIds(layout, "home", "home.annotate")).toEqual(["link"]);
  });

  it("places undo/redo in the persistent start zone, not a tab", () => {
    const layout = computeToolbarLayout(makeCtx(fakeStore()));
    expect(persistentItemIds(layout, "start", "global.history")).toEqual([
      "undo",
      "redo",
    ]);
    expect(layout.tabs.flatMap((t) => t.slots.map((s) => s.id))).not.toContain(
      "global.history",
    );
    // Find is injected by EditorToolbar (its handler is a host prop), so the default
    // layout resolves the persistent end empty.
    expect(layout.persistentEnd).toHaveLength(0);
  });

  it("auto-projects the format marks into home.format", () => {
    const ids = slotItemIds(
      computeToolbarLayout(makeCtx(fakeStore())),
      "home",
      "home.format",
    );
    expect(ids).toContain("mark:bold");
    expect(ids).toContain("mark:italic");
  });
});

describe("ribbon command availability + disabled (docs/023 §5.2)", () => {
  it("removes an unavailable command from the layout entirely", () => {
    registerCommand({
      group: "list",
      icon: "Plus",
      id: "spi-unavailable",
      isAvailable: () => false,
      kind: "button",
      label: "Nope",
      run: () => {},
      slot: "home.lists",
      surfaces: { ribbon: "primary" },
    });
    const ids = slotItemIds(
      computeToolbarLayout(makeCtx(fakeStore())),
      "home",
      "home.lists",
    );
    expect(ids).not.toContain("spi-unavailable");
    unregisterCommand("spi-unavailable");
  });

  it("keeps a disabled command visible but greyed (undo when !canUndo)", () => {
    const off = computeToolbarLayout(
      makeCtx(fakeStore({ canUndo: false })),
    ).persistentStart.find((s) => s.id === "global.history")!;
    const undoOff = off.items.find((i) => i.id === "undo")!;
    expect(undoOff.kind === "action" && undoOff.disabled).toBe(true);

    const on = computeToolbarLayout(
      makeCtx(fakeStore({ canUndo: true })),
    ).persistentStart.find((s) => s.id === "global.history")!;
    const undoOn = on.items.find((i) => i.id === "undo")!;
    expect(undoOn.kind === "action" && undoOn.disabled).toBe(false);
  });
});

describe("command SPI contract (docs/023 §5.2, docs/024 §5.2)", () => {
  it("is idempotent by id (re-register replaces)", () => {
    registerCommand({
      group: "history",
      icon: "Plus",
      id: "spi-dup",
      kind: "button",
      label: "First",
      surfaces: { ribbon: "primary" },
    });
    registerCommand({
      group: "history",
      icon: "Plus",
      id: "spi-dup",
      kind: "button",
      label: "Second",
      surfaces: { ribbon: "primary" },
    });
    expect(getCommand("spi-dup")?.label).toBe("Second");
    expect(listCommands().filter((a) => a.id === "spi-dup")).toHaveLength(1);
    unregisterCommand("spi-dup");
  });

  it("lists commands in registration order", () => {
    registerCommand({
      group: "history",
      icon: "Plus",
      id: "spi-order-a",
      kind: "button",
      label: "A",
      surfaces: { ribbon: "primary" },
    });
    registerCommand({
      group: "history",
      icon: "Plus",
      id: "spi-order-b",
      kind: "button",
      label: "B",
      surfaces: { ribbon: "primary" },
    });
    const ids = listCommands().map((a) => a.id);
    expect(ids.indexOf("spi-order-a")).toBeLessThan(ids.indexOf("spi-order-b"));
    unregisterCommand("spi-order-a");
    unregisterCommand("spi-order-b");
  });

  it("a custom command registered into a ribbon slot appears in the layout", () => {
    registerCommand({
      group: "list",
      icon: "Plus",
      id: "spi-custom",
      kind: "button",
      label: "Custom",
      run: () => {},
      slot: "home.lists",
      surfaces: { ribbon: "primary" },
    });
    expect(
      slotItemIds(
        computeToolbarLayout(makeCtx(fakeStore())),
        "home",
        "home.lists",
      ),
    ).toContain("spi-custom");
    unregisterCommand("spi-custom");
  });

  it("the surfaces map gates ribbon participation; a flyout-only command is excluded", () => {
    const ribbonOnly: Command = {
      group: "indent",
      icon: "Plus",
      id: "spi-ribbon-default",
      kind: "button",
      label: "R",
      slot: "home.lists",
      surfaces: { ribbon: "primary" },
    };
    expect(commandTargetsSurface(ribbonOnly, "ribbon")).toBe(true);
    expect(commandTargetsSurface(ribbonOnly, "flyout")).toBe(false);

    registerCommand({
      group: "inlineFormat",
      icon: "Plus",
      id: "spi-flyout-only",
      kind: "button",
      label: "F",
      run: () => {},
      slot: "home.lists",
      surfaces: { flyout: "primary" },
    });
    expect(
      slotItemIds(
        computeToolbarLayout(makeCtx(fakeStore())),
        "home",
        "home.lists",
      ),
    ).not.toContain("spi-flyout-only");
    unregisterCommand("spi-flyout-only");
  });

  it("run(ctx) fires the expected store command", () => {
    const calls: unknown[] = [];
    const action: Command = {
      group: "indent",
      icon: "Plus",
      id: "spi-run",
      kind: "button",
      label: "Run",
      run: (ctx) => ctx.store.command({ type: "outdent" }),
      slot: "home.lists",
      surfaces: { ribbon: "primary" },
    };
    action.run!(makeCtx(fakeStore({ command: (c) => calls.push(c) })));
    expect(calls).toEqual([{ type: "outdent" }]);
  });
});

describe("ribbon capability gating (docs/023 §5.6)", () => {
  it("removes the Table picker when insertTable is false (Insert survives on blocks)", () => {
    const layout = computeToolbarLayout(
      makeCtx(fakeStore(), { insertTable: false }),
    );
    expect(layout.tabs.map((t) => t.id)).toContain("insert");
    expect(slotItemIds(layout, "insert", "insert.tables")).not.toContain(
      "insert.table",
    );
  });

  it("drops the Insert tab when the table is unavailable and blocks are hidden", () => {
    const layout = computeToolbarLayout(
      makeCtx(fakeStore(), { insertTable: false }),
      {
        ...DEFAULT_TOOLBAR_LAYOUT,
        hiddenIds: ["insert.blocks"],
      },
    );
    expect(layout.tabs.map((t) => t.id)).not.toContain("insert");
  });

  it("gates a host tab on a host-defined capability key", () => {
    registerToolbarTab({
      id: "spi-host-tab",
      isAvailable: (ctx) => ctx.capabilities.myFeature === true,
      label: "Host",
    });
    registerToolbarSlot({ id: "spi-host.s", tab: "spi-host-tab" });
    registerCommand({
      group: "history",
      icon: "Plus",
      id: "spi-host-action",
      kind: "button",
      label: "Host action",
      run: () => {},
      slot: "spi-host.s",
      surfaces: { ribbon: "primary" },
    });

    const off = computeToolbarLayout(makeCtx(fakeStore())).tabs.map(
      (t) => t.id,
    );
    expect(off).not.toContain("spi-host-tab");

    const on = computeToolbarLayout(
      makeCtx(fakeStore(), { myFeature: true }),
    ).tabs.map((t) => t.id);
    expect(on).toContain("spi-host-tab");

    unregisterCommand("spi-host-action");
    unregisterToolbarSlot("spi-host.s");
    unregisterToolbarTab("spi-host-tab");
  });
});

describe("ribbon migration parity (docs/023 §7.3)", () => {
  it("the bulleted command toggles a list item on and back off", () => {
    const { store, id } = realStore("list me");
    const action = getCommand("list-bulleted")!;
    action.run!(makeCtx(store));
    expect(store.requireTextNode(id).type).toBe("listitem");
    action.run!(makeCtx(store));
    expect(store.requireTextNode(id).type).toBe("paragraph");
  });

  it("the numbered command makes a numbered list item", () => {
    const { store, id } = realStore("number me");
    getCommand("list-numbered")!.run!(makeCtx(store));
    expect(store.requireTextNode(id).type).toBe("listitem");
    expect(store.query({ type: "current-list-type" })).toBe("number");
  });

  it("indent/outdent dispatch the same commands as before", () => {
    const indentCalls: unknown[] = [];
    getCommand("indent")!.run!(
      makeCtx(fakeStore({ command: (c) => indentCalls.push(c) })),
    );
    expect(indentCalls).toEqual([{ type: "indent" }]);

    const outdentCalls: unknown[] = [];
    getCommand("outdent")!.run!(
      makeCtx(fakeStore({ command: (c) => outdentCalls.push(c) })),
    );
    expect(outdentCalls).toEqual([{ type: "outdent" }]);
  });

  it("the link command reflects the active link state", () => {
    const link = getCommand("link")!;
    expect(link.kind).toBe("popover");
    expect(
      link.isActive!(makeCtx(fakeStore({ query: () => "https://x.test" }))),
    ).toBe(true);
    expect(link.isActive!(makeCtx(fakeStore()))).toBe(false);
  });
});

describe("parameterized table insert (docs/023 §7.2)", () => {
  it("the table command is a capability-gated popover", () => {
    const action = getCommand("insert.table")!;
    expect(action.kind).toBe("popover");
    expect(
      action.isAvailable!(makeCtx(fakeStore(), { insertTable: false })),
    ).toBe(false);
    expect(
      action.isAvailable!(makeCtx(fakeStore(), { insertTable: true })),
    ).toBe(true);
  });

  it("inserts a table of the chosen rows × cols", () => {
    const store = tableStore();
    store.command({
      params: { cols: 2, rows: 4 },
      structuralType: "table",
      type: "insert-structural",
    });
    const table = insertedTable(store);
    expect(table.children).toHaveLength(4);
    const firstRow = store.getNode(table.children[0]!);
    expect(firstRow?.kind === "structural" && firstRow.children).toHaveLength(
      2,
    );
  });

  it("falls back to the legacy 3×3 default with no params", () => {
    const store = tableStore();
    store.command({ structuralType: "table", type: "insert-structural" });
    const table = insertedTable(store);
    expect(table.children).toHaveLength(3);
    const firstRow = store.getNode(table.children[0]!);
    expect(firstRow?.kind === "structural" && firstRow.children).toHaveLength(
      3,
    );
  });
});

/** The resolved slot object (carries `display` + items with `collapsible`/`disabled`). */
function slotOf(layout: ResolvedToolbarLayout, tabId: string, slotId: string) {
  return tab(layout, tabId)?.slots.find((s) => s.id === slotId);
}

describe("ribbon presentation — slot display + collapse derivation (note.md)", () => {
  it("carries the slot's display onto the resolved slot (default icon)", () => {
    const layout = computeToolbarLayout(makeCtx(fakeStore()));
    // Home format ships no display → defaults to icon; Insert blocks is auto.
    expect(slotOf(layout, "home", "home.format")?.display).toBe("icon");
    expect(slotOf(layout, "insert", "insert.blocks")?.display).toBe("auto");
    expect(slotOf(layout, "insert", "insert.tables")?.display).toBe("labelled");
  });

  it("derives collapsible per kind: marks/inserts are menu-item, chooser/popover keep-inline", () => {
    const layout = computeToolbarLayout(makeCtx(fakeStore()));
    const mark = slotOf(layout, "home", "home.format")?.items[0];
    expect(mark?.collapsible).toBe("menu-item");

    const chooser = slotOf(layout, "home", "home.text")?.items[0];
    expect(chooser?.kind).toBe("blockType");
    expect(chooser?.collapsible).toBe("keep-inline");

    const inserts = slotOf(layout, "insert", "insert.blocks")?.items ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.every((item) => item.collapsible === "menu-item")).toBe(
      true,
    );

    // The Table dimension picker is a popover action → never collapses to a MenuItem.
    const table = slotOf(layout, "insert", "insert.tables")?.items.find(
      (item) => item.id === "insert.table",
    );
    expect(table?.collapsible).toBe("keep-inline");
  });
});

describe("ribbon gating — marks/chooser reflect the selection (note.md §2)", () => {
  function ctxWithBlockType(blockType: string | null): CommandContext {
    const ctx = makeCtx(fakeStore());
    return {
      ...ctx,
      selection: { ...ctx.selection, blockType },
    };
  }

  /** Read the mark + chooser `disabled` flags from a resolved layout, kind-narrowed. */
  function gatingFlags(layout: ResolvedToolbarLayout) {
    const mark = slotOf(layout, "home", "home.format")?.items[0];
    const chooser = slotOf(layout, "home", "home.text")?.items[0];
    expect(mark?.kind).toBe("mark");
    expect(chooser?.kind).toBe("blockType");
    return {
      chooser: chooser?.kind === "blockType" ? chooser.disabled : undefined,
      mark: mark?.kind === "mark" ? mark.disabled : undefined,
    };
  }

  it("enables marks + chooser when the caret is on a text leaf", () => {
    const flags = gatingFlags(
      computeToolbarLayout(ctxWithBlockType("paragraph")),
    );
    expect(flags.mark).toBe(false);
    expect(flags.chooser).toBe(false);
  });

  it("disables marks + chooser when no text leaf is selected (blockType null)", () => {
    const flags = gatingFlags(computeToolbarLayout(ctxWithBlockType(null)));
    expect(flags.mark).toBe(true);
    expect(flags.chooser).toBe(true);
  });
});

describe("ribbon shortcuts — discoverability metadata (note.md §3)", () => {
  it("exposes a shortcut on built-in marks (Bold) and commands (Undo)", () => {
    const layout = computeToolbarLayout(makeCtx(fakeStore()));
    const bold = slotOf(layout, "home", "home.format")?.items.find(
      (item) => item.id === "mark:bold",
    );
    expect(bold?.kind === "mark" && bold.mark.toolbar?.shortcut).toBe(
      "Ctrl/Cmd+B",
    );
    expect(getCommand("undo")?.shortcut).toBe("Ctrl/Cmd+Z");
    expect(getCommand("link")?.shortcut).toBe("Ctrl/Cmd+K");
  });
});
