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
  registerNode,
  registerNodeView,
  type NodeView,
  type NodeViewInsert,
  type NodeViewLiveArgs,
  type NodeViewRestingArgs,
  type RegisterNodeArgs,
} from "./node-view";
