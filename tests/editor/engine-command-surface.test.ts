// @vitest-environment jsdom
/**
 * Command-surface SPI — the flat-surface projector `resolveCommandList` (docs/024 §10).
 *
 * Proves the *model*, not pixels: the context menu / selection flyout / slash menu are
 * pure projections of `resolveCommandList(surface, ctx)`, so a surface's contents are
 * asserted by calling it. Covers by-kind registry projection, surface participation,
 * scope contributions (the table folds its ops in via `contributeCommands`), the slash
 * filter, and `COMMAND_GROUP_ORDER`. The DOM/coordination concerns (one-of-each,
 * geometry, keyboard) are e2e.
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
  buildCommandContext,
  COMMAND_GROUP_ORDER,
  resolveCommandList,
  registerBuiltInBlockTypes,
  type CommandContext,
  type CommandSurface,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import {
  detectSlashTrigger,
  filterSlashItems,
  registerBuiltInCommands,
} from "../../packages/editor/src/view/chrome";

beforeAll(() => {
  registerBuiltInMarks();
  registerBuiltInBlockTypes();
  registerBuiltInNodeViews();
  registerBuiltInCommands();
});

const CAPS: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: false,
  review: false,
};

/** A real store with one paragraph; optional caret/selection. */
function paragraphStore(text: string): { store: EditorStore; id: NodeId } {
  const allocator = createIdAllocator("idco_client_cmd_surface");
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
  return { id: node.id, store };
}

function caretAt(store: EditorStore, id: NodeId, offset: number): void {
  const node = store.requireTextNode(id);
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(id, node.content, offset),
      focus: pointAtOffset(id, node.content, offset),
      type: "text",
    },
    steps: [],
  });
}

function selectRange(
  store: EditorStore,
  id: NodeId,
  from: number,
  to: number,
): void {
  const node = store.requireTextNode(id);
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(id, node.content, from),
      focus: pointAtOffset(id, node.content, to),
      type: "text",
    },
    steps: [],
  });
}

function ctxFor(store: EditorStore): CommandContext {
  return buildCommandContext(store, CAPS);
}

function groupsOf(
  surface: Exclude<CommandSurface, "ribbon">,
  store: EditorStore,
) {
  return resolveCommandList(surface, ctxFor(store)).map((g) => g.group);
}

function idsOf(surface: Exclude<CommandSurface, "ribbon">, store: EditorStore) {
  return resolveCommandList(surface, ctxFor(store)).flatMap((g) =>
    g.items.map((i) => i.id),
  );
}

describe("resolveCommandList — context menu (docs/024 §5.5/§7.1)", () => {
  it("a collapsed caret shows edit + blockStyle + annotate, not inlineFormat", () => {
    const { store, id } = paragraphStore("hello world");
    caretAt(store, id, 0);
    const groups = groupsOf("contextMenu", store);
    expect(groups).toContain("edit");
    expect(groups).toContain("blockStyle");
    expect(groups).toContain("annotate");
    expect(groups).not.toContain("inlineFormat");
  });

  it("a non-collapsed selection adds the inlineFormat (marks) group", () => {
    const { store, id } = paragraphStore("hello world");
    selectRange(store, id, 0, 5);
    expect(groupsOf("contextMenu", store)).toContain("inlineFormat");
    expect(idsOf("contextMenu", store)).toContain("mark:bold");
  });

  it("the edit-ops are present and resolve in COMMAND_GROUP_ORDER (edit first)", () => {
    const { store, id } = paragraphStore("x");
    caretAt(store, id, 0);
    const ids = idsOf("contextMenu", store);
    expect(ids).toContain("edit.cut");
    expect(ids).toContain("edit.paste");
    const groups = groupsOf("contextMenu", store);
    // Groups appear in COMMAND_GROUP_ORDER; `edit` precedes `blockStyle`.
    const order = groups.map((g) => COMMAND_GROUP_ORDER.indexOf(g));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(groups[0]).toBe("edit");
  });

  it("a disabled-by-selection command is present but flagged disabled", () => {
    const { store, id } = paragraphStore("x");
    caretAt(store, id, 0);
    const cut = resolveCommandList("contextMenu", ctxFor(store))
      .flatMap((g) => g.items)
      .find((i) => i.id === "edit.cut")!;
    expect(cut.disabled).toBe(true); // no selection
  });
});

