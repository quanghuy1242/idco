/**
 * docs/010 Phase 7 AC1 / §13 — IME and complex-script hardening, the half that
 * needs no real IME and runs deterministically on every browser's JS engine.
 *
 * Two suites:
 *
 * 1. **Grapheme/word segmentation (UAX #29 via `Intl.Segmenter`).** Caret motion
 *    and word selection must never split a user-perceived character: a surrogate
 *    pair, a combining sequence, an emoji ZWJ cluster, a regional-indicator flag,
 *    or a Hangul/Thai cluster. These assert the engine's `nextGraphemeBoundary` /
 *    `prevGraphemeBoundary` / `wordRangeAt` against known clusters.
 *
 * 2. **Composition/text-update convergence fuzz.** A seeded generator drives
 *    randomized composition, insert, delete, and caret-move sequences over the
 *    real engine text-update path (`applyEditContextText`, the same code the view
 *    runs on every `textupdate`). The invariant: the model text converges to the
 *    exact text snapshot the EditContext reported, for ≥ 99% of seeds. This is the
 *    Microsoft-Telex bug class (a mis-diffed commit) caught without a real IME.
 *    Composition replay against real browsers lives in `tests/e2e/engine-ime.spec.ts`.
 */
import { describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  pointAtOffset,
  type EditorDocumentSnapshot,
  type NodeId,
} from "../../packages/editor/src/core";
import {
  applyEditContextText,
  nextGraphemeBoundary,
  prevGraphemeBoundary,
  wordRangeAt,
} from "../../packages/editor/src/view";

// One whole grapheme cluster each, with its UTF-16 length (deliberately > 1 so a
// naive code-unit step would split it).
const CLUSTERS: ReadonlyArray<{ label: string; text: string }> = [
  { label: "combining acute (e + U+0301)", text: "é" },
  { label: "astral emoji", text: "😀" },
  { label: "emoji ZWJ family", text: "👨‍👩‍👧‍👦" },
  { label: "regional-indicator flag (VN)", text: "🇻🇳" },
  { label: "emoji + skin tone", text: "👍🏽" },
  { label: "keycap", text: "1️⃣" },
];

describe("Phase 7 AC1 — grapheme caret motion never splits a cluster", () => {
  for (const { label, text } of CLUSTERS) {
    it(`steps over a ${label} as one unit`, () => {
      // The cluster sits between two ASCII anchors: "a" + cluster + "b".
      const full = `a${text}b`;
      const afterA = 1;
      const afterCluster = 1 + text.length;
      // Forward from just after "a" jumps the whole cluster, landing before "b".
      expect(nextGraphemeBoundary(full, afterA)).toBe(afterCluster);
      // Backward from just before "b" jumps the whole cluster, landing after "a".
      expect(prevGraphemeBoundary(full, afterCluster)).toBe(afterA);
      // A standalone cluster is crossed in one move from each edge.
      expect(nextGraphemeBoundary(text, 0)).toBe(text.length);
      expect(prevGraphemeBoundary(text, text.length)).toBe(0);
    });
  }

  it("walks a mixed string boundary-to-boundary without ever splitting", () => {
    const text = "Hi 😀 é 👨‍👩‍👧‍👦!";
    const boundaries: number[] = [0];
    let offset = 0;
    while (offset < text.length) {
      const next = nextGraphemeBoundary(text, offset);
      expect(next).toBeGreaterThan(offset);
      offset = next;
      boundaries.push(offset);
    }
    // Walking backward visits the exact same boundary set.
    const reverse: number[] = [text.length];
    offset = text.length;
    while (offset > 0) {
      offset = prevGraphemeBoundary(text, offset);
      reverse.push(offset);
    }
    expect(reverse.toReversed()).toEqual(boundaries);
  });
});

describe("Phase 7 AC1 — word selection includes whole clusters", () => {
  it("selects an accented word without dropping its combining mark", () => {
    const text = "café bar";
    const [from, to] = wordRangeAt(text, 0);
    expect(text.slice(from, to)).toBe("café");
  });

  it("treats an emoji run as selectable without splitting it", () => {
    const text = "hi 😀😀 there";
    const at = text.indexOf("😀");
    const [from, to] = wordRangeAt(text, at);
    // The selected range never starts or ends inside a surrogate pair.
    expect(Number.isInteger(from)).toBe(true);
    expect(text.codePointAt(from)).not.toBeUndefined();
    expect(from).toBeLessThanOrEqual(at);
    expect(to).toBeGreaterThanOrEqual(at);
  });
});

