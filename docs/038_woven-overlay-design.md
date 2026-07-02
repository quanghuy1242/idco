# The Woven Inline Diff Overlay — Design System (Full Model A, 037 Option A)

> Status: design-complete, adversarially reviewed to convergence. No deferrals, no "later" — every piece named here has a mount path in the code that exists today.
>
> Date: 2026-07-02
>
> What this is: the design system for the **woven inline diff overlay** — the live, in-editor surface where a proposal (from an agent per `docs/037`, or from another human) is reviewed *in place*, in the editing surface, and accepted or rejected whole or per block. It is the piece `docs/036 §6.2` named and then parked behind R6-J. This document unparks it and specifies it in full.
>
> How it relates to the shipped work: `docs/036` R6-A..I already shipped the diff engine (`core/diff/**`, identity-based `diffSnapshots`), the dedicated **diff view** (`packages/reader/src/diff/**`, the §6.3 decoration system), the change-detail rendering (§6.4), and a live **change indicator** (`review-change-indicator.tsx`, §6.2.1). This document is the design for what rides on top: the genuinely woven overlay and the Model-A suggested-edits system it carries.
>
> How it relates to `docs/037`: `037` is the **producer** of proposals (an agent acts on the command layer, never on pixels, and its change targets a proposed branch by default). This document is the **consumer** — where those proposals land, are seen, and are resolved. Option A here = `037`'s propose-by-default landing on `036`'s Model A (a proposal is an attributed op-log branch).
>
> Provenance: this is the converged output of an adversarial design debate. Several of the first-draft mechanisms were wrong against the real code and were replaced; the rationale for each replacement is kept inline, because the reasons are the load-bearing part.

## 1. The core reframe — this is not a code editor, and it is not the diff view

A code-editor diff is one-dimensional: the document is lines of text, and *every* change is a visible glyph delta. Red line, green line, done — because there is nothing in the model that can change without changing a character.

This model is a two-level identity tree (`NodeId` per block, `CharacterId` per character, `docs/011`) with **orthogonal change dimensions**, and most of them produce **zero glyph delta**. These are the *invisible changes*, and they are the whole difficulty:

- **text content** — insert/delete characters. The only code-editor-like dimension.
- **marks** — bold *removed*, a link *removed*, italic added. Same characters; the run is byte-identical.
- **node attrs** — a table cell's fill red→yellow, a paragraph's alignment left→center, a heading h3→h2, an indent. The content is identical; a property changed.
- **object data** — a code block's `language` js→ts, an image's caption or alt or crop. Opaque payload, no glyph, often buried inside a live widget.
- **structure** — add a table row or column, reparent a list item, nest an item. Partially visible (a new cell exists) but the *fact* of the change is not.
- **collections / settings** — a glossary entry, a document theme. No glyph, and no block to attach to at all.

A red/green two-color inline scheme covers maybe a fifth of that space. The other four fifths look exactly like the document. So the design problem is not "color the changes" — it is **make an invisible change legible without destroying the thing it changed**.

The diff view solves legibility by **reflowing**: it wraps each changed block in a card, prints a status-tag header, injects a "Bold added on …" summary row, opens side-by-side gaps for one-sided rows. All of that is fine on a dedicated read-only review page. **All of it is illegal in a live editor**, because the reviewer is *editing* — you cannot card-wrap a block you are typing into, you cannot shove a summary row between two paragraphs, you cannot open alignment gaps in a single writing column. The diff view's decoration system (`docs/036 §6.3`) does not port; the woven overlay needs its own, built from a different constraint.

## 2. The governing principle

> **The diff view discloses detail inline (reflow is free on a dedicated surface). The woven overlay signals inline (zero reflow) and discloses detail on demand (floated, or drilled into a scoped diff view). Explicitness is preserved by progressive disclosure, not by inline reflow.**

Everything below is a consequence of that sentence. The shipped R6-I change indicator already proves the "signal inline with zero reflow" half — a `data-engine-block-id`-keyed `::after` gutter bar that adds no layout and needs no re-render. The woven overlay generalizes that proof to every change dimension.

## 3. The liveness model — the primary axis (not color)

The first design instinct is to reach for color. That is wrong. In a live editor the primary question about any glyph on screen is **can I put a caret in it** — because some of what you see during review is real editable content and some is a frozen artifact of the diff. Three states, and this table is the behavioral contract the rest of the system obeys:

