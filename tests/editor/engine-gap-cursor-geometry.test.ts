/**
 * docs/019 §4.9/§5.8 — gap-cursor geometry. Pure rect math for the horizontal
 * insertion marker and the click hit-test bands, ported off the legacy Lexical
 * plugin into the owned model's `{scope, index}` coordinate. No DOM here — the
 * overlay supplies measured client rects; these functions only do arithmetic.
 */
import { describe, expect, it } from "vitest";
import {
  gapAtY,
  gapCandidates,
  gapMarkerRect,
  gapVisualAnchors,
  type RectLike,
} from "../../packages/editor/src/view/overlays";

const block = (top: number, bottom: number): RectLike => ({
  bottom,
  left: 20,
  right: 220,
  top,
});

/** A full-width column block (the body): every block overlaps it horizontally. */
const wide = (top: number, bottom: number): RectLike => ({
  bottom,
  left: 69,
  right: 815,
  top,
});

describe("gapMarkerRect", () => {
  it("centers a horizontal bar in the gap between two blocks, spanning the content width", () => {
    const marker = gapMarkerRect({
      height: 2,
      nextTop: 120,
      prevBottom: 100,
      scopeBottom: 400,
      scopeLeft: 20,
      scopeRight: 220,
      scopeTop: 0,
    });
    // Centered in [100, 120].
    expect(marker.top).toBe(109);
    expect(marker.left).toBe(20);
    expect(marker.width).toBe(200);
    expect(marker.height).toBe(2);
  });

  it("pins to the scope top when the gap opens the scope (before the first block)", () => {
    const marker = gapMarkerRect({
      height: 2,
      nextTop: 40,
      prevBottom: null,
      scopeBottom: 400,
      scopeLeft: 20,
      scopeRight: 220,
      scopeTop: 10,
    });
    // Centered in [scopeTop=10, nextTop=40].
    expect(marker.top).toBe(24);
  });

  it("pins to the scope bottom when the gap closes the scope (after the last block)", () => {
    const marker = gapMarkerRect({
      height: 2,
      nextTop: null,
      prevBottom: 360,
      scopeBottom: 400,
      scopeLeft: 20,
      scopeRight: 220,
      scopeTop: 10,
    });
    // Centered in [prevBottom=360, scopeBottom=400].
    expect(marker.top).toBe(379);
  });

  it("falls back to a minimum width and respects insets", () => {
    const marker = gapMarkerRect({
      leftInset: 4,
      nextTop: 12,
      prevBottom: 10,
      rightInset: 4,
      scopeBottom: 100,
      scopeLeft: 0,
      scopeRight: 10, // narrower than minWidth
      scopeTop: 0,
    });
    expect(marker.left).toBe(4);
    expect(marker.width).toBe(24); // minWidth floor
  });
});

