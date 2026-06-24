/**
 * The server read tier barrel (docs/015 §4.5, docs/028 §4.1). Server-safe: `<Reader>`, the
 * snapshot-native render dispatch, the resolution kernel, and the option/snapshot types. No
 * `"use client"`, no island import — so this stays in the server-safe `.` graph.
 */
export { Reader } from "./Reader";
export {
  bodyNodes,
  collectHeadings,
  groupListRuns,
  renderBlock,
  renderRestingDocument,
  renderTableOfContents,
  renderUnit,
  tocEntries,
  type ReaderRenderUnit,
} from "./render";
export {
  readerHeadingAnchor,
  readerHeadingLevel,
  registerReaderIdentityMark,
  resolveBoundaryOffset,
  resolveLeafMarks,
  safeHref,
  segmentLeaf,
  segmentText,
  type ReaderCharacterRun,
  type ReaderMarkBoundary,
  type ReaderResolvedMark,
  type ReaderTextAnchor,
  type ReaderTextContent,
  type ReaderTextLeaf,
  type ReaderTextMark,
  type ReaderTextSegment,
} from "./model";
export type {
  IslandRenderer,
  ReaderAttrs,
  ReaderBaked,
  ReaderBlockNode,
  ReaderObjectNode,
  ReaderObjectRenderer,
  ReaderOptions,
  ReaderSnapshot,
  ReaderStructuralNode,
  ReaderStructuralRenderer,
  ReaderTextNode,
} from "./types";
