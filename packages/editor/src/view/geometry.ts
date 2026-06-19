/**
 * Pure DOM geometry for the owned-model editor view (docs/017 §3.1).
 *
 * The browser owns text layout and hit-testing; this module is the thin,
 * framework-free wrapper that turns model offsets into pixel rects and pointer
 * coordinates into model positions (docs/010 §6.3). It touches the DOM and the
 * store (read-only, by parameter) but never React. The selection overlay and the
 * navigation module build on these primitives.
 *
 * Multi-text-node mapping (Phase 8 AC3): a leaf now renders its marks as nested
 * semantic elements (`mark-render.tsx`), so a block's text is spread across many
 * descendant text nodes instead of one. Every offset↔DOM mapping therefore walks
 * the block's text nodes in document order, treating the concatenation as the
 * leaf's text. `segmentText` guarantees that concatenation equals the model text,
 * so a model offset stays a plain index into it. The unformatted case (one text
 * node) is just the one-element walk, so the fast path is preserved.
 */
import type { EditorStore, NodeId } from "../core";

export function isTextNode(node: Node): boolean {
  return node.nodeType === node.TEXT_NODE;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clampOffset(offset: number, length: number): number {
  return Math.min(Math.max(0, Math.floor(offset)), length);
}

export function firstTextNode(element: HTMLElement): Text | null {
  return textNodesOf(element)[0] ?? null;
}

/** Every descendant text node of `host`, in document order. */
export function textNodesOf(host: HTMLElement): Text[] {
  const doc = host.ownerDocument;
  const textNodeType = doc.defaultView?.Node.TEXT_NODE ?? 3;
  const nodes: Text[] = [];
  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === textNodeType) nodes.push(child as Text);
      else walk(child);
    }
  };
  walk(host);
  return nodes;
}

/** The total rendered text length of a block (sum of its text nodes). */
export function hostTextLength(host: HTMLElement): number {
  let total = 0;
  for (const node of textNodesOf(host)) total += node.textContent?.length ?? 0;
  return total;
}

/**
 * Resolve a model offset to the DOM `(text node, local offset)` it lands on. The
 * offset is clamped to the rendered length; ties at a text-node boundary prefer
 * the *end* of the earlier node so a caret after a mark run still measures.
 */
export function resolveOffsetToDom(
  host: HTMLElement,
  offset: number,
): { node: Text; offset: number } | null {
  const nodes = textNodesOf(host);
  if (nodes.length === 0) return null;
  const target = clampOffset(offset, hostTextLength(host));
  let consumed = 0;
  for (const node of nodes) {
    const length = node.textContent?.length ?? 0;
    if (target <= consumed + length) {
      return { node, offset: target - consumed };
    }
    consumed += length;
  }
  const last = nodes[nodes.length - 1]!;
  return { node: last, offset: last.textContent?.length ?? 0 };
}

/** Convert a DOM position inside `host` to a model offset (the inverse map). */
export function modelOffsetFromDom(
  host: HTMLElement,
  domNode: Node,
  domOffset: number,
): number {
  const nodes = textNodesOf(host);
  // A caret landing on an element (not a text node) reports a child index; sum
  // the text length of every text node before that child position.
  if (!isTextNode(domNode)) {
    const children = Array.from(domNode.childNodes).slice(0, domOffset);
    let before = 0;
    for (const child of children) {
      before += child.textContent?.length ?? 0;
    }
    // Add the text in earlier siblings of `domNode` up the tree to the host.
    return before + textLengthBefore(host, domNode, nodes);
  }
  let consumed = 0;
  for (const node of nodes) {
    if (node === domNode) return consumed + domOffset;
    consumed += node.textContent?.length ?? 0;
  }
  return consumed;
}

/** Sum the length of every text node in `host` that precedes `boundary`. */
function textLengthBefore(
  host: HTMLElement,
  boundary: Node,
  nodes: readonly Text[],
): number {
  let total = 0;
  for (const node of nodes) {
    const position = boundary.compareDocumentPosition(node);
    // Node precedes boundary: DOCUMENT_POSITION_PRECEDING (2).
    if (position & Node.DOCUMENT_POSITION_PRECEDING) {
      total += node.textContent?.length ?? 0;
    }
  }
  void host;
  return total;
}

