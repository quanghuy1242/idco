/**
 * Markdown I/O barrel (docs/030 MIO). View-layer transport, not core.
 *
 * `from-markdown.ts` is deliberately NOT re-exported here: it statically imports `markdown-it`
 * (~100 KB), and the clipboard controller lazy-loads it via `import()` on first paste so the
 * parser stays out of the initial editor bundle. Re-exporting it from this barrel would pull
 * the parser into anything that imports the barrel. Import `markdownToNodes` from the deep
 * path (the lazy `import()` or a test) instead. Export (`to-markdown`), the native clipboard
 * fragment, and the shared correspondence are all parser-free and safe to re-export.
 */
export { snapshotToMarkdown } from "./to-markdown";
export {
  IDCO_SNAPSHOT_MIME,
  collectSelectionFragment,
  parseFragment,
  serializeFragment,
  type SnapshotFragment,
} from "./native-clipboard";
export {
  CALLOUT_TONES,
  MARKDOWN_LOSSY_MARK_KINDS,
  MARK_MARKERS,
  headingTagForLevel,
  normalizeCalloutTone,
  type CalloutTone,
} from "./transformers";
