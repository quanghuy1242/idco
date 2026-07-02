/**
 * Public barrel for the headless owned-model editor core.
 *
 * Keep this export surface free of React, Lexical, DOM, and view code. Anything
 * exported here is part of the framework-agnostic engine spine that later
 * phases will bind to input, rendering, scheduling, and virtualization.
 */
export type {
  BakedSnapshot,
  CharacterId,
  CharacterRun,
  ClientId,
  CollectionItem,
  DocumentSettings,
  EditorDocumentSnapshot,
  EditorNode,
  EditorSelection,
  GapSelection,
  IdAllocator,
  JsonObject,
  JsonValue,
  MarkBoundary,
  NodeId,
  NodeSelection,
  ObjectNode,
  ObjectNodeStatus,
  ParentEntry,
  RichTextCompatDocument,
  RichTextCompatNode,
  StructuralNode,
  StructuralNodeType,
  TextAnchor,
  TextContent,
  TextLeafNode,
  TextLeafType,
  TextMark,
  TextMarkKind,
  TextPoint,
  TextSelection,
  TextSlice,
} from "./model";
export {
  boundaryAtOffset,
  characterIdsForSlice,
  createIdAllocator,
  createTextSliceFromIds,
  emptyDocument,
  makeObjectNode,
  makeStructuralNode,
  makeTextNode,
  pointAtOffset,
  replaceTextContent,
  resolveBoundaryOffset,
  resolvePointOffset,
  sliceTextContent,
} from "./model";
export type {
  BlockDefinition,
  NodeAnchor,
  NodeDefinition,
  NodeHeightHint,
  ObjectNormalizationResult,
  UnknownObjectPolicy,
} from "./registry";
export {
  BUILT_IN_OBJECT_DEFINITIONS,
  BlockRegistry,
  createDefaultBlockRegistry,
  globalNodeDefinitions,
  nodeDiffResolver,
  registerGlobalNodeDefinition,
  unregisterGlobalNodeDefinition,
} from "./registry";
export type {
  StructuralCompatContext,
  StructuralCompatResult,
  StructuralDefinition,
  StructuralExportContext,
  StructuralExportResult,
  StructuralInsertParams,
  StructuralSubtree,
} from "./registry";
export {
  BUILT_IN_STRUCTURAL_DEFINITIONS,
  getStructuralDefinition,
  globalStructuralDefinitions,
  isStructuralDefinitionType,
  registerGlobalStructuralDefinition,
} from "./registry";
export type {
  BakeObjectResult,
  BakeWorkerJob,
  BakeWorkerResult,
  CommentIndexEntry,
  DocumentIndex,
  TextIndexEntry,
  TocEntry,
} from "./bake";
export {
  bakeObjectData,
  buildDocumentIndex,
  headingAnchor,
  runBakeWorkerJob,
} from "./bake";
export { createBakeCache, type BakeCache, type BakeCacheOptions } from "./bake";
export {
  MemoryArbiter,
  type MemoryArbiterOptions,
  type MemoryPool,
} from "./memory/pool";
export {
  isDevInvariantsEnabled,
  resetDevInvariants,
  setDevInvariants,
} from "./dev-flags";
export {
  registerIdentityMark,
  isIdentityMark,
  resolveLeafMarks,
  segmentLeaf,
  segmentText,
  type ResolvedMark,
  type TextSegment,
} from "./model";
export {
  importPayloadLexical,
  type PayloadImportReport,
  type PayloadImportResult,
  type PayloadLexicalInput,
} from "./compat";
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
} from "./markdown-shortcuts";
export { safeHref } from "./url-safety";
export type { BakeService, WorkerLike } from "./bake";
export {
  createLoopbackBakeService,
  createLoopbackWorker,
  createWorkerBakeService,
} from "./bake";
export type {
  AddMarkStep,
  CommittedTransaction,
  InsertNodeStep,
  MoveNodeStep,
  RemoveMarkStep,
  RemoveNodeStep,
  ReplaceTextStep,
  SetNodeAttrStep,
  SetNodeTypeStep,
  SetObjectDataStep,
  SetSettingsStep,
  Step,
  StoreDirty,
  TransactionDraft,
  TransactionOrigin,
} from "./model";
export type {
  EnginePerformanceDashboard,
  EnginePerformanceSnapshot,
  EnginePerformanceTaskSnapshot,
  EngineScheduler,
  EngineSchedulerCoalesce,
  EngineSchedulerContract,
  EngineSchedulerLane,
  EngineSchedulerOptions,
  EngineSchedulerPriority,
  EngineSchedulerTask,
  EngineTaskRunContext,
  EngineTaskRunResult,
} from "./scheduler";
export { createEngineScheduler } from "./scheduler";
export {
  activeScope,
  childrenOf,
  compileAddRefMark,
  compileCommand,
  compileInsertFragment,
  isDisposableEmpty,
  pendingFormatMarkSteps,
  placeNodes,
  resolveInsertionPoint,
  runQuery,
  scopePath,
  type EditorCommand,
  type EditorCommandType,
  type EditorQuery,
  type InsertionPoint,
} from "./commands";
export {
  createOwnedEditorHandle,
  type OwnedEditorHandle,
  type OwnedEditorHandleEvent,
  type OwnedEditorHandleOptions,
} from "./editor-handle";
export {
  Mapping,
  mapTextOffset,
  type MapBias,
  type MapPos,
  type PointRedirect,
} from "./model";
export { collectSelectionText, orderedTextLeaves } from "./store";
export {
  ROOT_NODE_ID,
  TransactionBuilder,
  createEditorStore,
  createInMemoryBodyStore,
  HistoryPool,
  type BodyStore,
  type CompositionRange,
  type EditorCommitSubscriber,
  type EditorStore,
  type EditorStoreOptions,
  type EditorSubscriber,
  type HistoryConfig,
  type HistoryOverflow,
  type NodeBody,
  type PendingFormat,
  type ReviewFocusProtection,
  type ReviewModeOptions,
  type ReviewModeState,
  type SchemaProfile,
} from "./store";
export { diffSnapshots } from "./diff";
export {
  BODY_SCOPE_ID,
  attrDiffIsEmpty,
  buildParentIndex,
  countStats,
  diffAttrs,
  diffMarks,
  diffObject,
  diffScope,
  diffSequences,
  diffTextLeaf,
  jsonEqual,
  longestCommonSubsequence,
  type DiffContext,
  type ObjectDiffResult,
  type SequenceOp,
} from "./diff";
export type {
  AttrDiff,
  BlockDiff,
  BlockStatus,
  CollectionDiff,
  DiffOptions,
  DiffStats,
  MarkChange,
  ObjectDiff,
  ObjectDiffDefinition,
  ObjectFieldChange,
  SnapshotDiff,
  TextLeafDiff,
  TextRunDiff,
} from "./diff";
export {
  anchorlessChanges,
  applyProposal,
  applyProposalBlock,
  applyProposalToStore,
  attributionForTextRun,
  groupProposalOps,
  proposalAttribution,
  revertLiveProposalApplication,
  revertLiveProposalBlock,
  targetBlockOf,
  type ProposalApplyOptions,
  type SuggestionAttribution,
} from "./suggestions";
export type {
  AnchorlessChange,
  AnchorlessChangeKind,
  LiveProposalApplication,
  Proposal,
  ProposalApplication,
  ProposalAuthor,
  ProposalAuthorKind,
  ProposalConflict,
  ProposalConflictReason,
  ProposalOpGroups,
  ProposalStatus,
} from "./suggestions";
export {
  TEXT_FORMAT,
  compatFromEditorStore,
  compatFromSnapshot,
  compatInlineChildren,
  createEditorStoreFromCompat,
  createTextMark,
  editorSnapshotFromCompat,
  settingsFromCompat,
  textNodeTypeFromCompat,
  type CompatOptions,
  type RuntimeFormatMarkKind,
} from "./compat";
