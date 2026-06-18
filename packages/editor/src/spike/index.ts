// docs/010 Phase 2 input + caret + selection spike — REFERENCE ONLY.
//
// Purpose: prove the EditContext API + the vendored polyfill are feasible for a
// model-owned, virtualized editor. It is NOT the canonical model. Its document
// and selection shape is a flat block list (FlowTextBlock/FlowObjectBlock, much
// of it living in the Ladle stories), which is exactly the flat-store design
// 011 §1.1 REJECTED in favor of the normalized node graph. Do not treat the
// spike's model as correct, and do not import this from `core/` or `view/`.
//
// The canonical engine is built fresh in `core/` (Phase 3+). The spike's
// hard-won input/IME/caret/overlay BEHAVIOR is reabsorbed into `core/` later,
// gated by the e2e/IME test suite as the behavior bar, then this folder is
// deleted. Until then: read it, do not depend on it.

export {
  caretPointFromCoordinates,
  offsetWithinText,
  type CaretPoint,
} from "./caret-from-point";
export {
  createEditContextHost,
  type EditContextHost,
  type EditContextLike,
  type EditContextBackend,
  type EditContextReplacementResult,
  type CreateEditContextHostOptions,
} from "./editcontext-host";
export {
  createSelectionOverlay,
  type SelectionOverlay,
  type SelectionModel,
  type OverlayRenderInfo,
} from "./selection-overlay";
export {
  createTextInputController,
  type TextInputController,
  type TextInputState,
  type EngineInputDiagnostics,
  type CreateTextInputControllerOptions,
} from "./text-input-controller";
