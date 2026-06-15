import { describe, expect, it } from "vitest";
import { RichTextSectionHeightCache } from "../../packages/editor/src/large-document/height-cache";

describe("large document height cache", () => {
  it("keys measured heights by section id and content signature", () => {
    const cache = new RichTextSectionHeightCache();
    cache.set({ sectionId: "s1", signature: "a" }, 123.2);

    expect(cache.get({ sectionId: "s1", signature: "a" })).toBe(124);
    expect(cache.get({ sectionId: "s1", signature: "b" })).toBeUndefined();
    expect(cache.size()).toBe(1);
  });
});
