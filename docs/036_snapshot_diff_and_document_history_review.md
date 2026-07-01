# 036 — Snapshot Diff, Inline Review, And Suggested Edits

> Status: implementation-grade research and proposal
>
> Date: 2026-07-01
>
> Scope:
>
> - A framework-free core module `packages/editor/src/core/diff/**` that computes a structured diff between two `EditorDocumentSnapshot` values. Pure function, no DOM, no React, no store, so it runs in the editor, the reader, a worker, or a headless script.
> - Two display surfaces built on the reader L1 primitives (`packages/reader/src/l1/**`): a dedicated **diff view** (compare two saved versions) and a live **inline diff overlay** in the editor (review proposed changes against the current document).
> - The **suggested-edits / track-changes** feature that rides on the diff engine: an author (an agent or another human) proposes a change; you review it inline; you accept or reject it at whole-proposal or per-block granularity. This document specifies **Model A** (proposal as an attributed op-log branch, ship now) and reserves **Model B** (inline tombstones for concurrent multi-author suggesting, the collaboration-era upgrade), with the A→B migration cost analyzed so A does not paint B into a corner.
>
> Source docs:
>
> - `docs/011_foundation_dsa_owned_model_editor.md` — the node model, the coordinate system, and the character-id substrate the diff and attribution key on.
> - `docs/014_crdt_future_proofing_brainstorm.md` — the model is identity-addressed and CRDT-native by construction; §8 "Behavior Is Free Later, Addressing Is Forever" is why suggested edits (a behavior) is cheap now and tombstones (Model B) are the reserved collaboration cost.
> - `docs/027_review_tab_side_panel_and_document_insight.md` — §9.7 explicitly reserves the track-changes seam ("a suggested edit is an annotation on a range with a thread and an accepted state — extend the annotation/thread model, one dock pane"); §2 "Derive, Do Not Store"; the Comment Source SPI, the side-panel dock, and the derived document index that the review wrapper reuses.
> - `docs/029_editor_overlay_authority_spi.md` — the anchor-target spine and the focus-reclaim seam the accept/reject affordance anchors on.
> - `docs/028_reader_convergence_snapshot_native_dispatch.md` — the reader renders the native snapshot; both display surfaces reuse that render path and its parity guarantees.
> - `docs/030_ts_editor_markdown_nesting_snapshot_lifecycle.md` — incremental `toSnapshot()` and the op-log unit (D4); the op-log is the proposal representation and the diff fast path.
> - `docs/006_editor_toolbar_redesign_plan.md` — §4.6 the `[Changes]` review slot; §4.7 the AI output mode "propose review change" (the entry point, specified in `docs/037`).
> - `backlog.md` #6 — the one-paragraph summary this doc expands.
>
> Related docs:
>
> - `docs/037_agentic_control_api.md` — how an in-editor AI action or an external agent produces a proposal. `037` is the producer of suggestions; `036` is the review substrate they land in. The two reference each other and stay separate.
> - `docs/013_collaborative_owned_model_yjs_adaptation.md` — real-time collaboration; suggested edits is the async, review-gated on-ramp to it (§7.8).
> - `docs/016_node_spi_and_pluggable_blocks.md` — the object-diff seam mirrors `plainText`.
>
> Assumptions:
>
> - The primary diff case is two snapshots of the **same document** across time, so they share character-id lineage. Character ids are stable across edits (`sliceTextContent` preserves surviving ids, `model.ts:420-430`), so matching by id is exact. Diffing two **unrelated** documents is a fallback that degrades to text-level alignment (§5.2).
> - Suggested edits ships **Model A first**: one proposer at a time (or several *separate* proposals reviewed independently), no concurrent interleaving in a single span. Concurrent multi-author suggesting is Model B, deferred to the collaboration milestone (6–12 months out per the current lean).
> - Proposals are **host-owned** (the Suggestion Source SPI, §7.3), the same posture as comment threads (`docs/027 §4.2`). The live document is not polluted with pending markup; the inline diff is derived on demand.
> - The reader L1 render is the display substrate for both surfaces; its per-node render functions are pure and decoratable (§3.4).
> - No product or runtime dependency enters `packages/editor` or `packages/reader`; the diff and suggestion core are model/format concerns and the display is an L1-render concern (the shared-package boundary).

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 No Diff Exists Today](#31-no-diff-exists-today)
  - [3.2 The Identity Substrate — The Unlock](#32-the-identity-substrate--the-unlock)
  - [3.3 The Snapshot Shape The Diff Walks](#33-the-snapshot-shape-the-diff-walks)
  - [3.4 The Reader L1 Render Seams The Display Reuses](#34-the-reader-l1-render-seams-the-display-reuses)
  - [3.5 The Op-Log Fast Path](#35-the-op-log-fast-path)
  - [3.6 No Suggestion Concept Exists; The Seam Is Reserved](#36-no-suggestion-concept-exists-the-seam-is-reserved)
  - [3.7 The Attribution Substrate And Destructive Delete](#37-the-attribution-substrate-and-destructive-delete)
  - [3.8 The Comment And Overlay Substrate The Review Reuses](#38-the-comment-and-overlay-substrate-the-review-reuses)
- [4. Architecture Decisions](#4-architecture-decisions)
  - [4.1 D1 — Identity Diff, Not Text Diff](#41-d1--identity-diff-not-text-diff)
  - [4.2 D2 — A Framework-Free Core `diffSnapshots`](#42-d2--a-framework-free-core-diffsnapshots)
  - [4.3 D3 — One Structured Result, Many Renderers](#43-d3--one-structured-result-many-renderers)
  - [4.4 D4 — Char-Level Diff By Character Id, Text-Alignment Fallback](#44-d4--char-level-diff-by-character-id-text-alignment-fallback)
  - [4.5 D5 — Move Detection By NodeId](#45-d5--move-detection-by-nodeid)
  - [4.6 D6 — Object Diff Through A Node-Definition Seam](#46-d6--object-diff-through-a-node-definition-seam)
  - [4.7 D7 — Display On The Reader L1, Not A New Renderer](#47-d7--display-on-the-reader-l1-not-a-new-renderer)
  - [4.8 D8 — Two Display Surfaces: Diff View And Inline Overlay](#48-d8--two-display-surfaces-diff-view-and-inline-overlay)
  - [4.9 D9 — A Proposal Is An Attributed Op-Log Branch (Model A)](#49-d9--a-proposal-is-an-attributed-op-log-branch-model-a)
  - [4.10 D10 — Host-Owned Suggestion Source SPI](#410-d10--host-owned-suggestion-source-spi)
  - [4.11 D11 — Accept/Reject At Whole And Block Granularity](#411-d11--acceptreject-at-whole-and-block-granularity)
  - [4.12 D12 — Separate The Change From The Conversation](#412-d12--separate-the-change-from-the-conversation)
  - [4.13 D13 — Model B (Tombstones) Is The Concurrent Future](#413-d13--model-b-tombstones-is-the-concurrent-future)
- [5. The Diff Algorithm](#5-the-diff-algorithm)
  - [5.1 Result Data Shapes](#51-result-data-shapes)
  - [5.2 Text-Leaf Character Diff](#52-text-leaf-character-diff)
  - [5.3 Mark Diff](#53-mark-diff)
  - [5.4 Block Sequence Diff And Move Detection](#54-block-sequence-diff-and-move-detection)
  - [5.5 Structural Recursion](#55-structural-recursion)
  - [5.6 Object, Settings, And Collection Diff](#56-object-settings-and-collection-diff)
- [6. The Display Surfaces](#6-the-display-surfaces)
  - [6.1 The Diff View (Dedicated Review)](#61-the-diff-view-dedicated-review)
  - [6.2 The Inline Diff Overlay (Live In-Editor)](#62-the-inline-diff-overlay-live-in-editor)
  - [6.3 Shared Decoration](#63-shared-decoration)
- [7. Suggested Edits / Track-Changes](#7-suggested-edits--track-changes)
  - [7.1 The Two Models, And Why A First](#71-the-two-models-and-why-a-first)
  - [7.2 A Proposal Is An Attributed Op-Log](#72-a-proposal-is-an-attributed-op-log)
  - [7.3 The Suggestion Source SPI And Rebase](#73-the-suggestion-source-spi-and-rebase)
  - [7.4 Attribution](#74-attribution)
  - [7.5 Accept And Reject](#75-accept-and-reject)
  - [7.6 The Reuse Map](#76-the-reuse-map)
  - [7.7 Model A → Model B Migration Cost](#77-model-a--model-b-migration-cost)
  - [7.8 Suggest-First As The Collaboration On-Ramp](#78-suggest-first-as-the-collaboration-on-ramp)
- [8. Edge Cases And Failure Modes](#8-edge-cases-and-failure-modes)
- [9. Implementation Backlog](#9-implementation-backlog)
- [10. Future Backlog](#10-future-backlog)
- [11. Definition Of Done](#11-definition-of-done)
- [12. Final Model](#12-final-model)

## 1. Goal

Three deliverables on one engine. Compute an accurate diff between two `EditorDocumentSnapshot` values; render it in a dedicated diff view and as a live inline overlay; and build suggested edits on top, so an agent or another human proposes a change, you review it inline, and you accept or reject it part by part.

The thesis: the owned model carries stable identity at two levels — a `NodeId` per block, a `CharacterId` per character — so a diff between two versions of one document is an **identity** problem, not a text-alignment problem, and a suggested edit is a **branch** the diff engine renders rather than markup baked into the document. A plain-text editor has neither; it guesses with Myers alignment and it stores track-changes as inline spans that fight concurrent editing. We do neither.

Non-goals for the first release:

- **Real-time collaboration.** Suggested edits is the async, review-gated on-ramp (§7.8); live convergence, awareness, and multi-peer GC are `docs/013`/`docs/014`.
- **Concurrent interleaved suggestions in one span (Model B).** Model A covers one-proposer-at-a-time and several separate proposals; concurrent tombstoned suggesting is reserved (§4.13, §7.7).
- **Three-way merge and conflict resolution.** The CRDT track.
- **Semantic word/sentence diff** beyond character identity (a display nicety, §10).
- **Cross-document diff as a headline feature.** Unrelated documents share no id lineage; the algorithm handles them through a text-alignment fallback (§5.2), but the flagship is same-document review.

Short version: a pure `diffSnapshots(base, target): SnapshotDiff` in `core/diff/`, two reader-L1 display surfaces, and a suggested-edits layer where a proposal is an attributed op-log branch, the inline overlay is the derived diff, and accept/reject applies or drops the branch's ops.

## 2. System Summary

```text
     base ┐                                                   ┌─► DIFF VIEW (two saved versions, unified | side-by-side)
          ├─► diffSnapshots(base, target) ─► SnapshotDiff ────┤
   target ┘        (core/diff, pure)          (structured)    └─► INLINE OVERLAY (live, in-editor)
                        ▲                                              ▲
              op-log fast path (docs/030 D4)                          │
                                                            ┌─────────┴──────────┐
                                                            │  SUGGESTED EDITS    │
   proposal (agent / human B, docs/037) ──► op-log branch ──►  target = base+ops  │
                                                            │  accept = apply ops │
                                                            │  reject = drop ops  │
                                                            └─────────────────────┘
```

One pure function produces one structured `SnapshotDiff` (transport-agnostic JSON). Three consumers read it: the diff view, the inline overlay, and the suggested-edits review. A suggested edit is a proposal (an op-log branch, §7.2); its inline rendering is `diffSnapshots(liveDoc, liveDoc-with-proposal-ops)`; accepting it applies the ops, rejecting drops them. The proposal's discussion, attribution, and accept/reject affordance reuse the comment and overlay substrates (§7.6); only the change content is new, and it is an op-log, not document markup.

The single most important structural fact: **the proposed change never lives in the authoritative document.** It lives in a host-owned branch (§7.3), and the review UI derives everything from the diff. This keeps the live document clean (`docs/027 §2` derive-don't-store) and makes accept/reject a matter of applying or discarding ops, not unwinding inline suggestion spans.

## 3. Current-State Findings

### 3.1 No Diff Exists Today

A search across `packages/editor` and `packages/reader` for `diff`/`compare`/`delta`/`patch` finds no snapshot comparison. What exists nearby:

- The step algebra (`core/model/steps.ts:160-171`): eleven step types (`ReplaceTextStep`, `AddMarkStep`, `RemoveMarkStep`, `SetNodeTypeStep`, `SetNodeAttrStep`, `InsertNodeStep`, `RemoveNodeStep`, `MoveNodeStep`, `SetObjectDataStep`, `SetSettingsStep`, `SetCollectionStep`). Every edit is already a step; undo inverts steps.
- Position mapping (`core/model/mapping.ts`): threads a position through a sequence of steps within one transaction. Intra-transaction, not inter-snapshot.
- History (`core/store/history-pool.ts`): `CommittedTransaction` entries (forward steps plus inverses) for undo/redo, budgeted.
- Reference-block snapshot patching (`view/object-data.ts:82-88`): a shallow field-wise merge on one object node's `snapshot` field. Not a document diff.

So the step algebra is a per-edit delta and history is a linear log of those deltas. Neither reverse-engineers a diff from two arbitrary snapshots. That reverse-engineering is the net-new tree diff (except on the warm path, §3.5).

### 3.2 The Identity Substrate — The Unlock

`core/model/model.ts:56-81`:

```ts
type CharacterId = { readonly client: ClientId; readonly clock: number };
type CharacterRun = { readonly client: ClientId; readonly startClock: number; readonly length: number };
type TextSlice = { readonly text: string; readonly runs: readonly CharacterRun[] };
```

Every character in a prose leaf has a globally unique id (`{client, clock}`, CRDT-style), stored run-encoded on the leaf's `content`. `characterIdsForSlice(slice)` expands runs to a per-character id array (`model.ts:410`); `sliceTextContent` and the text-replace path preserve surviving ids across edits (`model.ts:420-430`). Marks and stored selection points anchor to these ids (`TextAnchor` `{kind:"char", id}`, `model.ts:89-91`).

Two snapshots of the same document share character-id lineage. To diff a leaf's text, expand both sides to id arrays and merge by id: a character in both is `keep`, only in base is `delete`, only in target is `insert`. No LCS, no heuristic, no false rename. Block identity works the same way one level up: `NodeId` is stable, so a block present in both snapshots is matched exactly, even if it moved. The substrate was built for marks and collaboration (`docs/014`); the diff and the attribution of suggested edits are second beneficiaries.

### 3.3 The Snapshot Shape The Diff Walks

`core/model/model.ts:305-320`:

```ts
type EditorDocumentSnapshot = {
  readonly version: 1;
  readonly body: {
    readonly order: readonly NodeId[];
    readonly blocks: Readonly<Record<NodeId, EditorSnapshotNode>>;
  };
  readonly settings: DocumentSettings;                                  // opaque JSON bag
  readonly collections?: Readonly<Record<string, readonly CollectionItem[]>>;
};

type EditorSnapshotNode = StructuralNode | TextLeafNode | ObjectNode;   // model.ts:282,293
```

- `StructuralNode`: `{ id, type, attrs?, kind:"structural", children: NodeId[] }` (callout, list, table/row/cell, the future columns).
- `TextLeafNode`: `{ id, type, attrs?, kind:"text", content: TextSlice, marks: TextMark[] }`.
- `ObjectNode`: `{ id, type, attrs?, kind:"object", data: JsonValue, baked?, status }`.

`body.order` is the top-level order; `body.blocks` is a flat id→node map; structural nesting is by `children` id lists inside that map. The document is a forest addressed by id, exactly the shape an identity diff wants: id lookups are O(1) and the tree is reachable from `order` plus `children`.

### 3.4 The Reader L1 Render Seams The Display Reuses

The reader renders a snapshot to static, RSC-safe semantic HTML through pure functions (`packages/reader/src/reader/render.tsx`):

- `renderBlock(node, snapshot, options)` — dispatch by kind: `renderTextLeaf`, `renderObject`, `renderStructural`.
- `renderTextLeaf(node, snapshot)` — one `<p>/<h*>/<li>/<blockquote>` with marks nested; internally uses `segmentText` (`core/model/marks.ts`) and `wrapMark`.
- `renderStructural` — recurses children via `renderSequence`.
- `bodyNodes(snapshot)`, `collectHeadings(snapshot)` — top-level walk helpers.

Stateless `(snapshot, node) → ReactNode`, so both display surfaces wrap a per-node result in status styling without reimplementing rendering. Character-level and mark-level decoration needs `segmentText` + `wrapMark` at a finer grain (not currently exported; §9 R6-C exports them). Structural containers and list runs need custom recursion so a changed child inside an unchanged container is marked, not just the container.

### 3.5 The Op-Log Fast Path

`docs/030` D4 defines incremental save as the op-log unit: `toSnapshot()` maintains `body.blocks` from the per-commit `touched` set, and the recorded `Step[]` for a save is the delta from the previous save. When two versions are adjacent saves and that log is persisted, the diff between them is the recorded steps, already computed. Folding `Step[]` into a `SnapshotDiff` is a projection, cheaper than a full tree walk. This is also the representation a suggested edit uses (§7.2): a proposal *is* an op-log, so rendering it as an inline diff and computing its diff are the same projection.

### 3.6 No Suggestion Concept Exists; The Seam Is Reserved

A search for `suggest`/`track-change`/`pending`/`proposed`/`accept-change`/`tombstone` across `packages/editor/src` and `packages/reader/src` finds nothing. Suggested edits is net-new. But `docs/027 §9.7` reserved the seam precisely: *"a suggested edit and a human comment are both annotations on a range with a thread of discussion and a resolved/accepted state — the same shape the comment model already carries. So when Changes is designed, it should extend the annotation/thread model rather than introduce a parallel one, and the Review dock should hold it as another pane."* And `docs/006 §4.6` already has a `[Changes]` review slot, `§4.7` an AI output mode "propose review change." The product design anticipated this; the substrate is under-built, not mis-built.

### 3.7 The Attribution Substrate And Destructive Delete

Attribution is ready. Every character carries `{client, clock}`; `characterIdsForSlice` reads which client inserted a run (`model.ts:410`); `ClientId` is minted per allocator/store (`model.ts:694`, `allocator.clientId`). The `origin` field exists on every transaction and commit (`steps.ts:177,189`), threaded through dispatch (`editor-store.ts:338,1320`) and already filtered by the view (`react-view.tsx:449` reclaims focus only on local edits). Today only `"local"` is used; a non-local origin (`"suggested"`/an author id) is a value to thread through, not a mechanism to build.

Destructive delete is today's behavior, and it is the reason Model A is preferred. When text is deleted, the removed `TextSlice` (with its character ids) survives in the inverse step for undo (`steps.ts:53-60`, `editor-store.ts:1454`), but the live document drops those ids. `docs/014 §4` names tombstones (non-destructive delete) as "the one genuinely new cost," collected immediately in the single-user build. Model A never tombstones — the deleted content lives in the base branch, and the diff renders it struck. Model B needs tombstones (§4.13).

### 3.8 The Comment And Overlay Substrate The Review Reuses

The comment system is the review wrapper, and it is ~100% reusable:

- **Marks as references** (`core/model/marks.ts`, `model.ts:208-215`): `comment` is an identity mark carrying `attrs: { thread: threadId, snapshot? }`; the document stores only the anchor, the host owns the body.
- **The Comment Source SPI** (`view/spi/comment-source-registry.ts`): a host-provided `CommentSource` with `load/resolve/create/reply/update/remove/setResolved`, and a `Thread` shape carrying `id, excerpt, body, author, createdAt, updatedAt, resolved, replies`.
- **The side-panel dock** (`view/chrome/surfaces/side-panel-dock.tsx`, `view/spi/side-panel-registry.ts`): `registerSidePanel({ id, ... })` + `panelHost.open(paneId, focusId)`; a Changes pane registers here like the Comments pane.
- **The caret affordance** (`view/chrome/comment-affordance.tsx`): a chip anchored to a mark's rect that routes into the dock.
- **The derived index** (`core/bake/bake.ts:80-102`): `buildDocumentIndex` rolls up `CommentIndexEntry { id, node, kind, text, ref }` off-thread, published live.

The overlay authority supplies the anchored affordance (`docs/029`): the anchor-target spine (`view/spi/anchor-target.ts`) already has a `mark` anchor kind and a `point` kind, supports many simultaneous affordances with collision avoidance, and drives the focus-reclaim seam (`suspendReclaim`/`resumeReclaim`, `overlay-authority.ts:744`). Anchoring an accept/reject control to a change is either a small new `range` anchor kind or reuse of the `mark` anchor. Gutter/change-bar placement is a separate painted layer, outside the authority.

## 4. Architecture Decisions

### 4.1 D1 — Identity Diff, Not Text Diff

Recommended: match blocks by `NodeId` and characters by `CharacterId`. Do not run generic tree-edit-distance or a text LCS on the common path.

Identity is exact and O(n). A move is a node whose id is unchanged but whose position changed; a text edit is an id-set difference on a leaf; a heading retyped to a paragraph is the same id with a changed `type`. A text-alignment diff reports a moved paragraph as delete-plus-insert and a re-flowed sentence as scattered edits. The substrate exists (§3.2), so the accurate algorithm is also the simpler one.

Rejected — Myers/LCS on serialized text: loses identity, produces move-as-delete-plus-insert noise, cannot see mark or attr changes. Kept only as the cross-document fallback (§5.2). Rejected — Zhang-Shasha tree-edit-distance: O(n²) and unnecessary when nodes carry stable ids.

### 4.2 D2 — A Framework-Free Core `diffSnapshots`

Recommended: `diffSnapshots(base, target, options?): SnapshotDiff` in `packages/editor/src/core/diff/`, depending only on `core/model` (and `@quanghuy1242/idco-lib` guards). No DOM, no React, no store.

The diff is a model/format concern, like `toSnapshot`. Keeping it in core means the editor, the reader, a worker, and a headless caller share one function, unit-testable without a renderer, and keeps the display thin: it consumes a computed result.

Rejected — compute the diff inside the display: couples the algorithm to React, blocks reuse by the reader and headless callers, and makes it hard to test.

### 4.3 D3 — One Structured Result, Many Renderers

Recommended: `diffSnapshots` returns one `SnapshotDiff` (§5.1), JSON-serializable, read by every consumer (diff view, inline overlay, suggested-edits review, a text report, an out-of-process client per `docs/037`).

Separating "what changed" from "how it looks" lets the three surfaces share the engine, and the serializable shape crosses a process boundary unchanged.

### 4.4 D4 — Char-Level Diff By Character Id, Text-Alignment Fallback

Recommended: for a text leaf in both snapshots, expand both `content` slices to per-character id arrays and merge by id (§5.2). When they share no ids, fall back to a character-level LCS on the raw strings, flagged `alignment: "text"` on that leaf.

Id merge is exact and O(n) for shared lineage; the fallback keeps the function total for any input; the flag makes the degradation observable.

### 4.5 D5 — Move Detection By NodeId

Recommended: a node in both snapshots at a different `(parent, index)` is `moved`, not removed-plus-added. Identity makes moves free to detect and worth surfacing; it is the clearest advantage over a text diff.

Rejected — treat every position change as delete+add: throws away the identity signal and doubles the visual noise on any reorder.

### 4.6 D6 — Object Diff Through A Node-Definition Seam

Recommended: object nodes compare `status` then `data` with a shallow structural default, and an optional `diffData?(base, target): ObjectFieldChange[]` seam on `NodeDefinition` (`object-registry.ts:72`), mirroring `plainText`/`anchors`. Omitted → block-level `changed` with no field detail.

The core cannot interpret opaque object `data`, exactly as it cannot bake or serialize it without the definition. The seam keeps granularity owned by the object.

### 4.7 D7 — Display On The Reader L1, Not A New Renderer

Recommended: both display surfaces render through the reader L1 per-node functions (§3.4), wrapping results in status styling; they do not reimplement block/mark rendering. Reusing the reader means the diff shows the same pixels the reader shows plus decoration, inheriting editor↔reader parity (`docs/028`).

Rejected — a bespoke diff renderer: duplicates the L1, drifts from parity, re-solves mark nesting and list grouping.

### 4.8 D8 — Two Display Surfaces: Diff View And Inline Overlay

Recommended: ship both, on one engine (§6). The **diff view** is a dedicated surface comparing two saved versions; the **inline overlay** is a live in-editor layer reviewing a proposal against the current document. They are different *contexts* (a review page vs the editor), not different layouts; unified vs side-by-side is a layout choice *within* the diff view.

The inline overlay is the surface suggested edits needs: an agent proposes while you edit, and the change shows inline where it happens, not in a separate page. A dedicated diff view is right for version history where a full-page comparison fits. Building only the diff view (the earlier draft's position) leaves the suggested-edits scenario without a home; building only the inline overlay makes whole-document version comparison cramped. Both, sharing the decoration.

### 4.9 D9 — A Proposal Is An Attributed Op-Log Branch (Model A)

Recommended: a suggested edit is a **proposal** = `{ id, author, baseVersion, ops: Step[], status, threadId? }` (§7.2). The proposed document is `apply(baseVersion, ops)`; the inline diff is `diffSnapshots(currentDoc, proposedDoc)`; accept applies the ops, reject drops them. The proposal is stored as an **op-log**, not an opaque proposed snapshot and not inline document markup.

Op-log representation is the load-bearing choice (§7.7): it makes per-block accept a subset-apply, keeps proposals small, and makes the Model A→B migration a reuse rather than a rewrite because the ops transfer directly. It generalizes to text, structural, object, and move changes uniformly, and it needs no tombstones because deleted content lives in the base (§3.7).

Rejected — proposal as an opaque proposed snapshot: loses op granularity, forces whole-document accept, and makes Model B a rewrite. Rejected — Model B (inline tombstoned suggestions) first: needs tombstones and a rewrite of every text-read path before anything ships (§4.13).

### 4.10 D10 — Host-Owned Suggestion Source SPI

Recommended: proposals are host-owned through a `SuggestionSource` SPI (§7.3), a sibling of `CommentSource` (`docs/027 §4.2`). The host decides storage; the document is not polluted; the review derives from the diff. The proposal's discussion reuses a comment `Thread` via `threadId`.

Rejected — store proposals inside the document: pollutes the live model with pending state, breaks derive-don't-store, and makes a clean accepted document impossible to serialize without stripping.

### 4.11 D11 — Accept/Reject At Whole And Block Granularity

Recommended: the accept/reject unit is the whole proposal or a single block (a `BlockDiff`). Per-character-run accept is out of scope for the first cut. Display granularity is finer than accept granularity: the overlay still tints per-run insert/delete inside a changed block (§6.3); the user just cannot accept half a paragraph.

Per-run accept multiplies rebase complexity for little value; block-level ops rebase cleanly. This is the user's decision, recorded.

### 4.12 D12 — Separate The Change From The Conversation

Recommended: the change content is the op-log (D9); the discussion about it is a comment `Thread` (`threadId` on the proposal). Do not store `before/after` text in the thread.

`docs/027 §9.7` frames a suggested edit as "an annotation with a thread and an accepted state," which is right for the *wrapper* but silent on where the change lives. Storing before/after in a thread breaks the content-vs-metadata line (`docs/027 §2.1`) and cannot express a structural or multi-block change. Ops as content, thread as metadata.

### 4.13 D13 — Model B (Tombstones) Is The Concurrent Future

Recommended: reserve Model B (inline suggestions: insertions tagged pending, deletions kept as tombstones, many authors interleaved in one span) for the collaboration milestone. Model A covers one-proposer-at-a-time and several separate proposals; Model B is needed only for concurrent interleaving.

Model B's net-new — tombstones plus read-path filtering plus a convergence rule — is exactly the `docs/014 §7` Tier-1 CRDT work required for collaboration anyway, so it rides that milestone rather than being invented for suggestions (§7.7). Building it first would block every shippable suggestion behind tombstones.

## 5. The Diff Algorithm

### 5.1 Result Data Shapes

Defined in `core/diff/types.ts`:

```ts
export type BlockStatus = "unchanged" | "added" | "removed" | "moved" | "changed";

// A "moved" block may also be "changed"; carry both signals rather than collapsing.
export type BlockDiff = {
  readonly id: NodeId;
  readonly status: BlockStatus;
  readonly alsoChanged?: boolean;                 // true when a moved block also changed content
  readonly baseIndex: number | null;              // index in base parent's order (null if added)
  readonly targetIndex: number | null;            // index in target parent's order (null if removed)
  readonly baseParent: NodeId | null;
  readonly targetParent: NodeId | null;
  readonly node: EditorSnapshotNode;              // target node, or base node when removed
  readonly attrs?: AttrDiff;                       // changed/added/removed attr keys
  readonly text?: TextLeafDiff;                    // set for a changed text leaf
  readonly object?: ObjectDiff;                    // set for a changed object node
  readonly children?: readonly BlockDiff[];        // set for a structural container (recursive)
};

export type TextLeafDiff = {
  readonly alignment: "id" | "text";              // "text" = fell back to LCS (D4)
  readonly runs: readonly TextRunDiff[];           // covers the union, in target-then-deleted order
  readonly markChanges: readonly MarkChange[];
};
export type TextRunDiff = {
  readonly op: "keep" | "insert" | "delete";
  readonly text: string;
  readonly ids?: readonly CharacterId[];           // present on the "id" path
};

export type MarkChange = {
  readonly op: "added" | "removed" | "changed";
  readonly kind: TextMarkKind;
  readonly from: number;                           // offset in the target leaf (or base for removed)
  readonly to: number;
  readonly attrs?: JsonObject;
};

export type AttrDiff = {
  readonly added: Readonly<Record<string, JsonValue>>;
  readonly removed: Readonly<Record<string, JsonValue>>;
  readonly changed: Readonly<Record<string, { readonly base: JsonValue; readonly target: JsonValue }>>;
};

export type ObjectDiff = {
  readonly statusChanged: boolean;
  readonly fields?: readonly ObjectFieldChange[];  // from NodeDefinition.diffData, or shallow default
};
export type ObjectFieldChange = { readonly path: string; readonly base: JsonValue; readonly target: JsonValue };

export type CollectionDiff = {
  readonly key: string;                            // "glossary", "bibliography", …
  readonly added: readonly string[];               // item ids
  readonly removed: readonly string[];
  readonly changed: readonly string[];
};

export type SnapshotDiff = {
  readonly base: EditorDocumentSnapshot;
  readonly target: EditorDocumentSnapshot;
  readonly blocks: readonly BlockDiff[];           // top-level (body) diff, removed interleaved by base index
  readonly settingsChanged: boolean;
  readonly settingsDetail?: AttrDiff;
  readonly collections: readonly CollectionDiff[];
  readonly stats: { readonly added: number; readonly removed: number; readonly moved: number; readonly changed: number };
};
```

### 5.2 Text-Leaf Character Diff

`diffTextLeaf(base: TextLeafNode, target: TextLeafNode): TextLeafDiff` in `core/diff/text.ts`.

Id path (default, shared lineage):

1. Expand both slices with `characterIdsForSlice` (`model.ts:410`) into arrays of `{id, char}`.
2. Build a set of target id keys (`idKey(id) = `${id.client}:${id.clock}``).
3. Two-pointer merge over base and target arrays in document order: emit `keep` when the next base id equals the next target id; otherwise emit `delete` for base ids absent from the target set and `insert` for target ids absent from base, advancing the pointer whose id the other side resolves. Linear, because ids are unique and each side is already ordered.
4. Coalesce consecutive same-op characters into `TextRunDiff` runs.
5. If the base and target id sets are disjoint, discard and take the text fallback with `alignment: "text"`.

Text fallback (disjoint ids): a character-level LCS on the two `text` strings producing the same `keep/insert/delete` runs, `alignment: "text"`. Reuse an internal Myers implementation in `core/diff/lcs.ts`; no dependency.

An identical leaf returns a single `keep` run; the caller marks the block `unchanged` unless marks or attrs differ.

### 5.3 Mark Diff

`diffMarks(base: TextLeafNode, target: TextLeafNode): MarkChange[]` in `core/diff/marks.ts`.

Resolve both leaves' marks to concrete offsets with `resolveLeafMarks` (`core/model/marks.ts:49`). Marks carry a stable `id`, so match by `mark.id`: only in target is `added`, only in base is `removed`, in both with different `kind`/`attrs`/range is `changed`. Report offsets in the target coordinate space (base space for a `removed` mark). Identity marks (`link`, `comment`, `glossary`) compare `attrs`, so a changed link href reads as `changed`, not remove+add.

### 5.4 Block Sequence Diff And Move Detection

`diffScope(base, target, scope)` in `core/diff/tree.ts`, run first on the body (`order`) then recursively (§5.5).

1. Compute base and target child-id lists (`body.order` for the body; `node.children` for a container).
2. `baseIds = Set(base)`, `targetIds = Set(target)`.
3. Classify each id in the union: target-only → `added`; base-only → `removed`; both → compare payloads (§5.5/§5.6) for `unchanged` vs `changed`, and compare `(parent, index)` for `moved`. A block can be both (`status:"moved"`, `alsoChanged:true`).
4. Emit `BlockDiff[]` ordered by target index, `removed` interleaved at base index. `baseIndex`/`targetIndex`/`baseParent`/`targetParent` drive move arrows and gutters.

Parent/index come from one pre-pass per snapshot: walk `order` + `children` once to build `Map<NodeId, {parent, index}>` (the `ParentEntry` shape, `model.ts:285`), making move detection O(1) per node.

### 5.5 Structural Recursion

A matched structural node recurses `diffScope` on its `children`. The container's `BlockDiff` is `changed` when its `attrs` differ or any descendant is non-`unchanged`; otherwise `unchanged`. `children` on the `BlockDiff` holds the child diffs. This marks a single edited table cell or a single added callout child, not the whole container. A matched id whose `kind` changed (a text leaf became an object) is `changed` with both nodes on `base`/`target`; the display renders removed-old over added-new.

### 5.6 Object, Settings, And Collection Diff

Objects (`diffObject` in `core/diff/object.ts`): compare `status`, then `data`. If `NodeDefinition.diffData` exists (D6), call it for field-level `ObjectFieldChange[]`; else shallow-compare `data` per top-level key and report `changed` with no detail when unequal. `baked` is derived from `data`, so a baked-only difference with equal `data` is `unchanged` (a re-bake).

Settings: `diffAttrs(base.settings, target.settings)` sets `settingsChanged` and `settingsDetail`. Collections: for each key in the union, diff item arrays by `item.id` (`CollectionItem` always has `id`, `model.ts:302`): added/removed/changed (changed = same id, different body).

## 6. The Display Surfaces

Both surfaces render the same `SnapshotDiff` on the reader L1 (D7), sharing one decoration layer (§6.3). They differ in context and layout, not in the diff.

### 6.1 The Diff View (Dedicated Review)

`DiffView` compares two saved versions on a dedicated surface. Ships in `packages/reader/src/diff/**` (render core stays in the reader; interactive chrome may live in a `@idco/ui` wrapper).

Layout modes (a `mode` prop):

- **Unified** — one column, blocks in target order with `removed` interleaved, tinted by status. The default.
- **Side-by-side** — two columns (base | target), matched blocks aligned by `baseIndex`/`targetIndex`, moves drawn with a connector. Better for large structural change.

Document-history review is the first host: fetch two snapshots, call `diffSnapshots`, render `<DiffView mode="unified" diff={...} />` with a version picker; `stats` drives a header summary ("+12 −3, 2 moved").

### 6.2 The Inline Diff Overlay (Live In-Editor)

The inline overlay reviews a proposal against the *current* document, in place, while editing. Its input is `diffSnapshots(currentDoc, proposedDoc)` where `proposedDoc = apply(currentDoc-or-baseVersion, proposal.ops)` (§7). It renders over the live editor content, not a separate page: changed text shows insert/delete tinting inline, added/removed blocks show in flow, and each change carries an anchored accept/reject affordance (§7.5) and, optionally, a comment thread.

The overlay is not a second editor. The authoritative document stays the live store; the overlay is a derived decoration layer plus anchored controls, mounted through the same portal seam the selection overlay uses (`react-view.tsx:497`) and anchored through the overlay authority (§3.8). A degenerate case with no attribution and no accept/reject — "show changes since my last save" — is `diffSnapshots(lastSaved, current)` rendered read-only; the suggested-edits case adds attribution, a proposal source, and the accept/reject controls on top of the same overlay.

### 6.3 Shared Decoration

One per-status decoration, used by both surfaces, wrapping the L1 result:

- `unchanged`: `renderBlock(node)` as-is.
- `added`: `renderBlock(target node)` in an added-tint wrapper (`data-rt-diff="added"`).
- `removed`: `renderBlock(base node)` in a removed-tint wrapper.
- `moved`: `renderBlock(target node)` with a moved marker and, side-by-side, a connector; if `alsoChanged`, also the changed decoration.
- `changed` text leaf: render the leaf but replace its text pass with a `TextRunDiff`-aware pass — `insert` tinted/underlined, `delete` tinted/struck, `keep` plain — reusing `segmentText`+`wrapMark` for surviving marks and overlaying `markChanges`.
- `changed` object: `renderBlock` plus a field-change summary from `ObjectDiff.fields`.
- `changed` structural: recurse `children`, so only changed descendants carry decoration.

Styling uses the `.rt-*` token contract plus new `.rt-diff-*` classes, shipped in the reader stylesheet (the `docs/028` mechanism). No raw color literals; tokens only, so themes apply.

## 7. Suggested Edits / Track-Changes

An author proposes a change; you review it inline; you accept or reject it. The author is an agent (`docs/037`) or another human. The engine is the diff (§5); the surface is the inline overlay (§6.2); the wrapper is the comment/overlay substrate (§3.8).

### 7.1 The Two Models, And Why A First

**Model A — proposal as an op-log branch (ship now).** The proposal lives outside the document as an attributed op-log; the inline overlay is the derived diff; accept applies the ops, reject drops them. No tombstones (deleted content lives in the base), no document pollution, generalizes to all change types, reuses the diff engine wholesale.

**Model B — inline tombstones (concurrent future).** One document with insertions tagged pending and deletions kept as struck tombstones, many authors interleaved in a single span. Needed only for concurrent multi-author suggesting. Requires tombstones plus read-path filtering plus a convergence rule (§4.13).

Ship A. It covers one-proposer-at-a-time and several separate proposals (the agent's branch and human B's branch coexist as distinct reviewable proposals), which is the 6–12 month scope. B is the collaboration-era upgrade and shares A's review wrapper and attribution; only the storage of the pending change differs (§7.7).

### 7.2 A Proposal Is An Attributed Op-Log

```ts
export type Proposal = {
  readonly id: string;
  readonly author: ProposalAuthor;              // agent id, or a human user id
  readonly createdAt: string;
  readonly baseVersion: string;                  // the document version the ops were computed against
  readonly ops: readonly Step[];                 // the change, in the model's own step algebra
  readonly status: "pending" | "accepted" | "rejected";
  readonly threadId?: string;                    // a comment Thread for discussion (§7.6)
};
export type ProposalAuthor = { readonly kind: "agent" | "human"; readonly id: string; readonly label: string };
```

The proposed document is `applyOps(baseSnapshot, ops)`; the inline diff is `diffSnapshots(currentDoc, proposedDoc)`. Steps are the model's own algebra (`steps.ts:160`), so a proposal expresses text edits, mark changes, block insert/remove/move, object edits, and settings/collection changes with no new vocabulary. Storing ops (not a proposed snapshot) is what makes per-block accept a subset-apply and Model B a reuse (§7.7).

### 7.3 The Suggestion Source SPI And Rebase

Proposals are host-owned, a sibling of `CommentSource`:

```ts
export type SuggestionSource = {
  readonly id: string;
  load(docId: string, signal: AbortSignal): Promise<readonly Proposal[]>;
  create(proposal: Omit<Proposal, "id" | "status">): Promise<Proposal>;
  accept(proposalId: string): Promise<void>;    // host records outcome; the editor applies ops locally
  reject(proposalId: string): Promise<void>;
  update(proposalId: string, ops: readonly Step[]): Promise<void>;
  subscribe(docId: string, onChange: () => void): () => void;
};
```

The host owns storage and lifecycle (a DB, a per-session queue, an async agent's output). The document carries at most an anchor; the change is the op-log the source holds. The Review dock gains a Changes pane registered like the Comments pane (`registerSidePanel({ id: "changes", ... })`), reading proposals filtered to this document.

Rebase: a proposal's ops are anchored to `baseVersion`. If the reviewer has edited since, the base moved. Whole-proposal *display* is robust — `diffSnapshots(current, applyOps(baseVersion, ops))` is a valid diff regardless of drift, so the change always renders. Whole-proposal or per-block *accept* against a moved base needs rebase (`mapStep`, `docs/014 §7`, `docs/011 §6.3` reserves the hook). First cut: when `baseVersion ≠ currentVersion`, mark the proposal "based on an older version" and rebase its ops through the intervening commits before applying; if a rebase conflict makes an op inapplicable, surface it rather than applying silently.

### 7.4 Attribution

Attribution is mostly free (§3.7). Every character the author inserts already carries their `ClientId`; every proposal transaction carries `origin` and the `author` on the `Proposal`. Net-new: accept a non-`"local"` origin on dispatch (`origin: "suggested"` while previewing), and map `ClientId`/`author` to a display name (an agent label, a human name) for the inline attribution and the Changes pane. The author drives the tint hue and the "proposed by" label; the diff's `TextRunDiff.ids` already tells you which client inserted each run.

### 7.5 Accept And Reject

Accept and reject operate on the proposal's ops at whole or block granularity (D11):

- **Accept whole:** apply all `ops` to the live store (rebased if the base moved, §7.3), set `status:"accepted"` via the source, drop the overlay for that proposal.
- **Reject whole:** set `status:"rejected"`, drop the overlay; the ops are never applied.
- **Accept block:** apply the subset of `ops` whose target is that block (`BlockDiff.id`); the rest of the proposal stays pending. This is why ops, not a proposed snapshot, are the representation.
- **Reject block:** drop that block's ops from the proposal (`source.update` with the reduced set); the rest stays pending.

The affordance is an anchored control (accept ✓ / reject ✗, and open-thread) rendered by the overlay authority, anchored to the change's range (a new `range` anchor kind, or the `mark` anchor if the change carries a marker, §3.8). It is a `taking`-focus surface so a click does not tear editor focus (the focus-reclaim seam). Many changes show many affordances at once; the authority's collision avoidance positions them.

### 7.6 The Reuse Map

| Layer | Reuses | Net-new |
| --- | --- | --- |
| What changed (engine) | §5 `diffSnapshots` | Nothing — the overlay is the diff rendered live |
| Where the proposal lives | The store's dispatch chokepoint + `recordHistory:false` | The op-log branch + `SuggestionSource` (§7.3) |
| Who proposed | `CharacterId.client` + `origin` | Non-`"local"` origin, author→label mapping (§7.4) |
| Discuss / accept-state / dock pane | Comment `Thread` + `CommentSource` + side-panel dock + derived index (§3.8) | `resolved` → `status: pending\|accepted\|rejected`; a Changes pane |
| Accept/reject affordance | Overlay authority: `mark` anchor, many-at-once, focus seam (§3.8) | A `range` anchor kind (~2–3 files) or a per-change marker |

The change content is the op-log (D9/D12); the conversation is a comment `Thread` (`threadId`). Do not store before/after in the thread.

### 7.7 Model A → Model B Migration Cost

A and B share three of four layers, *if* A stores proposals as op-logs (D9):

- **Shared — attribution** (`origin` + `CharacterId.client`), ready today.
- **Shared — the review wrapper** (threads, dock, affordance, accept/reject UX), built once in A, origin-agnostic.
- **Shared — the ops.** A's `Step[]` are the suggestion; B applies the same ops to the live doc but tagged pending, with deletions tombstoned instead of committed.
- **B-only, net-new:** tombstones (non-destructive delete plus read-path filtering in render/search/copy/export) and a concurrent convergence rule when two suggestions touch one span.

Those B-only pieces are the `docs/014 §7` Tier-1 CRDT work required for collaboration regardless. So B is not "suggestions v2"; it is the collaboration milestone, and suggestions inherit it there. If A instead stored opaque proposed snapshots, op granularity is lost and B is closer to a rewrite. Op-log representation is therefore the forward-compatible decision, and it is also better for A itself (per-block accept, smaller proposals).

### 7.8 Suggest-First As The Collaboration On-Ramp

Suggested edits is async, review-gated collaboration: edits held out of the authoritative document until a human accepts. Real-time collaboration is the same machinery with auto-accept and live convergence. Building suggestions now exercises attributed op-logs, accept/reject, and (at B) tombstones and rebase — most of what collaboration needs — but in a single-user-authoritative context with no real-time convergence pressure. When collaboration is built (6–12 months out per the current lean), the awareness/transport/convergence layer lands on machinery that already works. This is the `docs/014 §8` promise made concrete: the addressing is already forever-committed, the behavior arrives incrementally.

## 8. Edge Cases And Failure Modes

- **Disjoint character-id lineage.** Two unrelated documents, or a leaf deleted and retyped, share no ids. Mitigation: the D4 text-alignment fallback (`alignment:"text"`), so the leaf still diffs and the display can badge it as heuristic.
- **Id collision across independent clients (should not happen).** `CharacterId` is `{client, clock}`; documents that never shared a client cannot collide. Mitigation: the merge verifies `char` equality on a `keep` and downgrades that leaf to the text fallback on mismatch, with a dev-flag assertion.
- **Large documents.** The diff is O(nodes + characters). Mitigation: keep it off the keystroke path; for adjacent saves prefer the op-log fast path (§3.5). A multi-megabyte synchronous diff blocks a frame; the inline overlay diffs only the proposal's touched region in practice, since `ops` name the affected blocks.
- **Move plus edit.** Mitigation: `status:"moved"`, `alsoChanged:true`; both decorations.
- **Structural type change of a matched id.** Mitigation: `changed` with both nodes; render removed-old over added-new.
- **Object with no `diffData` seam.** Mitigation: shallow `data` compare marks it `changed` at block granularity; never a silent "unchanged" when `data` differs.
- **Baked-only difference.** Equal `data`, different `baked`. Mitigation: `unchanged` (§5.6); a re-highlight is not a content change.
- **Proposal against a moved base.** The reviewer edited after the proposal was made. Mitigation: display is robust (re-diff); accept rebases the ops through intervening commits and surfaces an inapplicable op rather than applying silently (§7.3).
- **Proposal targeting a block the reviewer deleted.** The op's target no longer exists. Mitigation: rebase drops or flags that op; the affordance shows "no longer applies," and the proposal is partially acceptable (the remaining blocks still apply).
- **Two proposals touching the same block (Model A).** Both render as separate proposals; accepting one rebases the other. If the second becomes inapplicable, it is flagged. Concurrent *interleaving* in one span is out of scope until Model B.
- **Orphaned proposal / stale thread.** A proposal whose ops all became inapplicable, or a thread whose anchor collapsed. Mitigation: keep-and-flag (the comment orphan pattern, `docs/027`), never silent-drop; the Changes pane surfaces it for manual dismissal.
- **Tombstone-less deletion display (Model A).** A proposed deletion has no tombstone in the live doc; the struck content comes from the base branch. Mitigation: the overlay reads deleted runs from `diffSnapshots`' base side (`TextRunDiff` `op:"delete"`), so no live-model tombstone is needed.
- **Two-view drift with the reader.** Mitigation: both surfaces reuse the reader L1; a parity test asserts an `unchanged` block renders identically to the plain reader render (§11).

## 9. Implementation Backlog

Phased, reviewable, tested. Diff core is R6-A…H; display and suggested edits are R6-I…N.

### R6-A. Diff Types And Scaffolding

Scope: `core/diff/types.ts`, `core/diff/index.ts`.
Tasks:

- [ ] Define `SnapshotDiff`, `BlockDiff`, `TextLeafDiff`, `TextRunDiff`, `MarkChange`, `AttrDiff`, `ObjectDiff`, `CollectionDiff` (§5.1).
- [ ] Export the barrel from `core/index.ts` with `@category` doc comments.

Acceptance: types compile and export; `pnpm check:docs` passes. Tests: `pnpm typecheck`.

### R6-B. Parent-Map And Attr/Settings Primitives

Scope: `core/diff/tree.ts`, `core/diff/attrs.ts`.
Tasks:

- [ ] `buildParentIndex(snapshot): Map<NodeId, ParentEntry>`.
- [ ] `diffAttrs(base, target): AttrDiff` for node attrs and settings.

Acceptance: parent index resolves every reachable node; orphan ids ignored; `diffAttrs` reports add/remove/change with values. Tests: `tests/editor/engine-diff-primitives.test.ts`.

### R6-C. Text And Mark Diff

Scope: `core/diff/text.ts`, `core/diff/marks.ts`, `core/diff/lcs.ts`, export `segmentText`/`wrapMark` helpers from `core/model/marks.ts` for the display.
Tasks:

- [ ] `diffTextLeaf` id-path merge with run coalescing (§5.2).
- [ ] Disjoint-id text-alignment fallback (`lcs.ts`) setting `alignment:"text"`.
- [ ] `diffMarks` by `mark.id` with identity-mark attr compare (§5.3).

Acceptance: an inserted word → `keep/insert/keep`, `alignment:"id"`, correct ids; a moved sentence → minimal insert/delete; a retyped leaf → `alignment:"text"`; a bolded range → one `MarkChange added`; a changed link href → `changed`. Tests: `engine-diff-text.test.ts`, `engine-diff-marks.test.ts`.

### R6-D. Block Sequence, Move, Structural Recursion

Scope: `core/diff/tree.ts`.
Tasks:

- [ ] `diffScope` classify with interleaved removed (§5.4).
- [ ] Recurse structural children; container `changed` on attr or descendant change (§5.5).
- [ ] Move detection via parent maps; `moved` + `alsoChanged`.
- [ ] Type-change handling for a matched id whose `kind` changed.

Acceptance: reorder → both `moved`; edited cell → table `changed` with only that cell `changed`; block added in callout → callout `changed`, one `added` child. Tests: `engine-diff-tree.test.ts`.

### R6-E. Object, Collection, Assembly

Scope: `core/diff/object.ts`, `core/diff/diff-snapshots.ts`, `object-registry.ts` (`diffData` seam).
Tasks:

- [ ] `diffObject` shallow default + `NodeDefinition.diffData` (§5.6, D6).
- [ ] Collection diff by `item.id`.
- [ ] `diffSnapshots(base, target, options?)` assembling body + settings + collections + `stats`.

Acceptance: identical snapshots → all-`unchanged`, `stats` zero; `diffData` object → field changes; no-seam object → block `changed` on any `data` diff; baked-only → `unchanged`. Tests: `engine-diff-object.test.ts`, `engine-diff-snapshots.test.ts` (apply commands, `toSnapshot`, diff, assert against known edits).

### R6-F. The Diff View

Scope: `packages/reader/src/diff/diff-view.tsx`, `diff/index.ts`, reader stylesheet `.rt-diff-*`.
Tasks:

- [ ] Unified mode wrapping `renderBlock` per status; changed-leaf run + mark decoration reusing `segmentText`/`wrapMark`.
- [ ] Side-by-side mode with alignment and move connectors.
- [ ] `stats` header.

Acceptance: every status renders with correct decoration, tokens only; an `unchanged` block renders identically to the plain reader render. Tests: `tests/reader/diff-view.test.tsx` + the parity assertion.

### R6-G. Document-History Review Host

Scope: consumer-side (content-api), after an idco republish exposes `diffSnapshots` + `DiffView`.
Tasks: version picker, fetch two snapshots, `diffSnapshots`, `<DiffView>`. Acceptance: two versions show the diff with the stats header. Tests: consumer e2e.

### R6-H. Public API Map + Docs

Scope: `packages/editor/api/**`, `packages/reader/api/**` (regenerated). Acceptance: `pnpm check` green with `diffSnapshots`, `SnapshotDiff`, `DiffView` documented. Tests: `pnpm check`.

### R6-I. The Inline Diff Overlay

Scope: `packages/editor/src/view/overlays/inline-diff-overlay.tsx` (or a reader-diff import mounted in the editor), reusing the §6.3 decoration and the portal seam (`react-view.tsx:497`).
Tasks:

- [ ] Render `diffSnapshots(current, proposed)` over the live content, per-status decoration in place.
- [ ] "Changes since last save" read-only mode (`diffSnapshots(lastSaved, current)`).

Acceptance: a proposed change shows inline with correct tinting; the read-only mode shows uncommitted changes; the authoritative store is untouched. Tests: `tests/editor/engine-inline-diff.test.ts` + an e2e that applies a proposal and asserts inline decoration.

### R6-J. Proposal Model + Apply/Rebase

Scope: `core/diff/proposal.ts` (or `core/suggestions/`), `core/model/mapping.ts` (rebase reuse).
Tasks:

- [ ] `Proposal` type (§7.2); `applyProposal(store, proposal)` and `applyProposalBlock(store, proposal, blockId)`.
- [ ] Rebase ops through intervening commits when `baseVersion ≠ current` (`mapStep`); flag inapplicable ops.

Acceptance: applying a whole proposal reproduces the proposed snapshot; applying one block applies only that block's ops; a proposal against a moved base rebases or flags. Tests: `engine-proposal-apply.test.ts`.

### R6-K. Suggestion Source SPI + Changes Pane

Scope: `view/spi/suggestion-source-registry.ts`, `view/chrome/panes/changes.ts`, `changes-pane.tsx`.
Tasks:

- [ ] `SuggestionSource` SPI (§7.3), sibling of `comment-source-registry.ts`.
- [ ] Changes pane in the Review dock reading proposals; unresolved/accepted/rejected grouping.

Acceptance: a host-provided source populates the pane; accept/reject calls the source and updates status. Tests: `tests/editor/engine-suggestion-source.test.ts`.

### R6-L. Accept/Reject Affordance + Range Anchor

Scope: `view/spi/anchor-target.ts` (add `range`), `view/overlays/overlay-anchor.ts` (resolve `range` via `boundingRectOf`), `view/chrome/change-affordance.tsx`.
Tasks:

- [ ] `range` anchor kind + resolver, or reuse `mark` anchor for a per-change marker.
- [ ] Accept/reject/open-thread affordance as a `taking`-focus surface; many-at-once.

Acceptance: each change shows an anchored accept/reject control; clicking does not tear editor focus; multiple affordances coexist without overlap. Tests: `tests/editor/engine-change-affordance.spec.ts` (e2e).

### R6-M. Attribution Wiring

Scope: `core/store/editor-store.ts` (accept non-`"local"` origin on a preview dispatch), `view` author→label mapping.
Tasks:

- [ ] Thread `origin: "suggested"` and an author through the proposal-preview dispatch.
- [ ] Map `ClientId`/author to a display label; drive tint hue.

Acceptance: a proposal renders attributed to its author; per-run insert ids resolve to the author. Tests: `engine-suggestion-attribution.test.ts`.

### R6-N. Public API Map + Docs (Suggestions)

Scope: regenerate API maps for `Proposal`, `SuggestionSource`, the overlay, the range anchor. Acceptance: `pnpm check` green. Tests: `pnpm check`.

## 10. Future Backlog

- **Model B — inline tombstoned suggestions.** Concurrent multi-author suggesting in one span: a tombstone flag on `CharacterRun`, read-path filtering, a convergence rule. Rides the collaboration milestone (§4.13, §7.7).
- **Per-run accept.** Accept/reject a single character run inside a block. Deferred (D11); needs finer rebase.
- **Op-log warm path.** Project persisted adjacent-save `Step[]` into a `SnapshotDiff` without a full walk (§3.5).
- **Word/sentence grouping.** Group `TextRunDiff` runs into word/sentence changes for a calmer display. Display-layer post-processing.
- **Real-time collaboration.** Live convergence, awareness, multi-peer GC (`docs/013`/`docs/014`); suggested edits is the on-ramp (§7.8).

## 11. Definition Of Done

- `diffSnapshots(base, target)` ships in `core/diff/**`, framework-free, returning `SnapshotDiff` (§5.1), R6-A…E green.
- Identity path proven: an edit made through commands, captured as two snapshots, diffs back to exactly that edit (the parity oracle `engine-diff-snapshots.test.ts`), including insert/delete text, mark add/remove, block add/remove, reorder-as-move, nested-container edits. Fallback proven: a retyped leaf reports `alignment:"text"`.
- The diff view (R6-F) and the inline overlay (R6-I) render every status on the reader L1; an `unchanged` block renders identically to the plain reader render (the parity assertion extending `docs/028`).
- Suggested edits (Model A) ships end to end: a `Proposal` applies whole and per-block (R6-J), the `SuggestionSource` + Changes pane drive lifecycle (R6-K), accept/reject affordances anchor and do not tear focus (R6-L), and changes render attributed (R6-M). Rebase against a moved base applies or flags, never silently mis-applies.
- No product/runtime dependency entered `packages/editor` or `packages/reader`; the architecture lint stays green.
- `pnpm check` green (format, lint, dup, typecheck, tests, build, `check:docs`, `check:package`); API maps regenerated with the new public symbols documented.

## 12. Final Model

A diff between two versions of an idco document is an identity problem the model already has the keys for: match blocks by `NodeId`, characters by `CharacterId`, marks by `mark.id`, and every change reads as what it is, not the delete-plus-insert noise a text diff produces. `diffSnapshots` is one pure core function returning one structured result; a dedicated diff view and a live inline overlay both decorate the reader's L1 render with it, inheriting reader↔editor parity instead of re-deriving it. Suggested edits rides on that engine without touching the authoritative document: a proposal is an attributed op-log branch, the inline overlay is the derived diff, accept applies the ops and reject drops them, at whole-proposal or per-block granularity. The change content is ops; the conversation is a comment thread; the affordance is an anchored overlay control; the persistence is a host-owned Suggestion Source — three substrates the editor already has, plus a small range anchor and a Changes pane. Because a proposal is ops, per-block accept is a subset-apply and the eventual Model B (inline tombstones for concurrent multi-author suggesting) is a reuse of the same ops and the same review wrapper, riding the collaboration milestone that has to build tombstones anyway. Suggested edits is async, review-gated collaboration, so building it now is the low-risk on-ramp to the real-time version later, exactly as the identity-addressed model was shaped to allow. The producer of proposals — an in-editor AI action or an external agent — is `docs/037`; this document is where their changes land, are seen, and are accepted or rejected.
