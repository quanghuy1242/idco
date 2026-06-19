/**
 * Mark segmentation for rendering (docs/010 Phase 8 AC3).
 *
 * Why this file exists
 * --------------------
 * A text leaf stores one string plus a set of overlapping `TextMark` ranges
 * (011 §4); it never stores split nodes. To render formatting the view must turn
 * that overlapping-range model into a flat, ordered list of non-overlapping
 * segments, each carrying the exact set of marks that cover it. Splitting at
 * every mark boundary is the standard "interval flattening" used by every
 * rich-text renderer; doing it here keeps it pure, framework-free, and shared by
 * the editor's live text block, its resting render, and the reader (docs/015).
 *
 * The output is the contract the view's DOM-offset geometry depends on: the
 * concatenation of every segment's text equals the leaf's full text, in order,
 * so a model offset is still a plain index into that concatenation even though
 * the DOM is now many text nodes across nested mark elements (AC3).
 */
import {
  resolveBoundaryOffset,
  type TextLeafNode,
  type TextMark,
  type TextMarkKind,
} from "./model";

/** A mark resolved to concrete `[from, to)` offsets in the leaf's text. */
export type ResolvedMark = {
  readonly id: string;
  readonly kind: TextMarkKind;
  readonly from: number;
  readonly to: number;
  readonly attrs?: TextMark["attrs"];
};

/** A maximal run of text covered by one constant set of marks. */
export type TextSegment = {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /** The marks covering this segment, in document (start-offset) order. */
  readonly marks: readonly ResolvedMark[];
};

/** Resolve every mark on a leaf to concrete offsets, dropping empty/inverted ranges. */
export function resolveLeafMarks(node: TextLeafNode): readonly ResolvedMark[] {
  const resolved: ResolvedMark[] = [];
  for (const mark of node.marks) {
    const from = resolveBoundaryOffset(node.content, mark.from);
    const to = resolveBoundaryOffset(node.content, mark.to);
    if (to <= from) continue;
    resolved.push({
      ...(mark.attrs ? { attrs: mark.attrs } : {}),
      from,
      id: mark.id,
      kind: mark.kind,
      to,
    });
  }
  return resolved;
}

/**
 * Flatten `text` plus its resolved marks into ordered, non-overlapping segments.
 *
 * Boundaries are the set of every mark start and end (plus 0 and the text end),
 * so each resulting segment has a constant mark set. The marks on a segment are
 * sorted by start offset then length so nested rendering is deterministic
 * (outermost mark first), which keeps the rendered DOM stable across edits.
 */
export function segmentText(
  text: string,
  marks: readonly ResolvedMark[],
): readonly TextSegment[] {
  if (text.length === 0) return [];
  if (marks.length === 0) {
    return [{ from: 0, marks: [], text, to: text.length }];
  }
  const boundaries = new Set<number>([0, text.length]);
  for (const mark of marks) {
    if (mark.from > 0) boundaries.add(mark.from);
    if (mark.to < text.length) boundaries.add(mark.to);
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  const segments: TextSegment[] = [];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const from = ordered[i]!;
    const to = ordered[i + 1]!;
    if (to <= from) continue;
    const covering = marks
      .filter((mark) => mark.from <= from && mark.to >= to)
      .sort((a, b) => a.from - b.from || b.to - a.to);
    segments.push({ from, marks: covering, text: text.slice(from, to), to });
  }
  return segments;
}

/** Convenience: resolve and segment a leaf in one call. */
export function segmentLeaf(node: TextLeafNode): readonly TextSegment[] {
  return segmentText(node.content.text, resolveLeafMarks(node));
}
