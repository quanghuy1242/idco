import { describe, expect, it } from "vitest";
import { metricsForNode, type EditorNode, type NodeId } from "@idco/editor";

const id = (s: string) => `idco_node_${s}` as NodeId;

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
