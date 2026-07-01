/**
 * The typography class contract (docs/015 §4.3, §11.1) — the single source of truth
 * for how every block and mark *looks*, across all three render contexts (the live
 * editor, the editor at rest, and the published reader).
 *
 * Why a class contract and not a component or `prose`. Objects are edited *beside*
 * their appearance, so the editor and reader share a literal component (the baked
 * `RichText*` view). Prose is edited *inside* its appearance — the caret and typing
 * happen in the very element that displays the styled text — so the editable host
 * must *be* the styled element, and the most that can be shared is the appearance,
 * not the element. A `prose` typography layer cannot help, because it targets
 * semantic tags (`prose h2`) and can never reach the editor's editable
 * `<div role="textbox">`. So the shared unit is a set of **tag-independent classes**
 * (`.rt-*`): the reader's semantic `<h2 class="rt-block rt-h2">`, the editor's resting
 * `<h2 class="rt-block rt-h2">`, and the editor's editable `<div role="textbox"
 * class="rt-block rt-h2">` all read the *same* class, so a change to `.rt-h2` moves
 * all three and drift is unrepresentable.
 *
 * Single source, not a stylesheet asset. The CSS lives here as one exported string
 * (`RICH_TEXT_TYPOGRAPHY_CSS`), mirroring how the editor already injects
 * `ENGINE_SURFACE_SUPPRESS_CSS` (`packages/editor/src/view/styles.ts`). Both hosts
 * inject this one string — the reader as a server-rendered `<style>` (zero JS), the
 * editor where it injects its functional CSS — so there is exactly one definition and
 * no second copy to drift from (docs/015 §13 "typography contract drift"). The class
 * *names* are exported as constants so the editor references them rather than
 * re-declaring string literals.
 *
 * Values are ported from the editor's `ENGINE_TYPOGRAPHY_CSS` and
 * `ENGINE_RESTING_TYPOGRAPHY_CSS` (the interim self-sufficient resting styling that
 * this contract replaces), so the published appearance is unchanged. The CSS uses
 * DaisyUI theme custom properties (`var(--color-*)`) with literal fallbacks, so it is
 * framework-neutral: it needs no Tailwind compilation and themes correctly when
 * DaisyUI is present.
 *
 * @categoryDefault Typography
 */

/** The base class every prose block carries; sets the shared line-height baseline. */
export const RT_BLOCK = "rt-block";

/** Per-block-type appearance classes. Tag-independent so an editable div can wear them. */
export const RT_BLOCK_CLASS = {
  paragraph: "rt-p",
  h1: "rt-h1",
  h2: "rt-h2",
  h3: "rt-h3",
  h4: "rt-h4",
  h5: "rt-h5",
  h6: "rt-h6",
  quote: "rt-quote",
  list: "rt-list",
  listOrdered: "rt-list-ordered",
  listItem: "rt-li",
  callout: "rt-callout",
  codeBlock: "rt-code-block",
} as const;

/** Callout tone modifier classes (paired with `RT_BLOCK_CLASS.callout`). */
export const RT_CALLOUT_TONE_CLASS = {
  info: "rt-callout-info",
  success: "rt-callout-success",
  warning: "rt-callout-warning",
  error: "rt-callout-error",
} as const;

/** Inline-mark appearance classes. */
export const RT_MARK_CLASS = {
  link: "rt-link",
  code: "rt-code",
  strong: "rt-strong",
  em: "rt-em",
  underline: "rt-underline",
  strikethrough: "rt-strike",
  highlight: "rt-highlight",
  mark: "rt-mark",
  glossary: "rt-glossary",
  comment: "rt-comment",
} as const;

/** The heading-level class for an `h1`..`h6` tag. */
export function rtHeadingClass(
  level: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
): string {
  return RT_BLOCK_CLASS[level];
}

/**
 * The single typography stylesheet, as a string for host injection. Scoped to
 * `.rt-block`/`.rt-*` classes only — tag-independent — so it applies identically to a
 * reader's semantic element and the editor's editable `<div>`. Functional editor CSS
 * (caret/selection suppression, `pre-wrap`, `user-select`) is NOT here: that is
 * behavior, not appearance, and stays in the editor's own CSS.
 */
