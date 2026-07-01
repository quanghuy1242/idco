import { describe, expect, it } from "vitest";
import {
  createDefaultBlockRegistry,
  metricsForNode,
  type EditorNode,
  type NodeId,
} from "@idco/editor";

const id = (s: string) => `idco_node_${s}` as NodeId;

const registry = createDefaultBlockRegistry();
const def = (type: string) => registry.require(type);

describe("metricsForNode — node → estimator metrics", () => {
  it("classifies text leaves by leaf type with character count", () => {
    const node: EditorNode = {
      content: { runs: [], text: "hello world" },
      id: id("p"),
      kind: "text",
      marks: [],
      type: "paragraph",
    };
    expect(metricsForNode(node)).toEqual({
      chars: 11,
      kind: "text",
      typeKey: "text:paragraph",
    });
  });

  it("classifies a code-block object by line count from data.code", () => {
    const node: EditorNode = {
      data: { code: "const a = 1\nconst b = 2\nconst c = 3", language: "ts" },
      id: id("c"),
      kind: "object",
      status: "ready",
      type: "code-block",
    };
    expect(metricsForNode(node)).toEqual({
      kind: "code",
      lines: 3,
      typeKey: "code:code-block",
    });
  });

  it("treats empty code as one line", () => {
    const node: EditorNode = {
      data: { code: "", language: "ts" },
      id: id("c2"),
      kind: "object",
      status: "ready",
      type: "code-block",
    };
    expect(metricsForNode(node)).toEqual({
      kind: "code",
      lines: 1,
      typeKey: "code:code-block",
    });
  });

  it("treats media (no dimensions) as an opaque bucket", () => {
    const node: EditorNode = {
      data: { alt: "", caption: "", src: "https://x/y.png" },
      id: id("m"),
      kind: "object",
      status: "ready",
      type: "media",
    };
    expect(metricsForNode(node)).toEqual({
      kind: "opaque",
      typeKey: "obj:media",
    });
  });

  it("uses the image analytic when an object does carry width/height", () => {
    const node: EditorNode = {
      data: { height: 600, src: "x", width: 800 },
      id: id("img"),
      kind: "object",
      status: "ready",
      type: "figure",
    };
    expect(metricsForNode(node)).toEqual({
      aspectRatio: 0.75,
      kind: "image",
      typeKey: "image:figure",
    });
  });

  it("buckets structural containers by type", () => {
    const node: EditorNode = {
      children: [id("a"), id("b")],
      id: id("call"),
      kind: "structural",
      type: "callout",
    };
    expect(metricsForNode(node)).toEqual({
      kind: "opaque",
      typeKey: "struct:callout",
    });
  });

  it("falls back to opaque for an object with unusable data", () => {
    const node: EditorNode = {
      data: null,
      id: id("weird"),
      kind: "object",
      status: "ready",
      type: "embed",
    };
    expect(metricsForNode(node)).toEqual({
      kind: "opaque",
      typeKey: "obj:embed",
    });
  });
});

describe("metricsForNode — declared height signals via NodeDefinition (backlog §3)", () => {
  it("seeds a configured embed by its 16:9 aspect", () => {
    const node: EditorNode = {
      data: { local: {}, ref: "https://youtu.be/abc123", snapshot: {} },
      id: id("e"),
      kind: "object",
      status: "ready",
      type: "embed",
    };
    expect(metricsForNode(node, def("embed"))).toEqual({
      aspectRatio: 9 / 16,
      kind: "image",
      typeKey: "image:embed",
    });
  });

  it("leaves an unconfigured embed (no URL) on the opaque bucket", () => {
    const node: EditorNode = {
      data: { local: {}, ref: "", snapshot: {} },
      id: id("e2"),
      kind: "object",
      status: "ready",
      type: "embed",
    };
    // No declared signal → the generic heuristic still buckets it by type, so a
    // definition passed in does not regress the empty-state case.
    expect(metricsForNode(node, def("embed"))).toEqual({
      kind: "opaque",
      typeKey: "obj:embed",
    });
  });

  it("seeds a resolved post-ref by its fixed card height", () => {
    const node: EditorNode = {
      data: {
        ref: "post_1",
        snapshot: { postId: "post_1", title: "Next", url: "/next" },
      },
      id: id("pr"),
      kind: "object",
      status: "ready",
      type: "post-ref",
    };
    expect(metricsForNode(node, def("post-ref"))).toEqual({
      height: 96,
      kind: "fixed",
      typeKey: "fixed:post-ref",
    });
  });

  it("leaves an unresolved post-ref (renders a small badge) on the opaque bucket", () => {
    const node: EditorNode = {
      data: { ref: "", snapshot: {} },
      id: id("pr2"),
      kind: "object",
      status: "ready",
      type: "post-ref",
    };
    expect(metricsForNode(node, def("post-ref"))).toEqual({
      kind: "opaque",
      typeKey: "obj:post-ref",
    });
  });

  it("seeds media by aspect when the snapshot carries pixel dimensions", () => {
    const node: EditorNode = {
      data: {
        local: {},
        ref: "m1",
        snapshot: { height: 400, src: "x", width: 800 },
      },
      id: id("m3"),
      kind: "object",
      status: "ready",
      type: "media",
    };
    expect(metricsForNode(node, def("media"))).toEqual({
      aspectRatio: 0.5,
      kind: "image",
      typeKey: "image:media",
    });
  });

  it("classifies the piece-table code block by line count (which the string heuristic missed)", () => {
    // The owned code block stores its source as a piece table, not a string, so
    // the generic `data.code` string branch never fired — it seeded as opaque.
    const codeDef = def("code-block");
    const { data } = codeDef.normalizeData({
      code: "a\nb\nc\nd",
      language: "ts",
    });
    const node: EditorNode = {
      data,
      id: id("code"),
      kind: "object",
      status: "ready",
      type: "code-block",
    };
    // Without a definition the piece-table shape is opaque (the latent gap)...
    expect(metricsForNode(node)).toEqual({
      kind: "opaque",
      typeKey: "obj:code-block",
    });
    // ...but the definition's declared signal recovers the line count.
    expect(metricsForNode(node, codeDef)).toEqual({
      kind: "code",
      lines: 4,
      typeKey: "code:code-block",
    });
  });

  it("ignores a nonsense declared signal and falls through to the heuristic", () => {
    const bogusDef = {
      estimateMetrics: () => ({ aspectRatio: -1, kind: "aspect" as const }),
      normalizeData: (value: unknown) => ({ data: value as never }),
      type: "custom",
    };
    const node: EditorNode = {
      data: { anything: true },
      id: id("cust"),
      kind: "object",
      status: "ready",
      type: "custom",
    };
    expect(metricsForNode(node, bogusDef)).toEqual({
      kind: "opaque",
      typeKey: "obj:custom",
    });
  });
});
