/**
 * Selection navigation and text-diff helpers for the owned-model editor view
 * (docs/017 §3.1).
 *
 * Caret/selection movement (arrow keys, vertical line moves, word/line ranges,
 * grapheme boundaries) and the EditContext text-snapshot → model-step diff
 * (docs/011 §9.4). Mostly pure and framework-free; it reads the store and the
 * geometry primitives by parameter, never React. The IME fuzz suite drives
 * `applyEditContextText` directly.
 */
import {
  pendingFormatMarkSteps,
  pointAtOffset,
  replaceTextContent,
  sliceTextContent,
  type EditorSelection,
  type EditorStore,
  type NodeId,
  type Step,
  type TextLeafNode,
  type TextPoint,
} from "../core";
import { caretClientRect, clampOffset, pointToModelPosition } from "./geometry";

export type TextDiff = {
  readonly at: number;
  readonly removed: string;
  readonly inserted: string;
};

export function pointForStoreOffset(
  store: EditorStore,
  nodeId: NodeId,
  offset: number,
): TextPoint {
  const node = store.requireTextNode(nodeId);
  return pointAtOffset(
    node.id,
    node.content,
    clampOffset(offset, node.content.text.length),
  );
}

/** The nearest text leaf to `fromIndex` in `direction`, skipping non-text blocks. */
export function adjacentTextLeaf(
  store: EditorStore,
  fromIndex: number,
  direction: -1 | 1,
): TextLeafNode | null {
  const order = store.order;
  for (
    let i = fromIndex + direction;
    i >= 0 && i < order.length;
    i += direction
  ) {
    const node = store.getNode(order[i]!);
    if (node && node.kind === "text") return node;
  }
  return null;
}

export function selectionForNavigation(
  store: EditorStore,
  selection: Extract<EditorSelection, { type: "text" }>,
  key: string,
  extend: boolean,
): EditorSelection | null {
  const current = store.requireTextNode(selection.focus.node);
  const order = store.order;
  const currentIndex = order.indexOf(current.id);
  let targetNode = current;
  let offset = selection.focus.offset;
  // Non-text blocks (a structural `list` placeholder) are stepped over, not
  // treated as a wall: navigation lands on the nearest text leaf so arrows and
  // shift+arrow cross the list to the next/previous paragraph.
  if (key === "ArrowRight") {
    if (offset < current.content.text.length) {
      // Move by a whole grapheme cluster, never a half surrogate/cluster (AC1).
      offset = nextGraphemeBoundary(current.content.text, offset);
    } else {
      const next = adjacentTextLeaf(store, currentIndex, 1);
      if (!next) return null;
      targetNode = next;
      offset = 0;
    }
  } else if (key === "ArrowLeft") {
    if (offset > 0) {
      offset = prevGraphemeBoundary(current.content.text, offset);
    } else {
      const prev = adjacentTextLeaf(store, currentIndex, -1);
      if (!prev) return null;
      targetNode = prev;
      offset = prev.content.text.length;
    }
  } else if (key === "ArrowDown") {
    const next = adjacentTextLeaf(store, currentIndex, 1);
    if (!next) return null;
    targetNode = next;
    offset = Math.min(offset, targetNode.content.text.length);
  } else if (key === "ArrowUp") {
    const prev = adjacentTextLeaf(store, currentIndex, -1);
    if (!prev) return null;
    targetNode = prev;
    offset = Math.min(offset, targetNode.content.text.length);
  } else if (key === "Home") {
    offset = 0;
  } else if (key === "End") {
    offset = current.content.text.length;
  } else {
    return null;
  }
  const focus = pointAtOffset(targetNode.id, targetNode.content, offset);
  return {
    anchor: extend ? selection.anchor : focus,
    focus,
    type: "text",
  };
}

/**
 * Vertical caret movement by visual line, using browser geometry.
 *
 * docs/011 §8.3 reuses `caretPositionFromPoint`: drop a probe one line above or
 * below the caret's current pixel position and ask the browser which model
 * offset sits there. This moves by the rendered line, so it works inside a
 * wrapped multi-line block, not only block-to-block. A persistent goal column
 * across several presses is the Phase 7 refinement and is not tracked here.
 */
export function verticalNavigation(
  store: EditorStore,
  selection: Extract<EditorSelection, { type: "text" }>,
  host: HTMLElement | null,
  direction: -1 | 1,
  extend: boolean,
  goalColumn: number | null,
): EditorSelection | null {
  if (!host) return null;
  const rect = caretClientRect(host, selection.focus.offset);
  if (!rect) return null;
  const lineStep = Math.max(8, rect.height || 16);
  const probeY =
    direction < 0 ? rect.top - lineStep * 0.5 : rect.bottom + lineStep * 0.5;
  const probe = (x: number): EditorSelection | null => {
    const hit = pointToModelPosition(host.ownerDocument, x, probeY);
    if (!hit) return null;
    const target = store.getNode(hit.id);
    if (!target || target.kind !== "text") return null;
    const focus = pointAtOffset(
      hit.id,
      target.content,
      clampOffset(hit.offset, target.content.text.length),
    );
    return { anchor: extend ? selection.anchor : focus, focus, type: "text" };
  };
  // Prefer the remembered goal column (docs/010 Phase 7 AC7) so a run of vertical
  // moves tracks the original X through ragged lines. But if the goal-column
  // probe yields nothing or does not move the caret, fall back to the live caret
  // X — that keeps the per-line reveal step (and avoids degrading to a whole-block
  // jump) exactly as before the goal column existed.
  const byGoal = goalColumn === null ? null : probe(goalColumn);
  if (byGoal && !samePoint(byGoal, selection)) return byGoal;
  return probe(rect.left);
}

