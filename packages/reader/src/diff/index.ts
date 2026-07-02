/**
 * The diff-view surface barrel (docs/036 §6.1, R6-F). Server-safe: `DiffView` is a pure,
 * hookless render over one `ReaderSnapshotDiff`, and the types are a structural mirror of the
 * engine's `SnapshotDiff`, so this stays in the reader's server-safe `.` graph and never
 * imports the editor (which depends on the reader, not the reverse).
 */
export { DiffView, type DiffViewProps } from "./diff-view";
export { ChangeDetail } from "./change-detail";
export { partitionTextRuns, type RunSlice, type RunSliceId } from "./runs";
export {
  DIFF_STATUS_TOKENS,
  diffStatusColor,
  type DiffStatusKey,
  type DiffStatusToken,
} from "./tokens";
export {
  elementDisclosure,
  tierOf,
  type ChangeKind,
  type DisclosureTier,
  type NodeDiffRenderer,
} from "./vocabulary";
export type {
  DiffViewMode,
  ReaderAttrDiff,
  ReaderBlockDiff,
  ReaderCollectionDiff,
  ReaderDiffBlockStatus,
  ReaderDiffStats,
  ReaderMarkChange,
  ReaderObjectDiff,
  ReaderObjectFieldChange,
  ReaderSnapshotDiff,
  ReaderTextLeafDiff,
  ReaderTextRunDiff,
} from "./types";
