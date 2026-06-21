/**
 * Undo-history coalescing helpers for the editor store (docs/011 §7.5).
 *
 * These are the `this`-free functions the `EditorStore` dispatch path uses to
 * decide whether a new committed transaction continues the previous typing run
 * (so a burst of keystrokes folds into one undo entry) and to merge two entries
 * into one. Lifted verbatim from the old single-file `store.ts` (docs/020 §7.5).
 */
import {
  resolveBoundaryOffset,
  selectionsEqual,
  type NodeId,
  type TextLeafNode,
  type TextMarkKind,
} from "../model";
import type { CommittedTransaction } from "../steps";

// A typing run within this idle gap coalesces into one undo entry; a longer
// pause opens a fresh group (docs/011 §7.5: "a ~500 ms idle gap").
export const TYPING_COALESCE_MS = 500;

export function nowMs(): number {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

/** The format-mark kinds whose range covers a collapsed caret at `offset`. */
export function marksCoveringCaret(
  node: TextLeafNode,
  offset: number,
): ReadonlySet<TextMarkKind> {
  const covering = new Set<TextMarkKind>();
  for (const mark of node.marks) {
    if (mark.kind === "link") continue;
    const from = resolveBoundaryOffset(node.content, mark.from);
    const to = resolveBoundaryOffset(node.content, mark.to);
    if (from <= offset && offset <= to) covering.add(mark.kind);
  }
  return covering;
}

/**
 * The single text leaf a coalescible typing entry edits, or null when the entry
 * is not a text run on one leaf. Inline mark steps on the same leaf are allowed
 * (sticky pending format marks each typed run, docs/018 §2.0), so formatted
 * typing still coalesces; a node-type/attr/structural step ends the run.
 */
function typingRunNode(entry: CommittedTransaction): NodeId | null {
  if (entry.steps.length === 0) return null;
  let node: NodeId | null = null;
  let hasText = false;
  for (const step of entry.steps) {
    if (step.type === "replace-text") hasText = true;
    else if (step.type !== "add-mark" && step.type !== "remove-mark") {
      return null;
    }
    if (node === null) node = step.node;
    else if (node !== step.node) return null;
  }
  return hasText ? node : null;
}

/** Net character delta of a text-only entry (positive = inserting). */
function typingRunDelta(entry: CommittedTransaction): number {
  let delta = 0;
  for (const step of entry.steps) {
    if (step.type === "replace-text") {
      delta += step.inserted.text.length - step.removed.text.length;
    }
  }
  return delta;
}

/**
 * Whether `next` continues `previous` as one typing run: both pure text edits on
 * the same leaf, the same direction (both inserting or both deleting), and with
 * the caret unmoved between them (`previous.selectionAfter === next.selectionBefore`).
 * Same-direction + continuity is what splits "type, then backspace" into two
 * groups and keeps an IME composition's per-update edits in one (docs/018 §2.2).
 */
export function canCoalesceTyping(
  previous: CommittedTransaction,
  next: CommittedTransaction,
): boolean {
  const node = typingRunNode(previous);
  if (node === null || node !== typingRunNode(next)) return false;
  if (!selectionsEqual(previous.selectionAfter, next.selectionBefore)) {
    return false;
  }
  return typingRunDelta(previous) >= 0 === typingRunDelta(next) >= 0;
}

/** Fold `next` into `previous` as one history entry (steps forward, inverse reversed). */
export function mergeTypingEntries(
  previous: CommittedTransaction,
  next: CommittedTransaction,
): CommittedTransaction {
  return {
    inverse: [...next.inverse, ...previous.inverse],
    origin: previous.origin,
    selectionAfter: next.selectionAfter,
    selectionBefore: previous.selectionBefore,
    settingsChanged: previous.settingsChanged || next.settingsChanged,
    steps: [...previous.steps, ...next.steps],
    structureChanged: previous.structureChanged || next.structureChanged,
    touched: new Set([...previous.touched, ...next.touched]),
  };
}
