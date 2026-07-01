/**
 * Text-leaf and sequence diff (docs/036 R6-C): the identity character merge, the
 * disjoint text-alignment fallback, run coalescing, and the Myers primitive.
 *
 * The Myers alignment is fuzzed against a DP-LCS oracle: for hundreds of random
 * string pairs the edit script must reconstruct both sides and use exactly an
 * LCS's worth of keeps (a minimal edit). The identity path is checked with
 * `replaceTextContent`, which preserves surviving character ids exactly as the
 * store's edit path does.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  characterIdsForSlice,
  createTextSliceFromIds,
  diffSequences,
  diffTextLeaf,
  makeTextNode,
  replaceTextContent,
  resetDevInvariants,
  setDevInvariants,
} from "../../packages/editor/src/core";
import { alloc, leaf } from "./diff-fixtures";

function ops(base: string, target: string) {
  return diffSequences([...base], [...target], (c) => c);
}

function reconstruct(script: ReturnType<typeof ops>) {
  const baseSide = script
    .filter((s) => s.op !== "insert")
    .map((s) => s.base)
    .join("");
  const targetSide = script
    .filter((s) => s.op !== "delete")
    .map((s) => s.target)
    .join("");
  return { baseSide, targetSide };
}

function lcsLength(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      dp[i + 1]![j + 1] =
        a[i] === b[j]
          ? dp[i]![j]! + 1
          : Math.max(dp[i]![j + 1]!, dp[i + 1]![j]!);
    }
  }
  return dp[a.length]![b.length]!;
}

describe("diffSequences — Myers alignment (R6-C)", () => {
  it("handles the degenerate empty cases", () => {
    expect(ops("", "")).toEqual([]);
    expect(ops("", "ab").map((s) => s.op)).toEqual(["insert", "insert"]);
    expect(ops("ab", "").map((s) => s.op)).toEqual(["delete", "delete"]);
    expect(ops("abc", "abc").every((s) => s.op === "keep")).toBe(true);
  });

  it("reconstructs both sides and uses a minimal (LCS-length) number of keeps for random pairs", () => {
    const alphabet = "abcde";
    for (let trial = 0; trial < 600; trial += 1) {
      const a = randomString(alphabet, 8);
      const b = randomString(alphabet, 8);
      const script = ops(a, b);
      const { baseSide, targetSide } = reconstruct(script);
      expect(baseSide).toBe(a);
      expect(targetSide).toBe(b);
      const keeps = script.filter((s) => s.op === "keep").length;
      expect(keeps).toBe(lcsLength(a, b));
    }
  });
});

describe("diffTextLeaf — identity path (R6-C)", () => {
  afterEach(() => resetDevInvariants());

  it("reports an inserted phrase as keep/insert/keep with correct ids", () => {
    const a = alloc("txt_insert");
    const base = leaf(a, "Hello world");
    const target = makeTextNode({
      content: replaceTextContent(
        base.content,
        5,
        0,
        a.createTextSlice(" big"),
      ),
      id: base.id,
    });
    const diff = diffTextLeaf(base, target);
    expect(diff.alignment).toBe("id");
    expect(diff.runs.map((r) => [r.op, r.text])).toEqual([
      ["keep", "Hello"],
      ["insert", " big"],
      ["keep", " world"],
    ]);
    // The surviving keep run carries the base leaf's original character ids.
    const baseIds = characterIdsForSlice(base.content);
    expect(diff.runs[0]!.ids).toEqual(baseIds.slice(0, 5));
  });

  it("reports a deletion as keep/delete", () => {
    const a = alloc("txt_delete");
    const base = leaf(a, "Hello world");
    const target = makeTextNode({
      content: replaceTextContent(base.content, 5, 6, a.createTextSlice("")),
      id: base.id,
    });
    const diff = diffTextLeaf(base, target);
    expect(diff.alignment).toBe("id");
    expect(diff.runs.map((r) => [r.op, r.text])).toEqual([
      ["keep", "Hello"],
      ["delete", " world"],
    ]);
  });

  it("reports a mid-word replacement as keep + target-then-deleted (§5.1)", () => {
    const a = alloc("txt_replace");
    const base = leaf(a, "Hello");
    const target = makeTextNode({
      content: replaceTextContent(base.content, 1, 4, a.createTextSlice("i")),
      id: base.id,
    });
    const diff = diffTextLeaf(base, target);
    expect(diff.alignment).toBe("id");
    // Co-located insert/delete emit target-then-deleted: keep H, insert i, delete ello.
    expect(diff.runs.map((r) => [r.op, r.text])).toEqual([
      ["keep", "H"],
      ["insert", "i"],
      ["delete", "ello"],
    ]);
  });

  it("keeps a middle deletion in place, not bunched at the end", () => {
    const a = alloc("txt_mid");
    const base = leaf(a, "abcXYZdef");
    const target = makeTextNode({
      content: replaceTextContent(base.content, 3, 3, a.createTextSlice("")),
      id: base.id,
    });
    const diff = diffTextLeaf(base, target);
    expect(diff.runs.map((r) => [r.op, r.text])).toEqual([
      ["keep", "abc"],
      ["delete", "XYZ"],
      ["keep", "def"],
    ]);
  });

  it("returns a single keep run for an identical leaf and nothing for an empty leaf", () => {
    const a = alloc("txt_same");
    const base = leaf(a, "unchanged");
    const same = makeTextNode({ content: base.content, id: base.id });
    const diff = diffTextLeaf(base, same);
    expect(diff.runs).toEqual([
      {
        ids: characterIdsForSlice(base.content),
        op: "keep",
        text: "unchanged",
      },
    ]);

    const e = alloc("txt_empty");
    const empty = leaf(e, "");
    expect(
      diffTextLeaf(
        empty,
        makeTextNode({ content: empty.content, id: empty.id }),
      ).runs,
    ).toEqual([]);
  });

  it("treats typing from empty and emptying as clean all-insert / all-delete on the id path", () => {
    const a = alloc("txt_fromempty");
    const empty = leaf(a, "");
    const filled = makeTextNode({
      content: replaceTextContent(
        empty.content,
        0,
        0,
        a.createTextSlice("abc"),
      ),
      id: empty.id,
    });
    const inserted = diffTextLeaf(empty, filled);
    expect(inserted.alignment).toBe("id");
    expect(inserted.runs.map((r) => [r.op, r.text])).toEqual([
      ["insert", "abc"],
    ]);

    const emptied = diffTextLeaf(
      filled,
      makeTextNode({ content: empty.content, id: empty.id }),
    );
    expect(emptied.alignment).toBe("id");
    expect(emptied.runs.map((r) => [r.op, r.text])).toEqual([
      ["delete", "abc"],
    ]);
  });

  it("coalesces consecutive same-op characters into one run", () => {
    const a = alloc("txt_coalesce");
    const base = leaf(a, "ac");
    const target = makeTextNode({
      content: replaceTextContent(base.content, 1, 0, a.createTextSlice("bbb")),
      id: base.id,
    });
    const diff = diffTextLeaf(base, target);
    expect(diff.runs.map((r) => [r.op, r.text])).toEqual([
      ["keep", "a"],
      ["insert", "bbb"],
      ["keep", "c"],
    ]);
    expect(diff.runs[1]!.ids).toHaveLength(3);
  });
});

describe("diffTextLeaf — text fallback (R6-C)", () => {
  afterEach(() => resetDevInvariants());

  it("falls back to text alignment when two non-empty leaves share no id lineage", () => {
    const base = leaf(alloc("fb_base"), "the quick fox");
    const target = leaf(alloc("fb_target"), "the quiet fox");
    const diff = diffTextLeaf(base, target);
    expect(diff.alignment).toBe("text");
    // No ids on the fallback path.
    expect(diff.runs.every((r) => r.ids === undefined)).toBe(true);
    // Reconstructs both sides.
    const baseSide = diff.runs
      .filter((r) => r.op !== "insert")
      .map((r) => r.text)
      .join("");
    const targetSide = diff.runs
      .filter((r) => r.op !== "delete")
      .map((r) => r.text)
      .join("");
    expect(baseSide).toBe("the quick fox");
    expect(targetSide).toBe("the quiet fox");
  });

  it("downgrades to text fallback when a shared id maps to different characters (invariants off)", () => {
    setDevInvariants(false);
    const a = alloc("fb_collide");
    const slice = a.createTextSlice("A");
    const base = makeTextNode({ content: slice, id: a.createNodeId() });
    const ids = characterIdsForSlice(slice);
    const target = makeTextNode({
      content: createTextSliceFromIds("B", ids),
      id: base.id,
    });
    const diff = diffTextLeaf(base, target);
    expect(diff.alignment).toBe("text");
    expect(diff.runs.map((r) => [r.op, r.text])).toEqual([
      ["delete", "A"],
      ["insert", "B"],
    ]);
  });

  it("throws on a same-id character mismatch when dev invariants are on", () => {
    setDevInvariants(true);
    const a = alloc("fb_collide2");
    const slice = a.createTextSlice("A");
    const base = makeTextNode({ content: slice, id: a.createNodeId() });
    const target = makeTextNode({
      content: createTextSliceFromIds("B", characterIdsForSlice(slice)),
      id: base.id,
    });
    expect(() => diffTextLeaf(base, target)).toThrow(/character id/);
  });
});

function randomString(alphabet: string, maxLen: number): string {
  const len = Math.floor(Math.random() * (maxLen + 1));
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
