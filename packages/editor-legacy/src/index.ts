/**
 * `@quanghuy1242/idco-editor-legacy` — the legacy Lexical-based rich-text editor
 * (docs/020 §4.5, §7.4; note.md Legacy extraction track).
 *
 * This is the pre-owned-model editor, extracted into its own package so the owned
 * engine (`@quanghuy1242/idco-editor`) carries no Lexical dependency. New code
 * should use the owned-model engine — `OwnedModelEditor`, the node SPI
 * (`registerNode`), and the compat helpers. This package is the supported home
 * for the legacy editor during its deprecation window; import directly from
 * `@quanghuy1242/idco-editor-legacy` (the owned package no longer re-exports it).
 */
export { RichTextEditor } from "./RichTextEditor";
export type { RichTextEditorProps } from "./RichTextEditor";
export type {
  RichTextEditorDocument,
  RichTextEditorNode,
  RichTextEditorMediaOption,
  RichTextEditorPostOption,
} from "./model/schema";
export type { RichTextNodeId } from "./model/ids";
export { ensureDocumentNodeIds } from "./model/ids";
export {
  ALIGNMENTS,
  DEFAULT_ALLOWED_NODES,
  TEXT_FORMAT,
  type RichTextAlignment,
} from "./model/schema";
export { capabilityFor, type BlockKind } from "./model/capabilities";
export {
  CalloutNode,
  CodeBlockNode,
  EmbedNode,
  MediaNode,
  PostRefNode,
  EditorHeadingNode,
  TableOfContentsNode,
  INSERT_RICH_TEXT_NODE_COMMAND,
  type RichTextEditorBindings,
  type RichTextEditorComment,
} from "./nodes";
