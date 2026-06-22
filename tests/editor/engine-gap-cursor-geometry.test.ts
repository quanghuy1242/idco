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
  type RectLike,
} from "../../packages/editor/src/view/overlays";

const block = (top: number, bottom: number): RectLike => ({
  bottom,
  left: 20,
  right: 220,
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
