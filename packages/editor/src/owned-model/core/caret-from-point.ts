// docs/010 §6.3 — let the browser hit-test text. There are two APIs with
// different shapes and browser support: `caretPositionFromPoint` (returns a
// `CaretPosition`; Firefox) and `caretRangeFromPoint` (returns a `Range`;
// Chromium/WebKit). This is a feature-detecting wrapper that normalizes both to
// `{ node, offset }`, so the engine never builds hit-testing itself.

export type CaretPoint = {
  readonly node: Node;
  readonly offset: number;
};

type CaretPositionFromPoint = (
  x: number,
  y: number,
) => { offsetNode: Node; offset: number } | null;

export function caretPointFromCoordinates(
  x: number,
  y: number,
  doc: Document = document,
): CaretPoint | null {
  const fromPosition = (
    doc as Document & { caretPositionFromPoint?: CaretPositionFromPoint }
  ).caretPositionFromPoint;
  if (typeof fromPosition === "function") {
    const position = fromPosition.call(doc, x, y);
    return position
      ? { node: position.offsetNode, offset: position.offset }
      : null;
  }

  const fromRange = (
    doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    }
  ).caretRangeFromPoint;
  if (typeof fromRange === "function") {
    const range = fromRange.call(doc, x, y);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }

  return null;
}

/**
 * Map a caret point that lands inside `textNode` (or its descendants) to a
 * character offset into that text node. Returns `null` when the point is not
 * within the node, so the caller can clamp to block edges.
 */
export function offsetWithinText(
  textNode: Text,
  point: CaretPoint | null,
): number | null {
  if (!point) return null;
  if (point.node === textNode) {
    return Math.min(Math.max(0, point.offset), textNode.length);
  }
  // A point can resolve to the containing element; accept it when the text node
  // is the (only) child so the spike's single block still maps cleanly.
  if (point.node === textNode.parentNode) {
    return point.offset <= 0 ? 0 : textNode.length;
  }
  return null;
}
