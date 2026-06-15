import type { AlertTone, CodeEditorLanguage } from "@quanghuy1242/idco-ui";
import type { HeadingTagType } from "@lexical/rich-text";

/**
 * Single source of truth for the editor document schema. The persisted JSON,
 * the Lexical serializer, and `@idco/content-renderer` all agree on these
 * shapes, node types, and the text-format bitmask so the two sides cannot
 * drift.
 */

export type RichTextEditorNode = {
  readonly type: string;
  readonly text?: string;
  readonly children?: readonly RichTextEditorNode[];
  readonly tag?: string;
  readonly anchorId?: string;
  readonly language?: string;
  readonly mediaId?: string;
  readonly alt?: string;
  readonly caption?: string;
  readonly postId?: string;
  readonly title?: string;
  readonly url?: string;
  readonly tone?: string;
  readonly format?: number | string;
  readonly minLevel?: number;
  readonly maxLevel?: number;
  readonly numbering?: string;
  readonly style?: string;
  readonly placement?: string;
  readonly side?: string;
  readonly [key: string]: unknown;
};

export type RichTextEditorDocument = {
  readonly root: {
    readonly children: readonly RichTextEditorNode[];
  };
};

export type RichTextEditorMediaOption = {
  readonly id: string;
  readonly label: string;
  readonly alt?: string;
  readonly caption?: string;
  /** URL used to render a live image preview in the editor. */
  readonly previewUrl?: string;
};

export type RichTextEditorPostOption = {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
};

/** Lexical text-format bitmask. Shared with `@idco/content-renderer`. */
export const TEXT_FORMAT = {
  bold: 1,
  italic: 2,
  strikethrough: 4,
  underline: 8,
  code: 16,
  subscript: 32,
  superscript: 64,
  highlight: 128,
} as const;

/** Element alignment values supported on block-level nodes. */
export type RichTextAlignment = "left" | "center" | "right" | "justify";

export const ALIGNMENTS: readonly RichTextAlignment[] = [
  "left",
  "center",
  "right",
  "justify",
];

/** Canonical list of block/inline node types the editor understands. */
export const DEFAULT_ALLOWED_NODES = [
  "paragraph",
  "heading",
  "quote",
  "list",
  "listitem",
  "text",
  "linebreak",
  "callout",
  "code-block",
  "media",
  "post-ref",
  "embed",
  "table-of-contents",
  "table",
  "link",
  "mark",
  "glossary",
] as const;

export function alignmentValue(value: unknown): RichTextAlignment | "" {
  return value === "left" ||
    value === "center" ||
    value === "right" ||
    value === "justify"
    ? value
    : "";
}

export function headingTag(value: unknown): HeadingTagType {
  return value === "h1" ||
    value === "h2" ||
    value === "h3" ||
    value === "h4" ||
    value === "h5" ||
    value === "h6"
    ? value
    : "h2";
}

export function listTypeValue(
  listType: unknown,
  tag: unknown,
): "bullet" | "number" | "check" {
  if (listType === "number" || tag === "ol") return "number";
  if (listType === "check") return "check";
  return "bullet";
}

export function calloutToneValue(value: unknown): AlertTone {
  return value === "info" ||
    value === "success" ||
    value === "warning" ||
    value === "error"
    ? value
    : "info";
}

export function codeLanguageValue(value: unknown): CodeEditorLanguage {
  return value === "json" ||
    value === "tsx" ||
    value === "js" ||
    value === "python" ||
    value === "text"
    ? value
    : "ts";
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNode(value: unknown): value is RichTextEditorNode {
  return isRecord(value) && typeof value.type === "string";
}

export function canUse(type: string, allowed: readonly string[]): boolean {
  return allowed.includes(type);
}
