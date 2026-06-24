// @vitest-environment jsdom
/**
 * Mark-kind SPI (docs/027 §16 P7): a host registers a *new* mark kind (the open
 * `TextMarkKind` union), declares whether it is data-bearing (`identity`), and renders
 * it — without touching the editor package. Proves the one core hook works: an
 * identity kind keeps adjacent runs apart; a plain kind merges them.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  boundaryAtOffset,
  createIdAllocator,
  isIdentityMark,
  makeTextNode,
  segmentLeaf,
  type TextContent,
  type TextLeafNode,
  type TextMark,
} from "../../packages/editor/src/core";
import { registerMark, renderLeafMarks } from "../../packages/editor/src/view";

const allocator = createIdAllocator("idco_client_mark_spi");

function twoAdjacent(kind: string): TextLeafNode {
  const content: TextContent = allocator.createTextSlice("abcd");
  const marks: TextMark[] = [
    {
      from: boundaryAtOffset(content, 0, "before"),
      id: "m1",
      kind,
      to: boundaryAtOffset(content, 2, "after"),
    },
    {
      from: boundaryAtOffset(content, 2, "before"),
      id: "m2",
      kind,
      to: boundaryAtOffset(content, 4, "after"),
    },
  ];
  return makeTextNode({ content, id: allocator.createNodeId(), marks });
}

describe("mark-kind SPI (docs/027 §16 P7)", () => {
  it("registers a new identity kind whose id distinguishes adjacent segments", () => {
    registerMark({
      identity: true,
      kind: "ref-link",
      nestingRank: 20,
      render: ({ child, key }) => (
        <a data-engine-mark="ref-link" key={key}>
          {child}
        </a>
      ),
    });
    expect(isIdentityMark("ref-link")).toBe(true);
    // Two adjacent ref-link marks with different ids must stay two segments.
    expect(segmentLeaf(twoAdjacent("ref-link"))).toHaveLength(2);
  });

  it("a plain (non-identity) kind merges adjacent same-kind runs", () => {
    registerMark({
      kind: "spoiler",
      nestingRank: 21,
      render: ({ child, key }) => (
        <span data-engine-mark="spoiler" key={key}>
          {child}
        </span>
      ),
    });
    expect(isIdentityMark("spoiler")).toBe(false);
    // Same kind, no identity → one merged segment.
    expect(segmentLeaf(twoAdjacent("spoiler"))).toHaveLength(1);
  });

  it("renders a host kind through its registered render", () => {
    const content = allocator.createTextSlice("hi");
    const node = makeTextNode({
      content,
      id: allocator.createNodeId(),
      marks: [
        {
          from: boundaryAtOffset(content, 0, "before"),
          id: "m1",
          kind: "ref-link",
          to: boundaryAtOffset(content, 2, "after"),
        },
      ],
    });
    const { container } = render(<div>{renderLeafMarks(node)}</div>);
    expect(
      container.querySelector("a[data-engine-mark='ref-link']"),
    ).not.toBeNull();
    expect(container.textContent).toBe("hi");
  });
});
