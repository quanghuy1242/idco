import { describe, expect, it } from "vitest";
import {
  blockGapAtY,
  blockGapCandidates,
  gapCursorRect,
} from "../../packages/editor/src/legacy/model/gap-cursor";

describe("gapCursorRect", () => {
  it("draws a horizontal insertion marker inside the visible gap", () => {
    expect(
      gapCursorRect({
        anchorRect: { bottom: 80, left: 24, top: 56 },
        gapBottom: 100,
        gapTop: 80,
        height: 4,
        rightInset: 12,
        rootRect: { bottom: 160, left: 10, right: 210, top: 20 },
        side: "after",
        textInset: 48,
      }),
    ).toEqual({ height: 4, left: 58, top: 88, width: 140 });
  });

  it("uses the top boundary for a before-target gap", () => {
    expect(
      gapCursorRect({
        anchorRect: { bottom: 80, left: 24, top: 56 },
        gapBottom: 56,
        gapTop: 40,
        rootRect: { bottom: 160, left: 10, right: 210, top: 20 },
        side: "before",
        textInset: 48,
      }),
    ).toEqual({ height: 2, left: 58, top: 47, width: 152 });
  });
});

describe("blockGapCandidates", () => {
  const candidates = blockGapCandidates({
    blockRects: [
      { bottom: 80, left: 0, top: 50 },
      { bottom: 130, left: 0, top: 100 },
    ],
    rootBottom: 160,
    rootTop: 20,
  });

  it("models the gaps above, between, and below sibling blocks", () => {
    expect(candidates).toEqual([
      { afterIndex: 0, beforeIndex: null, bottom: 50, top: 20 },
      { afterIndex: 1, beforeIndex: 0, bottom: 100, top: 80 },
      { afterIndex: null, beforeIndex: 1, bottom: 160, top: 130 },
    ]);
  });

  it("finds the gap containing a click y-coordinate", () => {
    expect(blockGapAtY(candidates, 90)).toEqual({
      afterIndex: 1,
      beforeIndex: 0,
      bottom: 100,
      top: 80,
    });
    expect(blockGapAtY(candidates, 115)).toBeNull();
  });
});
