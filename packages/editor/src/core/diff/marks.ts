/**
 * Mark diff by `mark.id`, with identity-mark attr comparison (docs/036 §5.3, R6-C).
 *
 * Why this file exists
 * --------------------
 * A `TextMark` carries a stable `id` (the same substrate comments and links anchor
 * on), so a mark diff is an identity diff one layer below the block level: a mark
 * only in target is `added`, only in base is `removed`, in both with a different
 * kind / attrs / resolved range is `changed`. Matching by id is what makes a
 * re-pointed link href or a re-threaded comment read as one `changed` mark instead
 * of a remove-plus-add — the identity win the whole diff design rests on (D1).
 *
 * Offsets are resolved (via `resolveLeafMarks`) into the leaf's concrete character
 * offsets and reported in the *target* coordinate space, except a `removed` mark,
 * which the target no longer carries and so is reported in base space.
 */
import {
  resolveLeafMarks,
  type ResolvedMark,
  type TextLeafNode,
} from "../model";
import { attrDiffIsEmpty, diffAttrs } from "./attrs";
import type { MarkChange } from "./types";

/**
 * Diff the marks of two versions of one text leaf, matched by `mark.id` (§5.3).
 *
 * Empty or inverted marks are dropped by `resolveLeafMarks` before matching, so a
 * mark that collapsed to nothing on one side reads as absent there. The result is
 * ordered by offset for a stable display.
 */
export function diffMarks(
  base: TextLeafNode,
  target: TextLeafNode,
): readonly MarkChange[] {
  const baseMarks = new Map<string, ResolvedMark>();
  for (const mark of resolveLeafMarks(base)) baseMarks.set(mark.id, mark);
  const targetMarks = new Map<string, ResolvedMark>();
  for (const mark of resolveLeafMarks(target)) targetMarks.set(mark.id, mark);

  const changes: MarkChange[] = [];
  for (const mark of targetMarks.values()) {
    const before = baseMarks.get(mark.id);
    if (!before) {
      changes.push(markChange("added", mark));
    } else if (
      before.kind !== mark.kind ||
      before.from !== mark.from ||
      before.to !== mark.to ||
      !attrDiffIsEmpty(diffAttrs(before.attrs, mark.attrs))
    ) {
      // Report the target state (kind/attrs/offsets), so a changed link shows its
      // new href and range. `removed`, below, reports the base state instead.
      changes.push(markChange("changed", mark));
    }
  }
  for (const mark of baseMarks.values()) {
    if (!targetMarks.has(mark.id)) changes.push(markChange("removed", mark));
  }

  return changes.sort(
    (a, b) => a.from - b.from || a.to - b.to || a.op.localeCompare(b.op),
  );
}

function markChange(op: MarkChange["op"], mark: ResolvedMark): MarkChange {
  return {
    ...(mark.attrs ? { attrs: mark.attrs } : {}),
    from: mark.from,
    kind: mark.kind,
    op,
    to: mark.to,
  };
}