describe("gapVisualAnchors (docs/039 R-GI — review ghost in the store-gap)", () => {
  it("raises the top edge to just above `next` when a ghost sits in the interior gap", () => {
    // The reproduced layout: intro (…–234), removed-para GHOST (234–268), table (280–334). The raw
    // store-gap is [234, 280] and spans the ghost; the corrected top edge is the ghost's bottom (268),
    // so the marker lands in the real [268, 280] gap just above the table, not centered in the ghost.
    const edges = gapVisualAnchors({
      nextTop: 280,
      occupants: [
        wide(174, 234), // intro (prev) — starts above the gap, excluded
        wide(234, 268), // removed-para ghost — the occupant inside the gap
        wide(280, 334), // table (next) — ends below the gap, excluded
      ],
      prevBottom: 234,
      scopeBottom: 900,
      scopeLeft: 69,
      scopeRight: 815,
      scopeTop: 0,
    });
    expect(edges).toEqual({ nextTop: 280, prevBottom: 268, scopeBottom: 900 });
  });

  it("is a no-op for an interior gap with no ghost (the normal editing path)", () => {
    const edges = gapVisualAnchors({
      nextTop: 120,
      occupants: [wide(80, 100), wide(120, 160)],
      prevBottom: 100,
      scopeBottom: 400,
      scopeLeft: 69,
      scopeRight: 815,
      scopeTop: 0,
    });
    expect(edges).toEqual({ nextTop: 120, prevBottom: 100, scopeBottom: 400 });
  });

  it("picks the ghost closest to `next` when several sit in one gap", () => {
    const edges = gapVisualAnchors({
      nextTop: 300,
      occupants: [
        wide(100, 140), // prev
        wide(140, 180), // ghost 1
        wide(180, 230), // ghost 2 (lowest, closest to next)
        wide(300, 340), // next
      ],
      prevBottom: 140,
      scopeBottom: 900,
      scopeLeft: 69,
      scopeRight: 815,
      scopeTop: 0,
    });
    expect(edges.prevBottom).toBe(230);
  });

  it("ignores an occupant that does not overlap the scope column (a nested/other-column block)", () => {
    // A block sitting in the gap's Y-band but in a different column (e.g. a sibling cell) must not be
    // mistaken for a ghost in THIS gap.
    const edges = gapVisualAnchors({
      nextTop: 280,
      occupants: [
        wide(174, 234),
        { bottom: 268, left: 900, right: 1100, top: 234 }, // off to the right, no column overlap
        wide(280, 334),
      ],
      prevBottom: 234,
      scopeBottom: 900,
      scopeLeft: 69,
      scopeRight: 815,
      scopeTop: 0,
    });
    expect(edges.prevBottom).toBe(234); // unchanged — the off-column block was ignored
  });

  it("clamps scopeBottom up to the true content bottom when the box under-reports (virtualized ghost)", () => {
    // The reproduced virtualized bug: a review ghost's height is not in the scope's virtual total, so
    // the scope box bottom (481) sits ABOVE the last block (the callout, bottom 505). A trailing gap
    // pinned to 481 would paint mid-document; clamping the effective scope bottom to 505 keeps the
    // end marker at/below the last block. (No `next`, so this is the end-of-document gap.)
    const edges = gapVisualAnchors({
      nextTop: null,
      occupants: [
        wide(134, 174), // heading
        wide(174, 234), // intro
        wide(234, 268), // removed-para ghost (uncounted in the virtual total)
        wide(280, 334), // table
        wide(346, 505), // callout (prev) — overflows the 481 box bottom
      ],
      prevBottom: 505,
      scopeBottom: 481, // the too-short virtualized box bottom
      scopeLeft: 69,
      scopeRight: 815,
      scopeTop: 134,
    });
    expect(edges).toEqual({ nextTop: null, prevBottom: 505, scopeBottom: 505 });
  });

  it("lowers the bottom edge to a trailing ghost for an end-of-scope gap", () => {
    // Gap closes the scope (next = null). A removed LAST block renders as a trailing ghost below prev;
    // the end marker should sit above it (an insertion at the live end goes above the removed block).
    const edges = gapVisualAnchors({
      nextTop: null,
      occupants: [wide(300, 360), wide(370, 410)], // prev, then a trailing ghost
      prevBottom: 360,
      scopeBottom: 500,
      scopeLeft: 69,
      scopeRight: 815,
      scopeTop: 0,
    });
    expect(edges).toEqual({ nextTop: 370, prevBottom: 360, scopeBottom: 500 });
  });

  it("is a no-op for a trailing gap with no trailing ghost (pins to scope bottom)", () => {
    const edges = gapVisualAnchors({
      nextTop: null,
      occupants: [wide(300, 360)],
      prevBottom: 360,
      scopeBottom: 500,
      scopeLeft: 69,
      scopeRight: 815,
      scopeTop: 0,
    });
    expect(edges).toEqual({ nextTop: null, prevBottom: 360, scopeBottom: 500 });
  });

  it("leaves a leading gap (no prev) pinned to the scope top", () => {
    const edges = gapVisualAnchors({
      nextTop: 40,
      occupants: [wide(40, 80)],
      prevBottom: null,
      scopeBottom: 400,
      scopeLeft: 69,
      scopeRight: 815,
      scopeTop: 0,
    });
    expect(edges).toEqual({ nextTop: 40, prevBottom: null, scopeBottom: 400 });
  });
});

describe("gapCandidates / gapAtY", () => {
  const rects = [block(10, 30), block(40, 80), block(90, 110)];
  const atomicFlags = [false, true, false]; // middle block is an atom

  it("produces one band per slot, flagging slots adjacent to an atom", () => {
    const candidates = gapCandidates({
      atomicFlags,
      rects,
      scopeBottom: 200,
      scopeTop: 0,
    });
    expect(candidates.map((c) => c.index)).toEqual([0, 1, 2, 3]);
    // Slot 1 (between block0 and the atom) and slot 2 (between the atom and
    // block2) are atom-adjacent; slots 0 and 3 are not.
    expect(candidates.map((c) => c.atomic)).toEqual([false, true, true, false]);
  });

  it("hit-tests a Y to the band that contains it", () => {
    const candidates = gapCandidates({
      atomicFlags,
      rects,
      scopeBottom: 200,
      scopeTop: 0,
    });
    // Between block0 (bottom 30) and the atom (top 40): slot 1.
    expect(gapAtY(candidates, 35)?.index).toBe(1);
    // After the last block (bottom 110): slot 3.
    expect(gapAtY(candidates, 150)?.index).toBe(3);
  });

  it("paints a single slot for an empty scope", () => {
    const candidates = gapCandidates({
      atomicFlags: [],
      rects: [],
      scopeBottom: 200,
      scopeTop: 0,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ atomic: false, index: 0 });
  });
});