/** A DOM `Range` over the model offsets `[from, to)`, spanning mark elements. */
export function modelRange(
  host: HTMLElement,
  from: number,
  to: number,
): Range | null {
  const start = resolveOffsetToDom(host, from);
  const end = resolveOffsetToDom(host, to);
  if (!start || !end) return null;
  const range = host.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/** Bounding rect of a block's full rendered text, or null. */
export function textBoundingRect(host: HTMLElement): DOMRect | null {
  const range = modelRange(host, 0, hostTextLength(host));
  if (!range || typeof range.getBoundingClientRect !== "function") return null;
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? rect : null;
}

/** Feature-detect the two browser point-to-caret APIs. */
export function caretPositionAtPoint(
  doc: Document,
  clientX: number,
  clientY: number,
): { readonly node: Node; readonly offset: number } | null {
  const withPosition = doc as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof withPosition.caretPositionFromPoint === "function") {
    const position = withPosition.caretPositionFromPoint(clientX, clientY);
    return position
      ? { node: position.offsetNode, offset: position.offset }
      : null;
  }
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }
  return null;
}

/** Map a client point to the block id and the model offset it falls on. */
export function pointToModelPosition(
  doc: Document,
  clientX: number,
  clientY: number,
): { readonly id: NodeId; readonly offset: number } | null {
  const caret = caretPositionAtPoint(doc, clientX, clientY);
  if (!caret) return null;
  const element =
    caret.node.nodeType === caret.node.TEXT_NODE
      ? caret.node.parentElement
      : (caret.node as Element);
  const block = element?.closest<HTMLElement>("[data-engine-block-id]");
  const id = block?.getAttribute("data-engine-block-id");
  if (!id) return null;
  // The hit offset is local to one descendant text node; convert it to the
  // block-level model offset by walking the block's text nodes (AC3).
  const offset = modelOffsetFromDom(block!, caret.node, caret.offset);
  return { id: id as NodeId, offset };
}

/**
 * Resolve any pointer position to a model text point, mapping to the nearest
 * text leaf when the pointer lands on a non-text block (the `[list]` placeholder)
 * or misses the content (the white gaps). This is what lets a drag or a gap
 * click pass through a placeholder instead of hitting a wall, and what places
 * the caret in the nearest paragraph when clicking the empty area below the text.
 */
export function resolveTextPointAt(
  store: EditorStore,
  root: HTMLElement,
  clientX: number,
  clientY: number,
): { node: NodeId; offset: number } | null {
  const direct = pointToModelPosition(root.ownerDocument, clientX, clientY);
  if (direct) {
    const node = store.getNode(direct.id);
    if (node && node.kind === "text")
      return { node: direct.id, offset: direct.offset };
  }
  // Pick the mounted text block whose vertical span is nearest the pointer.
  let best: {
    id: NodeId;
    el: HTMLElement;
    below: boolean;
    dist: number;
  } | null = null;
  for (const el of root.querySelectorAll<HTMLElement>(
    "[data-engine-block-id]",
  )) {
    const id = el.getAttribute("data-engine-block-id") as NodeId;
    const node = store.getNode(id);
    if (!node || node.kind !== "text") continue;
    const rect = el.getBoundingClientRect();
    const dist =
      clientY < rect.top
        ? rect.top - clientY
        : clientY > rect.bottom
          ? clientY - rect.bottom
          : 0;
    if (!best || dist < best.dist) {
      best = { below: clientY > rect.bottom, dist, el, id };
    }
  }
  if (!best) return null;
  const offset = offsetFromClientPoint(best.el, clientX, clientY);
  if (offset !== null) return { node: best.id, offset };
  const node = store.requireTextNode(best.id);
  return { node: best.id, offset: best.below ? node.content.text.length : 0 };
}

