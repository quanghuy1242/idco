/**
 * docs/010 Phase 6 — heavy objects + bake (headless).
 *
 * Proves the object spine without the DOM: bakers are pure and deterministic,
 * an object edit re-bakes and updates the compatibility projection, an
 * unbakeable object reports a recoverable `invalid` status (AC4), the live-edit
 * slot is capped at one object and suspends the text caret (AC2/AC5), and the
 * worker bake/index round-trip resolves through the loopback transport (AC6).
 * Drift (AC3) and the no-editor-at-rest DOM assertion (AC1) are proven in the
 * Playwright spec, since they are layout/DOM properties.
 */
import { describe, expect, it } from "vitest";
import {
  bakeObjectData,
  buildDocumentIndex,
  createDefaultBlockRegistry,
  createEditorStore,
  createIdAllocator,
  createEditorStoreFromCompat,
  createLoopbackBakeService,
  createOwnedEditorHandle,
  compatFromEditorStore,
  makeObjectNode,
  makeTextNode,
  runBakeWorkerJob,
  type BlockRegistry,
  type EditorDocumentSnapshot,
  type EditorNode,
  type IdAllocator,
  type JsonValue,
  type NodeId,
  type ObjectNode,
} from "../../packages/editor/src/core";

function objectNode(
  allocator: IdAllocator,
  registry: BlockRegistry,
  type: string,
  rawData: JsonValue,
): ObjectNode {
  const normalized = registry.normalizeSnapshotObject(type, rawData);
  const baked = bakeObjectData(registry, type, normalized.data);
  return makeObjectNode({
    baked: baked.baked ?? undefined,
    data: normalized.data,
    id: allocator.createNodeId(),
    status: baked.status,
    type,
  });
}

