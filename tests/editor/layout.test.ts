import { describe, expect, it } from "vitest";
import {
  blockHandleDropOffset,
  resizeColumnWidths,
  splitColumnWidths,
  tableSeedAvailableWidth,
} from "../../packages/editor-legacy/src/model/layout";

const sum = (widths: readonly number[]) => widths.reduce((a, b) => a + b, 0);

describe("splitColumnWidths (table seeding)", () => {
  it("splits evenly and fills the frame exactly when divisible", () => {
    expect(splitColumnWidths(900, 3)).toEqual([300, 300, 300]);
  });

  it("folds the rounding remainder into the last column so widths sum exactly", () => {
    const widths = splitColumnWidths(1000, 3);
    expect(widths).toEqual([333, 333, 334]);
    expect(sum(widths)).toBe(1000);
  });

  it("returns nothing for non-positive column counts", () => {
    expect(splitColumnWidths(500, 0)).toEqual([]);
  });

  it("uses the editor width instead of tiny intrinsic empty-table width", () => {
    expect(
      tableSeedAvailableWidth({
        columns: 3,
        editorWidth: 900,
        tableWidth: 122,
        wrapperWidth: 0,
      }),
    ).toBe(900);
  });

  it("falls back to a usable minimum when no layout width is available", () => {
    expect(
      tableSeedAvailableWidth({
        columns: 3,
        editorWidth: 0,
        tableWidth: 122,
        wrapperWidth: 0,
      }),
    ).toBe(360);
  });
});

describe("resizeColumnWidths (boundary drag)", () => {
  const widths = [200, 200, 200];

  it("conserves the total width so the table never leaves a gap on the right", () => {
    expect(sum(resizeColumnWidths(widths, 0, 60, 48))).toBe(sum(widths));
    expect(sum(resizeColumnWidths(widths, 0, -60, 48))).toBe(sum(widths));
  });

  it("trades width with the adjacent (right) column only", () => {
    expect(resizeColumnWidths(widths, 0, 60, 48)).toEqual([260, 140, 200]);
    expect(resizeColumnWidths(widths, 1, -30, 48)).toEqual([200, 170, 230]);
  });

  it("clamps so neither the dragged nor the adjacent column underflows minWidth", () => {
    // Dragging far left can't push the left column below 48 (the user's gap bug
    // was the table shrinking instead of the neighbour absorbing the space).
    const narrowed = resizeColumnWidths(widths, 0, -500, 48);
    expect(narrowed).toEqual([48, 352, 200]);
    const widened = resizeColumnWidths(widths, 0, 500, 48);
    expect(widened).toEqual([352, 48, 200]);
    expect(sum(narrowed)).toBe(600);
  });
});

describe("blockHandleDropOffset (gutter handle)", () => {
  it("drops the handle to the centre of the gap below a tall block", () => {
    // Lexical's menu centre starts at top + lineHeight/2; adding this offset
    // should land it at block bottom + gap/2.
    const height = 100;
    const gap = 16;
    const lineHeight = 24;
    const offset = blockHandleDropOffset(height, gap, lineHeight);
    const menuCentreFromTop = lineHeight / 2 + offset;
    expect(menuCentreFromTop).toBe(height + gap / 2);
  });

  it("lands at the block's bottom edge when there is no gap to the next block", () => {
    // height 24, lineHeight 24, gap 0 → menu centre at 24/2 + offset = bottom.
    const offset = blockHandleDropOffset(24, 0, 24);
    expect(24 / 2 + offset).toBe(24);
  });

  it("clamps an oversized margin so the handle can't fly far past the block", () => {
    expect(blockHandleDropOffset(24, 200, 24, 32)).toBe(24 + 32 / 2 - 24 / 2);
  });
});
