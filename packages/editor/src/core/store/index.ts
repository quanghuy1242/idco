/**
 * The runtime store package (docs/020 §7.5). The `EditorStore` class stays a
 * single mutable identity (docs/011 §6.8) in `editor-store.ts`; the `this`-free
 * dispatch helpers live in `history.ts` (undo coalescing) and `mapping-helpers.ts`
 * (mark/selection remap, notify-skip, value utilities). This barrel preserves the
 * original `core/store` import shape so no caller changes. `selection.ts` (read
 * helpers over a store's current selection) moved in here under note.md CP5
 * because it depends on the store.
 */
export {
  ROOT_NODE_ID,
  TransactionBuilder,
  EditorStore,
  createEditorStore,
  type EditorStoreOptions,
  type SchemaProfile,
  type CompositionRange,
  type PendingFormat,
  type EditorSubscriber,
  type EditorCommitSubscriber,
} from "./editor-store";
export { collectSelectionText, orderedTextLeaves } from "./selection";
export {
  HistoryPool,
  type HistoryConfig,
  type HistoryOverflow,
} from "./history-pool";
export {
  createInMemoryBodyStore,
  type BodyStore,
  type NodeBody,
} from "./body-store";
