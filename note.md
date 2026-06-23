# Toolbar SPI — icon+label polish and responsive auto-collapse

## What this is

A design note for the next toolbar UX iteration. Today each tab's command row is a flat run of square icon-only buttons (tooltip on hover). The goal is to optionally render a text label next to the icon, decided per group, and to degrade gracefully under width pressure by collapsing overflow into a dropdown rather than horizontal-scrolling the row. The rest of this note captures the findings, the chosen shape, and the gotchas.

## Status: implemented (2026-06-23)

All of this note shipped. The slices: `ToolbarSlot.display` (`"icon" | "labelled" | "auto"`) carried onto the resolved slot; a pure per-kind `collapsible` derivation on every resolved item (`"menu-item" | "keep-inline" | "submenu"`, with `submenu` reserved); the `useResponsiveCollapse` hook + pure `computeCollapsedIds` extracted into `@idco/ui` (priority-ordered, mixed-item, hidden-measure + ResizeObserver + correction pass); the ribbon command row rebuilt as a React Aria `Toolbar` (roving focus) that labels/collapses per slot and falls back to horizontal scroll on mobile; mark + block-type `disabled` gating wired (greyed off a text leaf); and a `shortcut` field on marks/commands surfaced in tooltips + `aria-keyshortcuts`. The **Insert tab renders icon + label** (`insert.tables` → `labelled`, `insert.blocks` → `auto`). Tests: `computeCollapsedIds` unit coverage in `tests/ui/use-responsive-collapse.test.ts` and display/collapsible/gating/shortcut assertions in `tests/editor/engine-toolbar-spi.test.ts`; full `pnpm check` green.

Two open follow-up questions resolved during the build: `auto` ships as the **two-tier** model (labelled → overflow menu, no icon-only middle tier) — the simpler sanctioned option, and the middle tier is the one that hurt touch discoverability anyway; and the `collapsible` derivation lives in **`computeToolbarLayout`** (pure + testable), not the renderer. Deliberate deferrals: the `"submenu"` collapse mode for popover/dropdown actions (they stay `keep-inline` for now), and code-block-specific mark gating (only the no-text-leaf case greys controls today).

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

### Mobile is horizontal scroll, not collapse

The three-tier degradation is a **desktop** behavior, gated above the mobile breakpoint. Below it (the `max-width: 767px` cutoff ResponsiveActions already uses at responsive-actions.tsx:111-114), do not collapse the command row into a dropdown — keep today's simple `overflow-x-auto` horizontal scroll (ribbon.tsx:375). Rationale: on touch there is no hover, so the icon-only middle tier would strip labels exactly where tooltips never fire, leaving bare glyphs the user cannot learn; and an overflow menu of formatting controls is a worse thumb target than a swipeable row. So the responsive matrix is: desktop under width pressure → labelled → icon-only → overflow menu; mobile → always horizontal-scroll the labelled-or-icon row. This inverts ResponsiveActions' mobile rule (which collapses *everything* on mobile) because a formatting row is scanned and swiped, not a short list of page actions. The measurement engine still only runs on desktop; the mobile branch is a CSS fallback with no measurement, which also sidesteps the Ladle measurement flakiness on the mobile story.

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

## UX gaps surfaced while grounding (adjacent, fold into the same epic)

Grounding the label/collapse work against the live renderer turned up three real UX gaps that are cheap, already half-plumbed, and synergistic with this change. They are not "label + collapse" but they touch the same files and the same SPI, so they belong in the same epic rather than a later pass.

### 1. `role="toolbar"` with no roving focus (accessibility correctness)

ribbon.tsx:340 hand-sets `role="toolbar"`, which by ARIA contract promises arrow-key navigation between controls — and there is none. Every `Button` is independently tab-focusable, so a keyboard user tabs through ~12 stops to cross one tab's command row, and a screen reader announces a "toolbar" that does not behave like one. This is the RA `Toolbar` adoption the responsive finding listed as "orthogonal"; promote it from optional aside to in-scope, because it is a correctness issue (the role is already asserted) and it is cheapest to fold in while this file is already open. RA `Toolbar` gives roving tabindex + arrow-key nav for free; verify it does not fight the capture-phase `onMouseDownCapture` preventDefault (ribbon.tsx:339) or the hidden measure row.

### 2. Mark and block-type gating is plumbed but dead

The resolved item already carries a `disabled` field, but `resolveConfigItem` hardcodes `disabled: false` for every mark (toolbar-layout.ts:334) and for the block-type chooser (toolbar-layout.ts:362), and the mark `Button` does not even pass `disabled` (ribbon.tsx:187-199). So Bold stays clickable-looking inside a code block where inline marks are meaningless. Actions already gate through `isDisabled` (command-registry.ts:159); marks and block-types just never wire the equivalent query. Wiring it makes the controls reflect what actually applies to the selection — independent of labels, but it lands in the exact same resolve path.

### 3. No keyboard-shortcut hints anywhere

Marks have shortcuts (Ctrl/Cmd+B, etc.) but the mark and command descriptors carry **no shortcut metadata at all** — only `find` hardcodes the string `"Find (Ctrl/Cmd+F)"` (ribbon.tsx:136). Tooltips show the bare label (`tooltip={meta.label}`). Adding an optional `shortcut` to the descriptor and rendering it in the tooltip (plus `aria-keyshortcuts` on the control) is the highest discoverability-per-effort change here, and it composes directly with the label work — the same descriptor that gains a visible label can carry its shortcut.

## Explicitly out of scope: contextual tabs

No contextual/auto-following tab (the Word "Picture Format on selection" pattern). `ToolbarTab.isAvailable` gates visibility but tabs deliberately do not auto-activate on selection. This is intended, not a gap: objects already carry their own **inline** chrome — the node SPI ships a default settings gear, a custom `chromeControl` (the code block's language selector), a `chromeMeta` badge, and view-level `renderOverlay` floating surfaces (node-view.ts:41-159), and structural nodes contribute selection controls through `renderOverlay` + `contributeCommands` (the table's hover row/column controls, structural-view.ts:62-119). The contextual affordance lives next to the object, where the selection is, not in a far-away ribbon tab. A contextual ribbon tab would duplicate that inline chrome and split one object's controls across two places.

## Recommendation / next step

Extract a small `useResponsiveCollapse` measurement hook in `packages/ui` from responsive-actions.tsx (hidden-measure + ResizeObserver + `nextCollapseCount` + correction pass), parameterized by per-item width and a priority order. Then the editor's `display:"auto"` slot feeds it `responsivePriority` and renders the overflow tail into the `Menu` ribbon.tsx already imports — with the `collapsible` kind-derivation handling popover/component/blockType items. React Aria's role is the `Menu` (overflow) and optionally `Toolbar` (roving focus); the collapse engine is ours, already written.

Open follow-up choices for when work resumes:

- Whether `auto` is the three-tier model or a simpler two-tier (labelled → overflow menu, skipping the icon-only middle tier) — this is now a *desktop-only* question; mobile is settled as horizontal scroll.
- Where the `collapsible` derivation lives — in `computeToolbarLayout` (so it stays pure and testable) versus in the renderer.

(The RA `Toolbar` adoption is no longer an open "whether" — it moved into the in-scope UX-gaps section above as item 1, the accessibility-correctness fix.)
