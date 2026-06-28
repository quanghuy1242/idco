/**
 * Style constants and load-bearing CSS for the owned-model editor view.
 *
 * Why this file exists
 * --------------------
 * The view was decomposed out of one ~3.3k-line module (docs/017 §3.1). This is
 * the seam for the daisyui migration (docs/017 §3.5): the colors, spacing, and
 * borders here are placeholders free to move to design tokens.
 *
 * Load-bearing CSS — DO NOT lose these when restyling (docs/017 §3.6). They are
 * functional, not decorative:
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
import {
  RICH_TEXT_TYPOGRAPHY_CSS,
  RT_BLOCK,
  RT_BLOCK_CLASS,
  rtHeadingClass,
} from "@quanghuy1242/idco-reader";
import type { EditorStore, NodeId, TextLeafType } from "../core";

/**
 * @categoryDefault Editor Components
 */

/**
 * The `.rt-*` typography class for a text-leaf block (docs/015 §4.3). The single source of
 * prose appearance: the live editor's editable host wears the *same* class the reader's L1
 * primitive emits, so a heading/quote looks identical whether edited or read, and changing
 * `.rt-h2` once moves both. Paragraph carries `rt-p` (no extra rules — default body text);
 * `listitem` carries only the baseline (`.rt-li` has no appearance of its own — the marker
 * is the engine's functional `::before`).
 */