describe("resolveCommandList — surface participation (docs/024 §6.3)", () => {
  it("the flyout shows edit (clipboard) + inlineFormat + annotate, never blockStyle/insert", () => {
    // docs/029 R1-D: clipboard (copy/cut/paste, the `edit` group) now projects onto the
    // selection surface too, so the one merged bar carries clipboard + format + annotate
    // (the merge that replaces the touch-only clipboard toolbar). blockStyle/insert stay off
    // the selection bar (they are slash/turn-into affordances).
    const { store, id } = paragraphStore("hello world");
    selectRange(store, id, 0, 5);
    const groups = groupsOf("flyout", store);
    expect(groups).toContain("edit");
    expect(groups).toContain("inlineFormat");
    expect(groups).toContain("annotate");
    expect(groups).not.toContain("blockStyle");
    expect(groups).not.toContain("insert");
  });

  it("the slash menu shows blockStyle + insert, never inlineFormat/edit", () => {
    const { store, id } = paragraphStore("");
    caretAt(store, id, 0);
    const groups = groupsOf("slash", store);
    expect(groups).toContain("blockStyle");
    expect(groups).toContain("insert");
    expect(groups).not.toContain("inlineFormat");
    expect(groups).not.toContain("edit");
    // The Table projects as a generic structural insert (default 3×3, not the picker).
    expect(idsOf("slash", store)).toContain("insert:table");
  });
});

function tableCellLeaf(store: EditorStore): NodeId {
  const tableId = store.order.find((n) => store.getNode(n)?.type === "table");
  if (!tableId) throw new Error("no table");
  const table = store.getNode(tableId) as StructuralNode;
  const row = store.getNode(table.children[0]!) as StructuralNode;
  const cell = store.getNode(row.children[0]!) as StructuralNode;
  const leaf = cell.children[0]!;
  if (store.getNode(leaf)?.kind !== "text") throw new Error("no cell leaf");
  return leaf;
}

describe("resolveCommandList — scope contributions (docs/024 §5.3/§7.4)", () => {
  it("a caret in a table cell surfaces the structure group (cell + table ops)", () => {
    const { store, id } = paragraphStore("intro");
    caretAt(store, id, 5);
    store.command({ structuralType: "table", type: "insert-structural" });
    caretAt(store, tableCellLeaf(store), 0);
    const ids = idsOf("contextMenu", store);
    expect(groupsOf("contextMenu", store)).toContain("structure");
    expect(ids).toContain("table.row-above");
    expect(ids).toContain("table.col-left");
    expect(ids).toContain("table.fill");
  });

  it("the structure group disappears when the caret leaves the table", () => {
    const { store, id } = paragraphStore("intro");
    caretAt(store, id, 5);
    store.command({ structuralType: "table", type: "insert-structural" });
    caretAt(store, id, 0); // back in the body paragraph
    expect(groupsOf("contextMenu", store)).not.toContain("structure");
  });

  it("a node selection on an object surfaces its object-group commands", () => {
    const { store, id } = paragraphStore("intro");
    caretAt(store, id, 5);
    store.command({
      data: { alt: "", caption: "", src: "" },
      objectType: "media",
      type: "insert-object",
    });
    const objectId = store.order.find(
      (n) => store.getNode(n)?.kind === "object",
    )!;
    store.dispatch({
      origin: "local",
      selectionAfter: { node: objectId, type: "node" },
      steps: [],
    });
    // The object scope is the innermost scope (an object never appears in scopePath),
    // so its `contributeCommands` run (docs/024 §5.3/§5.4).
    expect(groupsOf("contextMenu", store)).toContain("object");
    expect(idsOf("contextMenu", store)).toContain("media.remove");
  });
});

describe("slash filter (docs/024 §7.3)", () => {
  it("filters by label/keywords; empty query returns the full list", () => {
    const { store, id } = paragraphStore("");
    caretAt(store, id, 0);
    const items = resolveCommandList("slash", ctxFor(store)).flatMap(
      (g) => g.items,
    );
    expect(filterSlashItems(items, "")).toHaveLength(items.length);
    const tableMatch = filterSlashItems(items, "grid"); // a Table keyword
    expect(tableMatch.some((i) => i.id === "insert:table")).toBe(true);
    expect(filterSlashItems(items, "zzzznope")).toHaveLength(0);
  });
});

describe("slash trigger detection (docs/024 §7.3/§9)", () => {
  it("detects `/` at the start of a leaf and reads the query", () => {
    const { store, id } = paragraphStore("/tab");
    caretAt(store, id, 4);
    const trigger = detectSlashTrigger(store)!;
    expect(trigger.leafId).toBe(id);
    expect(trigger.slashPos).toBe(0);
    expect(trigger.query).toBe("tab");
  });

  it("detects `/` after whitespace but not mid-word", () => {
    const after = paragraphStore("hi /x");
    caretAt(after.store, after.id, 5);
    expect(detectSlashTrigger(after.store)?.query).toBe("x");

    const midWord = paragraphStore("a/x");
    caretAt(midWord.store, midWord.id, 3);
    expect(detectSlashTrigger(midWord.store)).toBeNull();
  });

  it("returns null when the token breaks (a space after the query)", () => {
    const { store, id } = paragraphStore("/tab ");
    caretAt(store, id, 5);
    expect(detectSlashTrigger(store)).toBeNull();
  });
});
