// @vitest-environment jsdom
/**
 * The ring affordance (docs/039 R-RG/R-EX, P4d): clicking a nested change's ring opens its detail —
 * a `<ChangeDetail>` CHIP for a one-line invisible (a re-colored cell's `fill: red → green`) or a
 * scoped-`<DiffView>` BAND for an opaque node (a code block's line diff via the node-diff SPI).
 */
import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import {
  diffSnapshots,
  nodeDiffRendererResolver,
  ReviewElementDetail,
  type SnapshotDiff,
} from "../../packages/editor/src";
import { alloc, container, leaf, object, snap } from "./diff-fixtures";

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

function Harness(props: {
  readonly diff: SnapshotDiff;
  readonly ringId: string;
  readonly ringLabel: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={rootRef}>
        <div
          data-engine-block-id={props.ringId}
          data-engine-review-ring="changed"
        >
          {props.ringLabel}
        </div>
      </div>
      <ReviewElementDetail
        diff={props.diff}
        getNodeDiffRenderer={nodeDiffRendererResolver()}
        rootRef={rootRef}
      />
    </div>
  );
}

describe("ReviewElementDetail — ring affordance", () => {
  it("opens a chip with the cell's fill transition on ring click", () => {
    const a = alloc("cellring");
    const cellId = a.createNodeId();
    const t = leaf(a, "cell");
    const cell = container(a, "tablecell", [t], {
      attrs: { fill: "red" },
      id: cellId,
    });
    const row = container(a, "tablerow", [cell]);
    const tableId = a.createNodeId();
    const table = container(a, "table", [row], { id: tableId });
    const cell2 = container(a, "tablecell", [t], {
      attrs: { fill: "green" },
      id: cellId,
    });
    const row2 = container(a, "tablerow", [cell2]);
    const table2 = container(a, "table", [row2], { id: tableId });
    const diff = diffSnapshots(
      snap([table], { nested: [row, cell, t] }),
      snap([table2], { nested: [row2, cell2, t] }),
    );

    const { container: root } = render(
      <Harness diff={diff} ringId={cellId} ringLabel="cell" />,
    );
    // Nothing before the click.
    expect(root.querySelector("[data-engine-review-detail]")).toBeNull();
    fireEvent.click(root.querySelector("[data-engine-review-ring]")!);
    const detail = root.querySelector("[data-engine-review-detail]");
    expect(detail).toBeTruthy();
    // The chip shows the fill transition (red → green), not a bare "changed".
    expect(detail?.textContent).toContain("red");
    expect(detail?.textContent).toContain("green");
    // It is a chip, not the code-diff band.
    expect(detail?.querySelector("[data-engine-code-diff]")).toBeNull();
  });

  it("opens a scoped-diff band with a code line diff for a code block ring", () => {
    const a = alloc("codering");
    const id = a.createNodeId();
    const base = object(
      a,
      "code-block",
      { code: pieceTable("line A\nline B"), language: "ts" },
      { id },
    );
    const target = object(
      a,
      "code-block",
      { code: pieceTable("line A\nline C"), language: "ts" },
      { id },
    );
    const diff = diffSnapshots(snap([base]), snap([target]));

    const { container: root } = render(
      <Harness diff={diff} ringId={id} ringLabel="code" />,
    );
    fireEvent.click(root.querySelector("[data-engine-review-ring]")!);
    const detail = root.querySelector("[data-engine-review-detail]");
    expect(detail).toBeTruthy();
    // The band renders the code block's line diff (the deleted + inserted lines in full).
    expect(detail?.querySelector("[data-engine-code-diff]")).toBeTruthy();
    expect(detail?.textContent).toContain("line C");
  });
});
