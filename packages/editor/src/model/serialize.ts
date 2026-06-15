import { PASSTHROUGH_ELEMENT_TYPES } from "./normalize";
import {
  alignmentValue,
  headingTag,
  listTypeValue,
  numberValue,
  stringValue,
  type RichTextEditorDocument,
  type RichTextEditorNode,
} from "./schema";

/**
 * Serialize the canonical document into a Lexical editor-state JSON string
 * shape. Element nodes carry their alignment via the Lexical `format` string;
 * decorator blocks pass their data through verbatim for their own importJSON.
 */
export function lexicalEditorState(document: RichTextEditorDocument) {
  const children = document.root.children.flatMap(lexicalNode);
  return {
    root: {
      children: children.length > 0 ? children : [emptyLexicalParagraph()],
      direction: null,
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  };
}

export function emptyLexicalParagraph() {
  return {
    children: [],
    direction: null,
    format: "",
    indent: 0,
    textFormat: 0,
    textStyle: "",
    type: "editor-paragraph",
    version: 1,
  };
}

export function lexicalNode(node: RichTextEditorNode): unknown[] {
  const format = alignmentValue(node.format);
  if (node.type === "paragraph") {
    return [
      {
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format,
        indent: 0,
        ...(stringValue(node.id) ? { id: node.id } : {}),
        textFormat: 0,
        textStyle: "",
        type: "editor-paragraph",
        version: 1,
      },
    ];
  }
  if (node.type === "heading") {
    return [
      {
        ...(stringValue(node.anchorId) ? { anchorId: node.anchorId } : {}),
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format,
        indent: 0,
        ...(stringValue(node.id) ? { id: node.id } : {}),
        tag: headingTag(node.tag),
        type: "editor-heading",
        version: 1,
      },
    ];
  }
  if (node.type === "quote") {
    return [
      {
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format,
        indent: 0,
        ...(stringValue(node.id) ? { id: node.id } : {}),
        type: "editor-quote",
        version: 1,
      },
    ];
  }
  if (node.type === "list") {
    const listType = listTypeValue(node.listType, node.tag);
    return [
      {
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format: "",
        indent: 0,
        ...(stringValue(node.id) ? { id: node.id } : {}),
        listType,
        start: numberValue(node.start) ?? 1,
        tag: listType === "number" ? "ol" : "ul",
        type: "editor-list",
        version: 1,
      },
    ];
  }
  if (node.type === "listitem") {
    return [
      {
        children: (node.children ?? []).flatMap(lexicalNode),
        direction: null,
        format: "",
        indent: 0,
        ...(stringValue(node.id) ? { id: node.id } : {}),
        type: "editor-listitem",
        value: numberValue(node.value) ?? 1,
        version: 1,
        ...(typeof node.checked === "boolean" ? { checked: node.checked } : {}),
      },
    ];
  }
  if (node.type === "text") {
    return [
      {
        detail: numberValue(node.detail) ?? 0,
        format: numberValue(node.format) ?? 0,
        ...(stringValue(node.id) ? { id: node.id } : {}),
        mode: stringValue(node.mode) ?? "normal",
        style: stringValue(node.style) ?? "",
        text: typeof node.text === "string" ? node.text : "",
        type: "text",
        version: 1,
      },
    ];
  }
  if (node.type === "linebreak") {
    return [
      {
        ...(stringValue(node.id) ? { id: node.id } : {}),
        type: "linebreak",
        version: 1,
      },
    ];
  }
  if (
    node.type === "callout" ||
    node.type === "code-block" ||
    node.type === "embed" ||
    node.type === "media" ||
    node.type === "post-ref" ||
    node.type === "table-of-contents"
  ) {
    return [
      {
        ...node,
        format: "",
        type: node.type,
        version: 1,
      },
    ];
  }
  if (node.type === "glossary") {
    return [
      {
        definition: stringValue(node.definition) ?? "",
        ...(stringValue(node.id) ? { id: node.id } : {}),
        term: stringValue(node.term) ?? "",
        type: "glossary",
        version: 1,
      },
    ];
  }
  if (PASSTHROUGH_ELEMENT_TYPES.has(node.type)) {
    // These are Lexical ElementNodes (table/row/cell, link, mark). They must
    // carry `indent: 0` (and direction/format): when `indent` is missing,
    // Lexical's reconciler writes an inline `padding-inline-start: calc(undefined
    // * …)` instead of clearing it, which overrides table-cell padding. Defaults
    // come first so any value already on the node still wins.
    return [
      {
        direction: null,
        format: "",
        indent: 0,
        ...node,
        children: (node.children ?? []).flatMap(lexicalNode),
        type:
          node.type === "table" || node.type === "editor-table"
            ? "editor-table"
            : node.type,
        version: 1,
      },
    ];
  }
  return [];
}
