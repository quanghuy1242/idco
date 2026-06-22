# Toolbar SPI — icon+label polish and responsive auto-collapse

## What this is

A design note for the next toolbar UX iteration. Today each tab's command row is a flat run of square icon-only buttons (tooltip on hover). The goal is to optionally render a text label next to the icon, decided per group, and to degrade gracefully under width pressure by collapsing overflow into a dropdown rather than horizontal-scrolling the row. No implementation yet — this captures the findings, the chosen shape, and the gotchas.

## The three layers being touched

- Layer 1, descriptor registries: marks, block types, node inserts, and the command registry. Each already carries a human label.
- Layer 2, the product surface: `packages/editor/src/view/spi/toolbar-layout.ts` — the tab/slot/item model plus `computeToolbarLayout`, a pure DOM-free resolver.
- Layer 3, the renderer: `packages/editor/src/view/chrome/surfaces/ribbon.tsx` — reads the resolved layout and paints it, holding zero command/layout knowledge.

## Finding: the label data already exists

Every resolved item kind already has a label that is currently spent only on `ariaLabel` + `tooltip`. So an icon+label mode needs no model or registry change — the data is already flowing.

- `mark` → `item.mark.toolbar.label`
- `insert` → `item.label`
- `action` → `item.action.label`
- `blockType` → already renders its label today (it is the labeled dropdown at ribbon.tsx:203-252)

The `@idco/ui` `Button` already supports icon + text together via `children` and `iconPosition` (packages/ui/src/button.tsx). The renderer change for static labels is just "drop `square`, pass the label as children." The whole problem is therefore an SPI-shape decision, not a rendering capability gap.

## Decision: the knob lives on the slot

Chosen granularity is per-slot, not a global prop and not per-item. Rationale: labels are valuable for some groups and pure noise for others. Bold/Italic/Underline/Strike are universally legible glyphs — labels there waste horizontal space and make the row collapse sooner. The Insert blocks group (Callout, Code, Media, Embed, Divider, TOC, Post-ref) is exactly where icons are ambiguous and the discoverability win is real. That heterogeneity is also the real-world ribbon pattern (Word mixes large labelled buttons with dense icon clusters inside one tab).

The slot is already defined as "a labelled group of controls" and already mentions dense/mobile presentation, so it is the natural home. Proposed addition to `ToolbarSlot`:

```ts
export type ToolbarSlot = {
  readonly id: string;
  // ...existing fields...
  /** How controls in this slot present. Default "icon". */
  readonly display?: "icon" | "labelled" | "auto";
};
```

This fits the SPI philosophy: declared as data, set at registration, the renderer reads it blind, and a host flips one group without touching the renderer. `home.format` stays `icon`; `insert.blocks` becomes `labelled` or `auto`. Per-item override was rejected as noisy and prone to ragged-looking rows; a global prop was rejected as too coarse (it would force redundant labels onto Bold/Italic).

## Decision: responsive behavior is "auto → dropdown", not scroll

Under width pressure the row should collapse overflow into a dropdown menu, not horizontal-scroll. This replaces today's `flex-nowrap overflow-x-auto` strategy for the command row (ribbon.tsx:375).

Cleanest mental model is a three-tier `auto` per slot: labelled when there is room, then icon-only (drop labels, keep tooltips) when tighter, then overflow the tail into one trailing Ellipsis menu when even icons do not fit. Tier 2 reuses the same measurement already taken to decide tier 1 (you must measure the labelled width to know whether labels fit).

## Finding: the collapse engine already exists in `packages/ui`

Two in-house components implement "show inline until it doesn't fit, then collapse the overflow into a dropdown". This is battle-tested house code, not something to invent.

- `packages/ui/src/responsive-actions.tsx` — the closest match. Trailing actions collapse into a single `Ellipsis` `MenuTrigger`.
- `packages/ui/src/responsive-breadcrumb.tsx` — same technique, collapsing leading crumbs instead.

The shared mechanism, worth lifting:

1. Hidden measurement layer. ResponsiveActions renders an `aria-hidden`, `invisible`, absolutely-positioned duplicate row of the fully labelled buttons plus the ellipsis button (responsive-actions.tsx:214-248), and measures each item's natural width from that — never from the live row. This is the key trick for `auto`: measure the width items want, not the width they currently have.
2. ResizeObserver on container + parent + measure-list, coalesced through one requestAnimationFrame, plus window/visualViewport resize and `document.fonts.ready` (responsive-actions.tsx:161-169). Fonts-ready matters: text width is wrong until the webfont lands.
3. Pure width math in `nextCollapseCount` (responsive-actions.tsx:48-80): greedily find how many trailing items to hide so `directWidth + menuWidth + gaps <= available`. Mirrors the toolbar-layout philosophy — a pure function decides, the renderer paints.
4. A correction pass (responsive-actions.tsx:181-195): after layout, if `scrollWidth > available`, bump collapse by one to guard against measurement rounding.
5. A hard mobile cutoff (`max-width: 767px` → collapse everything) at responsive-actions.tsx:111-114.

