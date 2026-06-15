export type SelectionAnchorPoint = {
  readonly x: number;
  readonly y: number;
};

function rootContainsNode(root: HTMLElement, node: Node): boolean {
  const target =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  return target ? root.contains(target) : false;
}

function selectedRange(root: HTMLElement): Range | null {
  if (typeof window === "undefined") return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  return rootContainsNode(root, range.commonAncestorContainer) ? range : null;
}

export function selectedRangeRects(root: HTMLElement): readonly DOMRect[] {
  const range = selectedRange(root);
  if (!range) return [];
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  if (rects.length > 0) return rects;
  const fallback = range.getBoundingClientRect();
  return fallback.width > 0 && fallback.height > 0 ? [fallback] : [];
}

export function selectedTextAnchorPoint(
  root: HTMLElement,
): SelectionAnchorPoint | null {
  const rect = selectedRangeRects(root)[0];
  if (!rect) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top,
  };
}

export function pointIntersectsSelectedText(
  root: HTMLElement,
  x: number,
  y: number,
  tolerance = 2,
): boolean {
  return selectedRangeRects(root).some(
    (rect) =>
      x >= rect.left - tolerance &&
      x <= rect.right + tolerance &&
      y >= rect.top - tolerance &&
      y <= rect.bottom + tolerance,
  );
}