export function richTextLeafClass(node: {
  readonly type: string;
  readonly attrs?: { readonly tag?: unknown } | null;
}): string {
  if (node.type === "heading") {
    const tag =
      typeof node.attrs?.tag === "string" && /^h[1-6]$/.test(node.attrs.tag)
        ? (node.attrs.tag as "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
        : "h2";
    return `${RT_BLOCK} ${rtHeadingClass(tag)}`;
  }
  if (node.type === "quote") return `${RT_BLOCK} ${RT_BLOCK_CLASS.quote}`;
  if (node.type === "listitem") return `${RT_BLOCK} ${RT_BLOCK_CLASS.listItem}`;
  return `${RT_BLOCK} ${RT_BLOCK_CLASS.paragraph}`;
}

// Re-export the reader's typography contract for the editor surface to inject (the single
// stylesheet that defines the `.rt-*` appearance the live host wears).
export { RICH_TEXT_TYPOGRAPHY_CSS };

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

/**
 * The editing surface's content inset, in px. Applied as the scroller/root padding
 * on both render paths so text never jams against the surface edge. On the
 * virtualized path the windowing subtracts this from `scrollTop` so the scroll math
 * stays exact (the scroller's top padding shifts the content origin by this much).
 */
export const SURFACE_PADDING = 16;

/**
 * Resolve the editing surface's root style across both render paths (R3, note.md
 * §5.9). It folds the two formerly-inline style objects in `react-view.tsx` into
 * one typed result so `chromeless`/`fillHeight` are real props, not load-bearing
 * `style={{...}}` consumer knowledge.
 *
 * - `chromeless` strips the card chrome (border, radius, max-width cap) so the
 *   surface reads as the page itself — the typed form of the old
 *   `style={{ border: "none", borderRadius: 0, maxWidth: "none" }}` override.
 * - `fillHeight` stretches the surface: `height: "100%"` so it fills a parent that
 *   has a height. On the virtualized path the *windowing* still needs a concrete
 *   pixel height (measured from the container by `useVirtualWindow`); this only
 *   sets the CSS so the scroller box actually fills its flex column.
 * - The caller's explicit `style` is spread LAST so the inline escape hatch still
 *   wins for anything a prop does not cover (back-compat with current consumers).
 *
 * The virtualized branch keeps `overflowAnchor: "none"` (docs/025 §5.4: the
 * controller owns the scroll anchor, so the browser's own overflow-anchor must not
 * also adjust scrollTop or the two corrections fight and jitter) and the auto
 * vertical scroll the scroller needs.
 */
export function resolveViewStyle(opts: {
  readonly virtualize: boolean;
  readonly viewportHeight: number;
  readonly chromeless: boolean;
  readonly fillHeight: boolean;
  readonly style?: CSSProperties;
}): CSSProperties {
  const { virtualize, viewportHeight, chromeless, fillHeight, style } = opts;
  // Drop the three card-chrome keys when chromeless (no border, radius, or
  // max-width cap); keep everything else (font/colour/line-height/position) so
  // prose still renders identically.
  const base: CSSProperties = chromeless
    ? {
        color: baseViewStyle.color,
        fontFamily: baseViewStyle.fontFamily,
        lineHeight: baseViewStyle.lineHeight,
        position: baseViewStyle.position,
      }
    : baseViewStyle;
  if (virtualize) {
    return {
      ...base,
      height: fillHeight ? "100%" : viewportHeight,
      overflowAnchor: "none",
      overflowY: "auto",
      // Same content inset as the non-virtualized path (was `padding: 0`, which
      // jammed the text against the surface edge — note.md §5.9 follow-up). The
      // caret/selection overlay lives INSIDE the scrolled content div, so it moves
      // with this padding and stays aligned; the windowing absorbs the constant
      // vertical offset via `SURFACE_PADDING` (passed to `useVirtualWindow`) so the
      // scroll math stays exact rather than drifting by the inset.
      padding: SURFACE_PADDING,
      ...style,
    };
  }
  // Non-virtualized: `minHeight: 100%` (not `height`) so the surface fills its
  // container's height — making the blank area below the text a click-to-type target
  // — while still growing past it when the content is taller (the page scrolls),
  // instead of clipping. Needs a parent with a definite height.
  return {
    ...base,
    padding: SURFACE_PADDING,
    ...(fillHeight ? { minHeight: "100%" } : {}),
    ...style,
  };
}

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
  // A live object editor (the code <textarea>, the config inputs) is a real
  // native input and must keep its visible native caret. Use a concrete color,
  // not `caret-color:auto`: the code editor renders highlighted text via a `<pre>`
  // underneath a `text-transparent` textarea (CodeEditor), so `auto` (= follow
  // the text color) would make the caret transparent too — the missing-caret bug.
  "[data-engine-view-root] [data-engine-object-editor],[data-engine-view-root] [data-engine-object-editor] *{caret-color:var(--color-base-content, CanvasText);}";

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
  // Block prose appearance (heading sizes/weight, the quote rule) is no longer defined
  // here: it moved to the single `.rt-*` typography contract the reader owns
  // (`RICH_TEXT_TYPOGRAPHY_CSS`, docs/015 §4.3), which the surface injects and the live
  // editable host wears via `richTextLeafClass`, so the editor and the reader render a
  // heading/quote from one definition and cannot drift. What remains here is structural
  // chrome and inline-mark styling whose live DOM differs from the reader's static
  // primitive (callout container + glyph, the computed list marker, the inline marks).
  // Callout: a tinted note box themed per `tone` with the same DaisyUI semantic
  // tokens the `Alert` component uses (info/success/warning/error), so it reads
  // as a callout while editing and matches the resting `alert` render (docs/018
  // §2.8, docs/019). A callout is now a structural container (it stacks block
  // children — paragraphs, lists), so the box is the container div, not a text
  // leaf; these rules reproduce the alert palette on it. The default (no/`info`
  // tone) uses the info token; padding gives the inner blocks gutter room.
  '[data-engine-view-root] [data-engine-structural="callout"]{border-radius:var(--radius-box, 0.5rem);border:1px solid color-mix(in oklab, var(--color-info, #0ea5e9) 35%, transparent);background:color-mix(in oklab, var(--color-info, #0ea5e9) 10%, var(--color-base-100, transparent));color:var(--color-base-content, CanvasText);padding:8px 1em 8px 2.75rem;margin:0.5em 0;}' +
  '[data-engine-view-root] [data-engine-callout-tone="success"]{border-color:color-mix(in oklab, var(--color-success, #16a34a) 35%, transparent);background:color-mix(in oklab, var(--color-success, #16a34a) 10%, var(--color-base-100, transparent));}' +
  '[data-engine-view-root] [data-engine-callout-tone="warning"]{border-color:color-mix(in oklab, var(--color-warning, #d97706) 35%, transparent);background:color-mix(in oklab, var(--color-warning, #d97706) 10%, var(--color-base-100, transparent));}' +
  '[data-engine-view-root] [data-engine-callout-tone="error"]{border-color:color-mix(in oklab, var(--color-error, #dc2626) 35%, transparent);background:color-mix(in oklab, var(--color-error, #dc2626) 10%, var(--color-base-100, transparent));}' +
  // The tone glyph (the same `AlertGlyph` the resting render uses) sits in the
  // left gutter the padding reserves, tinted to match the tone — so the editing
  // surface reads like the published alert, not just a tinted box.
  // `top` aligns the glyph centre with the first text line: box pad-top (8px) +
  // the lead block's pad-top (5px) + half the line-leading, so it reads level
  // with the first line rather than floating at the box top.
  "[data-engine-view-root] [data-engine-callout-glyph]{position:absolute;left:0.7rem;top:14px;pointer-events:none;color:var(--color-info, #0ea5e9);}" +
  "[data-engine-view-root] [data-engine-callout-glyph] svg{height:1.4rem;width:1.4rem;}" +
  '[data-engine-view-root] [data-engine-callout-tone="success"] [data-engine-callout-glyph]{color:var(--color-success, #16a34a);}' +
  '[data-engine-view-root] [data-engine-callout-tone="warning"] [data-engine-callout-glyph]{color:var(--color-warning, #d97706);}' +
  '[data-engine-view-root] [data-engine-callout-tone="error"] [data-engine-callout-glyph]{color:var(--color-error, #dc2626);}' +
  // The list padding-left + bullet offset are applied inline per block
  // (`blockStyleFor`) because the functional `blockStyle` sets an inline padding
  // shorthand that would otherwise win the cascade; only the bullet glyph itself
  // lives here. It sits inside the reserved left padding so it never overlaps the
  // text (the overlap bug, docs/010 §14).
  // `top` matches the list item's (tighter) top padding so the bullet aligns
  // with the first line of text (see LIST_ITEM_PADDING_Y in blockStyleFor).
  // A bulleted item (the default, and any `listType="bullet"`) shows a glyph; an
  // ordered item (`listType="number"`) shows its model-computed ordinal instead —
  // the number is computed at paint from list-run adjacency (docs/018 §2.10), not
  // a CSS counter, because under virtualization a CSS counter would count only the
  // mounted `<li>`s and renumber a scrolled list from 1. The ordinal rides on
  // `data-engine-list-ordinal`; it is right-aligned in the same reserved gutter so
  // multi-digit numbers stay clear of the text.
  '[data-engine-view-root] [data-engine-block-type="listitem"]:not([data-engine-list-type="number"])::before{content:"•";position:absolute;left:0.55em;top:2px;line-height:inherit;opacity:0.6;}' +
  '[data-engine-view-root] [data-engine-block-type="listitem"][data-engine-list-type="number"]::before{content:attr(data-engine-list-ordinal) ".";position:absolute;left:0;top:2px;width:1.3em;text-align:right;line-height:inherit;opacity:0.6;font-variant-numeric:tabular-nums;}' +
  // A checklist item (`data-engine-list-checked` present) shows a ☐/☑ checkbox in
  // place of the bullet (docs/030 §4.3c). These follow the bullet rule so, at equal
  // specificity, they win for a checklist item (which is also `list-type="bullet"`);
  // the `="true"` rule is more specific and wins for the checked state. The glyph is
  // `cursor:pointer` to hint the gutter click `focusAtClick` handles.
  '[data-engine-view-root] [data-engine-block-type="listitem"][data-engine-list-checked]::before{content:"\\2610";position:absolute;left:0.2em;top:1px;line-height:inherit;opacity:0.75;cursor:pointer;}' +
  '[data-engine-view-root] [data-engine-block-type="listitem"][data-engine-list-checked="true"]::before{content:"\\2611";opacity:0.85;}' +
  // Inline marks. Semantic elements (strong/em/u/s/sub/sup) already render via UA
  // defaults; these style the ones the UA does not (link without href, code,
  // highlight, comment, glossary) and theme the link with the DaisyUI token.
  "[data-engine-view-root] [data-engine-mark='link']{text-decoration:underline;text-underline-offset:2px;color:var(--color-primary, #2563eb);cursor:pointer;}" +
  "[data-engine-view-root] [data-engine-mark='code']{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.9em;background:color-mix(in srgb, currentColor 8%, transparent);padding:0.05em 0.3em;border-radius:3px;}" +
  "[data-engine-view-root] [data-engine-mark='highlight']{background:color-mix(in srgb, var(--color-warning, gold) 45%, transparent);color:inherit;border-radius:2px;}" +
  "[data-engine-view-root] [data-engine-mark='comment']{background:color-mix(in srgb, var(--color-info, #38bdf8) 22%, transparent);border-radius:2px;}" +
  "[data-engine-view-root] [data-engine-mark='glossary']{border-bottom:1px dotted currentColor;}" +
  // Empty-document placeholder (R2, note.md §5.8). A muted, non-interactive hint
  // painted inside the empty first/only block. It is absolutely positioned at the
  // block's text origin (the block's own 8px/5px content padding, blockStyle) so it
  // sits exactly where the caret paints, and `pointer-events:none` + `user-select:
  // none` keep it from intercepting the click that places the caret or from being
  // selected. `right` constrains a long hint to the block width so it wraps instead
  // of overflowing. Themed with the DaisyUI base-content token at reduced opacity.
  "[data-engine-view-root] [data-engine-placeholder-text]{position:absolute;left:8px;right:8px;top:5px;pointer-events:none;user-select:none;-webkit-user-select:none;color:var(--color-base-content, CanvasText);opacity:0.4;}";

// The self-sufficient resting typography (`ENGINE_RESTING_TYPOGRAPHY_CSS`) was retired
// (docs/028 §4.5): it was a *third* source of block/mark appearance beside the live editor
// CSS and the reader's `.rt-*` contract. `RestingDocument` now renders through the reader's
// `<Reader>`, which injects the single `RICH_TEXT_TYPOGRAPHY_CSS` — so there is no second
// definition to drift from.

/**
 * Hover/active affordance for heavy-object blocks. Painted with `box-shadow` (a
 * focus-style ring) rather than a border so it never changes the box's geometry
 * — activation must not shift layout (docs/010 §6.4 AC3). At rest an object
 * renders bare; the ring appears only on hover or while live-editing, so the
 * user still sees what is interactive without a permanent editor frame.
 */
export const ENGINE_OBJECT_CHROME_CSS =
  "[data-engine-view-root] [data-engine-object-type]{transition:box-shadow .12s ease;}" +
  "[data-engine-view-root] [data-engine-object-type]:hover{box-shadow:0 0 0 1px color-mix(in srgb, var(--color-primary, #2563eb) 35%, transparent);}" +
  "[data-engine-view-root] [data-engine-object-state='live']{box-shadow:0 0 0 2px var(--color-primary, #2563eb);}";

export const objectBlockStyle: CSSProperties = {
  // No resting border/padding: a baked object renders as its own content (the
  // reader's render, resting-document.tsx), not boxed in editor chrome — a
  // bordered box around an <hr> or an embed reads as broken (docs/010 §14). The
  // only affordance is a hover/active ring painted via box-shadow (see
  // ENGINE_OBJECT_CHROME_CSS), which does not change layout, so activation never
  // shifts the box (AC3).
  borderRadius: 6,
  margin: "4px 0",
  position: "relative",
};

export const objectStatusStyle: CSSProperties = {
  font: "13px/1.5 ui-sans-serif, system-ui, sans-serif",
};

// The code-block live + resting render now both flow through `@idco/ui`'s
// `CodeEditor` (Prism highlighting, DaisyUI styling) for syntax highlighting and
// a guaranteed no-shift box (docs/018 §2.8), so the old hand-rolled `<pre>`/
// `<textarea>` inline styles were retired.

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

// The config popover's own box/buttons/inputs are now @idco/ui (AnchoredPopover +
// Input + Button) with Tailwind layout classes, so the old hand-rolled
// `objectConfig*` box/input/done inline styles were retired (docs/010 §7.1). Only
// the field-row layout style remains, shared by the config and media panels.
export const objectConfigFieldStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  font: "13px/1.4 ui-sans-serif, system-ui, sans-serif",
  gap: 8,
};