/** Whether a text selection is a collapsed caret (anchor === focus). */
export function isCollapsedSelection(
  selection: Extract<EditorSelection, { type: "text" }>,
): boolean {
  return (
    selection.anchor.node === selection.focus.node &&
    selection.anchor.offset === selection.focus.offset
  );
}

/** Whether a navigation result leaves the caret where it already is. */
export function samePoint(
  next: EditorSelection,
  current: Extract<EditorSelection, { type: "text" }>,
): boolean {
  return (
    next.type === "text" &&
    next.focus.node === current.focus.node &&
    next.focus.offset === current.focus.offset
  );
}

// Word segmentation for double-click selection (docs/011 §8.3: Intl.Segmenter
// supplies the word gesture; we map it to a model range).
export const wordSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "word" })
    : null;

// Grapheme segmentation for caret movement (docs/010 Phase 7 AC1, docs/011
// §5.2/§8.3): ArrowLeft/Right move by a whole user-perceived character so the
// caret never lands inside a surrogate pair, a combining sequence, an emoji ZWJ
// cluster, or a regional-indicator flag.
export const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** The next grapheme-cluster boundary at or after `offset`. */
export function nextGraphemeBoundary(text: string, offset: number): number {
  if (offset >= text.length) return text.length;
  if (!graphemeSegmenter) return offset + 1;
  for (const segment of graphemeSegmenter.segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    if (offset >= start && offset < end) return end;
  }
  return Math.min(offset + 1, text.length);
}

/** The previous grapheme-cluster boundary at or before `offset`. */
export function prevGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  if (!graphemeSegmenter) return offset - 1;
  let boundary = 0;
  for (const segment of graphemeSegmenter.segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    if (offset > start && offset <= end) return start;
    boundary = end;
  }
  return Math.min(boundary, Math.max(0, offset - 1));
}

/** The [start, end) range of the soft-break-delimited line containing `offset`. */
export function lineRangeAt(text: string, offset: number): [number, number] {
  const clamped = Math.max(0, Math.min(text.length, offset));
  const start = text.lastIndexOf("\n", clamped - 1) + 1;
  const nextBreak = text.indexOf("\n", clamped);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return [start, end];
}

/** The [start, end) range of the word at `offset`, or a collapsed point. */
export function wordRangeAt(text: string, offset: number): [number, number] {
  if (!wordSegmenter || text.length === 0) return [offset, offset];
  let result: [number, number] = [offset, offset];
  for (const segment of wordSegmenter.segment(text)) {
    const start = segment.index;
    const end = start + segment.segment.length;
    if (offset >= start && offset < end) {
      result = [start, end];
      if (segment.isWordLike) return result;
    } else if (offset === end && segment.isWordLike) {
      // A click at the trailing edge of a word selects that word.
      result = [start, end];
    }
  }
  return result;
}

/** The exact edit span a `textupdate` event carries (pre-update coordinates). */
export type EditContextRange = {
  /** First offset of the replaced range, in the pre-update text. */
  readonly start: number;
  /** End (exclusive) of the replaced range, in the pre-update text. */
  readonly end: number;
};

/**
 * Apply one EditContext text snapshot to the model (docs/011 §9.4): build the
 * minimal `replace-text` step preserving surrounding character ids, and dispatch
 * with the snapshot's selection. This is the engine's half of the IME/typing
 * contract — the bug surface the Microsoft-Telex regression lived in — so it is a
 * pure, framework-free function the view calls and the IME fuzz suite drives
 * directly.
 *
 * `editRange` is the span the `textupdate` event already reported (the polyfill
 * and native EditContext both supply `updateRangeStart`/`updateRangeEnd`). When
 * present we recover `(at, removed, inserted)` by index math against the new
 * snapshot in O(edit-size), skipping the redundant O(n) prefix/suffix scan the
 * input backend already paid to produce the event. Headless callers (the IME
 * fuzz suite) omit it and fall back to `diffText`.
 *
 * `onBeforeDispatch` lets the view patch the rendered text node and authorize
 * the active-leaf re-render skip immediately before the commit; headless callers
 * omit it. Returns whether anything was dispatched.
 */
