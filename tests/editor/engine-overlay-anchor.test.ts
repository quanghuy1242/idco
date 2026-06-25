// @vitest-environment jsdom
/**
 * Overlay anchor resolver (docs/029 §7.4/§8.2, R1-C). Proves the pure off-window estimate
 * (the virtualized re-anchor via the offset model, docs/025) deterministically, plus the
 * `point` anchor. The mounted-element DOM path needs real layout (covered e2e in Phase 2);
 * jsdom returns zero rects, which is exactly the case that exercises the estimate fallback.
 */
import { describe, expect, it } from "vitest";
import { FlatOffsetModel } from "@idco/editor";
import type { EditorStore, NodeId } from "../../packages/editor/src/core";
import {
  estimateBlockRect,
  resolveAnchorRect,
} from "../../packages/editor/src/view/overlays/overlay-anchor";

const order: readonly NodeId[] = ["a" as NodeId, "b" as NodeId, "c" as NodeId];

describe("estimateBlockRect — virtualized re-anchor (docs/025)", () => {
  it("estimates an off-window block's rect from the offset-model prefix", () => {
    const model = new FlatOffsetModel([100, 120, 80]);
    const rect = estimateBlockRect(
      model,
      order,
      { left: 0, scrollTop: 0, top: 0 },
      "b" as NodeId,
    );
    expect(rect).not.toBeNull();
    expect(rect!.top).toBe(100); // prefix(1)
    expect(rect!.height).toBe(120); // prefix(2) - prefix(1)
  });

  it("subtracts scrollTop and adds the scroller's viewport top", () => {
    const model = new FlatOffsetModel([100, 120, 80]);
    const rect = estimateBlockRect(
      model,
      order,
      { left: 5, scrollTop: 60, top: 40 },
      "c" as NodeId,
    );
    // prefix(2) = 220; viewport top = 40 + (220 - 60) = 200.
    expect(rect!.top).toBe(200);
    expect(rect!.left).toBe(5);
  });

  it("returns null for a block not in the order", () => {
    const model = new FlatOffsetModel([100]);
    expect(
      estimateBlockRect(
        model,
        order,
        { left: 0, scrollTop: 0, top: 0 },
        "z" as NodeId,
      ),
    ).toBeNull();
  });
});

describe("resolveAnchorRect — point (docs/029 §7.4)", () => {
  it("resolves a point anchor to a zero-size rect at the cursor", () => {
    const rect = resolveAnchorRect({} as EditorStore, {
      kind: "point",
      x: 12,
      y: 34,
    });
    expect(rect).toEqual({ height: 0, left: 12, top: 34, width: 0 });
  });
});
