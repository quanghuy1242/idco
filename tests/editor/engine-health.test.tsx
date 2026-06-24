// @vitest-environment jsdom
/**
 * Document-health panes (docs/027 §9.5/§9.6): the pure accessibility checks, the
 * broken-reference detector, registration, and the rendered panes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  boundaryAtOffset,
  buildDocumentIndex,
  createEditorStore,
  createIdAllocator,
  makeObjectNode,
  makeTextNode,
  type EditorDocumentSnapshot,
  type EditorNode,
  type NodeId,
  type TextContent,
} from "../../packages/editor/src";
import {
  buildCommandContext,
  computeToolbarLayout,
  getSidePanel,
  registerBuiltInBlockTypes,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { registerBuiltInCommands } from "../../packages/editor/src/view/chrome";
import { DocumentIndexProvider } from "../../packages/editor/src/view/document-index";
import { createDocumentIndexStore } from "../../packages/editor/src/view/controllers/document-index-store";
import {
  AccessibilityPane,
  accessibilityFindings,
  brokenReferences,
} from "../../packages/editor/src/view/chrome/panes";

beforeAll(() => {
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

const allocator = createIdAllocator("idco_client_health");

function snapshotOf(nodes: readonly EditorNode[]): EditorDocumentSnapshot {
  return {
    body: {
      blocks: Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<
        NodeId,
        EditorNode
      >,
      order: nodes.map((n) => n.id),
    },
    settings: {},
    version: 1,
  };
}

function heading(text: string, tag: string): EditorNode {
  return makeTextNode({
    attrs: { tag },
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    type: "heading",
  });
}

describe("accessibilityFindings (docs/027 §9.5)", () => {
  it("flags heading-order skips and empty headings", () => {
    const nodes = [
      heading("Intro", "h1"),
      heading("Deep", "h3"),
      heading("", "h2"),
    ];
    const store = createEditorStore({ allocator, snapshot: snapshotOf(nodes) });
    const findings = accessibilityFindings(
      buildDocumentIndex(store.toSnapshot()),
      store,
    );
    expect(findings.some((f) => f.message.includes("H1 to H3"))).toBe(true);
    expect(findings.some((f) => f.message === "Empty heading")).toBe(true);
  });

  it("flags an image with no alt and a vague link", () => {
    const linkContent: TextContent =
      allocator.createTextSlice("click here now");
    const linkLeaf = makeTextNode({
      content: linkContent,
      id: allocator.createNodeId(),
      marks: [
        {
          attrs: { href: "https://x.test" },
          from: boundaryAtOffset(linkContent, 0, "before"),
          id: "lk1",
          kind: "link",
          to: boundaryAtOffset(linkContent, 10, "after"),
        },
      ],
    });
    const media = makeObjectNode({
      data: { ref: "g1", snapshot: { alt: "", src: "x" } },
      id: allocator.createNodeId(),
      status: "ready",
      type: "media",
    });
    const store = createEditorStore({
      allocator,
      snapshot: snapshotOf([linkLeaf, media]),
    });
    const findings = accessibilityFindings(
      buildDocumentIndex(store.toSnapshot()),
      store,
    );
    expect(findings.some((f) => f.kind === "image")).toBe(true);
    expect(findings.some((f) => f.kind === "link")).toBe(true);
  });

  it("is empty for a clean document", () => {
    const store = createEditorStore({
      allocator,
      snapshot: snapshotOf([heading("Title", "h1")]),
    });
    expect(
      accessibilityFindings(buildDocumentIndex(store.toSnapshot()), store),
    ).toEqual([]);
  });
});

describe("brokenReferences (docs/027 §9.6)", () => {
  it("lists object nodes whose resolve failed or ref dangles, with a label", () => {
    const broken = makeObjectNode({
      data: { ref: "deleted-1", snapshot: { title: "Old Post" } },
      id: allocator.createNodeId(),
      status: "invalid",
      type: "post-ref",
    });
    const ok = makeObjectNode({
      data: { ref: "g1", snapshot: { alt: "fine", src: "x" } },
      id: allocator.createNodeId(),
      status: "ready",
      type: "media",
    });
    const store = createEditorStore({
      allocator,
      snapshot: snapshotOf([broken, ok]),
    });
    const refs = brokenReferences(store);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.status).toBe("invalid");
    expect(refs[0]!.label).toBe("Old Post");
  });
});

describe("health pane registration (docs/027 §9.5/§9.6)", () => {
  it("registers both panes and their Review commands", () => {
    expect(getSidePanel("accessibility")?.title).toBe("Accessibility");
    expect(getSidePanel("broken-refs")?.title).toBe("Broken refs");
    const store = createEditorStore({
      allocator,
      snapshot: snapshotOf([heading("X", "h1")]),
    });
    const ids = computeToolbarLayout(buildCommandContext(store, CAPS))
      .tabs.find((t) => t.id === "review")!
      .slots.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain("review.accessibility");
    expect(ids).toContain("review.broken-refs");
  });
});

describe("AccessibilityPane render (docs/027 §9.5)", () => {
  it("shows findings and a clean state", () => {
    const dirty = createEditorStore({
      allocator,
      snapshot: snapshotOf([heading("Intro", "h1"), heading("Deep", "h3")]),
    });
    const index = buildDocumentIndex(dirty.toSnapshot());
    const { getByText } = render(
      <DocumentIndexProvider store={createDocumentIndexStore(index)}>
        <AccessibilityPane reveal={() => {}} store={dirty} />
      </DocumentIndexProvider>,
    );
    expect(getByText(/Heading jumps from H1 to H3/)).toBeTruthy();

    const clean = createEditorStore({
      allocator,
      snapshot: snapshotOf([heading("Title", "h1")]),
    });
    const { getByText: getClean } = render(
      <DocumentIndexProvider
        store={createDocumentIndexStore(buildDocumentIndex(clean.toSnapshot()))}
      >
        <AccessibilityPane reveal={() => {}} store={clean} />
      </DocumentIndexProvider>,
    );
    expect(getClean(/No accessibility issues/)).toBeTruthy();
  });
});
