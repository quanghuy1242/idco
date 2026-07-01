/**
 * Mark diff (docs/036 R6-C, §5.3): marks matched by `mark.id`, identity-mark attrs
 * compared so a re-pointed link reads as `changed`, and offsets in target space
 * (base space for a removed mark).
 */
import { describe, expect, it } from "vitest";
import { diffMarks, makeTextNode } from "../../packages/editor/src/core";
import { alloc, leaf, mark } from "./diff-fixtures";

function withMarks(
  base: ReturnType<typeof leaf>,
  marks: Parameters<typeof makeTextNode>[0]["marks"],
) {
  return makeTextNode({ content: base.content, id: base.id, marks });
}

describe("diffMarks (R6-C)", () => {
  it("reports an added mark with target-space offsets", () => {
    const base = leaf(alloc("mk_add"), "hello");
    const target = withMarks(base, [mark(base, "b1", "bold", 0, 5)]);
    expect(diffMarks(base, target)).toEqual([
      { from: 0, kind: "bold", op: "added", to: 5 },
    ]);
  });

  it("reports a removed mark", () => {
    const base0 = leaf(alloc("mk_remove"), "hello");
    const base = withMarks(base0, [mark(base0, "b1", "bold", 1, 4)]);
    const target = makeTextNode({ content: base0.content, id: base0.id });
    expect(diffMarks(base, target)).toEqual([
      { from: 1, kind: "bold", op: "removed", to: 4 },
    ]);
  });

  it("reports a changed link href as one `changed`, not remove+add", () => {
    const base0 = leaf(alloc("mk_href"), "click here");
    const base = withMarks(base0, [
      mark(base0, "L", "link", 0, 5, { href: "https://a.example" }),
    ]);
    const target = withMarks(base0, [
      mark(base0, "L", "link", 0, 5, { href: "https://b.example" }),
    ]);
    const changes = diffMarks(base, target);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      attrs: { href: "https://b.example" },
      kind: "link",
      op: "changed",
    });
  });

  it("reports a changed range on the same id as `changed`", () => {
    const base0 = leaf(alloc("mk_range"), "hello");
    const base = withMarks(base0, [mark(base0, "b", "bold", 0, 5)]);
    const target = withMarks(base0, [mark(base0, "b", "bold", 0, 3)]);
    expect(diffMarks(base, target)).toEqual([
      { from: 0, kind: "bold", op: "changed", to: 3 },
    ]);
  });

  it("reports a changed kind on the same id as `changed` (target kind)", () => {
    const base0 = leaf(alloc("mk_kind"), "hello");
    const base = withMarks(base0, [mark(base0, "m", "bold", 0, 5)]);
    const target = withMarks(base0, [mark(base0, "m", "italic", 0, 5)]);
    expect(diffMarks(base, target)).toEqual([
      { from: 0, kind: "italic", op: "changed", to: 5 },
    ]);
  });

  it("reports no change for an identical mark", () => {
    const base0 = leaf(alloc("mk_same"), "hello");
    const m = mark(base0, "b", "bold", 0, 5);
    const base = withMarks(base0, [m]);
    const target = withMarks(base0, [m]);
    expect(diffMarks(base, target)).toEqual([]);
  });

  it("reports a mix of add and remove ordered by offset", () => {
    const base0 = leaf(alloc("mk_mix"), "hello world");
    const base = withMarks(base0, [
      mark(base0, "keep", "bold", 0, 5),
      mark(base0, "gone", "italic", 6, 11),
    ]);
    const target = withMarks(base0, [
      mark(base0, "keep", "bold", 0, 5),
      mark(base0, "new", "underline", 0, 3),
    ]);
    const changes = diffMarks(base, target);
    // `keep` unchanged; `new` added at 0; `gone` removed at 6 — ordered by `from`.
    expect(changes.map((c) => [c.op, c.kind, c.from])).toEqual([
      ["added", "underline", 0],
      ["removed", "italic", 6],
    ]);
  });
});
