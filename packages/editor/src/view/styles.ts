/**
 * Style constants and load-bearing CSS for the owned-model editor view.
 *
 * Why this file exists
 * --------------------
 * The view was decomposed out of one ~3.3k-line module (docs/017 §3.1). This is
 * the seam for the daisyui migration (docs/017 §3.5): the colors, spacing, and
 * borders here are placeholders free to move to design tokens.
 *
 * Load-bearing CSS — DO NOT lose these when restyling (note.md §2 / docs/017
 * §3.1). They are functional, not decorative:
 *
 * - `caret-color: transparent` + the `::selection` suppression in
 *   `ENGINE_SURFACE_SUPPRESS_CSS` (the engine paints its own caret/selection),
 *   with the `[data-engine-object-editor] { caret-color: auto }` override so the
 *   live code editor keeps its native caret.
 * - `userSelect: none` on text blocks (native selection must not fight the
 *   overlay during a pointer drag).
 * - `position: relative` (content) / `position: absolute` (overlay rects).
 * - `whiteSpace: pre-wrap` on text blocks (soft breaks + caret geometry).
 */
import type { CSSProperties } from "react";

export const baseViewStyle: CSSProperties = {
  border: "1px solid color-mix(in srgb, CanvasText 18%, transparent)",
  borderRadius: 8,
  color: "CanvasText",
  fontFamily:
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  lineHeight: 1.55,
  maxWidth: 920,
  position: "relative",
};

export const visuallyHiddenStyle: CSSProperties = {
  border: 0,
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  margin: -1,
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: 1,
};

export const CARET_BLINK_KEYFRAMES =
  "@keyframes idco-caret-blink{0%,50%{opacity:1}51%,100%{opacity:0}}";

// Suppress the browser's own caret and ::selection on the editing surface so the
// only visible caret/selection is the engine-painted overlay (docs/010 Phase 7
// AC6). Applies on both backends: native EditContext can still draw a platform
// caret on the focused host, and the native ::selection can flash during a
// pointer gesture. Reabsorbed from the Phase 2 spike's overlay (§10.2).
// Suppress the native caret/::selection on the engine's own text surface (the
// blocks paint their own caret/overlay), but NOT on a live object editor: its
// `<textarea>`/inputs are real native inputs that must keep their visible caret
// and selection (the code-block live edit surface, docs/010 §6.4). caret-color
// inherits, so the object editor needs an explicit `auto` override.
export const ENGINE_SURFACE_SUPPRESS_CSS =
  "[data-engine-view-root]{caret-color:transparent;}" +
  "[data-engine-view-root] [data-engine-text-id]{caret-color:transparent;}" +
  "[data-engine-view-root] [data-engine-text-id]::selection{background:transparent;color:inherit;}" +
  // Marks render as nested elements (strong/em/a/…) inside the text block; their
  // own ::selection must be suppressed too, or the native highlight shows over
  // the engine overlay on a formatted run (the "double selection", Phase 8 AC3).
  "[data-engine-view-root] [data-engine-text-id] *::selection{background:transparent;color:inherit;}" +
  "[data-engine-view-root]::selection{background:transparent;color:inherit;}" +
  "[data-engine-view-root] [data-engine-object-editor],[data-engine-view-root] [data-engine-object-editor] *{caret-color:auto;}";

/**
 * Visible typography for the editing surface (docs/010 Phase 8 AC2/AC3).
 *
 * The editor renders every text leaf as a `<div role="textbox">` (the caret/
 * EditContext host), so the block type is carried on `data-engine-block-type`
 * rather than a semantic element — which means a `prose` typography layer (which
 * targets `<h2>`/`<blockquote>`/…) cannot style the editing surface. This CSS is
 * the engine's own block + mark styling so a heading looks like a heading and a
 * link is underlined *in the editor*, themed with DaisyUI tokens
 * (`--color-primary`/`--color-base-content`) so it follows the active theme even
 * when the host has not installed the typography plugin. The resting/reader
 * render uses real semantic elements + `prose` (resting-document.tsx); this is
 * the editor-surface counterpart, not a competing theme.
 */
