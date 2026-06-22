import {
  ensureRichTextHeadingAnchors,
  normalizeTocSettings,
  slugifyHeadingAnchor,
} from "@quanghuy1242/idco-lib";
import {
  alignmentValue,
  calloutToneValue,
  codeLanguageValue,
  headingTag,
  isNode,
  isRecord,
  listTypeValue,
  numberValue,
  stringValue,
  type RichTextEditorNode,
  type RichTextEditorDocument,
} from "./schema";
import { ensureDocumentNodeIds } from "./ids";

/**
 * Coerce untrusted / legacy JSON into the canonical document shape. This is the
 * inverse boundary to `serialize.ts`: anything stored or pasted is squeezed
 * through here before it reaches Lexical.
 */
export function normalizeDocument(
  value: unknown,
  options: { readonly previousDocument?: RichTextEditorDocument } = {},
): RichTextEditorDocument {
  if (isRecord(value) && isRecord(value.root)) {
    const children = Array.isArray(value.root.children)
      ? value.root.children.flatMap(normalizeNode)
      : [];
    return ensureDocumentNodeIds(
      ensureRichTextHeadingAnchors({ root: { children } }),
      {
        previousDocument: options.previousDocument,
      },
    );
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return normalizeDocument(JSON.parse(value) as unknown, options);
    } catch {
      return ensureDocumentNodeIds(
        { root: { children: [paragraphNode(value)] } },
        options,
      );
    }
  }
  return ensureDocumentNodeIds({ root: { children: [] } }, options);
}

export function normalizeNode(value: unknown): RichTextEditorNode[] {
  if (!isNode(value)) {
    return [];
  }
  const align = alignmentValue(value.format);
  const aligned = align ? { format: align } : {};
  if (value.type === "paragraph" || value.type === "editor-paragraph") {
    return [
      {
        children: normalizeChildren(value.children),
        ...nodeId(value),
        type: "paragraph",
        ...aligned,
      },
    ];
  }
  if (value.type === "heading" || value.type === "editor-heading") {
    return [
      {
        ...(stringValue(value.anchorId)
          ? { anchorId: slugifyHeadingAnchor(stringValue(value.anchorId)!) }
          : {}),
        children: normalizeChildren(value.children),
        ...nodeId(value),
        tag: headingTag(value.tag),
        type: "heading",
        ...aligned,
      },
    ];
  }
  if (value.type === "quote" || value.type === "editor-quote") {
    return [
      {
        children: normalizeChildren(value.children),
        ...nodeId(value),
        type: "quote",
        ...aligned,
      },
    ];
  }
  if (value.type === "list" || value.type === "editor-list") {
    const listType = listTypeValue(value.listType, value.tag);
    return [
      {
        children: normalizeChildren(value.children),
        ...nodeId(value),
        listType,
        start: numberValue(value.start) ?? 1,
        tag: listType === "number" ? "ol" : "ul",
        type: "list",
      },
    ];
  }
  if (value.type === "listitem" || value.type === "editor-listitem") {
    return [
      {
        children: normalizeChildren(value.children),
        ...nodeId(value),
        type: "listitem",
        value: numberValue(value.value) ?? 1,
        ...(typeof value.checked === "boolean"
          ? { checked: value.checked }
          : {}),
      },
    ];
  }
  if (value.type === "text") {
    return [
      {
        detail: numberValue(value.detail) ?? 0,
        format: numberValue(value.format) ?? 0,
        ...nodeId(value),
        mode: stringValue(value.mode) ?? "normal",
        style: stringValue(value.style) ?? "",
        text: stringValue(value.text) ?? "",
        type: "text",
      },
    ];
  }
  if (value.type === "linebreak") {
    return [{ ...nodeId(value), type: "linebreak" }];
  }
  if (value.type === "callout") {
    return [normalizeCalloutNode(value)];
  }
  if (value.type === "code-block" || value.type === "code") {
    return [normalizeCodeBlockNode(value)];
  }
  if (value.type === "embed") {
    return [normalizeEmbedNode(value)];
  }
  if (value.type === "table-of-contents") {
    return [normalizeTableOfContentsNode(value)];
  }
  if (value.type === "media") {
    return [normalizeMediaNode(value)];
  }
  if (value.type === "post-ref") {
    return [normalizePostRefNode(value)];
  }
  if (value.type === "glossary") {
    return [
      {
        definition: stringValue(value.definition) ?? "",
        ...nodeId(value),
        term: stringValue(value.term) ?? "",
        type: "glossary",
      },
    ];
  }
  // Links, comment marks, and tables carry structure (and properties such as
  // url / ids / colWidths) that must survive the doc round-trip verbatim, with
  // children recursively normalized. This keeps the model the single source of
  // truth without hand-maintaining a field list for every Lexical node.
  if (PASSTHROUGH_ELEMENT_TYPES.has(value.type)) {
    return [{ ...value, children: normalizeChildren(value.children) }];
  }
  return value.children ? [...normalizeChildren(value.children)] : [];
}