| State | What it is | Caret can enter? | In the store? |
| --- | --- | --- | --- |
| **live-normal** | untouched document | yes | yes |
| **live-proposed** | an addition/edit from the reviewed proposal, optimistically applied, decorated, **editable** — you can tweak it before accepting, and your tweak folds into the proposal | **yes** | yes (its ops carry `origin:"suggested"`) |
| **ghost** | a proposed *removal*, rendered from the diff's **base** side, **inert** — the caret skips it like an atomic widget | **no** | **no** (it is not in the store) |

Two consequences drive real mechanism, not just styling:

- **Ghosts are widgets, not text.** They are not in the editable model, so caret navigation and selection must treat a struck ghost run as atomic — arrow keys and clicks land *around* it, a keystroke never mutates it, and (critically for mobile) the per-block EditContext never sees it as an editable segment. A ghost is rendered, measured, and decorated like any block, but it is behaviorally inert.
- **live-proposed is the genuinely novel state.** No surface in the editor today has "text that is tinted *and* typeable." When you click into a proposed insertion and keep typing, your new characters are *also* proposed and fold into the proposal. The design has to make it unmistakable that you are writing *inside* a proposal (§12, review is a mode you enter), or the tint reads as a rendering bug.

## 4. The layer model

Organize the whole system by where each thing physically lives, because that decides virtualization, focus, and mobile behavior. This is the corrected model — the first draft named two "reuses" (`QuarantineBlock`, the overlay authority for N affordances) that the code cannot actually provide; see the notes.

