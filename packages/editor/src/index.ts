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
 *
 * The `@categoryDescription` blocks below are the per-category narratives the API map
 * (docs/032, `scripts/gen-api-map.mjs`) renders as the usage-shape intro for each
 * category file. They live here so the headline SPI story stays in one curated place.
 *
 * @categoryDescription Node SPI
 * Add a custom block or object node in one call. `registerNode({ view, definition })`
 * registers the React half (`NodeView`) and, when given, the model half
 * (`NodeDefinition`) so compat import/export and the bake service see it. Structural
 * containers register through `registerStructuralView`. This is the only call a feature
 * author makes to add a node; engine internals never need editing.
 *
 * @categoryDescription Mark SPI
 * Add an inline mark (a custom span, a link variant). `registerMark` declares how a mark
 * renders and how it surfaces in the toolbar; `listMarks`/`getMark` read the registry.
 *
 * @categoryDescription Block Types
 * The block-type chooser entries (paragraph, heading, quote). Register a type and read
 * its stable chooser key and announced aria role.
 *
 * @categoryDescription Commands & Toolbar SPI
 * Add a command and place it on the toolbar. `registerCommand` defines the action;
 * `registerToolbarTab`/`registerToolbarSlot` place it. The default layout and group order
 * ship as constants for reference.
 *
 * @categoryDescription Side Panel SPI
 * Dock a panel beside the document (an outline, comments, a custom inspector). Register a
 * `SidePanel`; the host renders it through `PanelHost`.
 *
 * @categoryDescription Comments SPI
 * Attach host-owned comment threads to the document. Register a `CommentSource`; the
 * engine resolves threads against anchors and the active source drives the review UI.
 *
 * @categoryDescription Document Collections SPI
 * Register a document-owned collection (a glossary, a reference set) the document reads
 * and the review surface shows.
 *
 * @categoryDescription Host Data Source SPI
 * Project host records (a post, a user) into reference blocks. Register one `DataSource`
 * per host collection; the picker, cache, resolve scheduling, gating, and static reader
 * are engine the host never touches (docs/026).
 *
 * @categoryDescription Schema Profile
 * The per-deployment allowlist of schema groups. Set `SchemaProfile` on the store;
 * `isNodeTypeAllowed`/`schemaGroupOf` resolve a node type against the registries for the
 * palette and quarantine gates.
 *
 * @categoryDescription Editor Components
 * The mounted editor and its chrome. `OwnedModelEditor` is the batteries-included
 * component; `OwnedModelEditorView` is the lower-level view; `EditorToolbar`, `FindBar`,
 * and `UploadProvider` compose around them.
 *
 * @categoryDescription Resting Render
 * Render a document read-only without the editor. `RestingDocument` paints a snapshot in
 * place; for a server render use the `@quanghuy1242/idco-reader` package.
 *
 * @categoryDescription Document Index
 * Read the whole-document index (TOC, headings, plain text) reactively. A node view
 * subscribes through `useDocumentIndex` without reaching across the document;
 * `DocumentIndexProvider` backs it and the editor and reader both feed it.
 *
 * @categoryDescription Autosave
 * Persist the document on a debounce. `useAutosave` derives save state from store commits.
 *
 * @categoryDescription Markdown I/O
 * Export a snapshot to Markdown (lossy, one-way) and copy/paste the native fragment
 * losslessly. `snapshotToMarkdown` is the export; the fragment functions back the in-app
 * clipboard. The Markdown paste parser is lazy-loaded and intentionally off this surface.
 *
 * @categoryDescription Engine Core — Store
 * Create and drive the model store. `createEditorStore({ snapshot })` builds it;
 * `store.toSnapshot()` serializes it. The scheduler and owned handle wire it to a host.
 *
 * @categoryDescription Engine Core — Model
 * The document model: nodes, marks, selections, and the snapshot shape. Node constructors
 * (`makeTextNode`, `makeObjectNode`, `makeStructuralNode`) and the `EditorNode` union.
 *
 * @categoryDescription Engine Core — Commands
 * Compile and run editor commands and queries against the model. `compileCommand`/
 * `runQuery` plus the placement, scope, and insertion-point helpers.
 *
 * @categoryDescription Text Segmentation
 * Resolve a text leaf's overlapping marks into flat, renderable segments. `segmentLeaf`/
 * `segmentText` and the resolved-mark shape the render layer consumes.
 *
 * @categoryDescription Snapshot & Performance
 * The save-path performance knobs and building blocks: the memory arbiter and its pool
 * contract, the bake cache, the cold-store SPI, history limits, and the dev-invariant
 * gate that opts a production build in or out of the load tripwires (docs/030).
 *
 * @categoryDescription Virtual Geometry
 * The offset model behind large-document virtualization. `calculateVirtualRange` plus the
 * block estimator and treap offset model that turn block heights into O(log n) scroll
 * math, and the fling/anchor scroll helpers (docs/025).
 *
 * @categoryDescription Compat (import-only)
 * Import-only. A one-time importer from the PayloadCMS-Lexical and legacy compat shapes
 * into the native model. This is NOT the save/load path: never serialize a document
 * through compat. Use `createEditorStore`/`toSnapshot` for persistence.
 *
 * @categoryDescription Editing Helpers
 * Low-level text helpers for the EditContext bridge: grapheme and word boundaries, line
 * ranges, and applying one EditContext text snapshot to the model.
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
  registerSidePanel,
  getSidePanel,
  listSidePanels,
  unregisterSidePanel,
  registerDocumentCollection,
  getDocumentCollection,
  listDocumentCollections,
  unregisterDocumentCollection,
  type DocumentCollectionDefinition,
  registerCommentSource,
  getCommentSource,
  listCommentSources,
  activeCommentSource,
  unregisterCommentSource,
  type Comment,
  type CommentAnchor,
  type CommentAuthor,
  type CommentSnapshot,
  type CommentSource,
  type Thread,
  registerSuggestionSource,
  getSuggestionSource,
  listSuggestionSources,
  activeSuggestionSource,
  unregisterSuggestionSource,
  type SuggestionSource,
  type Command,
  type CommandKind,
  type CommandContext,
  type CommandRenderContext,
  type CommandScope,
  type CommandSurface,
  type CommandPlacement,
  type CommandGroup,
  type PanelHost,
  type SidePanel,
  type SidePanelRenderArgs,
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
  nodeDiffResolver,
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
  type NodeHeightHint,
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
// The live in-editor review affordance (docs/036 §6.2.1, R6-I + docs/038 §7–§9, R6-J J3): the change
// indicator (`useReviewChangeIndicator` + `REVIEW_INDICATOR_CSS`, its pure `changedBlockIds` top-level
// core, the any-depth `changedElements` core, and DOM `applyReviewIndicators`), plus the commit-
// coalesced snapshot hook it diffs a baseline against (`useReviewSnapshot`). Review detail is the diff
// view; the indicator only flags where — a gutter bar on top-level blocks, a ring on nested elements.
export {
  applyReviewIndicators,
  changedBlockIds,
  changedElements,
  deletionAnchors,
  REVIEW_INDICATOR_CSS,
  useReviewChangeIndicator,
  useReviewSnapshot,
  type ReviewBlockStatus,
  type ReviewChangedBlock,
  type ReviewChangedElement,
  type ReviewDeletionAnchor,
  type ReviewMarkerKind,
} from "./view";
// The woven inline overlay's ReviewModel (docs/038 §5, R6-J J0+J2): project a `SnapshotDiff` into the
// render plan — the merged top-level order, the ghost nodes (all depths), the per-container merged
// child orders, and the per-container collapsed-ghost budget (`buildReviewModel`) — plus the opt-in
// hook that derives it live from a captured baseline (`useReviewModel`). Feed the model to the editor
// view's `review` prop to render removed blocks as inert ghosts in place, at the top level and inside
// containers.
export {
  buildReviewModel,
  DEFAULT_CONTAINER_GHOST_BUDGET,
  useReviewModel,
  type ReviewModel,
  type ReviewModelOptions,
} from "./view";
// The review cursor (docs/038 §7, R6-J J4): the headless controller that steps a single active
// surface through the diff's changed top-level blocks (`useReviewCursor` — next/prev/goTo + scroll-to-
// block reveal), plus its pure stops/detail derivation (`reviewCursorEntries`, `reviewEntryDetail`).
// `ReviewCursorSurface` is the anchored control that rides it.
export {
  ReviewCursorSurface,
  reviewCursorEntries,
  reviewEntryDetail,
  useReviewCursor,
  type ReviewCursor,
  type ReviewCursorEntry,
  type ReviewCursorOptions,
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
// Host data-source SPI (docs/026 §6.1): a deployment registers one `DataSource`
// per host collection it wants reference blocks to project; everything downstream
// (the picker, the cache, resolve scheduling, gating, the static reader) is engine
// the host never touches.
export {
  getDataSource,
  listDataSources,
  registerDataSource,
  unregisterDataSource,
  type DataSource,
  type DataSourcePickerProps,
} from "./view";
// Schema profile (note.md item 6): the per-deployment allowlist of schema *groups*.
// `SchemaProfile` (the data) is set on `EditorStoreOptions`; `isNodeTypeAllowed` /
// `schemaGroupOf` resolve a node type against the registries (the palette + quarantine
// gates use them, and a host can reuse them to reason about its own profile).
export { isNodeTypeAllowed, schemaGroupOf } from "./view";
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
// Markdown I/O (docs/030 MIO): lossy one-way `snapshotToMarkdown` export, the native
// snapshot-fragment clipboard for lossless in-app copy/paste, and the lossy-set contract.
// `markdownToNodes` (the markdown-it paste parser) is intentionally NOT here — it is
// lazy-loaded by the clipboard on first paste to stay out of the initial bundle.
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
} from "./view";

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
  type SchemaProfile,
  type EditorSubscriber,
  type EditorCommitSubscriber,
  type OwnedEditorHandle,
  type OwnedEditorHandleEvent,
  type OwnedEditorHandleOptions,
  type EngineScheduler,
  type EnginePerformanceSnapshot,
} from "./core";
export {
  emptyDocument,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  replaceTextContent,
  sliceTextContent,
  boundaryAtOffset,
  type CollectionItem,
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
// ============================================================================
// Snapshot diff (docs/036 §5, R6-A…E). `diffSnapshots` is one pure, framework-free
// function that computes a structured, JSON-serializable `SnapshotDiff` between two
// document snapshots by identity — blocks by NodeId, characters by CharacterId,
// marks by mark.id — so a move reads as a move, not delete-plus-insert. The diff
// view, the live inline overlay, and suggested-edits review all consume this one
// result. The result-shape types are the contract every consumer reads.
// ============================================================================
export { diffSnapshots } from "./core";
export type {
  AttrDiff,
  BlockDiff,
  BlockStatus,
  CollectionDiff,
  DiffOptions,
  DiffStats,
  MarkChange,
  ObjectDiff,
  ObjectFieldChange,
  SnapshotDiff,
  TextLeafDiff,
  TextRunDiff,
} from "./core";
// ============================================================================
// Suggested edits — Model A (docs/036 §7, docs/038, R6-J J1). A proposal is an
// attributed op-log branch; `applyProposal` folds it into a document by identity
// (node ids + character ids), so applying to a document that moved is a merge, not
// an offset rebase — a deleted anchor is surfaced as a conflict, never mis-applied.
// The proposed document diffs against the current one to render the woven review.
// ============================================================================
export {
  anchorlessChanges,
  applyProposal,
  applyProposalBlock,
  groupProposalOps,
  targetBlockOf,
  type ProposalApplyOptions,
} from "./core";
export type {
  AnchorlessChange,
  AnchorlessChangeKind,
  Proposal,
  ProposalApplication,
  ProposalAuthor,
  ProposalAuthorKind,
  ProposalConflict,
  ProposalConflictReason,
  ProposalOpGroups,
  ProposalStatus,
} from "./core";
// ============================================================================
// Snapshot lifecycle & performance (docs/030 §7.4–§7.6, SLP). Incremental save is
// internal to the store; these are the host-configurable knobs and the building
// blocks for the deferred body-paging follow-on: the memory arbiter and its pool
// contract, the bake LRU, the cold-store SPI, and the undo-budget config. The
// dev-invariant gate lets a host opt a production build in/out of the load tripwires.
// ============================================================================
export {
  MemoryArbiter,
  createBakeCache,
  createInMemoryBodyStore,
  isDevInvariantsEnabled,
  resetDevInvariants,
  setDevInvariants,
  type BakeCache,
  type BakeCacheOptions,
  type BodyStore,
  type HistoryConfig,
  type HistoryOverflow,
  type MemoryArbiterOptions,
  type MemoryPool,
  type NodeBody,
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
  type AutolinkShortcut,
  type BlockObjectShortcut,
  type BlockShortcut,
  type InlineCodeShortcut,
  type InlineLinkShortcut,
  type MarkPairShortcut,
  type MarkdownShortcut,
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
