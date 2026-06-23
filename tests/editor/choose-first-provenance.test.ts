/**
 * docs/026 §7.1 / §9 / §14.8 / §14.10 / RB-12 + RB-13 — choose-first insertion and
 * provenance gating.
 *
 * Provenance: a reference block whose source is not registered is hidden from the
 * insert affordance (a registry lookup, not a feature flag). Choose-first: a
 * reference block inserted from the menu opens its picker immediately and rolls the
 * insert back (via undo — the insert is its own history entry) if it is dismissed
 * before a record is picked, so a cancelled insert leaves no orphan; a block that
 * did pick keeps its committed insert.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type NodeId,
} from "../../packages/editor/src/core";
import {
  buildCommandContext,
  resolveCommandList,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import {
  listDataSources,
  registerDataSource,
  unregisterDataSource,
} from "../../packages/editor/src/view/spi/data-source-registry";

const CAPS: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: true,
  review: false,
};

beforeAll(() => registerBuiltInNodeViews());

afterEach(() => {
  for (const source of listDataSources()) unregisterDataSource(source.id);
});

function makeStore(): EditorStore {
  const allocator = createIdAllocator("idco_client_p5_test");
  const para = makeTextNode({
    content: allocator.createTextSlice("x"),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const store = createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [para.id]: para }, order: [para.id] },
      settings: {},
      version: 1,
    },
  });
  // Place a caret so an object insert resolves a positional insertion point.
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(para.id, para.content, 1),
      focus: pointAtOffset(para.id, para.content, 1),
      type: "text",
    },
    steps: [],
  });
  return store;
}

function insertIds(store: EditorStore): string[] {
  return resolveCommandList("slash", buildCommandContext(store, CAPS)).flatMap(
    (group) => group.items.map((item) => item.id),
  );
}

function insertReference(store: EditorStore): NodeId {
  store.command({
    data: { ref: "", snapshot: {} },
    objectType: "post-ref",
    type: "insert-object",
  });
  const sel = store.selection;
  if (sel?.type !== "node") throw new Error("expected a node selection");
  store.beginProvisionalInsert(sel.node);
  return sel.node;
}

describe("provenance gating (docs/026 §9)", () => {
  it("hides reference blocks whose source is not registered", () => {
    const ids = insertIds(makeStore());
    expect(ids).not.toContain("insert:post-ref");
    expect(ids).not.toContain("insert:media");
  });

  it("shows a reference block once its source is registered", () => {
    registerDataSource({ id: "posts", load: { items: [], mode: "sync" } });
    const ids = insertIds(makeStore());
    expect(ids).toContain("insert:post-ref");
    // media's source is still absent, so it stays hidden.
    expect(ids).not.toContain("insert:media");
  });
});

describe("choose-first rollback (docs/026 §7.1)", () => {
  it("removes a provisional reference block dismissed before picking", () => {
    registerDataSource({ id: "posts", load: { items: [], mode: "sync" } });
    const store = makeStore();
    const id = insertReference(store);
    expect(store.getNode(id)?.type).toBe("post-ref");
    expect(store.activeObjectId).toBe(id);
    // Dismiss without picking -> the insert rolls back.
    store.deactivateObject(id);
    expect(store.getNode(id)).toBeUndefined();
  });

  it("keeps a provisional reference block once a record is picked", () => {
    registerDataSource({ id: "posts", load: { items: [], mode: "sync" } });
    const store = makeStore();
    const id = insertReference(store);
    store.command({
      data: { ref: "post-1", snapshot: { title: "Picked" } },
      node: id,
      type: "set-object-data",
    });
    store.deactivateObject(id);
    const node = store.getNode(id);
    expect(node?.kind === "object" && (node.data as { ref: string }).ref).toBe(
      "post-1",
    );
  });
});