export function applyEditContextText(
  store: EditorStore,
  nodeId: NodeId,
  text: string,
  selectionStartRaw: number,
  selectionEndRaw: number,
  onBeforeDispatch?: () => void,
  editRange?: EditContextRange,
): boolean {
  const current = store.requireTextNode(nodeId);
  const diff = editRangeToDiff(current.content.text, text, editRange);
  const selectionStart = clampOffset(selectionStartRaw, text.length);
  const selectionEnd = clampOffset(selectionEndRaw, text.length);
  const selection = store.selection;
  if (
    diff.removed.length === 0 &&
    diff.inserted.length === 0 &&
    selection?.type === "text" &&
    selection.anchor.node === nodeId &&
    selection.anchor.offset === selectionStart &&
    selection.focus.offset === selectionEnd
  ) {
    return false;
  }
  const inserted = store.allocator.createTextSlice(diff.inserted);
  const nextContent = replaceTextContent(
    current.content,
    diff.at,
    diff.removed.length,
    inserted,
  );
  const steps: Step[] =
    diff.removed.length > 0 || diff.inserted.length > 0
      ? [
          {
            at: diff.at,
            inserted,
            node: nodeId,
            removed: sliceTextContent(
              current.content,
              diff.at,
              diff.at + diff.removed.length,
            ),
            type: "replace-text" as const,
          },
        ]
      : [];
  // A sticky pending collapsed-caret format applies to each typed run (docs/018
  // §2.0): any insertion on the pending leaf — including an IME composition update
  // that replaces its own preedit (`removed > 0`) — folds the format's mark steps
  // over the newly inserted text into this same transaction (one undo step, marks
  // anchored to the new content). The store's commit then re-anchors the pending
  // format to the resulting caret (durable across continued typing, an Enter into
  // a new block, deletes, and mid-composition diacritics), and clears it only on a
  // real navigation move. The offset is not required to match, so neither a
  // focus/caret hiccup before the first keystroke nor a tone key can swallow it.
  const pending = store.pendingFormat;
  if (pending && pending.node === nodeId && diff.inserted.length > 0) {
    steps.push(
      ...pendingFormatMarkSteps(
        store,
        pending,
        nodeId,
        diff.at,
        diff.inserted.length,
        nextContent,
      ),
    );
  }
  onBeforeDispatch?.();
  store.dispatch({
    origin: "local",
    selectionAfter: {
      anchor: pointAtOffset(nodeId, nextContent, selectionStart),
      focus: pointAtOffset(nodeId, nextContent, selectionEnd),
      type: "text",
    },
    steps,
  });
  return true;
}

/**
 * Recover the `(at, removed, inserted)` edit from the `textupdate` range when the
 * backend reported one, else fall back to a full diff.
 *
 * The event's `updateRangeStart`/`End` are offsets into `before` (pre-update),
 * and `after` is the post-update buffer, so the inserted run is simply what now
 * occupies the replaced span: its length is `after.length - (before.length -
 * removedLength)`. That is O(1) index math plus two O(edit-size) slices, with no
 * buffer scan — the redundant scan the input backend already paid to build the
 * event is exactly what this skips.
 *
 * The range is the EditContext contract and is treated as authoritative (native
 * consumers apply `updateRange` the same way); the leaf's layout-effect keeps
 * `editContext.text` and the node text in sync, so `before` matches the buffer
 * the range was measured against. The only guard is O(1) arithmetic sanity — if
 * the lengths cannot reconcile (a malformed/desynced range) we fall back to a
 * full `diffText` so a bad range degrades to "slower" and never "wrong".
 */
function editRangeToDiff(
  before: string,
  after: string,
  range: EditContextRange | undefined,
): TextDiff {
  if (!range) return diffText(before, after);
  const start = Math.max(0, Math.min(range.start, before.length));
  const end = Math.max(start, Math.min(range.end, before.length));
  const removedLength = end - start;
  const insertedLength = after.length - (before.length - removedLength);
  if (insertedLength < 0 || start + insertedLength > after.length) {
    return diffText(before, after);
  }
  return {
    at: start,
    inserted: after.slice(start, start + insertedLength),
    removed: before.slice(start, end),
  };
}

export function diffText(before: string, after: string): TextDiff {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start += 1;
  }
  let beforeEnd = before.length;
  let afterEnd = after.length;
  while (
    beforeEnd > start &&
    afterEnd > start &&
    before[beforeEnd - 1] === after[afterEnd - 1]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  return {
    at: start,
    inserted: after.slice(start, afterEnd),
    removed: before.slice(start, beforeEnd),
  };
}

export function patchHostText(element: HTMLElement | null, text: string): void {
  /*
   * While the leaf is active, React keeps reading the pinned snapshot from the
   * store. The visible glyph still has to appear synchronously with the input
   * event, so the controller owns this one textContent patch until the leaf
   * deactivates or a structural command forces a React refresh.
   */
  if (!element) return;
  element.textContent = text.length > 0 ? text : "\u200b";
}

export function activeSelectionNode(
  selection: EditorSelection | null,
): NodeId | null {
  if (!selection) return null;
  if (selection.type === "text") return selection.focus.node;
  return selection.node;
}
