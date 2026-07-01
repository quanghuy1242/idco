/**
 * Generic Myers sequence diff — the one alignment primitive both fall-back paths reuse (docs/036 §5.2/§5.4).
 *
 * Why this file exists
 * --------------------
 * The identity paths (character ids on a leaf, node ids in a scope) are exact and
 * do not need alignment. Two places still need a real longest-common-subsequence
 * alignment:
 *
 * - the text fallback (D4): two leaves that share *no* character-id lineage (a
 *   leaf deleted and retyped, or two unrelated documents) still need a diff, so we
 *   align their raw characters and flag `alignment: "text"`.
 * - block move detection (§5.4): the LCS *spine* of the two child-id lists is the
 *   set of blocks that kept their relative order; a common id off the spine is a
 *   move, not a keep.
 *
 * One correct alignment serves both. This is Myers' O(ND) diff (Eugene Myers,
 * 1986): it walks the edit graph on the diagonal `k = x - y`, recording each
 * round's furthest-reaching path, then backtracks the recorded trace to emit the
 * edit script. O(ND) beats the O(N·M) DP table when the two sequences are similar
 * (the common case — a few edits), and it bounds memory to the trace rather than a
 * full N·M matrix. It is a pure array algorithm: no DOM, no model knowledge, only
 * a caller-supplied key function, so the same code aligns characters and node ids.
 */

/** One aligned step: a character/id kept on both sides, inserted into target, or deleted from base. */
export type SequenceOp<T> = {
  readonly op: "keep" | "insert" | "delete";
  /** The base item for `keep`/`delete`; absent on `insert`. */
  readonly base?: T;
  /** The target item for `keep`/`insert`; absent on `delete`. */
  readonly target?: T;
};

/**
 * Align two sequences into an ordered keep/insert/delete edit script (Myers O(ND)).
 *
 * `keyOf` maps an item to the equality key (a character to itself, a node to its
 * id). The result reads left-to-right in the merged order: a `keep` advances both
 * sides, an `insert` advances target, a `delete` advances base — so replaying it
 * reconstructs both sequences.
 */
export function diffSequences<T>(
  base: readonly T[],
  target: readonly T[],
  keyOf: (item: T) => string = defaultKey,
): SequenceOp<T>[] {
  const n = base.length;
  const m = target.length;
  if (n === 0 && m === 0) return [];
  if (n === 0)
    return target.map((target_) => ({ op: "insert", target: target_ }));
  if (m === 0) return base.map((base_) => ({ op: "delete", base: base_ }));

  const baseKeys = base.map(keyOf);
  const targetKeys = target.map(keyOf);
  const max = n + m;
  const offset = max;
  // `v[offset + k]` is the furthest x reached on diagonal k this round. A fresh
  // copy is pushed to `trace` each round so the backtrack can replay the exact
  // choices that produced the shortest edit path.
  const v = Array.from({ length: 2 * max + 1 }, () => 0);
  const trace: number[][] = [];

  let found = -1;
  outer: for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      // Choose whether we arrived on diagonal k by moving down (an insert from
      // target, k+1) or right (a delete from base, k-1). Ties prefer the down
      // move, which keeps the alignment deterministic across runs.
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      // Follow the diagonal (matching items) as far as it runs — these are `keep`s.
      while (x < n && y < m && baseKeys[x] === targetKeys[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break outer;
      }
    }
  }

  return backtrack(base, target, trace, found, offset);
}

/** Convenience: the ordered longest common subsequence of two sequences (the `keep` items). */
export function longestCommonSubsequence<T>(
  base: readonly T[],
  target: readonly T[],
  keyOf: (item: T) => string = defaultKey,
): T[] {
  const ops = diffSequences(base, target, keyOf);
  const common: T[] = [];
  for (const step of ops) {
    if (step.op === "keep") common.push(step.target as T);
  }
  return common;
}

function backtrack<T>(
  base: readonly T[],
  target: readonly T[],
  trace: readonly number[][],
  found: number,
  offset: number,
): SequenceOp<T>[] {
  // Walk the recorded trace from the end back to the origin. Each round undoes one
  // non-diagonal move (an insert or a delete) plus the diagonal `keep` snake that
  // followed it; the script is built backwards and reversed at the end. Determining
  // insert-vs-delete by `x === prevX` after the snake is exact: a down move leaves
  // x at prevX, a right move leaves x one past it (see the arithmetic in §5.2).
  const script: SequenceOp<T>[] = [];
  let x = base.length;
  let y = target.length;
  for (let d = found; d > 0; d -= 1) {
    const v = trace[d]!;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
        ? k + 1
        : k - 1;
    const prevX = v[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      script.push({ base: base[x], op: "keep", target: target[y] });
    }
    if (x === prevX) {
      y -= 1;
      script.push({ op: "insert", target: target[y] });
    } else {
      x -= 1;
      script.push({ base: base[x], op: "delete" });
    }
  }
  // The leading run before the first recorded move is all matches (d = 0).
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    script.push({ base: base[x], op: "keep", target: target[y] });
  }
  return script.toReversed();
}

function defaultKey(item: unknown): string {
  return String(item);
}