/**
 * A style for an element that is **restyled across renders** — never a CSS
 * box-model *shorthand*, only longhands.
 *
 * Why this type exists (the standardized guard, docs/010 §14 hardening): React's
 * inline-style reconciliation clears a now-absent *longhand* (e.g. `paddingTop`)
 * by setting it to `""` — and it does so *after* writing a *shorthand*
 * (`padding`). So if render A sets `paddingTop` and render B switches to the
 * `padding` shorthand, React writes the shorthand and then blanks `paddingTop`,
 * zeroing that side (the list-item→paragraph padding collapse). Banning the
 * shorthands at the type level makes the whole class of bug unrepresentable for
 * any dynamically-restyled element. Static, never-restyled styles
 * (`objectBlockStyle`, the divider `<hr>`) keep `CSSProperties` and may use
 * shorthands freely — they are written once and never diffed against a sibling
 * variant.
 */
export type LonghandBlockStyle = Omit<
  CSSProperties,
  "padding" | "margin" | "border" | "font" | "inset" | "gap"
>;

export const blockStyle: LonghandBlockStyle = {
  borderRadius: 6,
  // The model owns caret painting. Chromium native EditContext can still draw a
  // platform caret on the focused host, so hide that browser caret or native
  // comparison mode double-paints.
  caretColor: "transparent",
  // An editable text surface reads as an I-beam, not the default arrow. The
  // engine still owns the caret painting; this is only the pointer affordance.
  // (Links re-assert `cursor: pointer` in ENGINE_TYPOGRAPHY_CSS.)
  cursor: "text",
  minHeight: 28,
  outline: "none",
  // Padding is written as longhands (not the `padding` shorthand) on purpose:
  // `blockStyleFor` overrides individual sides for list items, and a block that
  // flips listitem↔paragraph between renders would otherwise hit React's
  // shorthand/longhand reconciliation bug — React clears the now-absent
  // `paddingTop` longhand to "" *after* writing the shorthand, zeroing the top
  // padding (the toggled-off paragraph collapsing to a tight box, docs/010 §14).
  // Same keys every render keeps the diff clean.
  paddingBottom: 5,
  paddingLeft: 8,
  paddingRight: 8,
  paddingTop: 5,
  position: "relative",
  // The engine paints selection through model-derived overlay rects, so the
  // browser's own selection must not compete during a pointer drag (§8.5).
  userSelect: "none",
  WebkitUserSelect: "none",
  whiteSpace: "pre-wrap",
};