- **L0 — the live editable flow.** The store, rendered as the *proposed* document (the reviewed proposal's ops applied optimistically), virtualized as normal. Insertions live here as real, typeable nodes. This is the ordinary editor; review does not replace it.
- **L1 — inline decoration.** CSS on the real L0 nodes, applied by setting a `data-*` attribute on the element and letting a stylesheet rule paint it — the exact mechanism the shipped `review-change-indicator.tsx` uses (`root.querySelector('[data-engine-block-id="…"]').setAttribute(…)`). Zero reflow, no re-render, virtualizes for free (a block that scrolls out unmounts and re-applies its marker on remount). Because `block-dispatch.tsx` emits `data-engine-block-id={node.id}` on **every** node at every depth — container, row, and cell all carry it (see `table.tsx`) — L1 can decorate at *any* granularity (a whole block, a table cell, a list item, an object) with one mechanism. This is the passive marker layer (§7).
- **L2 — ghost content.** Removed nodes are not in the store, so they have no L0 element and no offset-model height. They are rendered by a new inert branch (`GhostBlock`, §5) that mounts a real DOM element carrying `data-engine-block-id={baseNode.id}` from the diff's base-side node. The instant a ghost mounts that attribute, the entire existing `[data-engine-block-id]`-keyed stack works on it unchanged: `geometry.ts` resolves its rect (`el.closest("[data-engine-block-id]")`, `:189`), L1 decorates it, the offset model can measure it. The ghost problem reduces to "mount an inert id-carrying element for a base-side node" — a new render branch, not a new geometry/anchor/marker subsystem.
- **L3 — the active affordance.** Exactly **one** overlay-authority surface at a time: the accept/reject/attribution control on the change under the review cursor (§7). This is the reconciliation of "no chrome in prose" with "you need controls at the change": decoration lives in the text (L0/L1/L2), the *control* floats above it via the overlay authority, anchored to the cursor's block.

> Why not `QuarantineBlock` for L2: `QuarantineBlock`/`EngineBlock` render a node that is **in the store** — `EngineBlock` returns `null` the instant an id is absent (`block-dispatch.tsx:61`). A ghost is by definition absent from the store, so the quarantine seam has no node to render. L2 is `GhostBlock`, a distinct branch that reads the base node from the diff.
>
> Why not "N floating affordances" for L3: the overlay authority is **one-winner-per-target-kind** (`overlay-authority.ts` buckets candidates by kind and picks a single winner per kind; its collision avoidance positions the handful of open surfaces against each other, it is not a layout engine for a button on every changed block). A proposal touching 12 blocks cannot show 12 authority-anchored controls. L3 is exactly one active surface, driven by the review cursor; the other 11 changes show only their passive L1 markers.

## 5. The ReviewModel — the ghost pipeline, built from the diff

"Render all ghosts in place" (the explicit choice — no `⋯ N removed ⋯` stubs) forces a merged-order virtualization pipeline, because a removed block has to appear at its old position with real height. The key realization that makes this cheap: **the merged order is already computed.** `diffSnapshots` emits `SnapshotDiff.blocks: BlockDiff[]` in merged spine order (`docs/036 §5.4` step 4), recursively (each `BlockDiff` carries `children`), each entry carrying `baseIndex`/`targetIndex` and `node` (the target node, or the base node when the block is removed). The ReviewModel is a **projection of that**, not a new computation:

- **merged order per scope** = the `BlockDiff[]` order (already merged, already recursive).
- **node resolver** = a live (non-removed) block resolves through `store.getNode(id)`; a removed block resolves to `BlockDiff.node` (the base side).
- **render dispatch** = a live block renders through the normal `EngineBlock`; a removed block renders through **`GhostBlock`** (new: inert, mounts `data-engine-block-id={baseNode.id}`, reads the base node, non-editable).

The offset model needs almost nothing: `metricsForNode` already accepts any `EditorNode` (`block-metrics.ts:55`), so it estimates a ghost's height from the base node with no change. The treap consumes the merged top-level order and `seedFor(id)` reaches ghosts through the base-node resolver. Estimator poisoning is already avoided for free: the estimator observation path guards on `if (node)` and `store.getNode(ghostId)` returns null (`use-virtual-window.ts`), so a ghost's measured height never feeds back into the *live* estimator. One cleanup this adds: **evict ghost height-cache entries on review exit**, or dead ghost ids linger in the ResizeObserver cache.

> The one honest wiring note: `renderContainer` (the structural-view SPI, e.g. `table.tsx`) splats its `{children}` as-is and does **not** change. What forks is the **child-assembly** — `block-dispatch.tsx:128` maps `node.children` *from the store*; in review mode that recursion maps the **merged** child order from the `BlockDiff` spine instead, so a ghost `<tr>` is spliced between two surviving rows. "EngineBlock is unchanged" is not quite true — its structural child-assembly branch is what becomes review-aware. Naming it here so it is not smuggled.

### 5.1 Two escape hatches, at two scopes

Rendering all ghosts is bounded by two thresholds, at two different scopes, and together they are total:

- **Top-level region threshold** (`docs/036 D16`): a single contiguous *top-level* changed region larger than roughly the viewport (~20–30 blocks) does not render inline; the affordance opens it in the dedicated diff view. The top-level treap owns this.
- **Per-container ghost budget** (new, and the reason it is *not* a deferral): structural containers do not internally virtualize today — a 2000-row table already mounts all its live rows in the ordinary editor, so the woven overlay adds **no** new cost for live rows. The only new cost inside a container is *ghost* rows. So the bound is a per-container ghost budget K: if a container would splice more than K ghost children (a deletion-heavy table), that container's review routes to a **scoped diff view** (`DiffView` scoped to the container) instead of splicing K ghosts inline. Live-row cost is unchanged from today; ghost cost is bounded. This does not require, and does not reopen, general container virtualization (a separate backlog track) — it completely handles the case by routing it, which is the same move D16 makes one scope up.

## 6. The disclosure tiers

Every change class lands in one of three tiers, by how much of the change is legible in the content itself. The engine already computes the data for all three (`docs/036 §6.4` calls change-detail a *display contract*, not new algorithm); the tiers only change the disclosure strategy.

- **T1 — Woven.** The change *is* a glyph delta: text insert/delete; a whole block added (real green content) or removed (a ghost); a mark-add that changes appearance (bold added → the text is now bold). Render it inline, like the diff view's inline track-changes.
- **T2 — Marked in situ, detail floated.** The invisible changes: node attrs (cell fill, alignment, heading level, indent), mark *removals* (bold removed, link removed), simple object fields (code `language`, image `alt`). A non-reflowing **marker** on the exact element that changed (§8), and the "key: base → target" detail in a **floating chip** revealed on the review cursor. This is where the diff view's field-summary content goes — floated, never as an injected row.
- **T3 — Signal in situ, drill into a scoped diff view.** The opaque and the complex: a code block's *source* edit, a custom-SPI object's internals, a large structural reshape. Signal the block; the affordance opens a **scoped `DiffView`** (just that object's before/after) in a popover or the Changes pane. The overlay is the map; the diff view is the drill-in.

> `renderInlineDiff` is **dropped**, not deferred. The first draft proposed a `NodeDefinition.renderInlineDiff?` seam so an object could weave its own internal diff into the live surface. It is unnecessary: T3 routes opaque objects to the existing `DiffView`, and the reader already renders object field detail through the shipped `NodeDefinition.diffData` seam (`docs/036 §6.4`; the code block already implements it). The detail engine exists and the surface exists — a second seam would only earn its keep to weave an object's representation into the *live* surface, which T3 explicitly declines to do (a code diff belongs in a proper diff view, not smeared into a live Prism editor). One fewer SPI.

## 7. The passive layer and the active review cursor

The split that keeps the overlay authority's one-winner invariant intact while still marking every change:

- **The passive marker layer** is a dumb, positioned decoration layer — the R6-I `review-change-indicator` mechanism generalized: set a `data-*` attribute on any `[data-engine-block-id]` element (a block, a cell, a list item, an object, a ghost) and let CSS paint it. No overlay authority, no position bookkeeping, virtualizes on remount. It carries *all N* markers at once: gutter bars on changed blocks, rings on changed cells/objects, ghost styling, deletion ticks. This is where "60 changed cells" lives — 60 passive rings, zero authority surfaces.
- **The active surface** is exactly one overlay-authority `block` control at a time, on the change under a **review cursor**. Next-change / prev-change step the cursor through the diff's changed entries (wired to the existing scroll-to-block path so an off-screen change scrolls into view); the cursor's block gets the floating accept/reject/attribution/detail affordance. Accept and reject act on the cursor's block. So "12 accept buttons" becomes "12 passive markers + 1 active control that moves."

The active surface is a `taking`-focus overlay (the focus-reclaim seam, `docs/029`), so operating it does not tear editor focus.

## 8. The marker vocabulary (closed set) and where each change attaches

The woven overlay gets its own primitives — not the diff view's cards/tags/summary-rows. Every primitive is zero-reflow except the two that occupy natural structural slots (added content and ghosts), which is the one allowed exemption.

| Primitive | Mechanism | Reflows? | Carries |
| --- | --- | --- | --- |
| gutter bar | `::after` in the left inset (R6-I ships it) | no | "this block differs" — the always-on breadcrumb |
| element ring | two-tone `focusRing` on a cell / object / list item | no | a sub-block element changed (T2) |
| run underline + wash | text-decoration + faint background on the run | no | inserted text (T1) |
| strikethrough | text-decoration on the run/ghost | no | deleted text (T1) |
| dotted underline | text-decoration on the run | no | a ranged invisible change — a mark removed on a run (T2) |
| ghost | inert `GhostBlock` in a natural slot | slot only | a removed block/row/item (L2) |
| deletion tick | `::after` edge mark on a surviving neighbor (R6-I ships it) | no | "a block was removed beside this one" |
| detail chip | floating, on the review cursor | no (floats) | the `key: base → target` summary (T2) |
| drill-in | scoped `DiffView` in popover / pane | no | opaque/complex detail (T3) |

**The hard rule:** a marker may only use mechanisms that do not touch the live box model — `box-shadow`, `outline`, `::after`/`::before`, `text-decoration`, `background`. The *only* things that occupy real layout are added content and ghosts, and only in **natural slots** the structure already has (a paragraph, a list item, a table row/cell). Nothing — no card, no tag row, no summary line — is ever injected between or inside live blocks.

**Every invisible change has a defined carrier** (this closed the first draft's biggest gap, where "attr tick / dotted underline" had no anchor for a rangeless change):

- **ranged invisible** (a mark removed on a text run) → **dotted underline** on the run + chip. It has a range, so it gets an in-prose decoration.
- **block-level attr** (alignment, indent, heading level) → the **gutter bar** (already block-level) + a block chip. It has no sub-range, so the block breadcrumb carries it.
- **element-level attr** (a cell's fill, an object's field) → an **element ring** on that element's `[data-engine-block-id]` + an element chip. A re-colored table cell shows its ring and, on the cursor, its `Fill: red → yellow` chip *without* a card and without a summary row destroying the table.

The R6-I `::after` already composes multiple signals on one element via layered gradients (a block can be `changed` and have a deletion beside it at once), so a block that is both moved and edited, or a cell that is both re-colored and holds edited text, composes without new machinery.

## 9. The color system

Color is subordinate to shape and to *location*, because in a live document content can be any color — a red cell, an amber callout, a green code token — so a status-by-color scheme collides with content-by-color. Shape carries meaning; color is a secondary, collision-aware channel.

- **Status is carried by shape**, not by four colors in prose: underline+wash = insert, strikethrough = delete, ring = attr/object change, ghost = removal, gutter bar = block changed.
- **Location decides whether a hue is safe.** The gutter bar sits in the **left inset, outside the prose box**, so it keeps the shipped R6-I status hue (info/success/warning) with zero content-color collision. An **element ring sits on content**, so a single-color ring would vanish when its hue matched the cell fill — the ring's *shape* would disappear, not just its tint. So element rings use the **two-tone `focusRing`** token (dark-inner / light-outer, shipped in `focus-ring.ts`, commit `a3bff63`, built to be "one visible ring on any surface"), which keeps a luminance-contrasting edge on any background. The teal-ring-on-a-teal-cell case is handled by the two-tone contrast, not by hoping the hue differs.
- **Inserted text = wash + underline, and the wash is load-bearing** — because a colored underline collides with a link (also underlined), and a dashed/double underline is fragile (a theme can style links dashed). The one thing a link never has is a background wash. So an insert reads as wash+underline, a link reads as underline-no-wash, and an inserted link reads correctly as both (wash for "new", underline for "link"). The diff view can lean on the underline alone because it is a read-only reader with no clickable links; the woven overlay genuinely needs the wash to carry more of the weight.
- **Author is carried by the chip, never by an in-prose marker.** Under single-proposal review (§12) exactly one proposal is applied at a time, so the author is constant for the whole session — the gutter bar and rings carry status only, and the "proposed by" identity (an agent label, a human name, an avatar and hue) lives in the floating chip where it never overlaps content. This is also why the multi-proposal attribution problem does not exist here: with one applied proposal there is nothing to disambiguate.

## 10. 037 Option A integration — the proposal pipeline

The producer/consumer split with `docs/037`: an agent (or a human proposer) acts on the **command layer** — the human's keystrokes are already `store.command(...)`, so the agent uses the same commands, never synthesized pointer events at guessed coordinates (`docs/037 §3.5, D1`). Its change is captured as an op-log and lands as a `Proposal` on a host-owned `SuggestionSource` (`docs/036 §7.2, §7.3`). Propose-by-default (`docs/037 D6`) routes any external/AI change to a proposed branch rather than a silent commit. The woven overlay is where that branch is rendered and resolved.

The proposal is an **attributed op-log branch** (Model A): `{ id, author, baseVersion, ops: Step[], status, threadId? }`. Its ops carry identity anchors (node ids, and character ids at text boundaries), so applying them to a document that moved since the proposal was made is a **merge by identity**, not an offset rebase (`docs/036 D15`). The proposed document is `applyOps(currentDoc, ops)`; the woven diff is `diffSnapshots(currentDoc, proposedDoc)`; the ReviewModel (§5) renders that diff in place.

## 11. Single-proposal woven review

Only the **one** proposal under review is optimistically applied to the live store. Other pending proposals show as passive R6-I-style indicators until you enter them. This is squarely inside Model A's stated scope ("one proposer at a time, or several *separate* proposals reviewed independently") — it is not a deferral of anything.

It also *deletes* two hard problems outright. With one applied proposal: (1) attribution is trivial — every change is that proposal's author, so the color system never has to disambiguate a merged store; (2) per-block accept is unambiguous — the ops on a block id all belong to the one proposal, so "accept this block" has one meaning. Both problems only exist if two proposals are applied into one store at once, and that never happens.

**Switching proposals is an atomic sequence** (Model A's "reviewed independently" is not free): (1) materialize the reviewer's pending in-review edits into the current proposal's op-log (the lazy fold, §14), (2) revert the current proposal's optimistic ops (a clean inverse, since they were `recordHistory:false`), (3) apply the next proposal's ops and re-diff. Skip step 1 and the reviewer's tweaks are lost on switch; the sequence is one operation, not three the user can interrupt between.

## 12. Review is a mode you enter

Because live-proposed text is editable *and* your edits fold into a proposal, review cannot be ambient — the reviewer must know that typing here joins a suggestion. Entering review is an explicit mode with its own chrome ("Reviewing agent proposal · 4 changes", a cursor, an exit). The mode is also the natural home for the save and undo rules below: they are scoped to the mode, and exiting the mode restores ordinary behavior.

## 13. Caret, focus, and the EditContext host

Two real hazards, both grounded in the code, both fixed here rather than waved at.

**Caret reclaim must key on caret-intent, not `origin`.** Today the focus-reclaim after a structural edit runs only for local origin — `react-view.tsx:452` is `if (committed.origin !== "local" || !committed.structureChanged) return;`. If the reviewer's edits are tagged `origin:"suggested"` (so they fold into the proposal and stay out of a save), that filter would skip reclaim and drop the caret on any structural edit during review. The bug is that `origin` conflates *authorship* with *user-initiatedness*. The fix does not invent a guessed flag: the reviewer's keystroke already flows through EditContext → `store.command(...)`, the identical path as ordinary typing, while `applyProposal` is a programmatic batch. So reclaim keys on the **dispatch entry point** — command-from-input is interactive and reclaims; `applyProposal`/optimistic-apply is programmatic and does not — regardless of the `"suggested"` tag either carries.

**The focused-block-protection handshake.** Optimistic-apply that removes or reparents the block currently holding the caret would unmount the per-block EditContext host (`text-block.tsx`), which on mobile is the documented keyboard-flicker class. So before such an apply, the caret is relocated to a safe surviving neighbor and the reviewer is told "this proposal removes the block you're editing." Honest scope: this reduces *silent unmount during typing* to a *deliberate, user-triggered swap on a review action* (entering review, accepting a removal) — a one-time visible transition, acceptable. It does **not** achieve zero host swaps; genuine zero-swap is the single-host (A) work that is a separate, pre-existing track, not this feature's deferral.

## 14. Save safety

There is no per-node "suggested" bit to filter on: `origin` lives on the transaction, `toSnapshot()` snapshots **nodes**, and adding a per-node suggested marking would be drift toward Model B (tombstones), which Model A refuses. So "exclude suggested ops from the save" is not implementable as a filter. Instead: **saves are blocked (deferred) while a proposal is under review.** Autosave queues; a manual save waits. The **exit condition is precisely "zero pending suggested ops remain in the store"** — which mixed block-level accept/reject drives toward just as well as accept-all/reject-all (partial resolution is allowed). On exit the store contains only accepted content, so the save resumes normally against a clean store, and `toSnapshot()` needs no special case.

## 15. Undo and redo during review

The problem: the reviewer's in-review edits must be individually undoable (Ctrl+Z their own typing) *and* revert cleanly as part of reject — and a single `recordHistory` flag cannot do both. The naive fix (a barrier inside the main history pool) is **wrong**, and the reason is subtle and fatal:

> A review-segment inverse is not merely undo depth — it *is* the reject mechanism (reject-all replays those inverses). The main pool is byte-budgeted and evicts oldest-first, treating every entry as droppable (`history-pool.ts`, `#evictOldest` does `#done.shift()`, driven by `#enforceBudget` and the arbiter's `evict()`). A long in-review edit burst that pushes past the budget would evict the reviewer's *earliest in-review inverses* — and under the mobile `overflow:"drop"` default they are gone, so **reject-all can no longer return to the pre-review state**. That is not lossy undo; it is a corrupted reject. And you cannot make segment entries un-evictable inside the budgeted pool, because that breaks the arbiter's contract to shed to a target. Barrier-in-pool has two exits and both are bad.

The correct design keeps the segment *concept* and moves it *out of the budgeted pool*:

- The review segment is a **separate `HistoryPool` instance**, owned by the review controller, constructed with **no caps** (default infinite) and **not registered with the memory arbiter**. It reuses the whole class for free — typing-run coalescing, `takeUndo`/`pushDone`/`breakCoalescing`, all of it — so an in-review typing run coalesces into one undo exactly like normal editing. It is safe to leave unbudgeted because it is transient and single-proposal-bounded: it is created on entering review and destroyed on every accept/reject, so it cannot grow without bound the way a session's main history can.
- The **main pool is frozen during review** — nothing records into it — so in-review edits create zero eviction pressure on document history, and the main pool may still shed its own pre-review entries under memory pressure without ever touching the segment.
- `store.undo()`/`redo()` **route by mode**: in review they drive the segment instance, otherwise the main pool. That is the one wiring change in the undo path. In-review undo/redo cannot cross into pre-review history — you cannot undo the document out from under the proposal you are reviewing.
- The agent's optimistic apply is `recordHistory:false` and is **not** on the segment; reject re-derives its inverse from `proposal.ops` via the step algebra (`steps.ts` inverts steps), so it needs no history entry at all.
- **Accept-all**: the store already holds the final state; push **one** collapsed "accepted proposal" entry into the *main* pool (so the whole acceptance undoes as a unit), discard the segment instance.
- **Reject-all**: replay the segment's inverses (all resident — never evicted, because unbudgeted), then invert the optimistic apply (re-derived from the ops), discard the segment. The store returns to the pre-review state.

**The op-log fold is lazy.** `docs/036 §8` reads as if in-review edits fold into the proposal per commit (eager). Eager fold plus segment-undo is a two-way sync hazard: type a tweak (→ segment and → `proposal.ops`), Ctrl+Z it (→ segment pops), and the persisted op-log still holds an edit the reviewer undid. So the fold is **lazy**: the segment is the live truth during review, and the op-log is materialized once at a resolution boundary (accept, or the switch sequence's step 1) from the segment's *net* state — never per keystroke. In-review undo/redo touch only the segment; the op-log is a snapshot taken after undo/redo have settled. The segment is the *undo* path, the op-log is the *persistence* path, same edits, two consumers, consistent by construction.

**Block-level resolution is a hard segment boundary.** The segment is a linear temporal stack, but a block-level reject removes a *subset* of edits (one target id's ops) from the middle. If the reviewer edited block X, then Y, then X again, a block-reject on X pulls non-contiguous entries whose later inverses may depend on the earlier ones — the same non-locality D11 flagged for accept, now in the undo stack. Resolution: **a block accept/reject is a hard undo boundary in the segment** (you cannot Ctrl+Z across it, exactly as accept-all and switch are). On a block-reject: materialize the fold up to the boundary, invert that block's segment entries plus its optimistic ops, and truncate the segment there; edits before the boundary are committed relative to it. Without this rule, block-reject leaves dangling inverses that reference removed ops.

## 16. Accept and reject

Under optimistic apply the proposal's ops are already in the store during review (tagged `origin:"suggested"`, `recordHistory:false`); accept and reject resolve that pending state at whole or block granularity.

- **Accept whole**: clear the suggested tag on all the proposal's ops so they become permanent, set the proposal `status:"accepted"` via the source, push the one collapsed history entry (§15), dissolve the overlay.
- **Reject whole**: invert all the proposal's ops and the reviewer's segment edits (§15), set `status:"rejected"`, dissolve the overlay.
- **Accept block / reject block**: operate on the op group for that block. Ops are grouped into the `BlockDiff` they produced **by target node id** — an insert-node belongs to the block it creates, a move-block to the moved block, a replace-text to the leaf it edits — so per-block resolution touches exactly that group (this grouping is why ops, not a proposed snapshot, are the representation). Each block resolution is a hard segment boundary (§15). The proposal is fully resolved, and review exits, when no pending suggested ops remain (§14).

The affordance is the single active overlay surface on the review cursor (§7): accept ✓ / reject ✗ / open-thread, anchored to the cursor's block, focus-safe.

## 17. What routes to the Changes pane, not the woven surface

Three classes have **no `[data-engine-block-id]` to anchor to**, so they cannot be woven and route to the Changes pane (a dock pane registered like the Comments pane, `docs/027 §4.2`):

- **Settings changes** (document theme, etc.) — no block owns them.
- **Collection changes** (a glossary or bibliography entry) — document-level, not block-anchored.
- **Conflicted ops** — a proposal op whose identity anchor no longer resolves (its target node or character id was deleted by an intervening reviewer edit). The whole point of the conflict is that the target is gone, so there is *no element to anchor to*. It routes to the pane with "no longer applies," and the rest of the proposal still applies (`docs/036 §7.3, §8`). This corrects the doc's current wording — a conflict is surfaced **to the pane when the anchor is gone**, not "on its block," because there is no block.

So "review a proposal" is always **the woven overlay plus the Changes pane**, never the overlay alone: the overlay carries every anchor-resolvable change, the pane carries the anchorless remainder and the proposal's discussion thread (`threadId`).

## 18. Attribution

Mostly free, and simplified by single-proposal review. Every character an author inserts already carries their `ClientId` (`docs/036 §7.4`); the proposal carries its `author`. Under single-proposal review the author is constant for the session, so attribution is a session-level fact shown in the mode chrome and the chip, not a per-run computation the in-prose markers have to encode. The `TextRunDiff.ids` on the diff still tell you which client inserted each run if a richer per-run "proposed by" is ever wanted, but the baseline needs none of it.

## 19. Failure scenarios, walked

The scenarios the debate stress-tested, with their resolutions:

- **Two proposals set different attrs on one paragraph** (P1 `align:center`, P2 `tag:h2`). Resolved by single-proposal review (§11): only one is applied, so there is nothing to disambiguate and accept-block is unambiguous.
- **A proposal deletes the table the reviewer is typing into.** Resolved by the focused-block-protection handshake (§13): the caret relocates to a safe neighbor and the reviewer is told, before the optimistic apply unmounts the host — a deliberate swap, not a silent one.
- **An agent rewrite changes 40 attrs across 60 cells.** Resolved by the passive/active split (§7): 60 passive two-tone rings (zero authority), one active chip on the review cursor's cell. Not 60 chips, not one card per cell.
- **A color attr change where the change accent equals the content color** (teal ring on a teal cell). Resolved by the two-tone `focusRing` (§9): the ring keeps a luminance-contrasting edge on any background, so the shape survives even when a hue collides.
- **A deletion of many rows inside a large table.** Resolved by the per-container ghost budget (§5.1): beyond K ghost rows the container routes to a scoped diff view; live rows already mount today, so only ghost cost is bounded.
- **The reviewer Ctrl+Z's an in-review tweak.** Resolved by the separate arbiter-exempt segment stack and the lazy fold (§15): the segment pops, the op-log (materialized only at a boundary) never desynced.
- **A long in-review edit burst on a document with deep history.** Resolved by moving the segment out of the budgeted pool (§15): the segment is unbudgeted so its reject inverses are never evicted; the main pool is frozen so review adds no eviction pressure.
- **A proposal op targeting a block the reviewer already deleted.** Resolved by routing conflicts to the pane (§17): no woven home, "no longer applies," the rest of the proposal still applies.

## 20. Build map — net-new vs reuse

The point of grounding every mechanism in real code: the net-new surface is small, and it is *additive*.

**Reused as-is:**

- the diff engine (`core/diff/**`, `diffSnapshots`, the `SnapshotDiff` merged spine) — the ReviewModel is a projection of it (§5).
- the `data-engine-block-id`-keyed decoration mechanism (`review-change-indicator.tsx`), generalized to any depth for the passive layer (§7).
- `geometry.ts` rect resolution, the overlay authority and its focus-reclaim seam for the single active surface (§7).
- `metricsForNode` on base nodes, the treap and estimator (`block-metrics.ts`, `use-virtual-window.ts`) for ghost measurement (§5).
- the two-tone `focusRing` token (`focus-ring.ts`) for element rings (§9).
- the step algebra's inverses (`steps.ts`) for reject and for optimistic-apply revert (§15, §16).
- the `HistoryPool` class, instantiated a second time for the review segment (§15).
- `NodeDefinition.diffData` + the reader `DiffView` for the T3 drill-in (§6).
- the Changes pane / side-panel dock and comment `Thread` for discussion and anchorless changes (§17).

**Net-new:**

- `GhostBlock` — the inert render branch that mounts a base-side node with `data-engine-block-id` (§4, §5).
- the review-aware child-assembly recursion (maps the merged `BlockDiff` spine instead of `store` children) (§5).
- the `ReviewModel` projection + ghost height-cache eviction on exit (§5).
- the passive-marker layer generalized across granularities + the review-cursor navigation (§7, §8).
- the per-container ghost budget → scoped-diff-view route (§5.1).
- the dispatch-entry-point reclaim signal + the focused-block-protection handshake (§13).
- the review-mode save block with the "zero pending suggested ops" exit condition (§14).
- the mode-routed undo, the second (arbiter-exempt) `HistoryPool`, the lazy op-log fold, the block-resolution segment boundary (§15).
- the `SuggestionSource` SPI, the `Proposal` type, `applyProposal`/`applyProposalBlock`, optimistic apply with `origin:"suggested"`, the atomic switch sequence, and the accept/reject affordance (§10, §11, §16) — the Model-A backbone `docs/036 R6-J..N` already scopes.

## 21. What this amends in docs/036

For when 036 is updated to match:

- §6.2 / §6.2.1: the woven overlay is unparked and specified here; the L2 mechanism is `GhostBlock` + review-aware recursion, **not** the `QuarantineBlock` seam (which cannot render an absent node); the L3 affordance is a single review-cursor surface, **not** N authority anchors (the authority is one-winner-per-kind).
- §7.3 / §8: a conflicted op routes to the **Changes pane** ("no longer applies"), not "on its block" — there is no block to anchor to.
- §7.5 / §8: the "save excludes suggested-origin ops" line is not implementable as a filter (`origin` is per-transaction, `toSnapshot` is per-node); it becomes **saves blocked in review mode**, exit condition "zero pending suggested ops."
- §8: in-review edits fold into the op-log **lazily** (at a resolution boundary), not eagerly per commit; undo during review is a **separate arbiter-exempt segment stack** with block-resolution as a hard boundary.
- D16: joined by a second escape hatch at container scope (the per-container ghost budget).
- §6.4: `renderInlineDiff` is **dropped** (T3 drill-in over `diffData` + `DiffView` suffices).
- §11 / §13: the DoD and "nothing deferred" claims should reflect that the woven overlay and Model-A suggested edits are now design-complete with the mechanisms above, not merely "reserved."

## 22. Convergence

This design was taken to convergence against an adversarial reviewer that broke the first draft on real code (the `QuarantineBlock` non-path for ghosts, the one-winner overlay authority, the `origin`-keyed reclaim, and the history-pool eviction that would have corrupted reject). Every mechanism that replaced a broken one is grounded in a file that exists today. The three would-be "laters" — conflicts with no woven home, save exclusion, undo during review — are closed here, not pushed. There are no open forks between this design and an implementation of full Model A with 037 option A. It is ready to build.
