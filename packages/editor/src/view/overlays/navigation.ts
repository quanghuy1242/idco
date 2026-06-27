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
  childrenOf,
  pendingFormatMarkSteps,
  pointAtOffset,
  replaceTextContent,
  sliceTextContent,
  type EditorSelection,
  type EditorStore,
  type GapSelection,
  type NodeId,
  type Step,
  type TextLeafNode,
  type TextPoint,
} from "../../core";
import { caretClientRect, clampOffset, pointToModelPosition } from "./geometry";

/**
 * @categoryDefault Editing Helpers
 */

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
  const text = current.content.text;
  const offset = selection.focus.offset;
  const scope = store.parentEntry(current.id)?.parent ?? store.bodyId;
  const siblings = childrenOf(store, scope);
  const index = siblings.indexOf(current.id);
  // A same-leaf move stays a text selection (extend keeps the anchor); a move
  // that leaves the leaf may land a real caret in a sibling, a gap beside an
  // atom, or descend into a container (docs/019 §4.10).
  const sameLeaf = (next: number): EditorSelection => {
    const focus = pointAtOffset(current.id, current.content, next);
    return { anchor: extend ? selection.anchor : focus, focus, type: "text" };
  };
  if (key === "ArrowRight") {
    // Move by a whole grapheme cluster, never a half surrogate/cluster (AC1).
    if (offset < text.length)
      return sameLeaf(nextGraphemeBoundary(text, offset));
    return index < 0 ? null : positionAfterBlock(store, scope, index);
  }
  if (key === "ArrowLeft") {
    if (offset > 0) return sameLeaf(prevGraphemeBoundary(text, offset));
    return index < 0 ? null : positionBeforeBlock(store, scope, index);
  }
  if (key === "ArrowDown") {
    return index < 0
      ? null
      : verticalCross(store, scope, index, offset, 1, extend, selection);
  }
  if (key === "ArrowUp") {
    return index < 0
      ? null
      : verticalCross(store, scope, index, offset, -1, extend, selection);
  }
  if (key === "Home") return sameLeaf(0);
  if (key === "End") return sameLeaf(text.length);
  return null;
}

// ---------------------------------------------------------------------------
// Scope-aware position stepping (docs/019 §4.10). These read the store and are
// pure (no DOM); they produce a text caret in a sibling leaf, a gap beside an
// atom, a descend into a container, or a scope-edge gap that a further arrow
// escapes from (`selectionForGapNavigation`).
// ---------------------------------------------------------------------------

function caretAt(
  store: EditorStore,
  id: NodeId,
  offset: number,
): EditorSelection | null {
  const node = store.getNode(id);
  if (!node || node.kind !== "text") return null;
  const point = pointAtOffset(
    id,
    node.content,
    clampOffset(offset, node.content.text.length),
  );
  return { anchor: point, focus: point, type: "text" };
}

function gap(scope: NodeId, index: number): GapSelection {
  return { index, scope, type: "gap" };
}

/** The position at the very start of a scope (descending into containers). */
function firstPositionIn(store: EditorStore, scope: NodeId): EditorSelection {
  const children = childrenOf(store, scope);
  if (children.length === 0) return gap(scope, 0);
  const node = store.getNode(children[0]!);
  if (node?.kind === "text")
    return caretAt(store, children[0]!, 0) ?? gap(scope, 0);
  if (node?.kind === "structural") return firstPositionIn(store, children[0]!);
  return gap(scope, 0); // opens with an atom — rest before it
}

/** The position at the very end of a scope (descending into containers). */
function lastPositionIn(store: EditorStore, scope: NodeId): EditorSelection {
  const children = childrenOf(store, scope);
  if (children.length === 0) return gap(scope, 0);
  const lastId = children[children.length - 1]!;
  const node = store.getNode(lastId);
  if (node?.kind === "text") {
    return (
      caretAt(store, lastId, node.content.text.length) ??
      gap(scope, children.length)
    );
  }
  if (node?.kind === "structural") return lastPositionIn(store, lastId);
  return gap(scope, children.length); // closes with an atom — rest after it
}

/**
 * Whether a scope's edge gap (before the first / after the last child) is a real
 * position the caret can rest at. It is — for an empty scope, beside an atom edge
 * block, or for a nested scope (whose edge gap is the escape rest, §5.7). But at
 * the *body* edge next to a TEXT block it is NOT: the start/end-of-text caret is
 * already that position, so an edge gap there would be a phantom horizontal bar
 * the caret could not reach by clicking (docs/019 §5.8). Returning null keeps
 * arrows in the text, matching a click above/below the first/last block.
 */
