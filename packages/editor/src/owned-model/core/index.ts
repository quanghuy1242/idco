// Owned-model engine core (docs/010). Framework-agnostic: this subtree must
// import neither React nor Lexical — enforced by the
// `architecture/owned-model-core-no-framework` lint rule (docs/010 G3/AC4).
//
// Phase 1 seeds it with the pure helpers salvaged from the retired section
// shell; later phases add the document model, EditContext input controller,
// selection model, transactions, and bake orchestration.

export {
  ensureDocumentNodeIds,
  isRichTextNodeId,
  createRichTextNodeId,
  type RichTextNodeId,
} from "./ids";
export {
  richTextDocumentSignature,
  richTextSectionSignature,
  richTextNodeSignature,
  hashString,
} from "./signatures";
export {
  RichTextSectionHeightCache,
  estimatedSectionHeight,
  type SectionHeightCacheKey,
  type SectionHeightInput,
} from "./height-cache";
export {
  calculateVirtualRange,
  type VirtualRange,
  type VirtualRangeInput,
} from "./virtual-range";

// Phase 2 input + caret + selection spike (docs/010 P2).
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
  type OwnedInputDiagnostics,
  type CreateTextInputControllerOptions,
} from "./text-input-controller";