/** One visual indent level, in em (matches the legacy editor's step). */
export const INDENT_STEP_EM = 1.6;

/**
 * A structural container (a quote/callout holding block children, the genuine
 * future use of the `structural` kind) renders its children stacked, with no box
 * of its own — the children carry their own block geometry (docs/018 §2.11
 * "rendering is separable from virtualizing").
 */
export const structuralContainerStyle: CSSProperties = { position: "relative" };

/**
 * A structural `list` container indents its items one step, so a nested list
 * (a list inside a structural list item) visibly steps in per level while each
 * item still owns its own marker gutter.
 */
export const structuralListStyle: CSSProperties = {
  paddingLeft: `${INDENT_STEP_EM}em`,
  position: "relative",
};

/**
 * The left-margin style for a block's `attrs.indent` level, or `undefined` when
 * unindented. Shared by the editing surface (`blockStyleFor`) and the resting
 * render (`resting-document.tsx`) so an indented block reads the same in both —
 * the §2.8 indent persist/resting-render parity (docs/018).
 */
export function indentMarginStyle(indent: unknown): CSSProperties | undefined {
  return typeof indent === "number" && indent > 0
    ? { marginLeft: `${indent * INDENT_STEP_EM}em` }
    : undefined;
}

// List items sit tighter than paragraphs (a list reads as one grouped block, the
// typographic convention) — less top/bottom padding and a smaller min height than
// the default block, so consecutive items are closer than separate paragraphs.
const LIST_ITEM_PADDING_Y = 2;
const LIST_ITEM_MIN_HEIGHT = 22;
// Extra breathing room before the first / after the last item of a list run, so a
// list reads as a grouped block set apart from the paragraphs around it. A flat
// list has no `<ul>`/`<ol>` to carry this margin, so the view derives first/last
// from the same render-time adjacency scan as the ordinals (docs/018 §2.10).
const LIST_RUN_BOUNDARY_MARGIN = 6;