function scopeEdgeGap(
  store: EditorStore,
  scope: NodeId,
  index: number,
): EditorSelection | null {
  const children = childrenOf(store, scope);
  const edgeId = index === 0 ? children[0] : children[children.length - 1];
  const edge = edgeId ? store.getNode(edgeId) : undefined;
  if (scope === store.bodyId && edge?.kind === "text") return null;
  return gap(scope, index);
}

/** The position immediately after `children[index]` of `scope`. */
function positionAfterBlock(
  store: EditorStore,
  scope: NodeId,
  index: number,
): EditorSelection | null {
  const children = childrenOf(store, scope);
  const j = index + 1;
  if (j < children.length) {
    const node = store.getNode(children[j]!);
    if (node?.kind === "text")
      return caretAt(store, children[j]!, 0) ?? gap(scope, j);
    if (node?.kind === "structural")
      return firstPositionIn(store, children[j]!);
    return gap(scope, j); // before an atom
  }
  return scopeEdgeGap(store, scope, children.length); // after the last child
}

/** The position immediately before `children[index]` of `scope`. */
function positionBeforeBlock(
  store: EditorStore,
  scope: NodeId,
  index: number,
): EditorSelection | null {
  const children = childrenOf(store, scope);
  if (index > 0) {
    const prevId = children[index - 1]!;
    const node = store.getNode(prevId);
    if (node?.kind === "text") {
      return (
        caretAt(store, prevId, node.content.text.length) ?? gap(scope, index)
      );
    }
    if (node?.kind === "structural") return lastPositionIn(store, prevId);
    return gap(scope, index); // after an atom
  }
  return scopeEdgeGap(store, scope, 0); // before the first child
}

function verticalCross(
  store: EditorStore,
  scope: NodeId,
  index: number,
  offset: number,
  direction: -1 | 1,
  extend: boolean,
  selection: Extract<EditorSelection, { type: "text" }>,
): EditorSelection | null {
  const result =
    direction > 0
      ? positionAfterBlock(store, scope, index)
      : positionBeforeBlock(store, scope, index);
  if (!result) return null;
  // Landing in text keeps the goal-ish column (a block-jump fallback); a gap is
  // returned as-is so a vertical arrow crosses an atom or rests at a doc edge.
  if (result.type === "text") {
    const node = store.getNode(result.focus.node);
    if (node?.kind === "text") {
      const clamped = Math.min(offset, node.content.text.length);
      const focus = pointAtOffset(result.focus.node, node.content, clamped);
      return { anchor: extend ? selection.anchor : focus, focus, type: "text" };
    }
  }
  return result;
}

/**
 * One step from a gap (docs/019 §4.10): cross an atom to the next gap, land a
 * real caret in a text sibling, descend into a container, or — at a non-body
 * scope edge — escape to the parent scope's gap beside this container (§5.7).
 */
export function selectionForGapNavigation(
  store: EditorStore,
  selection: GapSelection,
  key: string,
): EditorSelection | null {
  const { scope, index } = selection;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return stepGap(store, scope, index, 1);
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return stepGap(store, scope, index, -1);
  }
  if (key === "Home") return firstPositionIn(store, scope);
  if (key === "End") return lastPositionIn(store, scope);
  return null;
}

function stepGap(
  store: EditorStore,
  scope: NodeId,
  index: number,
  direction: -1 | 1,
): EditorSelection | null {
  const children = childrenOf(store, scope);
  if (direction > 0) {
    if (index >= children.length) {
      // Scope end: escape to the parent scope's slot after this container.
      if (scope === store.bodyId) return null;
      const entry = store.parentEntry(scope);
      return entry
        ? positionAfterBlock(store, entry.parent, entry.index)
        : null;
    }
    const node = store.getNode(children[index]!);
    if (node?.kind === "text") return caretAt(store, children[index]!, 0);
    if (node?.kind === "structural")
      return firstPositionIn(store, children[index]!);
    return gap(scope, index + 1); // cross the atom
  }
  if (index <= 0) {
    if (scope === store.bodyId) return null;
    const entry = store.parentEntry(scope);
    return entry ? positionBeforeBlock(store, entry.parent, entry.index) : null;
  }
  const prevId = children[index - 1]!;
  const node = store.getNode(prevId);
  if (node?.kind === "text")
    return caretAt(store, prevId, node.content.text.length);
  if (node?.kind === "structural") return lastPositionIn(store, prevId);
  return gap(scope, index - 1); // cross the atom
}

