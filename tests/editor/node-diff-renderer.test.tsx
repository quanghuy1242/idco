// @vitest-environment jsdom
/**
 * The per-node diff SPI (docs/039 §8, P3): a code block renders a real LINE diff through `renderDiff`,
 * a type with no renderer degrades to the `diffData` field rows (here: no line diff), and a renderer
 * that throws on bad data falls back rather than blanking the review. These feed the REAL engine diff
 * into the REAL `<DiffView>` with the built-in resolver.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiffView, type NodeDiffRenderer } from "@quanghuy1242/idco-reader";
import {
  codeBlockDiffRenderer,
  diffSnapshots,
  nodeDiffRendererResolver,
  type NodeId,
} from "../../packages/editor/src";
import { alloc, object, snap } from "./diff-fixtures";

/** A valid piece-table value wrapping a plain string (the code block's `code` field shape). */
function pieceTable(text: string) {
  return {
    append: "",
    kind: "piece-table" as const,
    original: text,
    pieces:
      text.length === 0
        ? []
        : [{ buffer: "original" as const, from: 0, length: text.length }],
  };
}

const codeBlock = (a: ReturnType<typeof alloc>, id: NodeId, source: string) =>
  object(a, "code-block", { code: pieceTable(source), language: "ts" }, { id });

/** A renderer that throws, to prove the diff view degrades rather than blanking (docs/039 §14). */
const boom: NodeDiffRenderer = () => {
  throw new Error("bad data");
};

describe("codeBlockDiffRenderer (docs/039 §8)", () => {
  it("renders a unified line diff of the source, not a truncated string", () => {
    const out = codeBlockDiffRenderer({
      base: { code: pieceTable("const x = 1;\nconst y = 2;\nreturn x;") },
      target: { code: pieceTable("const x = 1;\nconst z = 3;\nreturn x;") },
      status: "changed",
    });
    const { container } = render(<>{out}</>);
    const pre = container.querySelector("[data-engine-code-diff]");
    expect(pre).toBeTruthy();
    // Both the removed and the added line are present in full (no 48-char truncation, no "…").
    expect(pre?.textContent).toContain("const y = 2;");
    expect(pre?.textContent).toContain("const z = 3;");
    expect(pre?.textContent ?? "").not.toContain("…");
    // The unchanged lines survive once each (a keep, not a delete+insert).
    expect(pre?.textContent).toContain("const x = 1;");
    expect(pre?.textContent).toContain("return x;");
  });
});

describe("DiffView + getNodeDiffRenderer (docs/039 §8)", () => {
  it("renders the code block's line diff for a changed code block", () => {
    const a = alloc("cdiff");
    const id = a.createNodeId();
    const base = snap([codeBlock(a, id, "line A\nline B")]);
    const target = snap([codeBlock(a, id, "line A\nline C")]);
    const diff = diffSnapshots(base, target);
    const { container } = render(
      <DiffView diff={diff} getNodeDiffRenderer={nodeDiffRendererResolver()} />,
    );
    expect(container.querySelector("[data-engine-code-diff]")).toBeTruthy();
    expect(container.textContent).toContain("line C");
  });

  it("does not render a line diff for a type with no renderer (degrades to field rows)", () => {
    // A type the resolver has no renderer for resolves to undefined.
    expect(nodeDiffRendererResolver()("image")).toBeUndefined();
    const a = alloc("noren");
    const id = a.createNodeId();
    const base = snap([object(a, "image", { src: "a.png" }, { id })]);
    const target = snap([object(a, "image", { src: "b.png" }, { id })]);
    const diff = diffSnapshots(base, target);
    const { container } = render(
      <DiffView diff={diff} getNodeDiffRenderer={nodeDiffRendererResolver()} />,
    );
    expect(container.querySelector("[data-engine-code-diff]")).toBeNull();
  });

  it("falls back without blanking when a renderer throws", () => {
    const a = alloc("throw");
    const id = a.createNodeId();
    const base = snap([codeBlock(a, id, "x")]);
    const target = snap([codeBlock(a, id, "y")]);
    const diff = diffSnapshots(base, target);
    const { container } = render(
      <DiffView
        diff={diff}
        getNodeDiffRenderer={nodeDiffRendererResolver(
          new Map([["code-block", boom]]),
        )}
      />,
    );
    // The review still renders (the card is present); the throwing renderer produced no line diff.
    expect(container.querySelector(".rt-diff-view")).toBeTruthy();
    expect(container.querySelector("[data-engine-code-diff]")).toBeNull();
  });
});
