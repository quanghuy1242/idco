import { describe, expect, it } from "vitest";
import { computeCollapsedIds, type CollapseItem } from "@idco/ui";

/**
 * Pure collapse math (the `nextCollapseCount` analogue for a heterogeneous, priority-
 * ordered row). No DOM — widths are injected — so the decision is unit-testable the way
 * the toolbar layout is (note.md §"Pure width math").
 */
const widths = (map: Record<string, number>) => (id: string) => map[id] ?? 0;

describe("computeCollapsedIds", () => {
  it("collapses nothing when the row fits", () => {
    const items: CollapseItem[] = [
      { collapsible: true, id: "a", priority: 0 },
      { collapsible: true, id: "b", priority: 0 },
      { collapsible: true, id: "c", priority: 0 },
    ];
    const out = computeCollapsedIds(
      100,
      items,
      widths({ a: 10, b: 10, c: 10 }),
      10,
      0,
    );
    expect(out.size).toBe(0);
  });

  it("collapses the lowest-priority item first", () => {
    const items: CollapseItem[] = [
      { collapsible: true, id: "a", priority: 2 },
      { collapsible: true, id: "b", priority: 1 },
      { collapsible: true, id: "c", priority: 3 },
    ];
    // Full row = 30 > 28; collapsing just b (lowest priority) fits: a + c + menu = 28.
    const out = computeCollapsedIds(
      28,
      items,
      widths({ a: 10, b: 10, c: 10 }),
      8,
      0,
    );
    expect([...out]).toEqual(["b"]);
  });

  it("breaks a priority tie by collapsing the later item first", () => {
    const items: CollapseItem[] = [
      { collapsible: true, id: "a", priority: 0 },
      { collapsible: true, id: "b", priority: 0 },
    ];
    // Full = 20 > 18; collapsing the later item (b) fits: a + menu = 18.
    const out = computeCollapsedIds(18, items, widths({ a: 10, b: 10 }), 8, 0);
    expect([...out]).toEqual(["b"]);
  });

  it("never collapses a keep-inline item, even if the row still overflows", () => {
    const items: CollapseItem[] = [
      { collapsible: false, id: "chooser", priority: 1 },
      { collapsible: true, id: "b", priority: 2 },
      { collapsible: true, id: "c", priority: 3 },
    ];
    const out = computeCollapsedIds(
      40,
      items,
      widths({ b: 10, c: 10, chooser: 50 }),
      8,
      0,
    );
    expect(out.has("chooser")).toBe(false);
    expect(out.has("b")).toBe(true);
    expect(out.has("c")).toBe(true);
  });

  it("collapses every collapsible item when the container has no width", () => {
    const items: CollapseItem[] = [
      { collapsible: false, id: "keep", priority: 1 },
      { collapsible: true, id: "b", priority: 2 },
      { collapsible: true, id: "c", priority: 3 },
    ];
    const out = computeCollapsedIds(
      0,
      items,
      widths({ b: 10, c: 10, keep: 10 }),
      8,
      0,
    );
    expect([...out].sort()).toEqual(["b", "c"]);
  });
});