/**
 * Map a client point to a model offset within one block.
 *
 * A click in the block's padding or at its left/right/top/bottom edge makes
 * `caretPositionFromPoint` miss the text node (it returns the block element with
 * a child index, or a neighbour), which previously dropped the caret at the end
 * of the block. We clamp the point into the text's bounding box and retry, so an
 * edge click lands on the nearest character — the reliable behaviour a user
 * expects when clicking just outside the glyphs.
 */
export function offsetFromClientPoint(
  host: HTMLElement,
  clientX: number,
  clientY: number,
): number | null {
  const direct = caretPositionAtPoint(host.ownerDocument, clientX, clientY);
  if (direct && host.contains(direct.node)) {
    return modelOffsetFromDom(host, direct.node, direct.offset);
  }
  const textRect = textBoundingRect(host);
  if (textRect) {
    const cx = clampNumber(clientX, textRect.left + 1, textRect.right - 1);
    const cy = clampNumber(clientY, textRect.top + 1, textRect.bottom - 1);
    const clamped = caretPositionAtPoint(host.ownerDocument, cx, cy);
    if (clamped && host.contains(clamped.node)) {
      return modelOffsetFromDom(host, clamped.node, clamped.offset);
    }
  }
  return null;
}

/** Pixel rect of the collapsed caret at an offset inside one block. */
export function caretClientRect(
  host: HTMLElement,
  offset: number,
): DOMRect | null {
  return robustCaretRect(host, offset) ?? host.getBoundingClientRect();
}

/**
 * A single-line-height caret rect for a collapsed position, robust across soft
 * line breaks and across mark-element boundaries (AC3). A collapsed `Range`
 * returns no client rects at a `\n` boundary (and at the end of a block ending in
 * `\n`), so we measure a neighbouring character and place a zero-width caret at
 * its edge — never the block's full bounding box, which made the caret as tall as
 * the block and grow per line.
 */
export function robustCaretRect(
  host: HTMLElement,
  offset: number,
): DOMRect | null {
  const length = hostTextLength(host);
  if (length === 0 && textNodesOf(host).length === 0) return null;
  const text = host.textContent ?? "";
  const at = clampOffset(offset, length);

  if (at > 0 && text[at - 1] === "\n") {
    const r = softBreakCaretRect(host, text, at);
    if (r) return r;
  }

  const collapsed = boundingRectOf(host, at, at);
  if (collapsed && collapsed.height > 0) return collapsed;

  // Caret sitting just after a visible character: its right edge.
  if (at > 0 && text[at - 1] !== "\n") {
    const r = edgeRectOf(host, at - 1, at, "last");
    if (r) return makeRect(r.right, r.top, 0, r.height);
  }
  // Caret sitting just before a visible character: its left edge.
  if (at < length && text[at] !== "\n") {
    const r = edgeRectOf(host, at, at + 1, "first");
    if (r) return makeRect(r.left, r.top, 0, r.height);
  }
  // Line boundary or empty line: measure the adjoining box and take its start.
  if (at < length) {
    const r = edgeRectOf(host, at, Math.min(length, at + 1), "first");
    if (r) return makeRect(r.left, r.top, 0, r.height);
  }
  if (at > 0) {
    const r = edgeRectOf(host, at - 1, at, "last");
    if (r) return makeRect(r.left, r.top, 0, r.height);
  }
  return null;
}

/**
 * Browser `Range` geometry reports a selected `\n` on the previous visual line.
 * That is correct for highlighting the break character, but wrong for the
 * collapsed caret after Shift+Enter: the caret belongs at the start of the next
 * line even when there is no following glyph to measure. We synthesize that
 * missing empty-line rect from the previous measurable line plus the computed
 * line-height, preserving the glyph-height from the previous rect when possible.
 */
export function softBreakCaretRect(
  host: HTMLElement,
  text: string,
  offset: number,
): DOMRect | null {
  const lineHeight = computedLineHeight(host);
  const contentLeft = contentBoxLeft(host);
  const contentTop = contentBoxTop(host);
  let previousRect: DOMRect | null = null;
  let previousIndex = -1;

  for (let i = offset - 2; i >= 0; i -= 1) {
    if (text[i] === "\n") continue;
    previousRect = edgeRectOf(host, i, i + 1, "last");
    if (previousRect) {
      previousIndex = i;
      break;
    }
  }

  const breakCount = softBreakCount(text, previousIndex + 1, offset);
  if (breakCount === 0) return null;
  const baseTop = previousRect?.top ?? contentTop;
  const height = previousRect?.height ?? lineHeight;
  return makeRect(contentLeft, baseTop + lineHeight * breakCount, 0, height);
}

