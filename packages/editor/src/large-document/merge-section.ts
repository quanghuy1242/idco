import type { RichTextEditorDocument } from "../model/schema";
import { ensureDocumentNodeIds } from "./ids";
import { sectionizeDocument, type RichTextDocumentSection } from "./sectionize";
import type { RichTextLargeDocumentPolicy } from "./policy";

export type ReplaceSectionResult =
  | { readonly ok: true; readonly document: RichTextEditorDocument }
  | {
      readonly ok: false;
      readonly reason: "missing-section" | "stale-section";
    };

export type ReplaceDocumentSectionOptions = {
  readonly expectedBlockIds?: readonly string[];
  readonly policy?: RichTextLargeDocumentPolicy;
};

export function replaceDocumentSection(
  document: RichTextEditorDocument,
  sectionId: string,
  sectionDocument: RichTextEditorDocument,
  options: ReplaceDocumentSectionOptions = {},
): ReplaceSectionResult {
  const identified = ensureDocumentNodeIds(document);
  const sections = sectionizeDocument(identified, options.policy);
  const section = sections.find((candidate) => candidate.id === sectionId);
  if (!section) return { ok: false, reason: "missing-section" };
  if (
    options.expectedBlockIds &&
    !sameIds(section.blockIds, options.expectedBlockIds)
  ) {
    return { ok: false, reason: "stale-section" };
  }

  const range = sectionRange(identified, section);
  if (!range) return { ok: false, reason: "missing-section" };

  const nextSection = ensureDocumentNodeIds(sectionDocument, {
    previousDocument: section.document,
  });
  const children = [
    ...identified.root.children.slice(0, range.start),
    ...nextSection.root.children,
    ...identified.root.children.slice(range.end + 1),
  ];
  return {
    document: ensureDocumentNodeIds(
      { root: { children } },
      { previousDocument: identified },
    ),
    ok: true,
  };
}

function sectionRange(
  document: RichTextEditorDocument,
  section: RichTextDocumentSection,
): { readonly start: number; readonly end: number } | null {
  const start = document.root.children.findIndex(
    (node) => node.id === section.startBlockId,
  );
  const end = document.root.children.findIndex(
    (node) => node.id === section.endBlockId,
  );
  return start >= 0 && end >= start ? { end, start } : null;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
