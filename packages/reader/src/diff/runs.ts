/**
 * `partitionTextRuns` — the shared text-run partition (docs/039 §6.2 Atom 1).
 *
 * This is the ONE piece of text track-changes both surfaces share. Given a changed leaf's
 * `ReaderTextLeafDiff`, it returns the leaf's runs tagged `keep`/`insert`/`delete`, each with the
 * character ids on the identity path, the run's start offset in the base and target coordinate
 * spaces, and (for a surviving `keep` run) whether it sits under a changed mark. The diff view
 * renders each slice as a read-only span; the editor's woven overlay decorates its own live
 * inserted run and injects an inert deleted-run ghost from the SAME slices. Keeping only the
 * partition here (not the span DOM) is deliberate: the diff view's insert is a tinted read-only
 * span, but the editor's insert is real editable store text, so the span construction must differ
 * while the partition — which chars are inserted/deleted/kept, and where — is identical.
 *
 * Scope: this covers the identity path (`alignment: "id"`), the common case. A `"text"`-alignment
 * leaf (two leaves that shared no character ids — a wholesale rewrite) is a rare whole-unit render
 * that each surface does from its own base/target leaves (the diff view's `fallbackRuns`), because
 * the char-level LCS runs read as noise; those runs still tile, so `partitionTextRuns` maps them
 * faithfully, but a caller may choose to coalesce a `"text"` leaf instead.
 *
 * @categoryDefault Diff View
 */
import type { ReaderTextLeafDiff } from "./types";

/**
 * @categoryDefault Diff View
 */

/**
 * One character id on the identity path (a run's `ids` entry), matching the reader mirror shape.
 */
export type RunSliceId = {
  readonly client: string;
  readonly clock: number;
};

/**
 * One coalesced slice of a changed leaf's text, tagged by op, with the coordinates a renderer needs.
 *
 * `op` is the run kind; `text` is its raw substring. `ids` carries the run's character ids on the
 * identity path (absent on the text-alignment fallback) — the editor keys its live-leaf lookup on
 * them. `baseOffset`/`targetOffset` are the slice's start index in the base and target text (a
 * `delete` advances only base, an `insert` only target, a `keep` both), so a renderer can clamp the
 * side's marks to the slice. `markChanged` is true only for a `keep` slice that overlaps a changed
 * mark range in target coordinates (the dotted-underline cue for a mark-only change).
 */
export type RunSlice = {
  readonly op: "keep" | "insert" | "delete";
  readonly text: string;
  readonly ids?: readonly RunSliceId[];
  readonly baseOffset: number;
  readonly targetOffset: number;
  readonly markChanged: boolean;
};

/**
 * Partition a changed leaf's diff into ordered {@link RunSlice}s (docs/039 §6.2) — the shared
 * text track-changes partition both the diff view and the woven overlay render.
 *
 * Pure: it maps `text.runs` in order, tracking the base and target offsets exactly as the diff
 * view's inline pass does, and flags a `keep` run that overlaps a non-removed mark change so the
 * surface can dotted-underline it. The concatenation of the slices' `text` equals the union text,
 * and the character ids pass through unchanged on the identity path.
 */
export function partitionTextRuns(text: ReaderTextLeafDiff): RunSlice[] {
  // A changed mark is any add/change (a removal lives in the base space and has no surviving run
  // to underline); a `keep` slice overlapping one gets the dotted cue in target coordinates.
  const changedMarks = text.markChanges
    .filter((mc) => mc.op !== "removed")
    .map((mc) => [mc.from, mc.to] as const);
  const slices: RunSlice[] = [];
  let baseOffset = 0;
  let targetOffset = 0;
  for (const run of text.runs) {
    const len = run.text.length;
    if (run.op === "delete") {
      slices.push({
        baseOffset,
        ids: run.ids,
        markChanged: false,
        op: "delete",
        targetOffset,
        text: run.text,
      });
      baseOffset += len;
      continue;
    }
    if (run.op === "insert") {
      slices.push({
        baseOffset,
        ids: run.ids,
        markChanged: false,
        op: "insert",
        targetOffset,
        text: run.text,
      });
      targetOffset += len;
      continue;
    }
    // keep — present on both sides; its dotted cue fires when it overlaps a changed mark (target).
    const markChanged = changedMarks.some(
      ([from, to]) => from < targetOffset + len && to > targetOffset,
    );
    slices.push({
      baseOffset,
      ids: run.ids,
      markChanged,
      op: "keep",
      targetOffset,
      text: run.text,
    });
    baseOffset += len;
    targetOffset += len;
  }
  return slices;
}
