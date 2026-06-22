// @vitest-environment jsdom
/**
 * Toolbar SPI — the ribbon-lite layout, action registry, capability gating,
 * migration parity, and the parameterized table insert (docs/023 §10).
 *
 * These prove the *mechanism*, not pixels (docs/023 §5.5): a feature's appearance
 * is asserted by calling the pure `computeToolbarLayout`, with a fake store for
 * structure and a real store for command dispatch. The rendered DOM behaviour
 * (Bold/Link/Bulleted clicks, the context menu, find) stays covered by
 * `engine-chrome.test.tsx`; the focus/overlay/keyboard concerns are e2e.
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
  actionTargetsSurface,
  computeToolbarLayout,
  DEFAULT_TOOLBAR_LAYOUT,
  getToolbarAction,
  listToolbarActions,
  registerBuiltInBlockTypes,
  registerToolbarAction,
  registerToolbarSlot,
  registerToolbarTab,
  unregisterToolbarAction,
  unregisterToolbarSlot,
  unregisterToolbarTab,
  type ResolvedToolbarLayout,
  type ToolbarAction,
  type ToolbarActionContext,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { registerBuiltInToolbarActions } from "../../packages/editor/src/view/chrome";

// Populate every registry the layout reads: marks (home.format), block types
// (home.text chooser), node views (the Insert `inserts` projection), and the
// toolbar tabs/slots/actions themselves. All idempotent.
beforeAll(() => {
  registerBuiltInMarks();
  registerBuiltInBlockTypes();
  registerBuiltInNodeViews();
  registerBuiltInToolbarActions();
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

function makeCtx(
  store: EditorStore,
  caps: Partial<ToolbarCapabilities> = {},
): ToolbarActionContext {
  return {
    capabilities: {
      ai: false,
      insertTable: true,
      media: false,
      review: false,
      ...caps,
    } as ToolbarCapabilities,
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

describe("toolbar layout — Home + Insert resolve (docs/023 §5.5/§7)", () => {
  it("resolves Home and Insert under first-release capabilities, Home default", () => {
    const layout = computeToolbarLayout(makeCtx(fakeStore()));
    const ids = layout.tabs.map((t) => t.id);
    expect(ids).toContain("home");
    expect(ids).toContain("insert");
    expect(layout.defaultTab).toBe("home");
  });

  it("drops the empty/capability-gated View/Review/Data/AI tabs", () => {
    const ids = computeToolbarLayout(makeCtx(fakeStore())).tabs.map(
      (t) => t.id,
    );
    expect(ids).not.toContain("view");
    expect(ids).not.toContain("review");
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
    // The persistent zone is tab-independent — global.history never shows in a tab.
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

describe("toolbar action availability + disabled (docs/023 §5.2)", () => {
  it("removes an unavailable action from the layout entirely", () => {
    registerToolbarAction({
      icon: "Plus",
      id: "spi-unavailable",
      isAvailable: () => false,
      kind: "button",
      label: "Nope",
      run: () => {},
      slot: "home.lists",
    });
    const ids = slotItemIds(
      computeToolbarLayout(makeCtx(fakeStore())),
      "home",
      "home.lists",
    );
    expect(ids).not.toContain("spi-unavailable");
    unregisterToolbarAction("spi-unavailable");
  });

  it("keeps a disabled action visible but greyed (undo when !canUndo)", () => {
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

describe("toolbar action SPI contract (docs/023 §5.2/§10)", () => {
  it("is idempotent by id (re-register replaces)", () => {
    registerToolbarAction({
      icon: "Plus",
      id: "spi-dup",
      kind: "button",
      label: "First",
      slot: "home.history",
    });
    registerToolbarAction({
      icon: "Plus",
      id: "spi-dup",
      kind: "button",
      label: "Second",
      slot: "home.history",
    });
    expect(getToolbarAction("spi-dup")?.label).toBe("Second");
    expect(listToolbarActions().filter((a) => a.id === "spi-dup")).toHaveLength(
      1,
    );
    unregisterToolbarAction("spi-dup");
  });

  it("lists actions in registration order", () => {
    registerToolbarAction({
      icon: "Plus",
      id: "spi-order-a",
      kind: "button",
      label: "A",
      slot: "home.history",
    });
    registerToolbarAction({
      icon: "Plus",
      id: "spi-order-b",
      kind: "button",
      label: "B",
      slot: "home.history",
    });
    const ids = listToolbarActions().map((a) => a.id);
    expect(ids.indexOf("spi-order-a")).toBeLessThan(ids.indexOf("spi-order-b"));
    unregisterToolbarAction("spi-order-a");
    unregisterToolbarAction("spi-order-b");
  });

  it("a custom action registered into a slot appears in the layout", () => {
    registerToolbarAction({
      icon: "Plus",
      id: "spi-custom",
      kind: "button",
      label: "Custom",
      run: () => {},
      slot: "home.lists",
    });
    expect(
      slotItemIds(
        computeToolbarLayout(makeCtx(fakeStore())),
        "home",
        "home.lists",
      ),
    ).toContain("spi-custom");
    unregisterToolbarAction("spi-custom");
  });

  it("defaults surfaces to ['ribbon'] and excludes flyout-only actions", () => {
    const ribbonOnly: ToolbarAction = {
      icon: "Plus",
      id: "spi-ribbon-default",
      kind: "button",
      label: "R",
      slot: "home.lists",
    };
    expect(actionTargetsSurface(ribbonOnly, "ribbon")).toBe(true);
    expect(actionTargetsSurface(ribbonOnly, "flyout")).toBe(false);

    registerToolbarAction({
      icon: "Plus",
      id: "spi-flyout-only",
      kind: "button",
      label: "F",
      run: () => {},
      slot: "home.lists",
      surfaces: ["flyout"],
    });
    expect(
      slotItemIds(
        computeToolbarLayout(makeCtx(fakeStore())),
        "home",
        "home.lists",
      ),
    ).not.toContain("spi-flyout-only");
    unregisterToolbarAction("spi-flyout-only");
  });

  it("run(ctx) fires the expected store command", () => {
    const calls: unknown[] = [];
    const action: ToolbarAction = {
      icon: "Plus",
      id: "spi-run",
      kind: "button",
      label: "Run",
      run: (ctx) => ctx.store.command({ type: "outdent" }),
      slot: "home.lists",
    };
    action.run!(makeCtx(fakeStore({ command: (c) => calls.push(c) })));
    expect(calls).toEqual([{ type: "outdent" }]);
  });
});

describe("toolbar capability gating (docs/023 §5.6)", () => {
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
      order: 99,
    });
    registerToolbarSlot({ id: "spi-host.s", order: 0, tab: "spi-host-tab" });
    registerToolbarAction({
      icon: "Plus",
      id: "spi-host-action",
      kind: "button",
      label: "Host action",
      run: () => {},
      slot: "spi-host.s",
    });

    const off = computeToolbarLayout(makeCtx(fakeStore())).tabs.map(
      (t) => t.id,
    );
    expect(off).not.toContain("spi-host-tab");

    const on = computeToolbarLayout(
      makeCtx(fakeStore(), { myFeature: true }),
    ).tabs.map((t) => t.id);
    expect(on).toContain("spi-host-tab");

    unregisterToolbarAction("spi-host-action");
    unregisterToolbarSlot("spi-host.s");
    unregisterToolbarTab("spi-host-tab");
  });
});

describe("toolbar migration parity (docs/023 §7.3)", () => {
  it("the bulleted action toggles a list item on and back off", () => {
    const { store, id } = realStore("list me");
    const action = getToolbarAction("list-bulleted")!;
    action.run!(makeCtx(store));
    expect(store.requireTextNode(id).type).toBe("listitem");
    action.run!(makeCtx(store));
    expect(store.requireTextNode(id).type).toBe("paragraph");
  });

  it("the numbered action makes a numbered list item", () => {
    const { store, id } = realStore("number me");
    getToolbarAction("list-numbered")!.run!(makeCtx(store));
    expect(store.requireTextNode(id).type).toBe("listitem");
    expect(store.query({ type: "current-list-type" })).toBe("number");
  });

  it("indent/outdent dispatch the same commands as before", () => {
    const indentCalls: unknown[] = [];
    getToolbarAction("indent")!.run!(
      makeCtx(fakeStore({ command: (c) => indentCalls.push(c) })),
    );
    expect(indentCalls).toEqual([{ type: "indent" }]);

    const outdentCalls: unknown[] = [];
    getToolbarAction("outdent")!.run!(
      makeCtx(fakeStore({ command: (c) => outdentCalls.push(c) })),
    );
    expect(outdentCalls).toEqual([{ type: "outdent" }]);
  });

  it("the link action reflects the active link state", () => {
    const link = getToolbarAction("link")!;
    expect(link.kind).toBe("popover");
    expect(
      link.isActive!(makeCtx(fakeStore({ query: () => "https://x.test" }))),
    ).toBe(true);
    expect(link.isActive!(makeCtx(fakeStore()))).toBe(false);
  });
});

describe("parameterized table insert (docs/023 §7.2)", () => {
  it("the table action is a capability-gated popover", () => {
    const action = getToolbarAction("insert.table")!;
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