## Finding: what React Aria actually contributes (be precise)

Checked the RA `Toolbar` docs page. Do not over-credit it.

- React Aria does NOT do overflow/collapse. `Toolbar` is `display:flex; flex-wrap:wrap` — it wraps, it does not measure or collapse into a menu. There is no built-in responsive-collapse primitive in React Aria. The measurement layer must be ours (the packages/ui pattern above).
- What RA gives is the two endpoints. `Menu`/`MenuTrigger` (already used in ribbon.tsx and ResponsiveActions) is the overflow target — focus, dismissal, keyboard, ARIA all handled. `Toolbar` (the component) would additionally give arrow-key roving focus + `role="toolbar"` semantics; today ribbon.tsx:341 hand-sets `role="toolbar"` with no arrow-key nav, so adopting RA `Toolbar` is an orthogonal accessibility upgrade we could fold in, but it is not what powers the collapse.

Net: "React Aria supports us" is true for the overflow popover and toolbar semantics; the collapse engine is the packages/ui pattern. Two different sources, both already in the house.

## SPI-level considerations unique to the editor toolbar

ResponsiveActions only ever has uniform button items. The editor toolbar does not, so "auto → dropdown" surfaces three things ResponsiveActions never had to handle.

### a. `responsivePriority` finally earns its keep

It is already on every resolved item (toolbar-layout.ts:185-188) and documented as "responsive-collapse rank", but nothing reads it today. The collapse order should be driven by it (lowest priority collapses into the menu first) instead of ResponsiveActions' purely positional "collapse from the end". This is the tissue connecting the existing SPI to the new behavior — no new field needed.

### b. Not every item kind collapses into a flat MenuItem

ResponsiveActions assumes `{label, icon, onAction}`. The resolved items are heterogeneous (toolbar-layout.ts:190-222):

- `mark`, `insert`, and `action` of `kind:"button"` → collapse cleanly (label + icon + run).
- `action` of `kind:"popover"`/`"dropdown"` (table picker, link) → a popover-inside-a-menu is awkward; these want to stay inline or render as a submenu.
- `blockType` → already a wide (`w-40`) labelled dropdown; it is the natural "keep last / never collapse to a menu item" element.
- `component` (the `find` escape hatch at ribbon.tsx:128-141) → opaque host React; cannot become a MenuItem.

So the resolved item likely needs to advertise its collapse behavior — something like `collapsible: "menu-item" | "keep-inline" | "submenu"` derived per kind. That is the one genuinely new bit of SPI surface, and it is a derivation, not host config.

### c. It interacts with the existing responsive strategy

Today the command row is `flex-nowrap overflow-x-auto` (ribbon.tsx:375) and scrolls under pressure. Auto → dropdown replaces that strategy for the command row. The three-tier model (labelled → icon-only → overflow menu) is the graceful degradation we want on a narrow editor pane.

## Gotchas specific to the editor toolbar

- Focus restoration. Every toolbar press deliberately bounces focus back to the editing surface (ribbon.tsx:95-101, 273-277). An overflow Menu must do the same on action — ResponsiveActions does not, since its actions do not refocus an editor. The collapsed MenuItem `onAction` has to route through the same `run(...)` wrapper.
- The bar's `onMouseDownCapture` preventDefault (ribbon.tsx:339) must not swallow the measurement layer's interactions. The hidden measure row is `pointer-events-none`, so it is fine, but verify an RA `Toolbar` adoption does not fight the capture handler.
- Re-measure on content change. The row's item set changes with selection (capability gating, marks resolving in/out). The measure effect must key off the resolved layout signature, like ResponsiveActions keys off `actionSignature` (responsive-actions.tsx:94-96).
- Test story. Ladle measurement-driven UI has been flaky before (scroller/readyMs gotchas). An auto toolbar story needs a deterministic container width plus a fonts-ready wait, or it will be flaky.

## Recommendation / next step

Extract a small `useResponsiveCollapse` measurement hook in `packages/ui` from responsive-actions.tsx (hidden-measure + ResizeObserver + `nextCollapseCount` + correction pass), parameterized by per-item width and a priority order. Then the editor's `display:"auto"` slot feeds it `responsivePriority` and renders the overflow tail into the `Menu` ribbon.tsx already imports — with the `collapsible` kind-derivation handling popover/component/blockType items. React Aria's role is the `Menu` (overflow) and optionally `Toolbar` (roving focus); the collapse engine is ours, already written.

Open follow-up choices for when work resumes:

- Whether to adopt the RA `Toolbar` component now (gains arrow-key roving focus) or keep the hand-set `role="toolbar"` and do collapse only.
- Whether `auto` is the three-tier model or a simpler two-tier (labelled → overflow menu, skipping the icon-only middle tier).
- Where the `collapsible` derivation lives — in `computeToolbarLayout` (so it stays pure and testable) versus in the renderer.