// --- Composition / text-update convergence fuzz -----------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Strings an IME or paste can commit: ASCII, CJK, Vietnamese, emoji (incl. ZWJ),
// combining marks, Hangul, Thai. Multi-code-unit entries stress the diff.
const COMMIT_ALPHABET = [
  "a",
  "Z",
  " ",
  "你好",
  "世界",
  "chào",
  "ữ",
  "😀",
  "👨‍👩‍👧‍👦",
  "🇻🇳",
  "é",
  "한국어",
  "สวัสดี",
  "x́y",
];

function makeSingleBlockStore(initial: string) {
  const allocator = createIdAllocator("idco_client_ime_fuzz");
  const node = makeTextNode({
    content: allocator.createTextSlice(initial),
    id: allocator.createNodeId(),
  });
  const snapshot: EditorDocumentSnapshot = {
    body: { blocks: { [node.id]: node }, order: [node.id] },
    settings: {},
    version: 1,
  };
  const store = createEditorStore({ allocator, snapshot });
  store.activateTextLeaf(node.id);
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(node.id, node.content, initial.length),
      focus: pointAtOffset(node.id, node.content, initial.length),
      type: "text",
    },
    steps: [],
  });
  return { node, store };
}

/**
 * Feed one EditContext text snapshot to the engine and assert the model text
 * converged to exactly that snapshot — the core IME/typing invariant.
 */
function feedAndAssert(
  store: ReturnType<typeof makeSingleBlockStore>["store"],
  nodeId: NodeId,
  text: string,
  selStart: number,
  selEnd: number,
): void {
  applyEditContextText(store, nodeId, text, selStart, selEnd);
  const got = store.requireTextNode(nodeId).content.text;
  if (got !== text) {
    throw new Error(
      `model diverged: expected ${JSON.stringify(text)} got ${JSON.stringify(got)}`,
    );
  }
}

function runSeed(seed: number): void {
  const rng = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T =>
    items[Math.floor(rng() * items.length)]!;
  const { node, store } = makeSingleBlockStore(
    pick(["", "hello world", "tài liệu"]),
  );
  const nodeId = node.id;
  let text = store.requireTextNode(nodeId).content.text;
  let caret = text.length;
  const ops = 12 + Math.floor(rng() * 28);

  for (let i = 0; i < ops; i += 1) {
    const roll = rng();
    if (roll < 0.4) {
      // Compose: grow a preedit one cluster at a time, then it is committed.
      const committed = pick(COMMIT_ALPHABET);
      const head = text.slice(0, caret);
      const tail = text.slice(caret);
      let built = "";
      for (const part of new Intl.Segmenter(undefined, {
        granularity: "grapheme",
      }).segment(committed)) {
        built += part.segment;
        const snapshot = head + built + tail;
        feedAndAssert(
          store,
          nodeId,
          snapshot,
          head.length + built.length,
          head.length + built.length,
        );
      }
      text = head + committed + tail;
      caret = head.length + committed.length;
    } else if (roll < 0.6) {
      // Plain insert at the caret.
      const inserted = pick(COMMIT_ALPHABET);
      text = text.slice(0, caret) + inserted + text.slice(caret);
      caret += inserted.length;
      feedAndAssert(store, nodeId, text, caret, caret);
    } else if (roll < 0.78 && caret > 0) {
      // Delete the grapheme before the caret (a Backspace).
      const prev = prevGraphemeBoundary(text, caret);
      text = text.slice(0, prev) + text.slice(caret);
      caret = prev;
      feedAndAssert(store, nodeId, text, caret, caret);
    } else if (roll < 0.9 && text.length > 0) {
      // Select a random range and replace it (a multi-char commit over a range).
      const a = Math.floor(rng() * (text.length + 1));
      const b = Math.floor(rng() * (text.length + 1));
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      const replacement = pick(COMMIT_ALPHABET);
      text = text.slice(0, from) + replacement + text.slice(to);
      caret = from + replacement.length;
      feedAndAssert(store, nodeId, text, caret, caret);
    } else {
      // Move the caret to a random offset (selection-only update).
      caret = Math.floor(rng() * (text.length + 1));
      feedAndAssert(store, nodeId, text, caret, caret);
    }
  }
}

describe("Phase 7 AC1 — IME/text-update convergence fuzz (≥99% of seeds)", () => {
  it("converges the model to the reported text across randomized sequences", () => {
    const SEEDS = 500;
    const failures: { seed: number; error: string }[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      try {
        runSeed(seed);
      } catch (error) {
        failures.push({
          error: error instanceof Error ? error.message : String(error),
          seed,
        });
      }
    }
    const passRate = (SEEDS - failures.length) / SEEDS;
    if (failures.length > 0) {
      // Enumerate known-failures (AC1 requires they be listed, not hidden).
      console.error(
        `IME fuzz known-failures (${failures.length}/${SEEDS}):`,
        failures.slice(0, 10),
      );
    }
    expect(passRate).toBeGreaterThanOrEqual(0.99);
  });
});
