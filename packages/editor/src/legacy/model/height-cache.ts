import type { RichTextEditorDocument, RichTextEditorNode } from "./schema";

export type SectionHeightCacheKey = {
  readonly sectionId: string;
  readonly signature: string;
};

/**
 * Minimal shape the height estimator needs. Decoupled from the retired section
 * shell's `RichTextDocumentSection` so the cache stays a pure engine core
 * helper: anything carrying a document of blocks can be estimated.
 */
export type SectionHeightInput = {
  readonly document: RichTextEditorDocument;
};

export class RichTextSectionHeightCache {
  readonly #heights = new Map<string, number>();

  get(key: SectionHeightCacheKey): number | undefined {
    return this.#heights.get(cacheKey(key));
  }

  set(key: SectionHeightCacheKey, height: number): void {
    if (Number.isFinite(height) && height > 0) {
      this.#heights.set(cacheKey(key), Math.ceil(height));
    }
  }

  size(): number {
    return this.#heights.size;
  }
}

export function estimatedSectionHeight(section: SectionHeightInput): number {
  return Math.max(
    96,
    32 +
      section.document.root.children.reduce(
        (total, node) => total + estimatedNodeHeight(node),
        0,
      ),
  );
}

function estimatedNodeHeight(node: RichTextEditorNode): number {
  if (node.type === "heading") return 58;
  if (node.type === "paragraph" || node.type === "quote") return 36;
  if (node.type === "code-block" || node.type === "code") return 180;
  if (node.type === "table" || node.type === "editor-table") return 220;
  if (node.type === "media" || node.type === "embed") return 280;
  if (node.type === "callout") return 96;
  if (node.type === "table-of-contents") return 160;
  if (node.type === "list") return 48 + 28 * (node.children?.length ?? 0);
  return 44;
}

function cacheKey({ sectionId, signature }: SectionHeightCacheKey): string {
  return `${sectionId}:${signature}`;
}