/**
 * Per-item list metadata computed at paint from body-order adjacency (docs/018
 * §2.10): the run flavour, the 1-based ordinal within the run, and whether the
 * item opens/closes its run. The flat model has no `<ul>`/`<ol>` container, so the
 * view computes this instead of leaning on a CSS counter or container margins.
 */
export type ListItemMeta = {
  readonly listType: "bullet" | "number";
  readonly ordinal: number;
  readonly firstInRun: boolean;
  readonly lastInRun: boolean;
};

/**
 * Add the list-run boundary margins to a list item's base style, or return the
 * base unchanged (stable reference) for a non-list item or a mid-run item. The
 * base already carries any indent margin-left, which the spread preserves.
 */
export function listItemStyle(
  base: LonghandBlockStyle,
  meta: ListItemMeta | undefined,
): LonghandBlockStyle {
  if (!meta) return base;
  const top = meta.firstInRun ? LIST_RUN_BOUNDARY_MARGIN : undefined;
  const bottom = meta.lastInRun ? LIST_RUN_BOUNDARY_MARGIN : undefined;
  if (top === undefined && bottom === undefined) return base;
  return {
    ...base,
    ...(top !== undefined ? { marginTop: top } : {}),
    ...(bottom !== undefined ? { marginBottom: bottom } : {}),
  };
}

