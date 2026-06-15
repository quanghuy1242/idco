import { describe, expect, it } from "vitest";
import { calculateVirtualRange } from "@idco/editor";

describe("large document virtual range", () => {
  it("returns visible indexes plus overscan and aggregate spacer heights", () => {
    const range = calculateVirtualRange({
      getItemSize: () => 100,
      itemCount: 20,
      overscan: 1,
      scrollOffset: 450,
      viewportSize: 250,
    });

    expect(range).toEqual({
      afterHeight: 1200,
      beforeHeight: 300,
      endIndex: 8,
      startIndex: 3,
      totalHeight: 2000,
    });
  });
});
