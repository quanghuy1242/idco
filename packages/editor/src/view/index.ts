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
} from "./navigation";
export {
  getNodeView,
  listInsertableNodes,
  registerNode,
  registerNodeView,
  type NodeView,
  type NodeViewChromeArgs,
  type NodeViewConfigField,
  type NodeViewInsert,
  type NodeViewLiveArgs,
  type NodeViewRestingArgs,
  type RegisterNodeArgs,
} from "./node-view";
export {
  getStructuralView,
  listInsertableStructuralNodes,
  registerStructuralView,
  type StructuralContainerArgs,
  type StructuralNodeView,
  type StructuralNodeViewInsert,
  type StructuralRestingArgs,
} from "./structural-view";
export {
  OwnedModelEditor,
  type OwnedModelEditorHandle,
  type OwnedModelEditorProps,
} from "./owned-model-editor";
export { EditorToolbar } from "./editor-chrome";
export {
  FindBar,
  findMatches,
  useFindController,
  type FindController,
  type FindMatch,
} from "./find-bar";
export { renderLeafMarks } from "./mark-render";
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
} from "./resting-document";
export {
  computeWindowListMeta,
  listItemStyle,
  type ListItemMeta,
} from "./styles";