/** The flat-list run flavour of a node, or null when it is not a list item. */
function listFlavourOf(
  store: EditorStore,
  id: NodeId,
): "bullet" | "number" | null {
  const node = store.getNode(id);
  if (!node || node.kind !== "text" || node.type !== "listitem") return null;
  return node.attrs?.listType === "number" ? "number" : "bullet";
}

/**
 * Compute `ListItemMeta` for the list items in the current window (docs/018
 * §2.10). A *run* is a maximal sequence of consecutive `listitem` blocks of the
 * same flavour; an item's ordinal is its 1-based position in that run. The window
 * is a contiguous slice of the body order, so the run an item belongs to may have
 * begun before the window — the ordinal is seeded once by walking back from the
 * window start to the run start, then carried forward across the window in O(1)
 * per item. (A run spanning a very large offscreen prefix is the §2.11
 * trigger-gated case, not this flat-list pass.)
 */
export function computeWindowListMeta(
  store: EditorStore,
  windowIds: readonly NodeId[],
  windowStartIndex: number,
): Map<NodeId, ListItemMeta> {
  const order = store.order;
  const meta = new Map<NodeId, ListItemMeta>();
  // Seed the running ordinal from the run that may continue into the window.
  let runFlavour: "bullet" | "number" | null =
    windowStartIndex > 0
      ? listFlavourOf(store, order[windowStartIndex - 1]!)
      : null;
  let runOrdinal = 0;
  if (runFlavour) {
    runOrdinal = 1;
    for (let k = windowStartIndex - 2; k >= 0; k--) {
      if (listFlavourOf(store, order[k]!) !== runFlavour) break;
      runOrdinal++;
    }
  }
  for (let wi = 0; wi < windowIds.length; wi++) {
    const id = windowIds[wi]!;
    const flavour = listFlavourOf(store, id);
    if (!flavour) {
      runFlavour = null;
      runOrdinal = 0;
      continue;
    }
    if (flavour === runFlavour) {
      runOrdinal++;
    } else {
      runFlavour = flavour;
      runOrdinal = 1;
    }
    const globalIndex = windowStartIndex + wi;
    const nextId = order[globalIndex + 1];
    const lastInRun =
      nextId === undefined || listFlavourOf(store, nextId) !== flavour;
    meta.set(id, {
      firstInRun: runOrdinal === 1,
      lastInRun,
      listType: flavour,
      ordinal: runOrdinal,
    });
  }
  return meta;
}

