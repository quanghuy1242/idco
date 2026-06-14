# 002 — Gap Cursor and docx-style Block Flow

> Status: implementation-grade proposal (approved for full build)
>
> Date: 2026-06-14
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco/packages/editor` (live editor)
> - `/home/quanghuy1242/pjs/idco/stories` (Ladle previews)
> - `/home/quanghuy1242/pjs/idco/tests/editor` (vitest coverage)
>
> Related docs:
>
> - `docs/001_lexical_editor_architecture.md` — §7.1 *Caret Around Block Nodes* lists "a true gap-cursor (Lexical has none natively)" as backlog; this doc delivers it.
>
> Related memory: `lexical-editor-package`, `rich-text-live-editor`
>
> Decisions captured from the owner (2026-06-14):
>
> - **Build the full gap cursor** (Parts A + B + C below), not just the arrow fix.
> - **Keep both block-handle affordances** (the `+` insert and the grip) alongside the new caret flow. The handle and the caret are complementary; the priority is a strong content-authoring + publishing experience.
>
> Assumptions:
>
> - Lexical stays pinned at `0.45.0` across all `@lexical/*` packages.
> - v1 targets **keyboard + mouse**; touch/IME hardening is a follow-up.
> - The document JSON stays round-trippable through the editor and `@idco/content-renderer`. The gap cursor is an **editing affordance only** — it never persists to the document (no empty boundary paragraphs are kept).

## Table Of Contents

- [1. Goal](#1-goal)
- [2. Problem Statement](#2-problem-statement)
- [3. Current-State Findings](#3-current-state-findings)
- [4. Design Overview](#4-design-overview)
- [5. Part A — Arrow Navigation Fix](#5-part-a--arrow-navigation-fix)
- [6. Part B — The Gap Cursor](#6-part-b--the-gap-cursor)
- [7. Part C — Click-to-Place in Gaps](#7-part-c--click-to-place-in-gaps)
- [8. Relationship to the Block Handle](#8-relationship-to-the-block-handle)
- [9. Files](#9-files)
- [10. Edge Cases and Failure Modes](#10-edge-cases-and-failure-modes)
- [11. Tests](#11-tests)
- [12. Phasing and Rollout](#12-phasing-and-rollout)
- [13. Risks and Open Questions](#13-risks-and-open-questions)
- [14. Definition of Done](#14-definition-of-done)

## 1. Goal

Let an author place the caret **anywhere** — including the empty space before the first block, after the last block, and in the gap between two atomic blocks (code, callout, media, embed, post-ref) or tables — and type there, the way Word / Google Docs behave. Arrow keys and clicks must always leave a **visible** caret; the caret must never silently disappear when it meets a non-text block.

## 2. Problem Statement

Two reported issues share one root cause — **Lexical has no caret position in the space around atomic blocks.**

1. **#2 — can't insert blocks around a table.** The block handle (`DraggableBlockPlugin`) is currently the only way to insert around an atomic block. It reveals only in the thin left gutter, cannot insert *above* the first block, and there is no caret slot between two adjacent atomic blocks (e.g. `code-block` → `table`).
2. **#3 — caret disappears / docx-style free cursor wanted.** Arrowing into a `DecoratorBlockNode` produces a Lexical **NodeSelection** (the block is selected as a unit). Our `decorate()` renders the block UI directly with no selection ring, so nothing is drawn and the caret appears to vanish. The owner wants a free-flowing caret that can rest *beside* a table/atomic block and start new content there.

## 3. Current-State Findings

Relevant files:

- `plugins/draggable-block-plugin.tsx` — Lexical `DraggableBlockPlugin_EXPERIMENTAL`; renders the gutter `+`/grip. The `+` inserts a paragraph after the hovered block.
- `plugins/block-controls-plugin.tsx` — click handler that, **only** when clicking below the *last* block and that block is atomic, appends a trailing paragraph and drops the caret in.
- `nodes/base.tsx` — `RichTextDecoratorBlockNode extends DecoratorBlockNode` (`selectNext/selectPrevious/selectStart/selectEnd` available). `decorate()` returns the block UI directly (no `BlockWithAlignableContents`, so **no selection ring**).
- `nodes/index.tsx` — `INSERT_RICH_TEXT_NODE_COMMAND` replaces an empty caret paragraph in place; the canonical "insert without wrapping blank lines" logic to reuse.
- Tables come from `@lexical/table` (`RichTextTablePlugin`) and own their internal keyboard model (tab nav, cell selection).

Behaviour today:

- No registered `KEY_ARROW_*` handlers in `packages/editor` → default Lexical decorator/table arrow behaviour, which yields the invisible NodeSelection.
- No caret slot above the first block or between two atomic siblings.
- `BlockControlsPlugin` covers only the after-last-block slot.

## 4. Design Overview

Three cooperating parts, smallest/safest first:

- **Part A — Arrow navigation fix.** Intercept arrow keys so crossing an atomic block always lands a real `RangeSelection` (or, where there is genuinely no text slot, the gap cursor from Part B). Removes the "vanishing caret" bug on its own.
- **Part B — The gap cursor.** A custom, ProseMirror-style insertion caret rendered in the gaps Lexical can't hold a `RangeSelection` in (above first block, between two atomic blocks, after last block). Typing/Enter at the gap materialises a real paragraph there.
- **Part C — Click-to-place in gaps.** Generalise `BlockControlsPlugin` so clicking the whitespace between any two blocks places the gap cursor (or a real caret when an adjacent text block exists).

The gap cursor is **ephemeral UI state** held in React, never written to the document.

## 5. Part A — Arrow Navigation Fix

New `plugins/block-navigation-plugin.tsx`, registering `KEY_ARROW_UP/DOWN/LEFT/RIGHT_COMMAND` at `COMMAND_PRIORITY_LOW` (so `@lexical/table` keeps priority inside cells).

Behaviour:

- On a vertical arrow (`UP`/`DOWN`) from a `RangeSelection` at the first/last line of a block whose neighbour is atomic (`$isDecoratorNode` or a `TableNode`): move to the nearest real text caret slot on the far side of that block (using the 0.45 caret API — `$getAdjacentSiblingOrParentSiblingCaret`, `$getChildCaret`, `$caretFromPoint` — to find the next valid `RangeSelection` slot) instead of letting Lexical form a NodeSelection. If the far side is *also* atomic or absent, hand off to the **gap cursor** (Part B) at that boundary.
- On a `NodeSelection` of a decorator block, an arrow resolves to the adjacent text slot or the gap cursor rather than leaving the invisible selection.
- Horizontal arrows (`LEFT`/`RIGHT`) at a text boundary behave the same when the next sibling is atomic.

This part is independently shippable and fixes the visible #3 bug fast.

## 6. Part B — The Gap Cursor

Lexical has no native gap cursor, so this is a custom overlay modelled on ProseMirror's `gapcursor`.

State (React, in a new `plugins/gap-cursor-plugin.tsx`):

```ts
type GapTarget = { anchorKey: NodeKey; side: "before" | "after" } | null;
```

Rendering:

- A thin blinking caret element, portaled to `document.body` and `fixed`-positioned (same pattern as `TableControlsPlugin`), drawn in the gap computed from the anchor block's rect (`top` for `before`, `bottom` for `after`) and the editor's left text inset.
- Pure geometry in `model/` (e.g. `gapCursorRect(blockRect, side, inset)`) so it is unit-testable without a browser, like `model/layout.ts`.

Interactions (commands registered at appropriate priority):

- **Enter** the gap: from Part A when an arrow crosses a boundary with no text slot; or from Part C on click.
- **Move** the gap: arrow keys move it to the previous/next boundary, or out into a real text block (clearing `GapTarget`).
- **Materialise**: a printable key (`KEY_DOWN`/`controlled text insertion`) or **Enter** inserts a `$createParagraphNode()` at the gap (reusing the in-place insertion contract from `INSERT_RICH_TEXT_NODE_COMMAND`) and drops a real caret in; the slash menu (`/`) also works from here.
- **Dismiss**: Escape, blur, or clicking into real content clears `GapTarget`.

Priorities of the two hardest slots are first-class:

- **Above the first block** when it is atomic (today unreachable).
- **Between two atomic blocks** (e.g. `code-block` → `table`, `table` → `table`).

## 7. Part C — Click-to-Place in Gaps

Generalise `plugins/block-controls-plugin.tsx`:

- Hit-test the click `Y` against the vertical gaps between **all** top-level blocks (not just below the last).
- If a real text block borders the gap, drop a real caret there (`selectEnd`/`selectStart`). If both sides are atomic (or it's the top-of-document gap above an atomic first block), set the **gap cursor** (Part B) at that boundary.
- Covers the docx "click in the whitespace and a caret appears" behaviour, including a caret resting beside a table.

## 8. Relationship to the Block Handle

Per the owner's decision, **both block-handle affordances stay**: the `+` (insert paragraph after the hovered block) and the grip (drag-reorder). The gap cursor and the handle are complementary — the handle is a discoverable mouse affordance, the gap cursor is the keyboard/“click anywhere” path. No removal or de-emphasis in this iteration. (Revisit only if the two feel redundant in practice.)

## 9. Files

New:

- `packages/editor/src/plugins/block-navigation-plugin.tsx` (Part A)
- `packages/editor/src/plugins/gap-cursor-plugin.tsx` (Part B)
- `packages/editor/src/model/gap-cursor.ts` (pure geometry + caret-slot helpers)

Touched:

- `packages/editor/src/plugins/block-controls-plugin.tsx` (Part C — gap click)
- `packages/editor/src/RichTextEditor.tsx` (register the new plugins)
- `packages/editor/src/nodes/base.tsx` (optional: a subtle selection ring for decorator NodeSelection as a fallback affordance)

## 10. Edge Cases and Failure Modes

- **Table edges**: `@lexical/table` keyboard handling must win inside cells; the navigation plugin runs at lower priority and only acts at the table's outer boundary.
- **First/last document slots**: above an atomic first block and below an atomic last block must both be reachable and materialisable.
- **No persistent empties**: materialising at a gap inserts a paragraph only on actual input; an abandoned gap cursor leaves the document unchanged.
- **IME/composition**: defer composition hardening; ensure the gap cursor can't swallow composition events (guard on `KEY_DOWN`).
- **Selection restore**: the gap cursor must interact cleanly with `use-selection-restore.ts` (popovers) — clearing or preserving `GapTarget` across overlay open/close.
- **Scrolling / re-layout**: reposition the gap caret on scroll/resize (the table-controls portal already models this).

## 11. Tests

- **Pure helpers** (`model/gap-cursor.ts`): gap rect geometry; "is there a real caret slot on this side?" decisions — fast vitest unit tests (mirrors `tests/editor/layout.test.ts`).
- **jsdom integration** (`tests/editor/...`):
  - Arrow from a paragraph across a code block keeps a `RangeSelection` (no NodeSelection / no vanishing caret).
  - Enter at a gap between two atomic blocks inserts exactly one paragraph there.
  - Click between two blocks lands a caret / sets the gap target.
  - Abandoning a gap cursor leaves the document JSON unchanged (no empty paragraph persisted).
- **Manual/CDP**: pixel-level caret rendering and blink, as with prior layout work (jsdom has no layout).

## 12. Phasing and Rollout

1. **Part A** — arrow fix. Small, low risk, fixes the visible bug immediately.
2. **Part C** — click-to-place between blocks. Moderate; reuses existing click plumbing.
3. **Part B** — the full gap cursor overlay + materialisation. Largest; delivers the docx feel.

Each phase ships behind passing `pnpm check` (format, lint, dup, typecheck, test, build) and is verified live (CDP) before the next.

## 13. Risks and Open Questions

- **Command-priority interplay** with `@lexical/table` and the slash menu is the main implementation risk; needs careful ordering and live testing at table edges.
- **Touch** caret placement is out of v1 scope.
- **Open question**: should a gap cursor also accept *paste* (materialise a paragraph from clipboard) in v1, or only typed input + Enter + slash? (Default plan: accept paste too, since it's the same materialisation path.)

## 14. Definition of Done

- Arrow keys never leave an invisible caret; crossing any atomic block lands a visible caret or gap cursor.
- The caret can be placed (by click or keyboard) above the first block, after the last block, and between any two atomic blocks/tables, and typing there creates content in the right place.
- No empty boundary paragraphs are persisted to the document JSON.
- Both block-handle affordances (`+` and grip) remain functional.
- `pnpm check` green; new pure helpers and jsdom flows covered by vitest; behaviour verified live.
