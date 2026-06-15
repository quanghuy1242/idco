# 004 - Selection Flyout And Contextual Text Actions

> Status: implemented
>
> Date: 2026-06-14
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor` - Lexical editor model, toolbar, selected-text flyout, right-click context menu.
> - `/home/quanghuy1242/pjs/idco/stories` - Ladle verification surface for selected-text actions.
> - `/home/quanghuy1242/pjs/idco/tests/editor` - unit and integration coverage for action eligibility.
>
> Source docs:
>
> - `AGENTS.md` - React Aria behavior + DaisyUI styling contract.
> - `.agents/skills/idco-ui/SKILL.md` - shared UI package rules and verification requirements.
> - React Aria docs - `Popover`, `Menu`, `Toolbar`.
> - Lexical docs - selection APIs, `SELECTION_CHANGE_COMMAND`, `$getSelection`, `$isRangeSelection`, range formats.
> - DaisyUI 5 docs - button, menu, input, textarea, overlay panel styling classes.
>
> Related docs:
>
> - `docs/001_lexical_editor_architecture.md` - original flyout/context-menu roadmap.
> - `docs/002_gap_cursor_and_block_flow.md` - gap cursor and block flow interactions.
> - `docs/003_block_chrome_and_table_capabilities.md` - current block/table right-click menu shape.
>
> Assumptions:
>
> - Lexical stays pinned at `0.45.0` across all `@lexical/*` packages.
> - Selected-text actions only apply to a non-collapsed `RangeSelection`; table selections, node selections, collapsed carets, block decorator controls, and gap-cursor states do not open the selected-text flyout.
> - The right-click menu keeps its existing block/table capabilities and adds a selected-text branch without regressing table merge/unmerge or column move.
> - Input-collecting actions such as link, glossary, and comment use React Aria popovers/dialogs, not text fields inside menu items. React Aria menu items remain action-only.
> - The editor remains product-neutral. Host-owned comment storage still enters through `RichTextEditorBindingsContext`.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Current-State Findings](#2-current-state-findings)
  - [2.1 Existing Selection Awareness](#21-existing-selection-awareness)
  - [2.2 Existing Overlay Surfaces](#22-existing-overlay-surfaces)
  - [2.3 The Missing Behavior](#23-the-missing-behavior)
- [3. Can We Distinguish Applicable Functions?](#3-can-we-distinguish-applicable-functions)
- [4. Target Interaction Model](#4-target-interaction-model)
  - [4.1 Selected-Text Flyout](#41-selected-text-flyout)
  - [4.2 Right-Click Context Menu](#42-right-click-context-menu)
  - [4.3 Top Toolbar Parity](#43-top-toolbar-parity)
- [5. Action Eligibility Model](#5-action-eligibility-model)
- [6. Technical Design](#6-technical-design)
  - [6.1 Shared Selection Action Module](#61-shared-selection-action-module)
  - [6.2 DOM Selection Geometry](#62-dom-selection-geometry)
  - [6.3 Flyout Plugin](#63-flyout-plugin)
  - [6.4 Context Menu Extension](#64-context-menu-extension)
  - [6.5 Overlay And Selection Restore](#65-overlay-and-selection-restore)
- [7. Implementation Plan](#7-implementation-plan)
- [8. Edge Cases And Failure Modes](#8-edge-cases-and-failure-modes)
- [9. Tests And Verification](#9-tests-and-verification)
- [10. Definition Of Done](#10-definition-of-done)
- [11. As-Built Notes](#11-as-built-notes)

## 1. Goal

Add a serious selected-text command surface to the Lexical editor:

1. A floating flyout appears above selected text and exposes only actions that can apply to that selection.
2. Right-clicking selected text opens a selected-text context menu instead of the current block-only menu.
3. The top toolbar, flyout, and context menu read from the same capability/action model so they do not drift.

This is not a generic browser context menu replacement. It is an editor-owned command layer for authoring actions that already exist in the package: bold, italic, underline, strikethrough, inline code, link, glossary term, and comment. Existing block and table commands remain available when the click is not on a selected text range.

## 2. Current-State Findings

### 2.1 Existing Selection Awareness

`packages/editor/src/plugins/toolbar-plugin.tsx` already proves that Lexical gives us enough state to answer the user's question: yes, we can distinguish which functions apply to selected text.

The toolbar currently reads:

- `$getSelection()` and `$isRangeSelection(selection)` to know whether the active editor selection is text-like.
- `selection.isCollapsed()` indirectly through action controls such as comment.
- `selection.getTextContent()` in the comment and glossary controls.
- `selection.hasFormat(format)` for active inline format state.
- `selection.anchor.getNode().getTopLevelElement()` to derive the active block kind.
- `capabilityFor(blockKind)` to decide which inline formats and alignment actions are valid.
- `canUse("text", allowedNodes)` to honor the editor allowlist.
- `RichTextEditorBindingsContext` to gate host-bound actions such as comments.

That state is currently local to the toolbar and partly duplicated in `LinkButton`, `GlossaryButton`, and `CommentButton`.

### 2.2 Existing Overlay Surfaces

The editor already has the correct primitive vocabulary:

- `LinkButton` uses React Aria `DialogTrigger` + `Popover` and `TOGGLE_LINK_COMMAND`.
- `GlossaryButton` uses React Aria `DialogTrigger` + `Popover` and replaces the current range with a `GlossaryNode`.
- `CommentButton` uses React Aria `DialogTrigger` + `Popover`, `@lexical/mark`, and host-owned comment storage.
- `ContextMenuPlugin` uses `@idco/ui` `MenuTrigger`, `Menu`, and `MenuItem` with a synthetic fixed-position trigger at the mouse cursor.
- `useSelectionRestore` snapshots a Lexical selection before overlays steal focus and restores it after close.

This means the new work should compose existing behavior, not invent a parallel overlay stack.

### 2.3 The Missing Behavior

The current user-facing gap is discoverability and locality:

- Selecting text does not produce a local flyout.
- Right-clicking selected text still routes through block/table logic.
- The editor has no central list of selected-text actions; each surface decides eligibility on its own.
- The context menu is useful for blocks and tables, but it is too simple for text authoring.

## 3. Can We Distinguish Applicable Functions?

Yes. The applicable command set is computable from four inputs:

1. **Selection shape.** A non-collapsed `RangeSelection` enables selected-text actions. A collapsed range enables caret actions only. `TableSelection` enables table actions. Null or node selections do not enable text flyout actions.
2. **Block capability.** `capabilityFor(blockKind)` says which inline formats can apply. Paragraph/list text allows all inline formats; headings allow the heading subset; quote/callout disable inline formatting.
3. **Document allowlist.** `allowedNodes` controls whether text, link, glossary, mark/comment, and related inline node work should be exposed.
4. **Host bindings.** Comment creation needs `onComment`. Other actions may need current package capabilities or node registration.

The resulting model should not ask "what buttons should this surface show?" It should ask "what actions are valid for this selection?" and then let the top toolbar, flyout, and context menu render the same action records differently.

## 4. Target Interaction Model

### 4.1 Selected-Text Flyout

The flyout opens when all of these are true:

- the editor has focus and just completed a mouse selection release or keyboard selection update;
- the Lexical selection is a non-collapsed `RangeSelection`;
- the selected text has non-whitespace content;
- the browser DOM selection is inside the editor root and has a measurable rect;
- at least one selected-text action is enabled.

It closes when:

- selection collapses;
- selection leaves the editor root;
- the user presses Escape or clicks outside;
- the editor loses the text selection to a block widget;
- another editor overlay takes over.

The flyout is a React Aria `Popover` anchored to a synthetic fixed-position element at the DOM selection rect. Inside the popover, a React Aria `Toolbar` presents DaisyUI `btn btn-sm btn-square` controls.

Primary flyout controls:

- Bold
- Italic
- Underline
- Strikethrough
- Inline code
- Link
- Glossary term
- Comment

Disabled or invalid controls are hidden from the flyout rather than shown disabled, because the flyout is contextual. The always-visible top toolbar can still show disabled global controls.

### 4.2 Right-Click Context Menu

Right-click behavior branches by context:

1. If the pointer is inside the current selected-text DOM rects and the selection action model has text actions, open a selected-text menu.
2. Otherwise, keep the current block/table menu.

The selected-text menu is action-only:

- Inline format items restore the saved `RangeSelection` and apply `selection.formatText(...)` inside a discrete Lexical update.
- Link/comment/glossary remain in the flyout/top toolbar pattern for this implementation, because text inputs must not be embedded in menu items.

The first implementation may keep form-based actions in the flyout and expose direct inline format actions in the right-click menu. If input actions are added to the context menu, they must close the menu and open a separate React Aria popover/dialog with restored selection.

### 4.3 Top Toolbar Parity

The top toolbar remains the full persistent surface. It should keep its current behavior, but the same underlying action model should be reusable by the flyout and context menu. The toolbar can render controls disabled because it is global; the flyout should only render actions that are currently relevant.

## 5. Action Eligibility Model

The shared model should produce a context object and a list of actions.

Context fields:

```ts
type TextSelectionContext = {
  readonly activeFormats: ReadonlySet<TextFormatType>;
  readonly blockKind: BlockKind;
  readonly canComment: boolean;
  readonly canFormatText: boolean;
  readonly canGlossary: boolean;
  readonly canLink: boolean;
  readonly capability: BlockCapability;
  readonly hasSelectedText: boolean;
  readonly selectedText: string;
};
```

Action fields:

```ts
type TextSelectionAction = {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly group: "format" | "insert";
  readonly format?: TextFormatType;
  readonly isActive?: boolean;
  readonly isEnabled: boolean;
};
```

Initial action rules:

| Action | Enabled when |
| --- | --- |
| Bold | selected text exists, text nodes are allowed, block capability includes `bold` |
| Italic | selected text exists, text nodes are allowed, block capability includes `italic` |
| Underline | selected text exists, text nodes are allowed, block capability includes `underline` |
| Strikethrough | selected text exists, text nodes are allowed, block capability includes `strikethrough` |
| Inline code | selected text exists, text nodes are allowed, block capability includes `code` |
| Link | selected text exists and text/link nodes are allowed |
| Glossary term | selected text exists and text/glossary nodes are allowed |
| Comment | selected text exists, mark/comment support is available, and `onComment` exists |

## 6. Technical Design

### 6.1 Shared Selection Action Module

Create `packages/editor/src/model/selection-actions.ts`.

Responsibilities:

- Define `INLINE_TEXT_ACTIONS`.
- Derive `BlockKind` from a `RangeSelection`.
- Build `TextSelectionContext` from the current Lexical selection, `allowedNodes`, and host bindings.
- Return enabled `TextSelectionAction` records for the current selection.
- Keep all Lexical reads inside an editor read/update boundary.

The module should be UI-free. It can import Lexical node predicates and editor model helpers, but it must not import React, React Aria, DaisyUI, or DOM APIs.

### 6.2 DOM Selection Geometry

Create small DOM helpers near the flyout/context plugin, or in `plugins/selection-geometry.ts` if both plugins need them.

Responsibilities:

- Read `window.getSelection()`.
- Verify the selection range is not collapsed.
- Verify `root.contains(range.commonAncestorContainer)` after normalizing text nodes to their parent element.
- Choose a stable anchor rect:
  - prefer the first non-zero `range.getClientRects()` entry for multi-line selections;
  - fall back to `range.getBoundingClientRect()`;
  - anchor horizontally at `rect.left + rect.width / 2`;
  - anchor vertically at `rect.top`.
- Provide a hit-test helper for right-click:
  - the menu should treat the pointer as "on selected text" only if it falls inside one of the selected range rects, with a small tolerance.

### 6.3 Flyout Plugin

Create `packages/editor/src/plugins/selection-flyout-plugin.tsx`.

Behavior:

- Register `SELECTION_CHANGE_COMMAND`.
- Register an editor update listener.
- Schedule geometry reads in `requestAnimationFrame`, because Lexical state is available in read/update and DOM rects are only reliable after layout.
- Suppress flyout opening while a pointer selection is still in progress; show it after `pointerup`/`pointercancel` so mouse selection does not feel jumpy.
- Use React Aria `Popover` with a `triggerRef` pointing at a synthetic fixed-position anchor.
- Use React Aria `Toolbar` for keyboard semantics inside the flyout.
- Use DaisyUI classes for appearance:
  - panel: `rounded-box border border-base-300 bg-base-100 p-1 shadow-lg`;
  - buttons: `btn btn-sm btn-square btn-ghost` and active `btn-primary`;
  - inputs/dialogs stay inside existing link/glossary/comment popovers.
- Restore the saved `RangeSelection` and call `selection.formatText(...)` for direct format actions.
- Reuse `LinkButton`, `GlossaryButton`, and `CommentButton` for input actions, passing the flyout's saved selection snapshot into those child popovers so they do not depend on the current focused selection after the parent overlay has taken focus.

### 6.4 Context Menu Extension

Extend `packages/editor/src/plugins/context-menu-plugin.tsx`.

Behavior:

- Keep current block/table menu state and actions intact.
- Add a `selection` menu state branch.
- On `contextmenu`, before resolving the block key:
  - read the text action context;
  - hit-test the pointer against the current DOM selection rects;
  - if valid, `preventDefault()` and show selected-text menu at `event.clientX/Y`.
- Render the selected-text menu through the same `MenuTrigger` synthetic cursor-anchor pattern as the block menu.
- Direct format items restore the cached/current `RangeSelection` and call `selection.formatText(...)`.
- Block/table actions remain unchanged when the click is not on selected text.

### 6.5 Overlay And Selection Restore

Selection preservation is the main risk. Rules:

- Direct format buttons restore the saved selection, apply the format, keep the flyout mounted, refresh active state/position, and refocus the editor on the next frame.
- Form actions must snapshot the Lexical selection before the popover opens and either restore it on close or mark it handled after applying.
- Child input popovers launched from the flyout are treated as part of the same interaction. The parent flyout stays mounted while the child popover is open, and outside pointer interaction closes the whole selection action surface.
- Menu items cannot contain input fields. Input actions launched from a menu must close the menu and open a separate popover/dialog.
- The flyout must not be rendered with a native `<dialog>` or a hand-rolled dropdown.
- React Aria `Popover` must be non-modal for the selection flyout. A modal popover marks the editor subtree inert, which blocks browser contextmenu delivery and breaks the right-click selected-text branch.

## 7. Implementation Plan

1. Add `docs/004_selection_flyout_and_context_actions.md`.
2. Add `model/selection-actions.ts`.
3. Add shared DOM geometry helpers for selected range anchoring and hit-testing.
4. Add `SelectionFlyoutPlugin`.
5. Mount `SelectionFlyoutPlugin` in `RichTextEditor` after the editable content plugins and before document sync/history.
6. Extend `ContextMenuPlugin` with a selected-text branch.
7. Add a focused Ladle story, or extend the existing full editor story with clear selected-text content, so Playwright can select text and verify the flyout.
8. Add tests:
   - action eligibility for paragraphs, headings, quotes, and allowlist restrictions;
   - editor renders selected-text controls;
   - context menu still renders block/table actions.
9. Run format, lint, typecheck, tests, build, and `pnpm check`.
10. Use Playwright against the running Ladle server to select text, screenshot the flyout, click a format action, and verify no console errors.

## 8. Edge Cases And Failure Modes

- **Multi-line selections.** Anchor to the first visible rect so the flyout appears near where the selection starts, not at the vertical midpoint of an entire paragraph.
- **Selection overlaps a link/mark/glossary.** The flyout still shows text actions. Link editing can prefill from the current anchor link, as `LinkButton` already does.
- **Quote/callout selections.** Inline format actions should be absent or disabled according to `capabilityFor`.
- **Table cell text.** A normal range selection inside a table cell should show selected-text actions; a `TableSelection` should keep table actions.
- **Right-click outside current selected text.** Do not show stale text actions. Fall back to block/table menu.
- **Overlay focus loss.** Selection restore must preserve the selected range before link/comment/glossary popovers take focus.
- **Theme placement.** Popovers render through the existing React Aria overlay path; the consumer still owns global theme placement as required by the UI package contract.
- **Mobile/touch.** The implementation is desktop-first because it targets selected text and right-click. Touch selection can still trigger the flyout if browser selection geometry is available.

## 9. Tests And Verification

Static and unit gates:

- `pnpm format`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm check`

Focused test expectations:

- `readTextSelectionContext` returns no context for null, collapsed, and non-range selections.
- Paragraph selection enables all inline formats.
- Heading selection enables only heading-allowed inline formats.
- Quote selection disables inline formats.
- `allowedNodes` restrictions remove unavailable inline actions.
- Missing `onComment` disables comment creation.

Playwright verification against Ladle:

- Load the editor story with no console errors.
- Select known text in a paragraph.
- Verify a floating selected-text toolbar appears near the selection.
- Click Bold in the flyout and verify the selected text becomes bold in the editor JSON or DOM.
- Right-click the selected text and verify the selected-text menu appears.
- Right-click outside the selected text and verify the existing block/table context menu still appears.

## 10. Definition Of Done

Done means:

- `docs/004_selection_flyout_and_context_actions.md` exists and reflects the implemented design.
- Selected text opens a local flyout built with React Aria `Popover`/`Toolbar` and DaisyUI classes.
- Right-click on selected text opens a selected-text context menu built with `@idco/ui` `Menu`.
- Existing block/table right-click behavior still works.
- Action eligibility is shared rather than duplicated ad hoc across surfaces.
- Unit tests cover the action model; browser verification covers the editor surface.
- `pnpm check` passes.
- Playwright verification against the running Ladle story confirms the flyout and context menu visually and interactively.

## 11. As-Built Notes

Implemented files:

- `packages/editor/src/model/selection-actions.ts` owns the UI-free selected-text action model.
- `packages/editor/src/plugins/selection-geometry.ts` owns DOM range anchoring and selected-range hit testing.
- `packages/editor/src/plugins/selection-flyout-plugin.tsx` renders the React Aria `Popover` + `Toolbar` flyout with DaisyUI button styling.
- `packages/editor/src/plugins/context-menu-plugin.tsx` now has `selection` and `block` menu states while preserving existing table/block actions.
- `stories/editor.stories.tsx` includes a selected-text verification story.
- `tests/editor/selection-actions.test.tsx` covers the action eligibility model.

Final behavior:

- The flyout is mounted from `RichTextEditor` before the context menu plugin.
- The flyout uses `isNonModal` on React Aria `Popover`; this is required so the popover does not inert the editor and block right-click/contextmenu events.
- The flyout suppresses opening during pointer drag and opens after pointer release, while keyboard selection updates still use the scheduled selection refresh.
- Direct flyout format actions keep the flyout mounted, restore the saved Lexical selection, apply `selection.formatText(...)`, refresh active state/position, and refocus the editor.
- Existing `LinkButton`, `GlossaryButton`, and `CommentButton` are reused inside the flyout for input-collecting actions. They accept the flyout's saved selection snapshot so Link, Glossary, and Comment work even after focus has moved into nested React Aria popovers.
- The right-click menu caches the last valid selected-text actions, selection clone, and DOM rects. This survives browsers that collapse or disturb the visible selection during `contextmenu`.
- The right-click selected-text menu currently exposes direct inline format actions only. Link, glossary, and comment remain available in the flyout and top toolbar until a separate input popover launch path is added for menu actions.

Verification completed:

- `pnpm check` passes, with one pre-existing lint warning in `packages/ui/src/scope-builder.tsx` for `oxc(no-map-spread)`.
- Ladle browser verification selected text, confirmed the flyout does not open before pointer release, clicked Bold, verified the flyout stayed mounted instead of flickering/remounting, opened Link/Glossary/Comment from the flyout, and verified each action applied to the selected text.
- Right-click verification opened the selected-text context menu and verified right-click outside the selection still opens the block menu.
- Screenshots were captured at `/tmp/idco-selection-flyout.png`, `/tmp/idco-selection-context-menu.png`, `/tmp/idco-selection-input-actions.png`, and `/tmp/idco-selection-final-verification.png`.
- `pnpm plx` was unavailable in this repo. The browser verification used the Playwright-managed Chromium binary already present in the local Playwright cache and drove it over Chrome DevTools Protocol as the equivalent interactive pass.
