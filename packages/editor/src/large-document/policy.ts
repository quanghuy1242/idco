import type {
  RichTextEditorDocument,
  RichTextEditorNode,
} from "../model/schema";

export type RichTextEditorMode = "standard" | "large-document" | "read-shell";

export type RichTextLargeDocumentPolicy = {
  readonly mode?: RichTextEditorMode | "auto";
  readonly maxStandardBlocks?: number;
  readonly maxStandardDecoratorBlocks?: number;
  readonly sectionHeadingLevels?: readonly number[];
  readonly fallbackBlocksPerSection?: number;
  readonly overscanSections?: number;
};

export type RichTextDocumentScale = {
  readonly rootBlocks: number;
  readonly decoratorBlocks: number;
  readonly tableCells: number;
  readonly totalTextLength: number;
  readonly headings: number;
};

export const DEFAULT_LARGE_DOCUMENT_POLICY = {
  fallbackBlocksPerSection: 50,
  maxStandardBlocks: 300,
  maxStandardDecoratorBlocks: 80,
  mode: "auto",
  overscanSections: 2,
  sectionHeadingLevels: [1, 2],
} as const satisfies Required<RichTextLargeDocumentPolicy>;

const DECORATOR_TYPES = new Set([
  "callout",
  "code",
  "code-block",
  "embed",
  "glossary",
  "media",
  "post-ref",
  "table",
  "editor-table",
  "table-of-contents",
]);

export function resolveLargeDocumentPolicy(
  policy: RichTextLargeDocumentPolicy | undefined,
): Required<RichTextLargeDocumentPolicy> {
  return {
    ...DEFAULT_LARGE_DOCUMENT_POLICY,
    ...policy,
    sectionHeadingLevels:
      policy?.sectionHeadingLevels ??
      DEFAULT_LARGE_DOCUMENT_POLICY.sectionHeadingLevels,
  };
}

export function documentScale(
  document: RichTextEditorDocument,
): RichTextDocumentScale {
  const scale: MutableScale = {
    decoratorBlocks: 0,
    headings: 0,
    rootBlocks: document.root.children.length,
    tableCells: 0,
    totalTextLength: 0,
  };
  for (const node of document.root.children) {
    visitScale(node, scale);
  }
  return scale;
}

export function selectEditorMode(
  document: RichTextEditorDocument,
  policyInput?: RichTextLargeDocumentPolicy,
): RichTextEditorMode {
  const policy = resolveLargeDocumentPolicy(policyInput);
  if (policy.mode && policy.mode !== "auto") return policy.mode;
  const scale = documentScale(document);
  return scale.rootBlocks > policy.maxStandardBlocks ||
    scale.decoratorBlocks > policy.maxStandardDecoratorBlocks
    ? "large-document"
    : "standard";
}

type MutableScale = {
  decoratorBlocks: number;
  headings: number;
  rootBlocks: number;
  tableCells: number;
  totalTextLength: number;
};

function visitScale(node: RichTextEditorNode, scale: MutableScale): void {
  if (DECORATOR_TYPES.has(node.type)) scale.decoratorBlocks += 1;
  if (node.type === "heading" || node.type === "editor-heading") {
    scale.headings += 1;
  }
  if (node.type === "tablecell") scale.tableCells += 1;
  if (typeof node.text === "string") scale.totalTextLength += node.text.length;
  for (const child of node.children ?? []) {
    visitScale(child, scale);
  }
}