/** Bounding rect of the model range `[from, to)`, or null in a layout-less DOM. */
export function boundingRectOf(
  host: HTMLElement,
  from: number,
  to: number,
): DOMRect | null {
  const range = modelRange(host, from, to);
  if (!range || typeof range.getBoundingClientRect !== "function") return null;
  return range.getBoundingClientRect();
}

/** First or last positive-height client rect of the model range `[from, to)`. */
export function edgeRectOf(
  host: HTMLElement,
  from: number,
  to: number,
  pick: "first" | "last",
): DOMRect | null {
  const range = modelRange(host, from, to);
  if (!range || typeof range.getClientRects !== "function") return null;
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
  if (rects.length === 0) return null;
  return pick === "first" ? rects[0]! : rects[rects.length - 1]!;
}

export function computedLineHeight(element: HTMLElement): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const lineHeight = cssPx(style?.lineHeight);
  if (lineHeight !== null) return lineHeight;
  const fontSize = cssPx(style?.fontSize);
  return fontSize !== null ? fontSize * 1.2 : 18;
}

export function contentBoxLeft(element: HTMLElement): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return (
    element.getBoundingClientRect().left + (cssPx(style?.paddingLeft) ?? 0)
  );
}

export function contentBoxTop(element: HTMLElement): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return element.getBoundingClientRect().top + (cssPx(style?.paddingTop) ?? 0);
}

export function cssPx(value: string | undefined): number | null {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function softBreakCount(text: string, from: number, to: number): number {
  let count = 0;
  for (let i = Math.max(0, from); i < Math.min(text.length, to); i += 1) {
    if (text[i] === "\n") count += 1;
  }
  return count;
}

export function makeRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    toJSON: () => ({}),
    top,
    width,
    x: left,
    y: top,
  } as DOMRect;
}

/** A real `DOMRect` (required by native EditContext bounds), or the input in SSR. */
export function toDomRect(rect: {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}): DOMRect {
  if (typeof DOMRect === "function") {
    return new DOMRect(rect.left, rect.top, rect.width, rect.height);
  }
  return rect as DOMRect;
}

export function textRangeClientRects(
  element: HTMLElement,
  from: number,
  to: number,
): readonly DOMRect[] {
  /*
   * The production path is real DOM Range geometry. That lets the browser own line
   * wrapping, font metrics, bidi fragments, and subpixel layout while the engine
   * owns which model offsets are selected. The range spans mark elements (AC3).
   * jsdom has no layout engine, so callers fall back to deterministic
   * block-relative rectangles only when Range produces no measurable rects.
   */
  const length = hostTextLength(element);
  const range = modelRange(
    element,
    clampOffset(from, length),
    clampOffset(to, length),
  );
  if (
    !range ||
    typeof range.getClientRects !== "function" ||
    typeof range.getBoundingClientRect !== "function"
  ) {
    return [];
  }
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 || rect.height > 0,
  );
  if (rects.length > 0) return rects;
  const rect = range.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0 ? [rect] : [];
}

/**
 * One viewport-space rect per character in `[from, to)`, for IME character
 * bounds (docs/010 §7.4, Phase 7 AC4/AC5). Native `updateCharacterBounds`
 * expects one box per code unit so the candidate window aligns to the glyphs.
 */
export function characterClientRects(
  element: HTMLElement,
  from: number,
  to: number,
): DOMRect[] {
  const length = hostTextLength(element);
  const start = clampOffset(from, length);
  const end = clampOffset(to, length);
  const rects: DOMRect[] = [];
  for (let index = start; index < end; index += 1) {
    const range = modelRange(element, index, index + 1);
    if (!range || typeof range.getBoundingClientRect !== "function") break;
    rects.push(range.getBoundingClientRect());
  }
  return rects;
}
