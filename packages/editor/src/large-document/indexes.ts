import { headingLevelFromTag, richTextNodeText } from "@quanghuy1242/idco-lib";
import type {
  RichTextEditorDocument,
  RichTextEditorNode,
} from "../model/schema";
import type { RichTextLargeDocumentPolicy } from "./policy";
import { sectionizeDocument, type RichTextDocumentSection } from "./sectionize";

export type RichTextHeadingIndexEntry = {
  readonly sectionId: string;
  readonly nodeId?: string;
  readonly path: string;
  readonly text: string;
  readonly tag: string;
  readonly level: number;
  readonly anchorId?: string;
};

export type RichTextCommentIndexEntry = {
  readonly sectionId: string;
  readonly nodeId?: string;
  readonly path: string;
  readonly ids: readonly string[];
  readonly preview: string;
};

export type RichTextTextRunIndexEntry = {
  readonly sectionId: string;
  readonly nodeId?: string;
  readonly path: string;
  readonly text: string;
};

export type RichTextSearchResult = {
  readonly sectionId: string;
  readonly nodeId?: string;
  readonly path: string;
  readonly text: string;
  readonly preview: string;
  readonly startOffset: number;
  readonly endOffset: number;
};

export type RichTextDocumentIndexes = {
  readonly version: number;
  readonly sections: readonly RichTextDocumentSection[];
  readonly headings: readonly RichTextHeadingIndexEntry[];
  readonly comments: readonly RichTextCommentIndexEntry[];
  readonly textRuns: readonly RichTextTextRunIndexEntry[];
};

export function buildRichTextDocumentIndexes(
  document: RichTextEditorDocument,
  policy?: RichTextLargeDocumentPolicy,
): RichTextDocumentIndexes {
  const sections = sectionizeDocument(document, policy);
  const headings: RichTextHeadingIndexEntry[] = [];
  const comments: RichTextCommentIndexEntry[] = [];
  const textRuns: RichTextTextRunIndexEntry[] = [];
  for (const section of sections) {
    section.document.root.children.forEach((node, index) => {
      visitNode(node, `${index}`, section.id, { comments, headings, textRuns });
    });
  }
  return {
    comments,
    headings,
    sections,
    textRuns,
    version: Date.now(),
  };
}

export function searchRichTextIndexes(
  indexes: RichTextDocumentIndexes,
  query: string,
  limit = 20,
): readonly RichTextSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: RichTextSearchResult[] = [];
  for (const run of indexes.textRuns) {
    const haystack = run.text.toLowerCase();
    let offset = haystack.indexOf(needle);
    while (offset >= 0) {
      results.push({
        endOffset: offset + needle.length,
        nodeId: run.nodeId,
        path: run.path,
        preview: previewText(run.text, offset, needle.length),
        sectionId: run.sectionId,
        startOffset: offset,
        text: run.text,
      });
      if (results.length >= limit) return results;
      offset = haystack.indexOf(needle, offset + needle.length);
    }
  }
  return results;
}

function visitNode(
  node: RichTextEditorNode,
  path: string,
  sectionId: string,
  indexes: {
    readonly headings: RichTextHeadingIndexEntry[];
    readonly comments: RichTextCommentIndexEntry[];
    readonly textRuns: RichTextTextRunIndexEntry[];
  },
): void {
  const text = nodeText(node);
  if (node.type === "heading") {
    indexes.headings.push({
      anchorId: typeof node.anchorId === "string" ? node.anchorId : undefined,
      level: headingLevelFromTag(node.tag),
      nodeId: node.id,
      path,
      sectionId,
      tag: typeof node.tag === "string" ? node.tag : "h2",
      text: text || "Untitled section",
    });
  }
  const ids = commentIds(node);
  if (ids.length > 0) {
    indexes.comments.push({
      ids,
      nodeId: node.id,
      path,
      preview: text,
      sectionId,
    });
  }
  if (text && shouldIndexTextRun(node)) {
    indexes.textRuns.push({
      nodeId: node.id,
      path,
      sectionId,
      text,
    });
  }
  node.children?.forEach((child, index) => {
    visitNode(child, `${path}.${index}`, sectionId, indexes);
  });
}

function shouldIndexTextRun(node: RichTextEditorNode): boolean {
  if (!node.children?.length) return true;
  return node.type === "glossary";
}

function nodeText(node: RichTextEditorNode): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "glossary" && typeof node.term === "string") {
    return `${node.term} ${typeof node.definition === "string" ? node.definition : ""}`.trim();
  }
  if (
    node.type === "media" ||
    node.type === "post-ref" ||
    node.type === "embed"
  ) {
    return [node.title, node.alt, node.caption, node.url, node.postId]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
  }
  return richTextNodeText(node).trim();
}

function commentIds(node: RichTextEditorNode): readonly string[] {
  const ids = node.ids;
  return Array.isArray(ids)
    ? ids.filter((value): value is string => typeof value === "string")
    : [];
}

function previewText(text: string, offset: number, length: number): string {
  const start = Math.max(0, offset - 32);
  const end = Math.min(text.length, offset + length + 32);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end)}${suffix}`;
}
