import {
  headingLevelFromTag,
  richTextNodeText,
  type RichTextHeadingLevel,
} from "@quanghuy1242/idco-lib";
import type {
  RichTextEditorDocument,
  RichTextEditorNode,
} from "../model/schema";
import { ensureDocumentNodeIds } from "./ids";
import {
  resolveLargeDocumentPolicy,
  type RichTextLargeDocumentPolicy,
} from "./policy";
import { richTextSectionSignature } from "./signatures";

export type RichTextDocumentSection = {
  readonly id: string;
  readonly ordinal: number;
  readonly title: string;
  readonly startBlockId: string;
  readonly endBlockId: string;
  readonly blockIds: readonly string[];
  readonly document: RichTextEditorDocument;
  readonly headingAnchorId?: string;
  readonly level?: RichTextHeadingLevel;
  readonly estimatedHeight: number;
  readonly signature: string;
};

type SectionDraft = {
  readonly title: string;
  readonly headingAnchorId?: string;
  readonly level?: RichTextHeadingLevel;
  readonly blocks: readonly RichTextEditorNode[];
};

export function sectionizeDocument(
  document: RichTextEditorDocument,
  policyInput?: RichTextLargeDocumentPolicy,
): readonly RichTextDocumentSection[] {
  const policy = resolveLargeDocumentPolicy(policyInput);
  const identified = ensureDocumentNodeIds(document);
  const headingLevels = new Set(policy.sectionHeadingLevels);
  const headingSections = splitByHeadings(identified, headingLevels);
  const drafts =
    headingSections.length > 0
      ? headingSections
      : chunkBlocks(identified.root.children, policy.fallbackBlocksPerSection);
  const capped = drafts.flatMap((draft) =>
    splitOversizedSection(draft, policy.fallbackBlocksPerSection),
  );
  return capped.map(sectionFromDraft);
}

function splitByHeadings(
  document: RichTextEditorDocument,
  headingLevels: ReadonlySet<number>,
): SectionDraft[] {
  const sections: SectionDraft[] = [];
  let current: RichTextEditorNode[] = [];
  for (const node of document.root.children) {
    if (isSectionHeading(node, headingLevels) && current.length > 0) {
      sections.push(draftFromBlocks(current, sections.length));
      current = [];
    }
    current.push(node);
  }
  if (current.length > 0)
    sections.push(draftFromBlocks(current, sections.length));
  return sections.some((section) => section.level !== undefined)
    ? sections
    : [];
}

function splitOversizedSection(
  section: SectionDraft,
  maxBlocks: number,
): SectionDraft[] {
  if (section.blocks.length <= maxBlocks) return [section];
  return chunkBlocks(section.blocks, maxBlocks).map((chunk, index) => ({
    blocks: chunk.blocks,
    headingAnchorId: section.headingAnchorId,
    level: section.level,
    title: index === 0 ? section.title : `${section.title} part ${index + 1}`,
  }));
}

function chunkBlocks(
  blocks: readonly RichTextEditorNode[],
  chunkSize: number,
): SectionDraft[] {
  const size = Math.max(1, chunkSize);
  const sections: SectionDraft[] = [];
  for (let index = 0; index < blocks.length; index += size) {
    sections.push(
      draftFromBlocks(blocks.slice(index, index + size), sections.length),
    );
  }
  if (sections.length === 0) {
    sections.push({
      blocks: [],
      title: "Empty document",
    });
  }
  return sections;
}

function draftFromBlocks(
  blocks: readonly RichTextEditorNode[],
  ordinal: number,
): SectionDraft {
  const heading = blocks.find((node) => node.type === "heading");
  const title =
    (heading ? richTextNodeText(heading).trim() : "") ||
    (ordinal === 0 ? "Introduction" : `Section ${ordinal + 1}`);
  return {
    blocks,
    ...(heading?.anchorId && typeof heading.anchorId === "string"
      ? { headingAnchorId: heading.anchorId }
      : {}),
    ...(heading ? { level: headingLevelFromTag(heading.tag) } : {}),
    title,
  };
}

function sectionFromDraft(
  draft: SectionDraft,
  ordinal: number,
): RichTextDocumentSection {
  const first = draft.blocks[0] ?? emptyParagraph(ordinal);
  const last = draft.blocks[draft.blocks.length - 1] ?? first;
  const startBlockId = nodeId(first, `rt_empty_${ordinal}`);
  const endBlockId = nodeId(last, startBlockId);
  const blockIds = draft.blocks.map((node, index) =>
    nodeId(node, `${startBlockId}_${index}`),
  );
  const signature = richTextSectionSignature(draft.blocks);
  return {
    blockIds,
    document: { root: { children: draft.blocks } },
    endBlockId,
    estimatedHeight: estimateBlocksHeight(draft.blocks),
    headingAnchorId: draft.headingAnchorId,
    id: sectionId(startBlockId, ordinal),
    level: draft.level,
    ordinal,
    signature,
    startBlockId,
    title: draft.title,
  };
}

function sectionId(startBlockId: string, ordinal: number): string {
  return ordinal === 0 ? startBlockId : `${startBlockId}:section-${ordinal}`;
}

function isSectionHeading(
  node: RichTextEditorNode,
  headingLevels: ReadonlySet<number>,
): boolean {
  return (
    node.type === "heading" && headingLevels.has(headingLevelFromTag(node.tag))
  );
}

function nodeId(node: RichTextEditorNode, fallback: string): string {
  return typeof node.id === "string" && node.id.trim() ? node.id : fallback;
}

function estimateBlocksHeight(blocks: readonly RichTextEditorNode[]): number {
  return Math.max(96, 32 + blocks.length * 44);
}

function emptyParagraph(index: number): RichTextEditorNode {
  return {
    children: [],
    id: `rt_empty_${index}`,
    type: "paragraph",
  };
}
