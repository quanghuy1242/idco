/**
 * Public surface of `@quanghuy1242/idco-editor` (docs/020 §4.5, §7.4).
 *
 * Curated and grouped so the **node SPI** — the one-call way to add a custom block
 * (docs/016) — is the headline, not buried in a wildcard re-export. The owned-model
 * engine is the only API this package exposes; the legacy Lexical editor now lives
 * in its own package (`@quanghuy1242/idco-editor-legacy`) so nothing here pulls
 * Lexical (note.md Legacy extraction track).
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
  type StructuralTabArgs,
  registerMark,
  listMarks,
  getMark,
  type MarkDefinition,
  type MarkRenderArgs,
  type MarkToolbarMeta,
  type LinkMode,
  registerBlockType,
  listBlockTypes,
  getBlockType,
  blockTypeKey,
  blockTypeRole,
  type BlockTypeDefinition,
  registerCommand,
  getCommand,
  listCommands,
  unregisterCommand,
  registerToolbarTab,
  listToolbarTabs,
  unregisterToolbarTab,
  registerToolbarSlot,
  listToolbarSlots,
  unregisterToolbarSlot,
  commandTargetsSurface,
  COMMAND_GROUP_ORDER,
  DEFAULT_TOOLBAR_LAYOUT,
  type Command,
  type CommandKind,
  type CommandContext,
  type CommandRenderContext,
  type CommandScope,
  type CommandSurface,
  type CommandPlacement,
  type CommandGroup,
  type ToolbarSelectionFacts,
  type ToolbarCapabilities,
  type ToolbarTab,
  type ToolbarSlot,
  type ToolbarItem,
  type ToolbarLayoutConfig,
} from "./view";
export {
  BlockRegistry,
  createDefaultBlockRegistry,
  registerGlobalNodeDefinition,
  unregisterGlobalNodeDefinition,
  globalNodeDefinitions,
  BUILT_IN_OBJECT_DEFINITIONS,
  bakeObjectData,
  buildDocumentIndex,
  headingAnchor,
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
  type StructuralInsertParams,
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
// Read-side document SPI (note.md): a node view reads the whole-document index
// reactively without reaching across the document. The provider + store back it;
// the editor and reader both feed it. See `useDocumentIndex` / `useDocumentReveal`.
export {
  DocumentIndexProvider,
  useDocumentIndex,
  useDocumentReveal,
  createDocumentIndexStore,
  type DocumentIndexStore,
  type MutableDocumentIndexStore,
} from "./view";
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
export {
  calculateVirtualRange,
  rangeFromModel,
  type VirtualRange,
  type VirtualRangeInput,
  type VirtualRangeQuery,
} from "./core/virtual-range";
export {
  BlockEstimator,
  FlatOffsetModel,
  metricsForNode,
  reconcileOffsetModel,
  TreapOffsetModel,
  type BlockEstimatorOptions,
  type BlockMetrics,
  type OffsetModel,
} from "./core/offset-model";
export {
  anchorScrollAdjustment,
  isFlingVelocity,
} from "./view/controllers/anchor";

// ============================================================================
// The legacy Lexical editor was extracted to its own package (note.md Legacy
// extraction track). It is no longer re-exported here: import it directly from
// `@quanghuy1242/idco-editor-legacy`, so the owned engine carries no Lexical.
// ============================================================================
