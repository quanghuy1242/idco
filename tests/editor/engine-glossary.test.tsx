// @vitest-environment jsdom
/**
 * Glossary feature (docs/027 §6): the index→rows join, orphan detection, registration
 * gating, the live `<abbr>` mark render, and the pane.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  boundaryAtOffset,
  createDocumentIndexStore,
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  renderLeafMarks,
  type DocumentIndex,
  type NodeId,
  type TextContent,
  type TextMark,
} from "../../packages/editor/src";
import {
  buildCommandContext,
  computeToolbarLayout,
  getDocumentCollection,
  getSidePanel,
  registerBuiltInBlockTypes,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import { registerBuiltInCommands } from "../../packages/editor/src/view/chrome";
import { DocumentIndexProvider } from "../../packages/editor/src/view/document-index";
import {
  buildGlossaryRows,
  GlossaryPane,
  orphanedGlossaryRefs,
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

function indexWith(
  terms: readonly { id: string; term: string; definition: string }[],
  occ: readonly { ref: string; node: string }[],
): DocumentIndex {
  return {
    collections: { glossary: terms },
    comments: occ.map((o, i) => ({
      id: `m${i}`,
      kind: "glossary" as const,
      node: o.node as NodeId,
      ref: o.ref,
      text: "x",
    })),
    text: [],
    toc: [],
  };
}

describe("glossary index projection (docs/027 §6.1/§6.3)", () => {
  it("joins terms with occurrence counts and node ids", () => {
    const index = indexWith(
      [
        { definition: "d", id: "t1", term: "Alpha" },
        { definition: "d", id: "t2", term: "Beta" },
      ],
      [
        { node: "n1", ref: "t1" },
        { node: "n2", ref: "t1" },
      ],
    );
    const rows = buildGlossaryRows(index);
    const alpha = rows.find((r) => r.term.id === "t1")!;
    expect(alpha.occurrences).toBe(2);
    expect(alpha.nodeIds).toEqual(["n1", "n2"]);
    // Beta is unused (0 occurrences) — a representable, surfaced state.
    expect(rows.find((r) => r.term.id === "t2")!.occurrences).toBe(0);
  });

  it("detects orphaned references (a mark whose term was deleted)", () => {
    const index = indexWith(
      [{ definition: "d", id: "t1", term: "Alpha" }],
      [
        { node: "n1", ref: "t1" },
        { node: "n2", ref: "gone" },
      ],
    );
    const orphans = orphanedGlossaryRefs(index);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.ref).toBe("gone");
  });
});

describe("glossary registration + gating (docs/027 §7.7)", () => {
  it("registers the glossary collection and pane", () => {
    expect(getDocumentCollection("glossary")).toBeDefined();
    expect(getSidePanel("glossary")?.title).toBe("Glossary");
  });

  it("places Glossary + Add-to-glossary commands in the Review tab", () => {
    const allocator = createIdAllocator("idco_client_gloss_tab");
    const node = makeTextNode({
      content: allocator.createTextSlice("x"),
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
    const review = computeToolbarLayout(
      buildCommandContext(store, CAPS),
    ).tabs.find((t) => t.id === "review");
    const ids = review!.slots.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain("review.glossary");
    expect(ids).toContain("glossary.add");
  });
});

describe("glossary mark renders a live abbr (docs/027 §6.1)", () => {
  it("renders an <abbr> carrying the term id, not an inert span", () => {
    const allocator = createIdAllocator("idco_client_gloss_render");
    const content: TextContent = allocator.createTextSlice("term word");
    const mark: TextMark = {
      attrs: { term: "t-1" },
      from: boundaryAtOffset(content, 0, "before"),
      id: "gm1",
      kind: "glossary",
      to: boundaryAtOffset(content, 4, "after"),
    };
    const node = makeTextNode({
      content,
      id: "idco_node_g_1" as NodeId,
      marks: [mark],
    });
    const { container } = render(<div>{renderLeafMarks(node)}</div>);
    const abbr = container.querySelector("abbr[data-engine-mark='glossary']");
    expect(abbr).not.toBeNull();
    expect(abbr?.getAttribute("data-engine-glossary-term")).toBe("t-1");
    expect(container.textContent).toBe("term word");
  });
});

describe("GlossaryPane render (docs/027 §6.3)", () => {
  it("lists terms with definitions and marks an unused term", () => {
    const allocator = createIdAllocator("idco_client_gloss_pane");
    const node = makeTextNode({
      content: allocator.createTextSlice("x"),
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
    const index = indexWith(
      [
        {
          definition: "Application Programming Interface",
          id: "t1",
          term: "API",
        },
      ],
      [],
    );
    const { container, getByText } = render(
      <DocumentIndexProvider store={createDocumentIndexStore(index)}>
        <GlossaryPane reveal={() => {}} store={store} />
      </DocumentIndexProvider>,
    );
    expect(getByText("API")).toBeTruthy();
    expect(container.querySelector("[data-engine-glossary]")).not.toBeNull();
    // The term has no occurrences → an "unused" badge.
    expect(getByText("unused")).toBeTruthy();
  });
});
