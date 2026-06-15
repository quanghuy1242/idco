# 007 - Node Contract Consolidation And UI Hygiene

> Status: implemented (`pnpm check` green); §3.5 deferred by design
>
> Date: 2026-06-15
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/nodes/**` - decorator node classes, the chrome vocabulary, and the node base contract.
> - `/home/quanghuy1242/pjs/idco/packages/editor/src/toolbar/**` and `/home/quanghuy1242/pjs/idco/packages/editor/src/plugins/**` - annotation popovers (link, comment, glossary) and the inline editor plugins.
> - `/home/quanghuy1242/pjs/idco/packages/ui/src/form.tsx` - shared form primitives; gains bare `Input` / `TextArea` controls.
> - `/home/quanghuy1242/pjs/idco/packages/lib/src/**` - lowest shared layer; gains a `cn` class-name helper.
>
> Source docs:
>
> - `AGENTS.md` - shared UI must be React Aria behavior + DaisyUI styling; no hand-rolled interactive primitives.
> - `docs/006_editor_toolbar_redesign_plan.md` - the toolbar/publication redesign; 007 exists so 006 can stay focused on its own scope.
> - `docs/003_block_chrome_and_table_capabilities.md` - the block-chrome vocabulary this builds on.
>
> Relationship to 006:
>
> - This is pure refactoring and hardening. It adds no product features.
> - 007 makes adding a new node (mermaid, data grid) a one-entry change instead of a five-file edit, so 006's node work is cheap and low-risk.
> - 007 deliberately does **not** implement 006's bake pipeline, render-tier renderers, or publication settings. Those are 006's business. 007 only consolidates the contract that already exists.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Findings](#2-findings)
  - [2.1 Node Type To Behavior Is Scattered](#21-node-type-to-behavior-is-scattered)
  - [2.2 Raw Form Controls Bypass React Aria And UI](#22-raw-form-controls-bypass-react-aria-and-ui)
  - [2.3 Duplicated Popover And Label Boilerplate](#23-duplicated-popover-and-label-boilerplate)
  - [2.4 Class-Name Concatenation Has No Helper](#24-class-name-concatenation-has-no-helper)
  - [2.5 Dead Code And Boundary Smell](#25-dead-code-and-boundary-smell)
  - [2.6 The UI Boundary Is Otherwise Sound](#26-the-ui-boundary-is-otherwise-sound)
- [3. Decisions](#3-decisions)
  - [3.1 A Decorator Node Registry, Explicit Classes Kept](#31-a-decorator-node-registry-explicit-classes-kept)
  - [3.2 Bare UI Controls, Not Form Fields, For Inline Editing](#32-bare-ui-controls-not-form-fields-for-inline-editing)
  - [3.3 An Editor Popover Shell, Not A Rigid Annotation Form](#33-an-editor-popover-shell-not-a-rigid-annotation-form)
  - [3.4 Leave Compliant AriaButtons Alone](#34-leave-compliant-ariabuttons-alone)
  - [3.5 Deferred: Shared Enums And Coercers To Lib](#35-deferred-shared-enums-and-coercers-to-lib)
  - [3.6 Promote The Shared Chrome Vocabulary](#36-promote-the-shared-chrome-vocabulary)
- [4. Implementation](#4-implementation)
- [5. Out Of Scope](#5-out-of-scope)
- [6. Verification](#6-verification)

## 1. Goal

Harden the editor's internal structure so that:

1. The mapping from a node `type` to its Lexical class and normalization lives in one place, not duplicated across the registration array and `richTextNodeToLexicalNode`.
2. Inline editing controls (the alt/caption inputs, the embed URL field, the link/comment/glossary popovers) use React Aria behavior + DaisyUI styling through `@idco/ui`, not raw `<input>` / `<textarea>` elements.
3. The repeated popover shell and field-label markup is shared, not copy-pasted.

This is the prerequisite refactor for 006. It changes no behavior and no document shape.

## 2. Findings

### 2.1 Node Type To Behavior Is Scattered

The six decorator nodes (`callout`, `code-block`, `embed`, `media`, `post-ref`, `table-of-contents`) all extend `RichTextDecoratorBlockNode` and repeat an identical static shape: `clone` is always `new X(node.__data, node.__format, node.__key)`, `importJSON` is always `new X(normalizeX(serialized), format || "")`, and `decorate` is always `<XEditor nodeKey node={getData()} />`.

Each editor also re-wires its own state: `const updateNode = useDecoratorNodeUpdater(nodeKey)` (and `useRemoveNode`) appears in every block.

The same type-to-class mapping is then enumerated in two more places that must be kept in sync by hand:

- `RICH_TEXT_DECORATOR_NODES` in `nodes/index.tsx` (registration with the composer).
- the `richTextNodeToLexicalNode` if-chain in `nodes/index.tsx` (`type === "callout" -> new CalloutNode(normalizeCalloutNode(node))`, etc.).

Adding a node means editing both, plus the class, plus `normalize.ts`, plus `serialize.ts`. That is the friction 006 would multiply with mermaid and the data grid.

### 2.2 Raw Form Controls Bypass React Aria And UI

`@idco/ui` exports `Button`, `TextInput`, and `Textarea`, but the editor uses none of them for inline editing. Instead it hand-rolls raw DaisyUI on raw elements: `<input className="input input-bordered">` and `<textarea className="textarea ...">` appear in `media-node`, `embed-node`, `glossary-node`, `link-button`, `comment-button`, `link-plugin`, `comment-plugin`, and `glossary-button`. A raw `<input>` has no React Aria behavior, which is a direct AGENTS.md violation.

Notably `table-of-contents-node` already does it the right way — `AriaTextField` + `AriaInput` with DaisyUI classes — so the correct pattern already exists in the codebase; it is just not shared.

### 2.3 Duplicated Popover And Label Boilerplate

The link/comment popovers repeat the same `AriaPopover` panel shell (`popover-panel z-[60] w-72 data-[entering]:… data-[exiting]:…`) and the same field-label span (`text-xs font-medium text-base-content/70`) across five files. `FieldLabel` already exists in `nodes/base.tsx` but is not used by the toolbar/plugin popovers.

### 2.4 Class-Name Concatenation Has No Helper

`[a, b, c].filter(Boolean).join(" ")` is repeated in `chrome.tsx` (and `ui/menu.tsx`). There is no shared `cn` helper anywhere in the monorepo.

### 2.5 Dead Code And Boundary Smell

- `BlockChromeButton` in `nodes/base.tsx` is a `@deprecated` alias for `ChromeButton` with zero remaining usages.
- `model/schema.ts` imports `AlertTone` and `CodeEditorLanguage` *types* from `@idco/ui`, i.e. the model layer depends on the component library, and `@idco/content-renderer` re-derives the same coercers (`codeEditorLanguage`) that `schema.ts` already has (`codeLanguageValue`).

### 2.6 The UI Boundary Is Otherwise Sound

`@idco/ui` never imports `@idco/editor` (no illegal dependency), and the genuinely shared presentational pieces (`CodeEditor`, `RichTextContent`) are correctly in `@idco/ui` because both the editor and the renderer consume them. Nothing editor-specific is stranded in `@idco/ui`.

## 3. Decisions

### 3.1 A `defineDecoratorBlock` Factory + A Class-List Registry

Promote both repeats — the class boilerplate and the per-editor state wiring — into one base abstraction:

- `nodes/decorator-block.tsx` exports `defineDecoratorBlock({ type, normalize, Editor })`, which builds the Lexical class (`clone`/`importJSON`/`decorate`; data carried verbatim by the base) and standardizes the state contract: every editor receives `DecoratorBlockProps = { node, nodeKey, update, remove }` instead of calling `useDecoratorNodeUpdater`/`useRemoveNode` itself. The produced class exposes `getType()` and `normalizeData` statically.
- `nodes/registry.ts` is then just the list of the six classes; `DECORATOR_NODE_DEFINITIONS`, `RICH_TEXT_DECORATOR_NODES`, and the decorator branch of `richTextNodeToLexicalNode` all derive from it by reading `getType()`/`normalizeData`. There is no hand-maintained type→class→normalize table left anywhere.

A new block (006 mermaid / data grid) is a spec + an editor + one registry-list entry. Editors still render their own `BlockShell`/chrome because a block's icon and actions can be data-derived (the callout tone icon changes with state), so the factory deliberately does not own chrome framing.

This supersedes the earlier "keep explicit classes" stance: the classes were pure boilerplate, and no code does `instanceof CalloutNode` (Lexical keys off `getType()`), so a factory loses nothing and removes ~24 methods.

`normalize.ts` and `serialize.ts` keep their explicit dispatch on purpose: they also handle element nodes (paragraph/heading/list/quote), legacy type aliases (`code` -> `code-block`), and the Lexical-state JSON shape, none of which is one-to-one with the decorator registry. Making `normalize.ts` consume the registry would also create an import cycle (`normalize -> registry -> *-node -> normalize`), so the registry imports the normalize functions, never the reverse.

### 3.2 Bare UI Controls, Not Form Fields, For Inline Editing

`@idco/ui`'s `TextInput` / `Textarea` are *form fields* — they render a label block, an "(Optional)" suffix, a `FieldError`, and force `font-mono` on the textarea. Inline editing wants bare controls. Add bare `Input` and `TextArea` to `ui/form.tsx` (React Aria `TextField` + `Input` / `TextArea`, DaisyUI `input`/`textarea` classes, `size`, `invalid`, `className`, `autoFocus`). These wrap the exact pattern `table-of-contents-node` already proved. Replace every raw `<input>` / `<textarea>` in the editor with them, and use the existing `FieldLabel` for labels.

### 3.3 An Editor Popover Shell, Not A Rigid Annotation Form

The link/comment/glossary popovers share a panel shell but have genuinely different triggers (button + `DialogTrigger` vs hidden anchor + controlled `isOpen`) and different footers (Apply/Remove vs Open/Clear/Save vs Save). A single rigid `AnnotationForm` would fight that variance. Instead extract `toolbar/editor-popover.tsx` — the `AriaPopover` + `AriaDialog` shell with `width`, `placement`, `offset`, and the `data-editor-selection-action-popover` flag — and let each caller own its body and footer. This kills the duplicated panel class-name and centralizes the popover styling without over-abstracting.

### 3.4 Leave Compliant AriaButtons Alone

The footer buttons are already `react-aria-components` `Button` with DaisyUI `btn` classes — that is the sanctioned "React Aria behavior + DaisyUI styling" pattern, not a violation. `@idco/ui`'s `Button` cannot express the subtle destructive style used here (ghost trigger with `text-error`) without changes, and its `LinkButton` pulls `next/link`, which the product-neutral editor must not depend on. Converting them would risk visual regressions for no behavioral gain, so they stay as `AriaButton` + `btn`. The hygiene win is concentrated on the genuine violations (raw controls) and the real duplication (panel shell, labels).

### 3.5 Deferred: Shared Enums And Coercers To Lib

Moving `AlertTone` / `CodeEditorLanguage` and the value coercers to `@idco/lib` (so the model layer and the renderer stop depending on / duplicating the component library) is correct, but it touches `@idco/ui`'s public types and every consumer, and needs a layering decision (ui imports the canonical unions from lib). It is documented here and left for a focused follow-up rather than bundled into this refactor.

### 3.6 Promote The Shared Chrome Vocabulary

Two more repeats lived in the chrome layer and are promoted into `nodes/chrome.tsx`:

- The hover/focus reveal class was duplicated — and divergent by group scope (`group/code` vs `group/block`) — in `BlockChrome` and the code block. It becomes `CHROME_REVEAL`, and blocks standardize on the `group/block` scope so the literal Tailwind variants are generated once.
- The callout reimplemented a `Menu`/`MenuItem` tone picker that `ChromeSelect` already provided. `ChromeSelect` gains an optional icon-only trigger (`triggerIcon`) and colored option icons (`iconClassName`); the callout tone routes through it, deleting the bespoke menu. The pill trigger and existing callers render unchanged (the colored-icon wrapper is conditional).

## 4. Implementation

1. `cn` helper in `@idco/lib`; use it in `chrome.tsx`. Delete the dead `BlockChromeButton` alias.
2. `nodes/decorator-block.tsx` with `defineDecoratorBlock` + `DecoratorBlockProps`; rewrite all six block modules (callout, code-block, embed, media, post-ref, table-of-contents) onto it (their editors now take `update`/`remove` props and drop the `no-underscore-dangle` eslint pragma).
3. `nodes/registry.ts` reduced to the six-class list; `DECORATOR_NODE_DEFINITIONS`, `RICH_TEXT_DECORATOR_NODES`, and `richTextNodeToLexicalNode` derive from it.
4. Chrome vocabulary (§3.6): `CHROME_REVEAL` + `ChromeSelect` `triggerIcon`/`iconClassName`; callout tone routed through `ChromeSelect`, code block onto `CHROME_REVEAL` + `group/block`.
5. Bare `Input` / `TextArea` in `ui/form.tsx`.
6. `toolbar/editor-popover.tsx` shell; adopt it plus bare controls and `FieldLabel` in `link-button`, `link-plugin`, `comment-button`, `comment-plugin`, `glossary-button`, `glossary-node`.
7. Adopt bare controls / `FieldLabel` in `media-node` and `embed-node` (`table-of-contents-node` already uses an associated `AriaTextField`+`AriaLabel` and is left as-is).

## 5. Out Of Scope

- 006's bake pipeline, render-tier renderers, host-node registry, publication settings, and any toolbar tab work.
- The enum/coercer move to lib (§3.5).
- Any change to document shape, normalization output, or serialization output.

## 6. Verification

- `pnpm check` is green (types, lint, tests, build).
- Existing editor/renderer tests pass unchanged — no document-shape or behavior change is intended.
- Ladle stories for callout/code/media/embed/post-ref/toc and the link/comment/glossary popovers render identically.