function createObjectStore() {
  const allocator = createIdAllocator("idco_client_phase6_test");
  const registry = createDefaultBlockRegistry();
  const heading = makeTextNode({
    attrs: { tag: "h2" },
    content: allocator.createTextSlice("Section one"),
    id: allocator.createNodeId(),
    type: "heading",
  });
  const intro = makeTextNode({
    content: allocator.createTextSlice("Intro paragraph"),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  const code = objectNode(allocator, registry, "code-block", {
    code: "const a = 1;\nconst b = 2;",
    language: "ts",
  });
  const media = objectNode(allocator, registry, "media", {
    alt: "Diagram",
    caption: "Cap",
    src: "https://example.com/a.png",
  });
  const order: EditorNode[] = [heading, intro, code, media];
  const snapshot: EditorDocumentSnapshot = {
    body: {
      blocks: Object.fromEntries(order.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: order.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
  const store = createEditorStore({ allocator, registry, snapshot });
  return { code, heading, intro, media, registry, store };
}

describe("Phase 6 bake — pure compute", () => {
  const registry = createDefaultBlockRegistry();

  it("bakes a code block deterministically from its data", () => {
    const data = registry.normalizeSnapshotObject("code-block", {
      code: "a\nb\nc",
      language: "ts",
    }).data;
    const first = bakeObjectData(registry, "code-block", data);
    const second = bakeObjectData(registry, "code-block", data);
    expect(first.status).toBe("ready");
    expect(first).toEqual(second);
    expect(first.baked).toEqual({
      kind: "code",
      payload: { code: "a\nb\nc", language: "ts", lineCount: 3 },
    });
  });

  it("reports a recoverable invalid status when an object cannot bake", () => {
    const empty = bakeObjectData(registry, "media", { alt: "x", src: "" });
    expect(empty.status).toBe("invalid");
    expect(empty.baked).toBeNull();
    expect(empty.error).toBeTruthy();
    const ok = bakeObjectData(registry, "media", { src: "https://x/y.png" });
    expect(ok.status).toBe("ready");
    expect(ok.baked?.kind).toBe("media");
  });

  it("treats an unknown object type as invalid, never throwing", () => {
    const result = bakeObjectData(registry, "not-a-real-object", { a: 1 });
    expect(result.status).toBe("invalid");
    expect(result.baked).toBeNull();
  });

  it("derives a TOC and text index from a snapshot", () => {
    const { store } = createObjectStore();
    const index = buildDocumentIndex(store.toSnapshot());
    expect(index.toc).toEqual([
      expect.objectContaining({ level: 2, text: "Section one" }),
    ]);
    expect(index.text.map((entry) => entry.text)).toContain("Intro paragraph");
  });
});

describe("Phase 6 object editing — re-bake + compat", () => {
  it("re-bakes a code block on edit and updates the compat projection (AC4)", () => {
    const { store, code } = createObjectStore();
    store.command({
      data: { code: "renamed();", language: "ts" },
      node: code.id,
      type: "set-object-data",
    });
    const edited = store.getNode(code.id);
    expect(edited?.kind).toBe("object");
    if (edited?.kind !== "object") throw new Error("expected object");
    expect(edited.status).toBe("ready");
    expect(edited.baked).toEqual({
      kind: "code",
      payload: { code: "renamed();", language: "ts", lineCount: 1 },
    });
    const compat = compatFromEditorStore(store);
    const compatCode = compat.root.children.find(
      (child) => child.type === "code-block",
    );
    expect(compatCode?.text).toBe("renamed();");
    expect(compatCode?.baked).toEqual(edited.baked);
  });

  it("commits an unbakeable edit as invalid rather than crashing (AC4)", () => {
    const { store, media } = createObjectStore();
    store.command({
      data: { alt: "still here", src: "" },
      node: media.id,
      type: "set-object-data",
    });
    const edited = store.getNode(media.id);
    if (edited?.kind !== "object") throw new Error("expected object");
    expect(edited.status).toBe("invalid");
    expect(edited.baked).toBeUndefined();
  });

  it("projects an unbakeable object to a valid, reloadable compat document (G1)", () => {
    const { store, media } = createObjectStore();
    store.command({
      data: { alt: "kept", src: "" },
      node: media.id,
      type: "set-object-data",
    });
    // The invalid object is still in the projection (not dropped), carries its
    // status, and emits no baked field — a recoverable state, not a broken doc.
    const compat = compatFromEditorStore(store);
    const mediaCompat = compat.root.children.find((c) => c.type === "media");
    expect(mediaCompat).toBeDefined();
    expect(mediaCompat?.status).toBe("invalid");
    expect(mediaCompat?.baked).toBeUndefined();
    // It reloads cleanly through the compat boundary (rollback-compatible).
    const reloaded = createEditorStoreFromCompat(compat);
    const reloadedMedia = reloaded.order
      .map((id) => reloaded.getNode(id))
      .find((node) => node?.kind === "object" && node.type === "media");
    expect(reloadedMedia?.kind).toBe("object");
    const reloadedStatus =
      reloadedMedia?.kind === "object" ? reloadedMedia.status : undefined;
    expect(reloadedStatus).toBe("invalid");
  });

  it("undoes an object edit back to the prior data and bake", () => {
    const { store, code } = createObjectStore();
    const before = store.getNode(code.id);
    store.command({
      data: { code: "changed();", language: "ts" },
      node: code.id,
      type: "set-object-data",
    });
    store.undo();
    expect(store.getNode(code.id)).toEqual(before);
  });
});

describe("Phase 6 activation slot — one live object (AC2/AC5)", () => {
  it("caps the live slot at one object", () => {
    const { store, code, media } = createObjectStore();
    store.activateObject(code.id);
    expect(store.activeObjectId).toBe(code.id);
    store.activateObject(media.id);
    expect(store.activeObjectId).toBe(media.id);
    store.deactivateObject();
    expect(store.activeObjectId).toBeNull();
  });

  it("suspends the active text leaf and selects the object atomically", () => {
    const { store, intro, code } = createObjectStore();
    store.activateTextLeaf(intro.id);
    expect(store.activeTextLeafId).toBe(intro.id);
    store.activateObject(code.id);
    expect(store.activeTextLeafId).toBeNull();
    expect(store.selection).toEqual({ node: code.id, type: "node" });
  });

  it("publishes the suspended leaf's latest text on activation, not stranding the edit (AC5)", () => {
    const { store, intro, code } = createObjectStore();
    store.activateTextLeaf(intro.id);
    let leafNotifications = 0;
    const unsubscribe = store.subscribeNode(intro.id, () => {
      leafNotifications += 1;
    });
    // Mirror the input fast path of an in-flight composition: the controller
    // patched the DOM, so the active leaf skips its re-render on commit.
    store.markActiveLeafDomSynced();
    const end = store.requireTextNode(intro.id).content.text.length;
    store.dispatch(
      store
        .transaction()
        .replaceText({ at: end, inserted: "Z", node: intro.id, removed: "" }),
    );
    expect(leafNotifications).toBe(0);
    // Activating an object suspends the leaf and must flush its latest text so
    // the suspended block does not keep showing a stale pre-edit snapshot.
    store.activateObject(code.id);
    expect(leafNotifications).toBe(1);
    expect(store.requireTextNode(intro.id).content.text.endsWith("Z")).toBe(
      true,
    );
    expect(store.activeTextLeafId).toBeNull();
    unsubscribe();
  });

  it("notifies active-object subscribers on the resting↔live switch", () => {
    const { store, code } = createObjectStore();
    let notifications = 0;
    const unsubscribe = store.subscribeActiveObject(() => {
      notifications += 1;
    });
    store.activateObject(code.id);
    store.deactivateObject();
    unsubscribe();
    expect(notifications).toBe(2);
  });
});

describe("Phase 6 worker bake service — loopback round-trip (AC6)", () => {
  it("bakes an object through the worker protocol", async () => {
    const service = createLoopbackBakeService();
    const result = await service.bakeObject("code-block", {
      code: "x\ny",
      language: "ts",
    });
    expect(result.status).toBe("ready");
    expect(result.baked?.kind).toBe("code");
    service.dispose();
  });

  it("builds the document index through the worker protocol", async () => {
    const { store } = createObjectStore();
    const service = createLoopbackBakeService();
    const index = await service.buildIndex(store.toSnapshot());
    expect(index.toc).toHaveLength(1);
    expect(index.toc[0]?.text).toBe("Section one");
    service.dispose();
  });

  it("runs the same handler on the dispatcher the worker entry calls", () => {
    const reply = runBakeWorkerJob({
      data: { code: "z", language: "ts" },
      id: "job-1",
      kind: "bake-object",
      objectType: "code-block",
    });
    expect(reply.kind).toBe("bake-object");
    if (reply.kind !== "bake-object") throw new Error("wrong kind");
    expect(reply.id).toBe("job-1");
    expect(reply.result.baked?.kind).toBe("code");
  });
});

describe("Phase 6 handle — object control surface", () => {
  it("activates, edits, and deactivates an object through the handle", () => {
    const { store, code } = createObjectStore();
    const handle = createOwnedEditorHandle(store);
    handle.activateObject(code.id);
    expect(handle.getActiveObjectId()).toBe(code.id);
    handle.setObjectData(code.id, { code: "viaHandle();", language: "ts" });
    const node = store.getNode(code.id);
    if (node?.kind !== "object") throw new Error("expected object");
    expect(node.baked).toEqual({
      kind: "code",
      payload: { code: "viaHandle();", language: "ts", lineCount: 1 },
    });
    handle.deactivateObject();
    expect(handle.getActiveObjectId()).toBeNull();
  });
});
