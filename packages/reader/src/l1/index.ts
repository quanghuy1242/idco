/**
 * L1 — the RSC-safe presentational primitive layer (docs/015 §4.1/§4.2). Pure node+baked
 * → DOM for every block and mark, plus the typography class contract. No `"use client"`,
 * no hooks, no handlers anywhere under here; the import-boundary lint (docs/015 §7.5)
 * enforces it. Imported by both the server `<Reader>` (whole render) and the editor
 * (resting render + the shared `.rt-*` classes).
 */
export * from "./types";
export * from "./blocks";
export * from "./marks";
export * from "./objects";
export * from "./table";
export * from "./toc";
export {
  RT_BLOCK,
  RT_BLOCK_CLASS,
  RT_CALLOUT_TONE_CLASS,
  RT_MARK_CLASS,
  rtHeadingClass,
  RICH_TEXT_TYPOGRAPHY_CSS,
} from "./typography";