/**
 * Per-text-type style overrides, applied on top of `blockStyle`.
 *
 * Declarative instead of a `type === x` chain: a text leaf type that needs
 * distinct block geometry adds one entry here, no edit to `blockStyleFor`'s
 * control flow. The key set is `TextLeafType` (a closed model union, `model.ts`),
 * so a new type is a compile-time reminder to consider its style; types with no
 * entry (paragraph, heading) just use `blockStyle`. Entries are
 * `Partial<LonghandBlockStyle>`, so they can only override longhands — never
 * reintroduce a box-model shorthand that the longhand-only rule bans (docs/017
 * §3.6).
 *
 * Heavy/custom blocks are *object* nodes and style themselves through the
 * `NodeView` SPI (`renderResting`/`renderLive`, docs/016); they never appear here
 * and never require editing this file.
 */
const BLOCK_TYPE_STYLE: Partial<
  Record<TextLeafType, Partial<LonghandBlockStyle>>
> = {
  // The bullet gutter is reserved inline (stylesheet `padding-left` would lose to
  // the inline padding); list items also sit tighter than paragraphs.
  listitem: {
    minHeight: LIST_ITEM_MIN_HEIGHT,
    paddingBottom: LIST_ITEM_PADDING_Y,
    paddingLeft: "1.6em",
    paddingTop: LIST_ITEM_PADDING_Y,
  },
  // The quote bar (border-left, ENGINE_TYPOGRAPHY_CSS) needs gutter room.
  quote: { paddingLeft: "1em" },
};

/**
 * Per-block style: `blockStyle` plus the type's overrides and the visual indent.
 *
 * Type-specific geometry comes from `BLOCK_TYPE_STYLE` (declarative, extensible),
 * and indent rides on `attrs.indent` (set by the indent/outdent commands) as a
 * left margin so the whole block — bullet included — shifts together. Every
 * override is a longhand (never `blockStyle`'s padding shorthand — there isn't
 * one), so a block flipping between types diffs cleanly (docs/017 §3.6).
 */
export function blockStyleFor(node: {
  readonly type: string;
  readonly attrs?: {
    readonly indent?: unknown;
    readonly format?: unknown;
  } | null;
}): LonghandBlockStyle {
  const indent =
    typeof node.attrs?.indent === "number" && node.attrs.indent > 0
      ? node.attrs.indent
      : 0;
  // Element alignment rides on `attrs.format` (note.md item 1) — the same field the
  // reader's `elementAlign` maps to align. The LIVE editor must paint it here too, or
  // the Align control is a model-only no-op with no visible effect (the symptom that
  // exposed this gap). Only center/right/justify produce a `text-align`; left/absent is
  // the default, so the shared-object fast path below still covers the common block.
  const align =
    node.attrs?.format === "center" ||
    node.attrs?.format === "right" ||
    node.attrs?.format === "justify"
      ? (node.attrs.format as "center" | "right" | "justify")
      : undefined;
  const typeStyle = BLOCK_TYPE_STYLE[node.type as TextLeafType];
  // Fast path for the common, unstyled, unindented, left-aligned block
  // (paragraph/heading): reuse the shared object so React sees a stable reference.
  if (!typeStyle && indent === 0 && !align) return blockStyle;
  return {
    ...blockStyle,
    ...typeStyle,
    ...(indent > 0 ? { marginLeft: `${indent * INDENT_STEP_EM}em` } : {}),
    ...(align ? { textAlign: align } : {}),
  };
}
