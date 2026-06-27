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
