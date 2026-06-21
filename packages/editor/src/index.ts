/**
 * Public surface of `@quanghuy1242/idco-editor` (docs/020 §4.5, §7.4).
 *
 * Curated and grouped so the **node SPI** — the one-call way to add a custom block
 * (docs/016) — is the headline, not buried in a wildcard re-export. The owned-model
 * engine is the supported API; the legacy Lexical editor is re-exported at the
 * bottom marked deprecated (prefer the `@quanghuy1242/idco-editor/legacy` entry).
 *
 * Deep engine internals (the step set, scheduler internals, position mapping, the
 * transaction builder, low-level offset helpers) are intentionally NOT on this
 * surface (docs/020 §5.5); they remain importable from the package's `core/` and
 * `view/` modules for advanced use, but the public root stays small and honest.
 */

// ============================================================================
// Node SPI — add a block/object node in one `registerNode` call (docs/016, 020).
// ============================================================================
export {
  registerNode,
  registerNodeView,
  getNodeView,
  listInsertableNodes,
  registerStructuralView,
  getStructuralView,
  listInsertableStructuralNodes,
  type NodeView,
  type NodeViewInsert,
  type NodeViewLiveArgs,
  type NodeViewRestingArgs,
  type NodeViewChromeArgs,
  type NodeViewConfigField,
  type NodeOverlayArgs,
  type RegisterNodeArgs,
  type StructuralNodeView,
  type StructuralNodeViewInsert,
  type StructuralContainerArgs,
  type StructuralRestingArgs,
  type StructuralOverlayArgs,
  registerMark,
  listMarks,
  getMark,
  type MarkDefinition,
  type MarkRenderArgs,
  type MarkToolbarMeta,
  type LinkMode,
} from "./view";
export {
  BlockRegistry,
  createDefaultBlockRegistry,
  registerGlobalNodeDefinition,
  globalNodeDefinitions,
  BUILT_IN_OBJECT_DEFINITIONS,
  bakeObjectData,
  buildDocumentIndex,
  registerGlobalStructuralDefinition,
  globalStructuralDefinitions,
  getStructuralDefinition,
  isStructuralDefinitionType,
  BUILT_IN_STRUCTURAL_DEFINITIONS,
  type NodeDefinition,
  type BlockDefinition,
  type NodeAnchor,
  type ObjectNormalizationResult,
  type UnknownObjectPolicy,
  type BakeObjectResult,
  type DocumentIndex,
  type TocEntry,
  type TextIndexEntry,
  type StructuralDefinition,
  type StructuralSubtree,
  type StructuralCompatContext,
  type StructuralCompatResult,
} from "./core";

// ============================================================================
// The editor components + resting render.
// ============================================================================
export {
  OwnedModelEditor,
  type OwnedModelEditorHandle,
  type OwnedModelEditorProps,
} from "./view";
export {
  OwnedModelEditorView,
  type OwnedModelEditorViewProps,
  type OwnedModelEditorViewHandle,
  type OwnedModelEditorViewDiagnostics,
  type ObjectBlockDiagnostics,
} from "./view";
export {
  RestingDocument,
  RestingLeaf,
  renderLeafMarks,
  type RestingDocumentProps,
} from "./view";
export { EditorToolbar } from "./view";
export {
  FindBar,
  findMatches,
  useFindController,
  type FindController,
  type FindMatch,
} from "./view";
export { UploadProvider, useUpload, type UploadImage } from "./view";
export { useAutosave, type AutosaveOptions, type AutosaveState } from "./view";
export {
  computeWindowListMeta,
  listItemStyle,
  type ListItemMeta,
} from "./view";
export {
  applyEditContextText,
  lineRangeAt,
  nextGraphemeBoundary,
  prevGraphemeBoundary,
  wordRangeAt,
} from "./view";
export { sanitizeHtmlToCompat } from "./view";

// ============================================================================
// Engine core — the model, store, commands, compat boundary, and the helpers a
// host needs to build/import/serialize a document.
// ============================================================================
export {
  ROOT_NODE_ID,
  createEditorStore,
  createEngineScheduler,
  createIdAllocator,
  createOwnedEditorHandle,
  type EditorStore,
  type EditorStoreOptions,
  type EditorSubscriber,
  type EditorCommitSubscriber,
  type OwnedEditorHandle,
  type OwnedEditorHandleEvent,
  type OwnedEditorHandleOptions,
  type EngineScheduler,
  type EnginePerformanceSnapshot,
} from "./core";
export {
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  replaceTextContent,
  sliceTextContent,
  boundaryAtOffset,
  type EditorNode,
  type StructuralNode,
  type StructuralNodeType,
  type TextLeafNode,
  type TextLeafType,
  type ObjectNode,
  type ObjectNodeStatus,
  type BakedSnapshot,
  type DocumentSettings,
  type EditorDocumentSnapshot,
  type EditorSelection,
  type TextSelection,
  type NodeSelection,
  type GapSelection,
  type TextPoint,
  type TextAnchor,
  type TextContent,
  type TextSlice,
  type TextMark,
  type TextMarkKind,
  type NodeId,
  type IdAllocator,
  type JsonObject,
  type JsonValue,
  type ParentEntry,
  type CommittedTransaction,
} from "./core";
export {
  resolveLeafMarks,
  segmentLeaf,
  segmentText,
  type ResolvedMark,
  type TextSegment,
} from "./core";
export {
  childrenOf,
  scopePath,
  activeScope,
  resolveInsertionPoint,
  isDisposableEmpty,
  placeNodes,
  compileCommand,
  runQuery,
  type EditorCommand,
  type EditorCommandType,
  type EditorQuery,
  type InsertionPoint,
} from "./core";
export { collectSelectionText, orderedTextLeaves } from "./core";
export {
  compatFromEditorStore,
  compatFromSnapshot,
  compatInlineChildren,
  createEditorStoreFromCompat,
  createTextMark,
  editorSnapshotFromCompat,
  settingsFromCompat,
  textNodeTypeFromCompat,
  type CompatOptions,
  type RichTextCompatDocument,
  type RichTextCompatNode,
} from "./core";
export {
  importPayloadLexical,
  type PayloadImportReport,
  type PayloadImportResult,
  type PayloadLexicalInput,
} from "./core";
export {
  detectMarkdownShortcut,
  type MarkdownShortcut,
  type BlockShortcut,
  type InlineCodeShortcut,
  type SubstituteShortcut,
  type WrapPairShortcut,
} from "./core";
export { safeHref } from "./core";
export { calculateVirtualRange } from "./core/virtual-range";

// ============================================================================
// DEPRECATED: the legacy Lexical editor. Prefer the owned-model engine above, or
// import these from "@quanghuy1242/idco-editor/legacy" (docs/020 §8). Re-exported
// here for the deprecation window so existing consumers keep compiling.
// ============================================================================
export {
  RichTextEditor,
  ensureDocumentNodeIds,
  ALIGNMENTS,
  DEFAULT_ALLOWED_NODES,
  TEXT_FORMAT,
  capabilityFor,
  CalloutNode,
  CodeBlockNode,
  EmbedNode,
  MediaNode,
  PostRefNode,
  EditorHeadingNode,
  TableOfContentsNode,
  INSERT_RICH_TEXT_NODE_COMMAND,
  type RichTextEditorProps,
  type RichTextEditorDocument,
  type RichTextEditorNode,
  type RichTextEditorMediaOption,
  type RichTextEditorPostOption,
  type RichTextNodeId,
  type RichTextAlignment,
  type BlockKind,
  type RichTextEditorBindings,
  type RichTextEditorComment,
} from "./legacy";