export const RICH_TEXT_TYPOGRAPHY_CSS =
  // The prose baseline: line-height only. Text color is owned by the host surface (the
  // reader article carries `text-base-content`; the editor surface its own), so applying
  // `.rt-block` to the editor's editable host never changes the editor's themed color.
  ".rt-block{line-height:1.55;}" +
  // Headings: weight + line-height shared, size per level (ported verbatim from
  // ENGINE_TYPOGRAPHY_CSS). Margins are omitted on the editor host (its block layout
  // owns spacing) and supplied by the reader article wrapper, so they are not baked
  // into the size classes.
  ".rt-h1,.rt-h2,.rt-h3,.rt-h4,.rt-h5,.rt-h6{font-weight:700;line-height:1.25;}" +
  ".rt-h1{font-size:1.875em;}" +
  ".rt-h2{font-size:1.5em;}" +
  ".rt-h3{font-size:1.25em;}" +
  ".rt-h4{font-size:1.1em;}" +
  ".rt-h5{font-size:1em;}" +
  ".rt-h6{font-size:0.9em;}" +
  // Quote: left rule + faint base tint + italic, off DaisyUI base tokens.
  ".rt-quote{border-left:4px solid color-mix(in oklab, var(--color-base-content, currentColor) 25%, transparent);background:color-mix(in oklab, var(--color-base-content, currentColor) 4%, transparent);border-radius:0 6px 6px 0;font-style:italic;color:color-mix(in oklab, var(--color-base-content, currentColor) 80%, transparent);}" +
  // Callout box, themed per tone with the same DaisyUI semantic tokens the Alert
  // component uses. Default (no tone class) is the info palette.
  ".rt-callout{border-radius:var(--radius-box, 0.5rem);border:1px solid color-mix(in oklab, var(--color-info, #0ea5e9) 35%, transparent);background:color-mix(in oklab, var(--color-info, #0ea5e9) 10%, var(--color-base-100, transparent));color:var(--color-base-content, CanvasText);}" +
  ".rt-callout-success{border-color:color-mix(in oklab, var(--color-success, #16a34a) 35%, transparent);background:color-mix(in oklab, var(--color-success, #16a34a) 10%, var(--color-base-100, transparent));}" +
  ".rt-callout-warning{border-color:color-mix(in oklab, var(--color-warning, #d97706) 35%, transparent);background:color-mix(in oklab, var(--color-warning, #d97706) 10%, var(--color-base-100, transparent));}" +
  ".rt-callout-error{border-color:color-mix(in oklab, var(--color-error, #dc2626) 35%, transparent);background:color-mix(in oklab, var(--color-error, #dc2626) 10%, var(--color-base-100, transparent));}" +
  // Code block: a static highlighted-or-plain <pre>. The reader runs no Prism; it
  // renders baked HTML when present or the plain source otherwise (docs/015 §4.2).
  ".rt-code-block{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.9em;line-height:1.5;background:color-mix(in oklab, var(--color-base-content, currentColor) 6%, var(--color-base-100, transparent));border:1px solid color-mix(in oklab, var(--color-base-content, currentColor) 12%, transparent);border-radius:var(--radius-box, 0.5rem);padding:12px 14px;overflow-x:auto;white-space:pre;}" +
  ".rt-code-block code{font:inherit;background:none;padding:0;}" +
  // Inline marks the UA does not style (link without href styling, code, highlight,
  // comment, glossary); semantic strong/em/u/s render via UA defaults but carry the
  // class so a host can theme them if desired.
  ".rt-link{text-decoration:underline;text-underline-offset:2px;color:var(--color-primary, #2563eb);cursor:pointer;}" +
  ".rt-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.9em;background:color-mix(in srgb, currentColor 8%, transparent);padding:0.05em 0.3em;border-radius:3px;}" +
  ".rt-highlight,.rt-mark{background:color-mix(in srgb, var(--color-warning, gold) 45%, transparent);color:inherit;border-radius:2px;}" +
  ".rt-comment{background:color-mix(in srgb, var(--color-info, #38bdf8) 22%, transparent);border-radius:2px;}" +
  // One dotted underline: the `border-bottom` is the single source. `text-decoration:none`
  // suppresses the `<abbr title>` UA underline so the term is not doubly-underlined.
  ".rt-glossary{border-bottom:1px dotted currentColor;cursor:help;text-decoration:none;}" +
  // Divider: a themed horizontal rule. A `divider` object renders `<hr class="rt-hr">`
  // (docs/028 §4.1). No margin here on purpose: the article's single inter-block gap owns
  // spacing (docs/028 §4.5), and a margin in this unlayered `<style>` would beat the
  // `[&>div>*]:my-0` neutralizer (unlayered CSS wins over @layer utilities), double-spacing
  // the rule against every other block.
  ".rt-hr{border:0;border-top:1px solid color-mix(in oklab, var(--color-base-content, currentColor) 24%, transparent);}";

