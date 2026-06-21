/**
 * The legacy Lexical-based rich-text editor (docs/020 §4.5, §7.4).
 *
 * This is the pre-owned-model editor. New code should use the owned-model engine
 * from the package root (`@quanghuy1242/idco-editor`): `OwnedModelEditor`, the
 * node SPI (`registerNode`), and the compat helpers. This entry is kept as the
 * supported home for the legacy editor during its deprecation window; the package
 * root also re-exports these names (marked deprecated) until consumers migrate.
 */
export { RichTextEditor } from "./legacy/RichTextEditor";
export type { RichTextEditorProps } from "./legacy/RichTextEditor";
export type {
  RichTextEditorDocument,
  RichTextEditorNode,
  RichTextEditorMediaOption,
  RichTextEditorPostOption,
} from "./legacy/model/schema";
export type { RichTextNodeId } from "./legacy/model/ids";
export { ensureDocumentNodeIds } from "./legacy/model/ids";
export {
  ALIGNMENTS,
  DEFAULT_ALLOWED_NODES,
  TEXT_FORMAT,
  type RichTextAlignment,
} from "./legacy/model/schema";
export { capabilityFor, type BlockKind } from "./legacy/model/capabilities";
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
} from "./legacy/nodes";
