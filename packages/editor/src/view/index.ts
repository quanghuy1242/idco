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
  applyReviewIndicators,
  changedBlockIds,
  deletionAnchors,
  REVIEW_INDICATOR_CSS,
  useReviewChangeIndicator,
  type ReviewBlockStatus,
  type ReviewChangedBlock,
  type ReviewDeletionAnchor,
} from "./overlays";
export { useReviewSnapshot } from "./store-hooks";
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
// Command-surface SPI (docs/024 §5.7): the command registry + tab/slot registries +
// descriptor/context/group types are the host extension surface. `resolveCommandList`,
// the `Resolved*` types, `computeToolbarLayout`, and the internal context builders
// stay orchestrator-internal (deep-imported by the surface hosts + tests, docs/024
// §5.7), so they are deliberately not re-exported here.
export {
  COMMAND_GROUP_ORDER,
  commandTargetsSurface,
  DEFAULT_TOOLBAR_LAYOUT,
  getCommand,
  listCommands,
  listToolbarSlots,
  listToolbarTabs,
  registerCommand,
  registerToolbarSlot,
  registerToolbarTab,
  unregisterCommand,
  unregisterToolbarSlot,
  unregisterToolbarTab,
  type Command,
  type CommandContext,
  type CommandGroup,
  type CommandKind,
  type CommandPlacement,
  type CommandRenderContext,
  type CommandScope,
  type CommandSurface,
  type ToolbarCapabilities,
  type ToolbarItem,
  type ToolbarLayoutConfig,
  type ToolbarSelectionFacts,
  type ToolbarSlot,
  type ToolbarTab,
} from "./spi";
// Host data-source SPI (docs/026 §6.1): the single host-facing extension point by
// which a deployment exposes host-backed records (media, posts, …) to the
// reference blocks that project them. `registerDataSource` is the host's entire
// surface — one call, one object — so it is part of the public package.
export {
  getDataSource,
  listDataSources,
  registerDataSource,
  unregisterDataSource,
  type DataSource,
  type DataSourcePickerProps,
} from "./spi";
// Schema profile (note.md item 6): resolve a node type against the registries to decide
// whether the deployment's profile permits it (the palette + quarantine gates).
export { isNodeTypeAllowed, schemaGroupOf } from "./spi";
// Side Panel SPI (docs/027 §8.2): a feature registers one `SidePanel` to add a dock
// pane (Outline first; Comments/Glossary/Insights follow). `PanelHost` is the seam a
// toolbar/flyout command opens a pane through. The dock host itself stays internal
// chrome the composed `OwnedModelEditor` mounts.
export {
  getSidePanel,
  listSidePanels,
  registerSidePanel,
  unregisterSidePanel,
  type PanelHost,
  type SidePanel,
  type SidePanelRenderArgs,
} from "./spi";
// Document Collections SPI (docs/027 §5.2): a feature declares a document-owned
// collection (glossary first) so the model carries its items and a pane can gate on
// it. Item edits route through the `set-collection` command/step (history-undoable).
export {
  getDocumentCollection,
  listDocumentCollections,
  registerDocumentCollection,
  unregisterDocumentCollection,
  type DocumentCollectionDefinition,
} from "./spi";
// Comment Source SPI (docs/027 §7.1): the docs/026 sibling for host-owned annotation
// threads. A deployment registers one source with thread capabilities; the editor owns
// the anchor mark + snapshot, the host owns the conversation. No source = no comments.
export {
  activeCommentSource,
  getCommentSource,
  listCommentSources,
  registerCommentSource,
  unregisterCommentSource,
  type Comment,
  type CommentAnchor,
  type CommentAuthor,
  type CommentSnapshot,
  type CommentSource,
  type Thread,
} from "./spi";
export { sanitizeHtmlToCompat } from "./paste-html";
// Markdown I/O (docs/030 MIO). `snapshotToMarkdown` (lossy export) and the native fragment
// clipboard are parser-free and on the public surface; `markdownToNodes` (the markdown-it
// import path) stays lazy-only — import it from `view/markdown/from-markdown` directly.
export {
  IDCO_SNAPSHOT_MIME,
  collectSelectionFragment,
  parseFragment,
  serializeFragment,
  snapshotToMarkdown,
  CALLOUT_TONES,
  MARKDOWN_LOSSY_MARK_KINDS,
  normalizeCalloutTone,
  type CalloutTone,
  type SnapshotFragment,
} from "./markdown";
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
  DocumentIndexProvider,
  useDocumentIndex,
  useDocumentReveal,
} from "./document-index";
export {
  createDocumentIndexStore,
  type DocumentIndexStore,
  type MutableDocumentIndexStore,
} from "./controllers/document-index-store";
export {
  computeWindowListMeta,
  listItemStyle,
  type ListItemMeta,
} from "./styles";