export const PASSTHROUGH_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  "link",
  "autolink",
  "mark",
  // New tables serialize as "editor-table" (EditorTableNode carries `layout` /
  // `showRowNumbers`); legacy documents use "table" and still hydrate into the
  // same node via Lexical's node replacement. Both pass through verbatim.
  "table",
  "editor-table",
  "tablerow",
  "tablecell",
]);

export function normalizeChildren(
  children: readonly RichTextEditorNode[] | undefined,
  fallbackText?: string,
): readonly RichTextEditorNode[] {
  const normalized = Array.isArray(children)
    ? children.flatMap(normalizeNode)
    : [];
  if (normalized.length > 0) {
    return normalized;
  }
  return fallbackText !== undefined
    ? [{ text: fallbackText, type: "text" }]
    : [];
}

export function paragraphNode(text: string): RichTextEditorNode {
  return {
    children: [{ text, type: "text" }],
    type: "paragraph",
  };
}

export function normalizeCalloutNode(
  node: RichTextEditorNode,
): RichTextEditorNode {
  return {
    children: [{ text: childText(node) || "Callout", type: "text" }],
    ...nodeId(node),
    tone: calloutToneValue(node.tone),
    type: "callout",
  };
}

export function normalizeCodeBlockNode(
  node: RichTextEditorNode,
): RichTextEditorNode {
  return {
    language: codeLanguageValue(node.language),
    ...nodeId(node),
    text: stringValue(node.text) ?? "",
    type: "code-block",
  };
}

export function normalizeEmbedNode(
  node: RichTextEditorNode,
): RichTextEditorNode {
  return {
    ...nodeId(node),
    type: "embed",
    url: stringValue(node.url) ?? "",
  };
}

export function normalizeMediaNode(
  node: RichTextEditorNode,
): RichTextEditorNode {
  return {
    alt: stringValue(node.alt) ?? "",
    caption: stringValue(node.caption) ?? "",
    mediaId: stringValue(node.mediaId) ?? "",
    ...nodeId(node),
    type: "media",
  };
}

export function normalizePostRefNode(
  node: RichTextEditorNode,
): RichTextEditorNode {
  return {
    ...nodeId(node),
    postId: stringValue(node.postId) ?? "",
    title: stringValue(node.title) ?? "",
    type: "post-ref",
    url: stringValue(node.url) ?? "",
  };
}

export function normalizeTableOfContentsNode(
  node: RichTextEditorNode,
): RichTextEditorNode {
  const settings = normalizeTocSettings(node);
  return {
    maxLevel: settings.maxLevel,
    minLevel: settings.minLevel,
    numbering: settings.numbering,
    placement: settings.placement,
    side: settings.side,
    style: settings.style,
    title: settings.title,
    ...nodeId(node),
    type: "table-of-contents",
  };
}

export function textFromChildren(
  children: readonly RichTextEditorNode[] | undefined,
  fallback = "",
): string[] {
  const text = children
    ?.map((child) => stringValue(child.text))
    .filter((value): value is string => value !== undefined);
  return text && text.length > 0 ? text : [fallback];
}

export function childText(node: RichTextEditorNode): string {
  return textFromChildren(node.children, stringValue(node.text)).join("");
}

function nodeId(node: RichTextEditorNode): { readonly id?: string } {
  return stringValue(node.id) ? { id: stringValue(node.id) } : {};
}
