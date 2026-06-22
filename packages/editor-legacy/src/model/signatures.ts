import { richTextNodeText } from "@quanghuy1242/idco-lib";
import type { RichTextEditorDocument, RichTextEditorNode } from "./schema";

export function richTextDocumentSignature(
  document: RichTextEditorDocument,
): string {
  return hashString(JSON.stringify(document.root.children.map(nodeSignature)));
}

export function richTextSectionSignature(
  nodes: readonly RichTextEditorNode[],
): string {
  return hashString(JSON.stringify(nodes.map(nodeSignature)));
}

export function richTextNodeSignature(node: RichTextEditorNode): string {
  return hashString(JSON.stringify(nodeSignature(node)));
}

export function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash.toString(36);
}

function nodeSignature(node: RichTextEditorNode): unknown {
  const { id: _id, children, ...rest } = node;
  return {
    ...rest,
    textContent: richTextNodeText(node),
    children: children?.map(nodeSignature),
  };
}
