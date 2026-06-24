// @vitest-environment jsdom
/**
 * Schema profile (note.md item 6) — the per-deployment allowlist of schema *groups*.
 *
 * Two enforcement points over one group set, plus the preservation guarantee:
 *
 *  - `isNodeTypeAllowed` resolves a node type → its group and checks the allowlist; the
 *    table family (`table`/`tablerow`/`tablecell`) shares one group so it toggles
 *    coherently, and the prose floor (paragraph) is ungrouped → always allowed.
 *  - the **palette gate** drops out-of-profile inserts from both the flat surfaces
 *    (`resolveCommandList`) and the ribbon (`computeToolbarLayout`).
 *  - the **quarantine** posture preserves an out-of-profile node already in a loaded
 *    document: the store keeps it untouched and the snapshot round-trips byte-for-byte,
 *    so nothing is deleted (the render swaps in an inert placeholder; the server's Zod
 *    union stays the hard authority).
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeObjectNode,
  makeTextNode,
  pointAtOffset,
  type EditorStore,
  type NodeId,
  type SchemaProfile,
} from "../../packages/editor/src/core";
import {
  buildCommandContext,
  computeToolbarLayout,
  isNodeTypeAllowed,
  registerBuiltInBlockTypes,
  resolveCommandList,
  schemaGroupOf,
  type ResolvedToolbarLayout,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { registerBuiltInCommands } from "../../packages/editor/src/view/chrome";

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

/** A store with one paragraph + caret, optionally carrying a schema profile. */
function paragraphStore(profile?: SchemaProfile): {
  store: EditorStore;
  id: NodeId;
} {
  const allocator = createIdAllocator("idco_client_profile");
  const node = makeTextNode({
    content: allocator.createTextSlice("hello"),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const store = createEditorStore({
    allocator,
    schemaProfile: profile,
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

function slashInsertIds(store: EditorStore): string[] {
  return resolveCommandList("slash", buildCommandContext(store, CAPS)).flatMap(
    (g) => g.items.map((i) => i.id),
  );
}

function ribbonInsertIds(store: EditorStore): string[] {
  const layout: ResolvedToolbarLayout = computeToolbarLayout(
    buildCommandContext(store, CAPS),
  );
  const insert = layout.tabs.find((t) => t.id === "insert");
  return (insert?.slots ?? []).flatMap((s) => s.items.map((i) => i.id));
}

describe("isNodeTypeAllowed / schemaGroupOf", () => {
  it("permits everything when no profile is set", () => {
    expect(isNodeTypeAllowed(undefined, "table")).toBe(true);
    expect(isNodeTypeAllowed(undefined, "code-block")).toBe(true);
    expect(isNodeTypeAllowed({}, "table")).toBe(true);
  });

  it("always permits the ungrouped prose floor", () => {
    expect(schemaGroupOf("paragraph")).toBeUndefined();
    expect(isNodeTypeAllowed({ allowedGroups: [] }, "paragraph")).toBe(true);
    expect(isNodeTypeAllowed({ allowedGroups: ["code"] }, "heading")).toBe(
      true,
    );
  });

  it("toggles the table family coherently as one group", () => {
    expect(schemaGroupOf("table")).toBe("table");
    expect(schemaGroupOf("tablerow")).toBe("table");
    expect(schemaGroupOf("tablecell")).toBe("table");
    const tablesOn: SchemaProfile = { allowedGroups: ["table"] };
    expect(isNodeTypeAllowed(tablesOn, "table")).toBe(true);
    expect(isNodeTypeAllowed(tablesOn, "tablerow")).toBe(true);
    expect(isNodeTypeAllowed(tablesOn, "tablecell")).toBe(true);
    expect(isNodeTypeAllowed(tablesOn, "code-block")).toBe(false);
  });

  it("gates a grouped type on its group membership", () => {
    const codeOnly: SchemaProfile = { allowedGroups: ["code"] };
    expect(isNodeTypeAllowed(codeOnly, "code-block")).toBe(true);
    expect(isNodeTypeAllowed(codeOnly, "divider")).toBe(false);
    expect(isNodeTypeAllowed(codeOnly, "table")).toBe(false);
  });
});

describe("palette gate — slash menu (note.md item 6)", () => {
  it("shows every owned insert when no profile is set", () => {
    const { store } = paragraphStore();
    const ids = slashInsertIds(store);
    expect(ids).toContain("insert:code-block");
    expect(ids).toContain("insert:divider");
    expect(ids).toContain("insert:table-of-contents");
    expect(ids).toContain("insert:table");
  });

  it("hides out-of-profile inserts, keeps allowed ones + the prose floor", () => {
    const { store } = paragraphStore({ allowedGroups: ["code"] });
    const ids = slashInsertIds(store);
    expect(ids).toContain("insert:code-block");
    expect(ids).not.toContain("insert:divider");
    expect(ids).not.toContain("insert:table-of-contents");
    expect(ids).not.toContain("insert:table");
    // The block-type choosers (prose floor) are untouched by the profile.
    expect(ids.some((id) => id.startsWith("block:"))).toBe(true);
  });
});

describe("palette gate — ribbon Insert tab (note.md item 6)", () => {
  it("drops out-of-profile blocks from the Insert projection", () => {
    const open = ribbonInsertIds(paragraphStore().store);
    expect(open).toContain("insert:code-block");
    expect(open).toContain("insert:divider");

    const gated = ribbonInsertIds(
      paragraphStore({ allowedGroups: ["code"] }).store,
    );
    expect(gated).toContain("insert:code-block");
    expect(gated).not.toContain("insert:divider");
    expect(gated).not.toContain("insert:table-of-contents");
  });
});

describe("quarantine — out-of-profile content is preserved, never deleted", () => {
  it("keeps an out-of-profile node in the store and round-trips the snapshot", () => {
    const allocator = createIdAllocator("idco_client_quarantine");
    const paragraph = makeTextNode({
      content: allocator.createTextSlice("prose"),
      id: allocator.createNodeId(),
      type: "paragraph",
    });
    const code = makeObjectNode({
      data: { code: "x = 1", language: "js" },
      id: allocator.createNodeId(),
      status: "ready",
      type: "code-block",
    });
    const blocks = { [paragraph.id]: paragraph, [code.id]: code };
    const order = [paragraph.id, code.id];
    const store = createEditorStore({
      allocator,
      // `code` group is not allowed → the code block is out-of-profile.
      schemaProfile: { allowedGroups: ["media"] },
      snapshot: { body: { blocks, order }, settings: {}, version: 1 },
    });

    // It would render the inert placeholder…
    expect(isNodeTypeAllowed(store.schemaProfile, "code-block")).toBe(false);
    // …but it is NOT deleted — the node and its data survive untouched.
    const kept = store.getNode(code.id);
    expect(kept).toBeDefined();
    expect(kept?.kind === "object" ? kept.data : null).toEqual({
      code: "x = 1",
      language: "js",
    });
    // The whole document round-trips byte-for-byte (lossless preservation).
    const out = store.toSnapshot();
    expect(out.body.order).toEqual(order);
    expect(out.body.blocks[code.id]).toEqual(code);
  });
});
