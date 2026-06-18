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
  ObjectNormalizationResult,
  UnknownObjectPolicy,
} from "./registry";
export {
  BUILT_IN_OBJECT_DEFINITIONS,
  BlockRegistry,
  createDefaultBlockRegistry,
} from "./registry";
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
} from "./steps";
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
export { collectSelectionText, orderedTextLeaves } from "./selection";
export {
  ROOT_NODE_ID,
  TransactionBuilder,
  createEditorStore,
  type EditorStore,
  type EditorStoreOptions,
  type EditorSubscriber,
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