export const ENGINE_TYPOGRAPHY_CSS =
  // Block types.
  '[data-engine-view-root] [data-engine-block-type="heading"]{font-weight:700;line-height:1.25;margin:0;}' +
  '[data-engine-view-root] [data-engine-heading="h1"]{font-size:1.875em;}' +
  '[data-engine-view-root] [data-engine-heading="h2"]{font-size:1.5em;}' +
  '[data-engine-view-root] [data-engine-heading="h3"]{font-size:1.25em;}' +
  '[data-engine-view-root] [data-engine-heading="h4"]{font-size:1.1em;}' +
  '[data-engine-view-root] [data-engine-block-type="quote"]{border-left:3px solid color-mix(in srgb, currentColor 30%, transparent);padding-left:12px;font-style:italic;opacity:0.85;}' +
  '[data-engine-view-root] [data-engine-block-type="listitem"]{padding-left:1.5em;}' +
  '[data-engine-view-root] [data-engine-block-type="listitem"]::before{content:"•";position:absolute;left:0.5em;opacity:0.6;}' +
  // Inline marks. Semantic elements (strong/em/u/s/sub/sup) already render via UA
  // defaults; these style the ones the UA does not (link without href, code,
  // highlight, comment, glossary) and theme the link with the DaisyUI token.
  "[data-engine-view-root] [data-engine-mark='link']{text-decoration:underline;text-underline-offset:2px;color:var(--color-primary, #2563eb);cursor:pointer;}" +
  "[data-engine-view-root] [data-engine-mark='code']{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.9em;background:color-mix(in srgb, currentColor 8%, transparent);padding:0.05em 0.3em;border-radius:3px;}" +
  "[data-engine-view-root] [data-engine-mark='highlight']{background:color-mix(in srgb, var(--color-warning, gold) 45%, transparent);color:inherit;border-radius:2px;}" +
  "[data-engine-view-root] [data-engine-mark='comment']{background:color-mix(in srgb, var(--color-info, #38bdf8) 22%, transparent);border-radius:2px;}" +
  "[data-engine-view-root] [data-engine-mark='glossary']{border-bottom:1px dotted currentColor;}";

export const objectBlockStyle: CSSProperties = {
  border: "1px solid color-mix(in srgb, CanvasText 16%, transparent)",
  borderRadius: 6,
  margin: "4px 0",
  padding: 8,
  position: "relative",
};

export const objectStatusStyle: CSSProperties = {
  font: "13px/1.5 ui-sans-serif, system-ui, sans-serif",
};

export const codeBakedStyle: CSSProperties = {
  background: "color-mix(in srgb, CanvasText 6%, transparent)",
  borderRadius: 4,
  font: "13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
  margin: 0,
  overflow: "auto",
  padding: 8,
  whiteSpace: "pre",
};

export const codeLiveStyle: CSSProperties = {
  ...codeBakedStyle,
  border: "none",
  // border-box so width:100% fills the container exactly like the resting <pre>,
  // and an auto-set height of scrollHeight (content + padding) matches the baked
  // box so activation does not shift layout (AC3, the no-drift property).
  boxSizing: "border-box",
  color: "CanvasText",
  display: "block",
  outline: "2px solid color-mix(in srgb, CanvasText 28%, transparent)",
  overflow: "hidden",
  resize: "none",
  width: "100%",
};

export const mediaBakedStyle: CSSProperties = {
  font: "13px/1.5 ui-sans-serif, system-ui, sans-serif",
  margin: 0,
};

export const mediaThumbStyle: CSSProperties = {
  alignItems: "center",
  background: "color-mix(in srgb, CanvasText 8%, transparent)",
  borderRadius: 4,
  display: "flex",
  justifyContent: "center",
  minHeight: 48,
  padding: 8,
};

export const objectConfigStyle: CSSProperties = {
  background: "Canvas",
  border: "1px solid color-mix(in srgb, CanvasText 28%, transparent)",
  borderRadius: 6,
  boxShadow: "0 6px 24px color-mix(in srgb, CanvasText 22%, transparent)",
  display: "flex",
  flexDirection: "column",
  gap: 6,
  left: 8,
  padding: 10,
  position: "absolute",
  top: "calc(100% + 4px)",
  width: "min(320px, 90%)",
  zIndex: 5,
};

export const objectConfigFieldStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  font: "13px/1.4 ui-sans-serif, system-ui, sans-serif",
  gap: 8,
};

export const objectConfigInputStyle: CSSProperties = {
  border: "1px solid color-mix(in srgb, CanvasText 30%, transparent)",
  borderRadius: 4,
  color: "CanvasText",
  flex: 1,
  padding: "4px 6px",
};

export const objectConfigDoneStyle: CSSProperties = {
  alignSelf: "flex-end",
  border: "1px solid color-mix(in srgb, CanvasText 30%, transparent)",
  borderRadius: 4,
  cursor: "pointer",
  padding: "4px 10px",
};

export const blockStyle: CSSProperties = {
  borderRadius: 6,
  // The model owns caret painting. Chromium native EditContext can still draw a
  // platform caret on the focused host, so hide that browser caret or native
  // comparison mode double-paints.
  caretColor: "transparent",
  minHeight: 28,
  outline: "none",
  padding: "5px 8px",
  position: "relative",
  // The engine paints selection through model-derived overlay rects, so the
  // browser's own selection must not compete during a pointer drag (§8.5).
  userSelect: "none",
  WebkitUserSelect: "none",
  whiteSpace: "pre-wrap",
};
