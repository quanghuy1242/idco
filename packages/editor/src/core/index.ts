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
  ObjectNormalizationResult,
  UnknownObjectPolicy,
} from "./registry";
export {
  BUILT_IN_OBJECT_DEFINITIONS,
  BlockRegistry,
  createDefaultBlockRegistry,
  globalNodeDefinitions,
  registerGlobalNodeDefinition,
  unregisterGlobalNodeDefinition,
} from "./registry";
export type {
  StructuralCompatContext,
  StructuralCompatResult,
  StructuralDefinition,
  StructuralExportContext,
  StructuralExportResult,
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
  DocumentIndex,
  TextIndexEntry,
  TocEntry,
} from "./bake";
export { bakeObjectData, buildDocumentIndex, runBakeWorkerJob } from "./bake";
export {
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
  type BlockShortcut,
  type InlineCodeShortcut,
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
  compileCommand,
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
  type CompositionRange,
  type EditorCommitSubscriber,
  type EditorStore,
  type EditorStoreOptions,
  type EditorSubscriber,
  type PendingFormat,
} from "./store";
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
