/**
 * Central overlay positioning solve (docs/029 §7.4, R1-C unit suite). Pure geometry: the
 * start-bias, the viewport flip, and the collision nudge, asserted on plain rect inputs (no
 * DOM — jsdom has no layout engine, so the math must be testable without real rects).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAP,
  solveOverlayPlacements,
  VIEWPORT_MARGIN,
  type EnvelopeLayoutInput,
} from "../../packages/editor/src/view/spi/overlay-positioning";

const viewport = { height: 1000, width: 1000 };

describe("overlay positioning — start-bias + flip (docs/029 §7.4)", () => {
  it("places a `top`-preferring box above its anchor, left-aligned to the anchor (start-bias)", () => {
    const input: EnvelopeLayoutInput = {
      anchor: { height: 20, left: 100, top: 200, width: 0 },
      id: "a",
      prefer: "top",
      size: { height: 30, width: 50 },
      z: 1,
    };
    const [out] = solveOverlayPlacements([input], viewport);
    expect(out!.placement).toBe("top");
    expect(out!.left).toBe(100);
    expect(out!.top).toBe(200 - DEFAULT_GAP - 30);
  });

  it("flips a `top` box to `bottom` when it would clip the viewport top", () => {
    const input: EnvelopeLayoutInput = {
      anchor: { height: 20, left: 10, top: 5, width: 0 },
      id: "a",
      prefer: "top",
      size: { height: 30, width: 50 },
      z: 1,
    };
    const [out] = solveOverlayPlacements([input], viewport);
    expect(out!.placement).toBe("bottom");
    expect(out!.top).toBe(5 + 20 + DEFAULT_GAP);
  });

  it("clamps a box that is wider than the viewport to the left margin", () => {
    const input: EnvelopeLayoutInput = {
      anchor: { height: 0, left: 980, top: 500, width: 0 },
      id: "a",
      prefer: "bottom",
      size: { height: 20, width: 50 },
      z: 1,
    };
    const [out] = solveOverlayPlacements([input], viewport);
    expect(out!.left).toBe(viewport.width - 50 - VIEWPORT_MARGIN);
  });
});

describe("overlay positioning — collision avoidance (docs/029 §7.4)", () => {
  it("nudges the lower-z box below the higher-z box when they overlap", () => {
    const inputs: EnvelopeLayoutInput[] = [
      {
        anchor: { height: 0, left: 0, top: 100, width: 0 },
        id: "hi",
        prefer: "bottom",
        size: { height: 40, width: 100 },
        z: 2,
      },
      {
        anchor: { height: 0, left: 0, top: 100, width: 0 },
        id: "lo",
        prefer: "bottom",
        size: { height: 40, width: 100 },
        z: 1,
      },
    ];
    const out = solveOverlayPlacements(inputs, viewport);
    const hi = out.find((p) => p.id === "hi")!;
    const lo = out.find((p) => p.id === "lo")!;
    expect(hi.top).toBe(100 + DEFAULT_GAP); // higher-z keeps its ideal slot
    expect(lo.top).toBe(hi.top + 40 + DEFAULT_GAP); // lower-z nudged below it
  });

  it("returns placements in the caller's input order, not z order", () => {
    const inputs: EnvelopeLayoutInput[] = [
      {
        anchor: { height: 0, left: 0, top: 100, width: 0 },
        id: "lo",
        prefer: "bottom",
        size: { height: 10, width: 10 },
        z: 1,
      },
      {
        anchor: { height: 0, left: 0, top: 100, width: 0 },
        id: "hi",
        prefer: "bottom",
        size: { height: 10, width: 10 },
        z: 9,
      },
    ];
    const out = solveOverlayPlacements(inputs, viewport);
    expect(out.map((p) => p.id)).toEqual(["lo", "hi"]);
  });
});
