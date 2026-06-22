/**
 * Public React binding for the owned-model editor engine.
 *
 * `core/` owns the framework-free model, transactions, and scheduler. This
 * package is the Phase 4 bridge from that store into React through
 * `useSyncExternalStore`; it renders every block mounted and leaves
 * virtualization to Phase 5.
 */
export {
  OwnedModelEditorView,
  type ObjectBlockDiagnostics,
  type OwnedModelEditorViewDiagnostics,
  type OwnedModelEditorViewHandle,
  type OwnedModelEditorViewProps,
} from "./react-view";
export {
  applyEditContextText,
  lineRangeAt,
  nextGraphemeBoundary,
  prevGraphemeBoundary,
  wordRangeAt,
} from "./overlays";
export {
  getNodeView,
  listInsertableNodes,
  registerNode,
  registerNodeView,
  type NodeOverlayArgs,
  type NodeView,
  type NodeViewChromeArgs,
  type NodeViewConfigField,
  type NodeViewInsert,
  type NodeViewLiveArgs,
  type NodeViewRestingArgs,
  type RegisterNodeArgs,
} from "./spi";
export {
  getStructuralView,
  listInsertableStructuralNodes,
  registerStructuralView,
  type StructuralContainerArgs,
  type StructuralNodeView,
  type StructuralNodeViewInsert,
  type StructuralOverlayArgs,
  type StructuralRestingArgs,
  type StructuralTabArgs,
} from "./spi";
export {
  OwnedModelEditor,
  type OwnedModelEditorHandle,
  type OwnedModelEditorProps,
} from "./owned-model-editor";
export { EditorToolbar } from "./chrome";
export {
  FindBar,
  findMatches,
  useFindController,
  type FindController,
  type FindMatch,
} from "./chrome";
export { renderLeafMarks } from "./render";
export {
  getMark,
  listMarks,
  registerMark,
  type LinkMode,
  type MarkDefinition,
  type MarkRenderArgs,
  type MarkToolbarMeta,
} from "./spi";
export {
  blockTypeKey,
  blockTypeRole,
  getBlockType,
  listBlockTypes,
  registerBlockType,
  type BlockTypeDefinition,
} from "./spi";
// Toolbar SPI (docs/023): the action/tab/slot registries + descriptor types are the
// host extension surface; `computeToolbarLayout` and the `Resolved*` types stay
// orchestrator-internal (§5.8), so they are deliberately not re-exported here.
export {
  actionTargetsSurface,
  DEFAULT_TOOLBAR_LAYOUT,
  getToolbarAction,
  listToolbarActions,
  listToolbarSlots,
  listToolbarTabs,
  registerToolbarAction,
  registerToolbarSlot,
  registerToolbarTab,
  unregisterToolbarAction,
  unregisterToolbarSlot,
  unregisterToolbarTab,
  type ToolbarAction,
  type ToolbarActionContext,
  type ToolbarActionKind,
  type ToolbarActionRenderContext,
  type ToolbarCapabilities,
  type ToolbarItem,
  type ToolbarLayoutConfig,
  type ToolbarSelectionFacts,
  type ToolbarSlot,
  type ToolbarSurface,
  type ToolbarTab,
} from "./spi";
export { sanitizeHtmlToCompat } from "./paste-html";
export { UploadProvider, useUpload, type UploadImage } from "./upload-context";
export {
  useAutosave,
  type AutosaveOptions,
  type AutosaveState,
} from "./use-autosave";
export {
  RestingDocument,
  RestingLeaf,
  type RestingDocumentProps,
} from "./render";
export {
  computeWindowListMeta,
  listItemStyle,
  type ListItemMeta,
} from "./styles";