/**
 * The diff-view decoration stylesheet (docs/036 §6.3 design system) — the `.rt-diff-*` companion
 * to the `.rt-*` typography contract, kept as a separate string so a plain editor/reader mount
 * pays nothing for it: only `DiffView` injects it. Tokens only (a `color-mix` over DaisyUI theme
 * custom properties with literal fallbacks), so every bar/tint/wash themes correctly with no
 * Tailwind compilation.
 *
 * One vocabulary (§6.3): a **change card** (`.rt-diff-card*` — a status left-bar, a header
 * **status tag** `.rt-diff-tag*`, a body) for a flow-level change; inline **track-changes**
 * (`.rt-diff-ins` colored underline / `.rt-diff-del` strikethrough) for text; a **fold** separator
 * (`.rt-diff-fold`) for folded context; a side-by-side **gap** (`.rt-diff-gap`). Change a hue here
 * and every diff surface moves with it.
 */
export const RICH_TEXT_DIFF_CSS =
  ".rt-diff-view{position:relative;}" +
  // Stats header summary ("+12 −3, 2 moved").
  ".rt-diff-stats{display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;font-size:0.8em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;padding:0.4rem 0.7rem;margin-bottom:0.9rem;border-radius:var(--radius-box, 0.5rem);background:color-mix(in oklab, var(--color-base-content, currentColor) 5%, transparent);}" +
  ".rt-diff-stat-added{color:var(--color-success, #16a34a);font-weight:600;}" +
  ".rt-diff-stat-removed{color:var(--color-error, #dc2626);font-weight:600;}" +
  ".rt-diff-stat-moved{color:var(--color-warning, #d97706);font-weight:600;}" +
  ".rt-diff-stat-changed{color:var(--color-info, #0ea5e9);font-weight:600;}" +
  ".rt-diff-stat-clean{color:color-mix(in oklab, var(--color-base-content, currentColor) 55%, transparent);}" +
  // The change card — a status left-bar + a faint wash. The header tag names the change; the body
  // holds the content. This is what makes a change scannable against bare unchanged context.
  ".rt-diff-card{border-left:3px solid transparent;border-radius:0 6px 6px 0;margin:0.55rem 0;padding-bottom:0.1rem;}" +
  ".rt-diff-card-added{border-left-color:var(--color-success, #16a34a);background:color-mix(in oklab, var(--color-success, #16a34a) 6%, transparent);}" +
  ".rt-diff-card-removed{border-left-color:var(--color-error, #dc2626);background:color-mix(in oklab, var(--color-error, #dc2626) 6%, transparent);}" +
  ".rt-diff-card-changed{border-left-color:var(--color-info, #0ea5e9);background:color-mix(in oklab, var(--color-info, #0ea5e9) 5%, transparent);}" +
  ".rt-diff-card-moved{border-left-color:var(--color-warning, #d97706);background:color-mix(in oklab, var(--color-warning, #d97706) 6%, transparent);}" +
  ".rt-diff-card-body{padding:0.05rem 0.8rem 0.1rem;}" +
  // A removed TEXT block is struck through (clearly deleted, still readable); a removed
  // object/table is dimmed (a grid cannot be struck).
  ".rt-diff-struck{text-decoration:line-through;text-decoration-color:color-mix(in oklab, var(--color-error, #dc2626) 55%, currentColor);color:color-mix(in oklab, var(--color-base-content, currentColor) 60%, transparent);}" +
  ".rt-diff-dim{opacity:0.55;filter:saturate(0.55);}" +
  // The one status-tag component — the card header, same shape for every status.
  ".rt-diff-tag{display:flex;align-items:baseline;gap:0.35em;font-size:0.66em;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;padding:0.3rem 0.8rem 0.1rem;}" +
  ".rt-diff-tag-icon{font-weight:400;}" +
  ".rt-diff-tag-detail{text-transform:none;font-weight:500;opacity:0.75;letter-spacing:0;}" +
  ".rt-diff-tag-added{color:var(--color-success, #16a34a);}" +
  ".rt-diff-tag-removed{color:var(--color-error, #dc2626);}" +
  ".rt-diff-tag-changed{color:var(--color-info, #0ea5e9);}" +
  ".rt-diff-tag-moved{color:var(--color-warning, #d97706);}" +
  // Inline track-changes: insert = colored underline + faint tint (reads as new text, not a chip);
  // delete = strikethrough, muted (the removed text stays readable).
  ".rt-diff-ins{text-decoration:underline;text-decoration-color:var(--color-success, #16a34a);text-decoration-thickness:2px;text-underline-offset:2px;background:color-mix(in oklab, var(--color-success, #16a34a) 9%, transparent);border-radius:2px;}" +
  ".rt-diff-del{text-decoration:line-through;text-decoration-color:color-mix(in oklab, var(--color-error, #dc2626) 60%, currentColor);color:color-mix(in oklab, var(--color-base-content, currentColor) 55%, transparent);}" +
  // A mark whose presence/attrs changed over surviving text — a dotted info underline.
  ".rt-diff-mark{text-decoration-line:underline;text-decoration-style:dotted;text-decoration-color:var(--color-info, #0ea5e9);text-underline-offset:3px;}" +
  // A change nested inside a changed container decorates inline (no nested card): a thin bar+wash.
  ".rt-diff-inline{border-left:2px solid transparent;padding-left:0.5rem;border-radius:2px;margin:0.15rem 0;}" +
  ".rt-diff-inline-added{border-left-color:var(--color-success, #16a34a);background:color-mix(in oklab, var(--color-success, #16a34a) 7%, transparent);}" +
  ".rt-diff-inline-removed{border-left-color:var(--color-error, #dc2626);background:color-mix(in oklab, var(--color-error, #dc2626) 6%, transparent);text-decoration:line-through;color:color-mix(in oklab, var(--color-base-content, currentColor) 55%, transparent);}" +
  ".rt-diff-inline-moved{border-left-color:var(--color-warning, #d97706);background:color-mix(in oklab, var(--color-warning, #d97706) 5%, transparent);}" +
  // The inline "moved" marker for a non-flow item (an <li>/<td>) that cannot wear a card.
  ".rt-diff-moved-marker{display:inline-block;font-size:0.6em;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;color:var(--color-warning, #d97706);border:1px solid color-mix(in oklab, var(--color-warning, #d97706) 40%, transparent);border-radius:3px;padding:0 0.3em;margin-right:0.4em;vertical-align:middle;}" +
  // A changed object's field-change summary.
  ".rt-diff-fields{font-size:0.78em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:color-mix(in oklab, var(--color-base-content, currentColor) 70%, transparent);margin:0.2em 0 0;list-style:none;padding-left:0;}" +
  ".rt-diff-fields li{margin:0.1em 0;}" +
  ".rt-diff-field-key{color:var(--color-base-content, CanvasText);font-weight:600;}" +
  // The folded-context separator (context=\"focused\").
  ".rt-diff-fold{text-align:center;font-size:0.72em;letter-spacing:0.06em;color:color-mix(in oklab, var(--color-base-content, currentColor) 45%, transparent);padding:0.35rem;margin:0.4rem 0;border-top:1px dashed color-mix(in oklab, var(--color-base-content, currentColor) 15%, transparent);border-bottom:1px dashed color-mix(in oklab, var(--color-base-content, currentColor) 15%, transparent);}" +
  // Side-by-side (§6.1): a 2-col grid; each row's [left cell, right cell] land in one grid row and
  // top-align, so matched blocks line up. A one-sided row shows a clean gap opposite the block.
  ".rt-diff-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 1.5rem;align-items:start;}" +
  ".rt-diff-cell{min-width:0;align-self:start;}" +
  ".rt-diff-gap{min-width:0;min-height:1.4rem;border-radius:6px;background:color-mix(in oklab, var(--color-base-content, currentColor) 3%, transparent);}" +
  ".rt-diff-colhead{font-size:0.72em;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:color-mix(in oklab, var(--color-base-content, currentColor) 55%, transparent);padding-bottom:0.25rem;border-bottom:1px solid color-mix(in oklab, var(--color-base-content, currentColor) 12%, transparent);margin-bottom:0.4rem;}";