/**
 * Vertical caret movement by visual line, using browser geometry — a
 * document-level iterative probe (docs/019 §4.10, docs/022 §5).
 *
 * docs/011 §8.3 reuses `caretPositionFromPoint`: drop a probe above/below the
 * caret's pixel position and ask the browser which model offset sits there, so a
 * move tracks the rendered line, not just block order. A *single* line-step probe
 * is not enough across a structural boundary: stepping down out of a table cell
 * lands the probe in the cell's padding/border (or the inter-block gap), where
 * `caretPositionFromPoint` resolves to a non-text element and the move stalls.
 *
 * The fix is general: step the probe point progressively further in the travel
 * direction at the goal column until it resolves to a *different* text position —
 * the cell visually below in the same column, the next paragraph, whatever pixel
 * is there — or until it exits the viewport (the probe API only resolves visible
 * points; off-screen targets are the pager's job, docs/018 §2.4). This is the
 * ProseMirror/Word behaviour and is correct for all vertical motion, including
 * across mixed-width body blocks, not only tables (docs/022 §10.3).
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
  const doc = host.ownerDocument;
  const viewportHeight =
    doc.defaultView?.innerHeight || doc.documentElement?.clientHeight || 0;
  const maxY = viewportHeight > 0 ? viewportHeight : 10_000;
  const lineStep = Math.max(8, rect.height || 16);
  // Step ~half a line so a thin target line is never skipped, but cap the number
  // of probes (each is a `caretPositionFromPoint` hit-test) so a press at a doc
  // boundary — where nothing resolves below — can't fan out into hundreds of DOM
  // queries and stall input. ~64 probes crosses several lines / a cell boundary.
  const step = Math.max(4, Math.round(lineStep * 0.5));
  const maxProbes = 64;
  // Prefer the remembered goal column (docs/010 Phase 7 AC7) so a run of vertical
  // moves tracks the original X through ragged lines; the live caret X is the
  // fallback when there is no goal column or it resolves nothing.
  const xs = goalColumn === null ? [rect.left] : [goalColumn, rect.left];
  const baseY = direction < 0 ? rect.top : rect.bottom;
  const anchorScope = store.parentEntry(selection.anchor.node)?.parent;
  let probes = 0;
  for (let distance = Math.round(lineStep * 0.5); ; distance += step) {
    const probeY = baseY + direction * distance;
    if (probeY < 0 || probeY > maxY || (probes += 1) > maxProbes) break;
    for (const x of xs) {
      const hit = pointToModelPosition(doc, x, probeY);
      if (!hit) continue;
      const target = store.getNode(hit.id);
      if (!target) continue;
      // The next visual line is an atom (an image, a divider, a code block
      // inside a cell). An atom has no caret offset — its caret stop is the
      // horizontal gap cursor beside it, which the block-order vertical step
      // (`verticalCross`, reached via the caller's fallback to
      // `selectionForNavigation`) computes. Defer to it instead of stepping the
      // probe *over* the atom to the next text line, which would skip that stop
      // — the regression where ArrowUp/Down no longer walked onto the gap
      // cursor beside an in-cell object (docs/019 §4.9, docs/022 §5). Only an
      // *object* defers; a structural hit (a cell/row/table border the probe
      // merely passes through on its way to the cell below) keeps stepping so
      // text-to-text cross-cell movement still resolves.
      if (target.kind === "object") return null;
      if (target.kind !== "text") continue;
      const focus = pointAtOffset(
        hit.id,
        target.content,
        clampOffset(hit.offset, target.content.text.length),
      );
      if (
        focus.node === selection.focus.node &&
        focus.offset === selection.focus.offset
      ) {
        continue;
      }
      // A shift-extend must stay in one scope: extending into the cell below (a
      // different container) would form a cross-scope text range that is not
      // editable (deleteRange collapses it). Stop at the boundary. A plain
      // collapsed move across the boundary is fine and falls through.
      if (extend && store.parentEntry(focus.node)?.parent !== anchorScope) {
        return null;
      }
      return { anchor: extend ? selection.anchor : focus, focus, type: "text" };
    }
  }
  return null;
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
  if (selection.type === "node") return selection.node;
  // A gap is between blocks, not on any one — no active leaf (docs/019 §4.3).
  return null;
}
