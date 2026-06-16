// docs/010 Phase 2 helper: the spike still owns one plain-text model string,
// but the DOM may split that string across spans for temporary format demos.
// These helpers keep model offsets authoritative while letting the browser keep
// doing text layout and hit-testing.

import type { CaretPoint } from "./caret-from-point";

export type TextDomPosition = {
  readonly node: Text;
  readonly offset: number;
};

export type TextDomMapper = {
  /** Invalidate cached text nodes after the rendered text DOM is replaced. */
  readonly markDirty: () => void;
  /** Return the current model-text length represented by rendered text nodes. */
  readonly textLength: () => number;
  /** Return the model character before an offset, skipping layout markers. */
  readonly characterBeforeOffset: (offset: number) => string | null;
  /** Convert a model offset to the rendered DOM text node/offset pair. */
  readonly textPositionFromModelOffset: (
    offset: number,
  ) => TextDomPosition | null;
  /** Convert browser hit-test output back to a model offset. */
  readonly modelOffsetFromCaretPoint: (
    point: CaretPoint | null,
  ) => number | null;
};

/**
 * Return whether a DOM text node belongs to the model text, not to an
 * engine-only measurement/layout marker. The trailing-newline marker and
 * temporary caret probe contain real text nodes, so the offset mapper must
 * deliberately skip them.
 */
function isModelTextNode(node: Text): boolean {
  const parent = node.parentElement;
  return !parent?.closest(
    "[data-owned-trailing-line],[data-owned-caret-probe]",
  );
}

/**
 * Iterate all DOM text nodes that represent the model string. This is tiny and
 * intentionally DOM-based because Phase 2 is proving browser layout/hit-test
 * integration, not building the Phase 3 model store.
 */
function collectModelTextNodes(textElement: HTMLElement): readonly Text[] {
  const doc = textElement.ownerDocument;
  const walker = doc.createTreeWalker(textElement, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text && isModelTextNode(current)) {
      nodes.push(current);
    }
    current = walker.nextNode();
  }
  return nodes;
}

/**
 * Create a cached model-offset mapper for one rendered text surface. Offset
 * conversion sits on the caret hot path, so rebuilding a TreeWalker on every
 * arrow key or pointer move would be wasteful. The controller marks this mapper
 * dirty only after it replaces the rendered text DOM.
 */
export function createTextDomMapper(textElement: HTMLElement): TextDomMapper {
  let dirty = true;
  let cachedNodes: readonly Text[] = [];
  let cachedTextLength = 0;

  /** Return cached model text nodes, refreshing only after a dirty mark. */
  function nodes(): readonly Text[] {
    if (dirty) {
      cachedNodes = collectModelTextNodes(textElement);
      cachedTextLength = cachedNodes.reduce(
        (sum, node) => sum + node.length,
        0,
      );
      dirty = false;
    }
    return cachedNodes;
  }

  return {
    markDirty(): void {
      dirty = true;
    },

    textLength(): number {
      nodes();
      return cachedTextLength;
    },

    characterBeforeOffset(offset: number): string | null {
      const target = Math.min(
        Math.max(0, Math.floor(offset)),
        this.textLength(),
      );
      if (target <= 0) return null;

      let remaining = target;
      for (const node of nodes()) {
        if (remaining <= node.length) {
          return node.data[remaining - 1] ?? null;
        }
        remaining -= node.length;
      }
      return null;
    },

    textPositionFromModelOffset(offset: number): TextDomPosition | null {
      let remaining = Math.max(0, Math.floor(offset));
      let last: Text | null = null;

      for (const node of nodes()) {
        const length = node.length;
        if (remaining <= length) {
          return { node, offset: remaining };
        }
        remaining -= length;
        last = node;
      }

      return last ? { node: last, offset: last.length } : null;
    },

    modelOffsetFromCaretPoint(point: CaretPoint | null): number | null {
      if (!point) return null;

      let base = 0;
      for (const node of nodes()) {
        if (point.node === node) {
          return base + Math.min(Math.max(0, point.offset), node.length);
        }
        base += node.length;
      }

      if (point.node === textElement) {
        return point.offset <= 0 ? 0 : base;
      }
      return null;
    },
  };
}
