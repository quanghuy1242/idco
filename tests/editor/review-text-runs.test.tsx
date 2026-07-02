// @vitest-environment jsdom
/**
 * The woven T1 text decorator (docs/039 R-T1, P4c): a changed leaf renders live track-changes —
 * inserted runs decorated (editable store text), deleted runs as INERT ghosts. The load-bearing
 * assertion is the geometry-skip invariant: `textNodesOf` (which every caret/click mapping walks) must
 * SKIP a `data-engine-ghost-run` span, so "concat of counted text nodes == store text" holds and a
 * caret past a deletion lands on the right offset.
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createIdAllocator,
  makeTextNode,
  type TextLeafDiff,
} from "../../packages/editor/src/core";
import { renderReviewLeafMarks } from "../../packages/editor/src/view/render/mark-render";
import {
  hostTextLength,
  modelOffsetFromDom,
  resolveOffsetToDom,
  textNodesOf,
} from "../../packages/editor/src/view/overlays/geometry";

const alloc = createIdAllocator("idco_client_reviewtext");

/** A leaf whose live text is the keep+insert union (the store side of a diff). */
function liveLeaf(text: string) {
  return makeTextNode({
    content: alloc.createTextSlice(text),
    id: alloc.createNodeId(),
  });
}

describe("renderReviewLeafMarks (docs/039 R-T1)", () => {
  // Live text = "The very quick fox" (keep + insert); "brown " was deleted (base only).
  const node = liveLeaf("The very quick fox");
  const diff: TextLeafDiff = {
    alignment: "id",
    markChanges: [],
    runs: [
      { op: "keep", text: "The " },
      { op: "insert", text: "very " },
      { op: "keep", text: "quick " },
      { op: "delete", text: "brown " },
      { op: "keep", text: "fox" },
    ],
  };

  it("decorates the inserted run and renders the deleted run as an inert ghost", () => {
    const { container } = render(
      <div>{renderReviewLeafMarks(node, diff)}</div>,
    );
    const insert = container.querySelector('[data-engine-review-op="insert"]');
    expect(insert?.textContent).toBe("very ");
    const ghost = container.querySelector("[data-engine-ghost-run]");
    expect(ghost?.textContent).toBe("brown ");
    // The inline delete is silent-in-prose (aria-hidden) and inert; geometry-skipped (proven below).
    expect(ghost?.getAttribute("aria-hidden")).toBe("true");
    expect(ghost?.getAttribute("contenteditable")).toBe("false");
    // The inserted run announces as an insertion via a real <ins> (role=insertion).
    expect(
      container.querySelector("ins[data-engine-review-op='insert']"),
    ).toBeTruthy();
  });

  it("geometry SKIPS the ghost so counted text == store text (the R-T1 invariant)", () => {
    const { container } = render(
      <div>{renderReviewLeafMarks(node, diff)}</div>,
    );
    const host = container.firstChild as HTMLElement;
    // The store text is the live leaf text — the deleted "brown " must NOT be counted.
    const counted = textNodesOf(host)
      .map((n) => n.textContent)
      .join("");
    expect(counted).toBe("The very quick fox");
    expect(counted).not.toContain("brown");
  });

  it("maps a store offset PAST the deletion to the right DOM node and back — the caret invariant", () => {
    // The layout-free half of the §14/P4 caret-after-deletion proof: pixel rects need a browser, but the
    // load-bearing thing — a MODEL offset after a deletion mapping to the correct COUNTED DOM position and
    // round-tripping to the SAME offset (the ghost length never added in) — is pure DOM-node math and runs
    // in jsdom. If this drifts, every caret/click past a woven deletion is off by the ghost's length.
    const { container } = render(
      <div>{renderReviewLeafMarks(node, diff)}</div>,
    );
    const host = container.firstChild as HTMLElement;
    expect(hostTextLength(host)).toBe("The very quick fox".length);
    // Offset 16 is inside "fox" — the run that renders AFTER the delete-ghost in DOM order (the ghost's
    // targetOffset is 15, "fox" starts at 15). This is the offset a broken skip WOULD mis-map: counting
    // the ghost's 6 chars would push "fox" to store offset 21, so the round-trip below only holds while
    // `textNodesOf`/`modelOffsetFromDom` actually skip the ghost. (An offset in "quick", before the ghost,
    // would pass even against a broken skip — the reviewer's catch.)
    const at = 16;
    const dom = resolveOffsetToDom(host, at);
    expect(dom).not.toBeNull();
    // `resolveOffsetToDom` walks `textNodesOf`, so it can never land in the ghost's (uncounted) node.
    expect(
      dom!.node.parentElement?.closest("[data-engine-ghost-run]"),
    ).toBeNull();
    // Round-trip: the DOM position maps back to the SAME store offset — no ghost length spliced in.
    expect(modelOffsetFromDom(host, dom!.node, dom!.offset)).toBe(at);
  });

  it("flags a keep run under a changed mark with a dotted cue, no insert/delete", () => {
    const bold = liveLeaf("bold plain");
    const markDiff: TextLeafDiff = {
      alignment: "id",
      markChanges: [{ from: 0, kind: "bold", op: "removed", to: 4 }],
      // A mark-only change: the engine still emits a run whose target range the mark covered as its
      // own keep slice so the decorator can dot it; here the whole text is kept.
      runs: [
        { op: "keep", text: "bold" },
        { op: "keep", text: " plain" },
      ],
    };
    // A `removed` mark change does not flag a surviving run (partitionTextRuns rule), so no dotted cue
    // fires here — the assertion is that it renders without insert/delete decoration.
    const { container } = render(
      <div>{renderReviewLeafMarks(bold, markDiff)}</div>,
    );
    expect(
      container.querySelector('[data-engine-review-op="insert"]'),
    ).toBeNull();
    expect(container.querySelector("[data-engine-ghost-run]")).toBeNull();
    expect((container.firstChild as HTMLElement).textContent).toBe(
      "bold plain",
    );
  });
});
