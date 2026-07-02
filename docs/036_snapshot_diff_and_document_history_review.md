# 036 — Snapshot Diff, Inline Review, And Suggested Edits

> Status: implementation-grade research and proposal
>
> Date: 2026-07-01
>
> Update (2026-07-02): R6-A..I have shipped (the diff engine, the diff view, change-detail rendering §6.4, and the live change indicator §6.2.1). The genuinely **woven inline diff overlay** and the Model-A suggested-edits system that rides it (the single **R6-J phase**, §9) now have a full, adversarially-reviewed design system in [`docs/038_woven-overlay-design.md`](038_woven-overlay-design.md), which is the source of truth for the woven surface. Where this document's woven-overlay mechanics have been superseded — the ghost render path, the accept/reject affordance, conflict routing, save exclusion, in-review undo, and the offset-model deferral — the inline notes below point to `038`. This document remains the source of truth for the diff **engine** (§5) and the diff **view** (§6.1, §6.3, §6.4).
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
> - `docs/038_woven-overlay-design.md` — the full design system for the **woven inline diff overlay** (built as the single R6-J phase, §9) and its 037 option-A integration. Supersedes this document's woven-overlay mechanics (§4.14, §4.16, §6.2, §6.2.1, §7.3, §7.5, §8); the diff engine and diff view here stand.
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
  - [4.14 D14 — The Inline Overlay Mounts The Proposed Side And Ghosts Removals](#414-d14--the-inline-overlay-mounts-the-proposed-side-and-ghosts-removals)
  - [4.15 D15 — Proposals Are Identity-Anchored; A Document Revision Signals Staleness](#415-d15--proposals-are-identity-anchored-a-document-revision-signals-staleness)
  - [4.16 D16 — Inline Review Scales By Region, With A Diff-View Fallback](#416-d16--inline-review-scales-by-region-with-a-diff-view-fallback)
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
  - [7.3 The Suggestion Source SPI And Applying A Proposal](#73-the-suggestion-source-spi-and-applying-a-proposal)
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
- [13. Resolved Design Questions](#13-resolved-design-questions)

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
  readonly version: 1;                                                  // schema version (a literal), NOT a document revision
  readonly revision?: number;                                          // D15: monotonic document revision, bumped per commit; added additively
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

Attribution is ready. Every character carries `{client, clock}`; `characterIdsForSlice` reads which client inserted a run (`model.ts:410`); `ClientId` is minted per allocator/store (`model.ts:694`, `allocator.clientId`). The `origin` field exists on every transaction and commit (`steps.ts:177,189`), threaded through dispatch (`editor-store.ts:338,1320`) and already filtered by the view (`react-view.tsx:449` reclaims focus only on local edits). Today only `"local"` is used; a non-local origin (`"suggested"`/an author id) is a value to thread through, not a mechanism to build. There is also **no persistent document revision** today: `snapshot.version` is a schema version (the literal `1`) and the handle's `revision` is an in-memory dirty counter that resets per session (`editor-handle.ts:85`) — D15 adds a persisted monotonic revision so a proposal can name the version it was made against.

Destructive delete is today's behavior, and it is the reason Model A is preferred. When text is deleted, the removed `TextSlice` (with its character ids) survives in the inverse step for undo (`steps.ts:53-60`, `editor-store.ts:1454`), but the live document drops those ids. `docs/014 §4` names tombstones (non-destructive delete) as "the one genuinely new cost," collected immediately in the single-user build. Model A never tombstones — the deleted content lives in the base branch, and the diff renders it struck. Model B needs tombstones (§4.13).

### 3.8 The Comment And Overlay Substrate The Review Reuses

The comment system is the review wrapper, and it is ~100% reusable:

- **Marks as references** (`core/model/marks.ts`, `model.ts:208-215`): `comment` is an identity mark carrying `attrs: { thread: threadId, snapshot? }`; the document stores only the anchor, the host owns the body.
- **The Comment Source SPI** (`view/spi/comment-source-registry.ts`): a host-provided `CommentSource` with `load/resolve/create/reply/update/remove/setResolved`, and a `Thread` shape carrying `id, excerpt, body, author, createdAt, updatedAt, resolved, replies`.
- **The side-panel dock** (`view/chrome/surfaces/side-panel-dock.tsx`, `view/spi/side-panel-registry.ts`): `registerSidePanel({ id, ... })` + `panelHost.open(paneId, focusId)`; a Changes pane registers here like the Comments pane.
- **The caret affordance** (`view/chrome/comment-affordance.tsx`): a chip anchored to a mark's rect that routes into the dock.
- **The derived index** (`core/bake/bake.ts:80-102`): `buildDocumentIndex` rolls up `CommentIndexEntry { id, node, kind, text, ref }` off-thread, published live.

The overlay authority supplies the anchored affordance (`docs/029`): the anchor-target spine (`view/spi/anchor-target.ts`) already has a `block` anchor kind, a `mark` anchor, and a `point` kind, supports many simultaneous affordances with collision avoidance, and drives the focus-reclaim seam (`suspendReclaim`/`resumeReclaim`, `overlay-authority.ts:744`). The accept/reject control reuses the existing `block` anchor — accept is block-granular (D11), so the control sits at the changed block and **no new anchor kind is needed** (§7.5). The change-bar is not a separate layer either: it is a CSS left-border on the block's diff wrapper (§6.3), so it moves and virtualizes with the block.

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

Per-run accept multiplies conflict-resolution complexity for little value; block-level ops resolve cleanly. This is the user's decision, recorded.

### 4.12 D12 — Separate The Change From The Conversation

Recommended: the change content is the op-log (D9); the discussion about it is a comment `Thread` (`threadId` on the proposal). Do not store `before/after` text in the thread.

`docs/027 §9.7` frames a suggested edit as "an annotation with a thread and an accepted state," which is right for the *wrapper* but silent on where the change lives. Storing before/after in a thread breaks the content-vs-metadata line (`docs/027 §2.1`) and cannot express a structural or multi-block change. Ops as content, thread as metadata.

### 4.13 D13 — Model B (Tombstones) Is The Concurrent Future

Recommended: reserve Model B (inline suggestions: insertions tagged pending, deletions kept as tombstones, many authors interleaved in one span) for the collaboration milestone. Model A covers one-proposer-at-a-time and several separate proposals; Model B is needed only for concurrent interleaving.

Model B's net-new — tombstones plus read-path filtering plus a convergence rule — is exactly the `docs/014 §7` Tier-1 CRDT work required for collaboration anyway, so it rides that milestone rather than being invented for suggestions (§7.7). Building it first would block every shippable suggestion behind tombstones.

### 4.14 D14 — The Inline Overlay Mounts The Proposed Side And Ghosts Removals

Recommended: while reviewing a proposal, the live editable surface is the **proposed** document, not the base. Apply the proposal's ops to the live store optimistically (`recordHistory: false`, `origin: "suggested"`), so the new content — an added callout, an inserted phrase — is a real, editable node the reviewer can tweak before accepting. The **removed** content (a deleted table, struck text) is not in the proposed store; it renders as a non-editable **ghost** from the diff's base-side node, positioned by `baseIndex`. Accept clears the `suggested` tag and keeps the ops; reject reverts them (a clean inverse, since they were `recordHistory: false`) and drops the ghosts.

This follows from the rule "new content is editable, old content is not": editable new content must be real mounted nodes, which forces the live surface to be the proposed side. The mirror holds for the "changes since my last save" mode — there the live store already *is* the newer side (current), and the removed-since-save content is the ghost, with no optimistic apply. So the general rule is: **the inline overlay mounts the newer side and ghosts the removals from the older side**, and the diff derives the decoration — no suggestion tags baked into the model.

Two bounded caveats. Save safety: the store transiently holds un-accepted content, so a save excludes `origin: "suggested"` ops (or warns/blocks) while a proposal is pending — the tag is the filter. Ghost positioning: a removed block's ghost has no offset-model height, so the affected span renders as a bounded, non-virtualized **review band** (§6.2) rather than injecting phantoms into the virtualized flow.

Rejected — mount the base and ghost the *additions*: the new content is then a non-editable ghost, violating "new is editable" and making it impossible to tweak a suggestion. Rejected — bake per-node suggestion tags into the model (a partial Model B): a model change we do not need, since the diff already tells the view what is inserted vs removed; deriving the decoration keeps the model clean (D9/D12).

### 4.15 D15 — Proposals Are Identity-Anchored; A Document Revision Signals Staleness

Recommended: a proposal's ops carry **identity anchors** (node ids, and character ids at text boundaries via the existing `TextAnchor`), so applying a proposal to a document that moved since it was made is a **merge by identity**, not an offset rebase. Non-overlapping intervening edits do not affect the proposal (the anchors still resolve); an op whose target node or character id was deleted by an intervening edit is a **conflict**, surfaced rather than applied silently. This is the CRDT-native behavior the model was shaped for (`docs/014 §2-§3`): positions are identity, not offset, so "the reviewer typed elsewhere" never disturbs a pending proposal, and only a genuine overlap conflicts. It also resolves the "rebase needs the intervening op-log" worry — there is no log to replay.

Separately, add a persisted **document revision**: a monotonic integer on the snapshot (`revision`, §3.3), incremented per committed transaction, because none exists today (§3.7). `Proposal.baseVersion` is that revision. It is not a rebase key (identity anchoring handles apply); it *detects and labels staleness* ("made against revision N, the document is now N+7") and orders proposals. The revision generalizes to a CRDT state vector under collaboration (`docs/013` "state-vector diffs"); a single integer is its single-user form. It is added additively (optional, defaulting to 0 on a legacy snapshot), so stored documents keep round-tripping.

Rejected — offset rebase through the intervening op-log (`mapStep` over every commit between `baseVersion` and now): it needs the full log retained, but the history pool is byte-capped (`docs/030` SLP-4) and may not hold it, and it re-solves under offsets exactly the drift the identity substrate exists to eliminate. Rejected — a content hash as the version id: it gives identity but not ordering or staleness distance, and hashing a large snapshot per save is wasted work when a counter is O(1). Rejected — no revision at all: the diff still renders, but the reviewer cannot be told a proposal is stale and two proposals cannot be ordered.

### 4.16 D16 — Inline Review Scales By Region, With A Diff-View Fallback

Recommended: the inline overlay renders **one bounded review band per contiguous changed region**, not one band for the whole proposal. Unchanged blocks between two changed regions stay virtualized and live, so a proposal touching block 3 and block 50 produces two small bands with normal editing between them. A single region larger than a threshold — the default: taller than the viewport, roughly 20–30 blocks, tunable — does **not** render inline; the affordance opens that proposal in the dedicated **diff view** (§6.1) instead, which is virtualization-free by construction and built for whole-document comparison.

This bounds the cost D14's non-virtualized band would otherwise incur: a small local change reviews inline where it happens; a large rewrite (an agent restructuring half the document) reviews in the surface built for it. "A proposal touches a small region" becomes a rule with an explicit escape hatch, not an unstated hope.

Rejected — always inline, one band for the whole proposal: a 500-block rewrite renders 500 blocks non-virtualized, defeating virtualization on the exact large-document case it exists for. Superseded by [`docs/038`](038_woven-overlay-design.md) §5–§5.1 (2026-07-02): under "render all ghosts, no stubs," the measured-ghost offset model is **built now**, not deferred — but cheaply, as a projection of the already-computed `SnapshotDiff` merged spine (`metricsForNode` estimates a ghost from its base node). The top-level threshold here is joined by a **second escape hatch at container scope** (a per-container ghost budget → scoped diff view), because a single giant container is invisible to a top-level block count; the two hatches at two scopes are together total.

## 5. The Diff Algorithm

### 5.1 Result Data Shapes

Defined in `core/diff/types.ts`:

```ts
export type BlockStatus = "unchanged" | "added" | "removed" | "moved" | "changed";

// "moved" = a common id whose order among the surviving blocks changed (LCS-based, §5.4),
// NOT any index shift from a neighbouring insert/delete; a moved block may also be "changed".
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
  readonly replacedBy?: NodeId;                    // a "removed" entry links to the "added" one taking its slot
  readonly replaces?: NodeId;                      // the reverse: an "added" entry standing in for a removed one (§5.4)
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

`diffScope(base, target, scope)` in `core/diff/tree.ts`, run first on the body (`order`) then recursively (§5.5). The diff keeps its **own merged order**: each snapshot's `body.order` is unchanged, but neither base order nor target order alone is the display order once blocks were added, removed, or moved, so `diffScope` aligns the two.

1. Compute base and target child-id lists (`body.order` for the body; `node.children` for a container).
2. `baseIds = Set(base)`, `targetIds = Set(target)`. Classify by membership: target-only → `added`; base-only → `removed`; both → compare payloads (§5.5/§5.6) for `unchanged` vs `changed`.
3. Detect moves by **aligning the two order lists, not by comparing absolute indices**. Compute the longest common subsequence of the base and target child-id lists — the same identity alignment §5.2 runs on characters, one level up on block ids. Ids in the LCS keep their relative order and are *not* moves; a common id outside the LCS, or one whose `parent` changed, is `moved` (with `alsoChanged` if its payload also changed). Absolute-index comparison is wrong here: inserting one block shifts every later index, which would flag every following block as moved.
4. Emit `BlockDiff[]` in the **merged order** — the LCS spine, with `added` slotted at their target position and `removed` at their base position relative to that spine. Nothing is lost: either original order is recoverable (non-added entries by `baseIndex`, non-removed by `targetIndex`), and `baseParent`/`targetParent` drive move connectors and gutters. Within a single gap between two spine blocks, `removed` and `added` entries are paired **positionally 1:1** (first removed ↔ first added, and so on) and linked via `replaces`/`replacedBy`, so the display can show a replacement as one unit; a lone `removed` or lone `added` in a gap is not a replacement.

Parent/index come from one pre-pass per snapshot: walk `order` + `children` once to build `Map<NodeId, {parent, index}>` (the `ParentEntry` shape, `model.ts:285`). The LCS runs per scope on the child-id lists; total cost stays near-linear for the shared-lineage case (few edits) and is bounded by standard LCS otherwise.

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

- **Unified** — one column in the merged spine order (target order with `removed` interleaved at its base slot), so a changed document reads top-to-bottom as the new version with edits marked in place. The default.
- **Side-by-side** — two columns, base | target, **row-aligned**: a matched block (unchanged or changed) occupies one row with its base cell on the left and its target cell on the right; an `added` block leaves a blank **gap** opposite it on the left, a `removed` block a gap on the right (§6.3). Row alignment is the whole point — you compare a block against its counterpart on the same line — so it is built on the LCS spine, not two independently-ordered columns (two independent columns lose the alignment and were the wrong call). Better for large structural change.

Two review affordances the flat surface needs (specified in §6.3): **context folding** — a long run of unchanged blocks between two changes collapses to a `⋯ N unchanged ⋯` separator while ±N blocks of context are kept around each change, so a change is reviewed in place rather than lost in the whole document — and **two-ended moves** — a move names its origin at the destination and, in side-by-side, shows a ghost at both ends so the reader can trace where a block came from and went.

Document-history review is the first host: fetch two snapshots, call `diffSnapshots`, render `<DiffView mode="unified" diff={...} />` with a version picker; `stats` drives a header summary ("+12 −3, 2 moved").

### 6.2 The Inline Diff Overlay (Live In-Editor)

> Superseded by [`docs/038`](038_woven-overlay-design.md) (2026-07-02). The mechanics below are the original sketch; `038` is the source of truth for the woven surface. Two corrections in particular: (1) removed-block **ghosts do not use the `QuarantineBlock` seam** — it renders only store-*present* nodes (`block-dispatch.tsx:61`), so ghosts get a distinct inert `GhostBlock` branch that mounts a base-side node (038 §4–§5); (2) the non-virtualized "review band" is replaced by a **`ReviewModel`** that renders the diff's merged spine with measured ghosts, so removed content virtualizes like any block (038 §5–§5.1).

The inline overlay reviews a proposal in place, while editing. Per D14 the live editable surface is the **proposed** document: the proposal's ops are applied to the live store optimistically (`recordHistory: false`, `origin: "suggested"`), so an added callout or an inserted phrase is a real editable node, and the diff is `diffSnapshots(base, proposedLiveStore)`. What the diff reports as `insert`/`added` is decorated but stays editable; what it reports as `delete`/`removed` renders as a non-editable **ghost** from the diff's base-side node, positioned by `baseIndex`.

Because a removed block's ghost has no offset-model height, the affected contiguous span renders as a bounded, non-editable **review band** rather than phantoms injected into the virtualized flow. The band hooks the seam `QuarantineBlock` uses — `EngineBlock` returns an inert, preserved render before dispatching to the editable renderers (`view/render/quarantine-block.tsx`) — so for a block in the reviewed span it returns the diff render (real editable new content plus removed ghosts) instead of the plain editable surface. Unchanged blocks around the band stay live, so editing continues elsewhere. Accept materializes (clears the `suggested` tag, keeps the ops, dissolves the band); reject reverts the ops and dissolves the band.

Scale is **per region, not per proposal** (D16): each contiguous changed region is its own band, unchanged blocks between stay virtualized and live, and a single region larger than the viewport (~20–30 blocks, tunable) opens in the diff view (§6.1) instead of rendering inline. When the reviewer edits on top of the proposal, the overlay re-diffs **incrementally** — only the commit's `touched` blocks intersected with the proposal's region, coalesced on the scheduler's idle lane (`coalesce:"latest"`), never synchronously on the keystroke path — the same derive-off-thread discipline the document index uses (`docs/027 §2.2`).

The "which side is live" rule generalizes: a proposal mounts the proposed side and ghosts its removals (above); the degenerate "changes since my last save" mode is `diffSnapshots(lastSaved, current)` where the live store already *is* the newer side, so the removed-since-save content is the ghost and there is no optimistic apply. Both feed the same §6.3 decoration.

Save and undo safety: the optimistic ops are `recordHistory: false`, so a reject is a clean inverse and the undo stack is untouched; a save while a proposal is pending excludes `origin: "suggested"` ops (or warns), so un-accepted content is never persisted.

#### 6.2.1 What Ships In R6-I: The Change Indicator, Not A Woven Overlay

The first draft of R6-I built a "changes-since-baseline" surface as a **region-banded panel** rendered below the editor — and it was the wrong thing: a panel of `DiffView` cards detached from the document is indistinguishable from the diff view (§6.1). It re-answered "what changed" in a second place instead of doing the one thing the word *inline* promises — showing the change **where it lives, in the editing surface**. That draft is withdrawn. The corrected split is by **who authored the change**, because that is what decides whether weaving the diff into the live surface earns its cost:

- **Human self-edits → no woven overlay.** When *you* are typing, you already know what you changed; a full inline diff of your own edits woven into the surface is noise. What helps is a lightweight **change indicator** — a live left-border on each block that differs from the baseline, so you can see *which* blocks you have touched — and, for the detail, the **diff view** (§6.1), opened on demand. Review is reframed onto the diff view; the live surface only flags *where*. This is what R6-I ships.
- **Agent / proposal edits → the woven inline overlay (deferred).** When an **agent** (`docs/037`) or another human **proposes** a change, you have not seen it, so it must render **in place** — the proposed text decorated inline, removals ghosted at their slot, an accept/reject affordance on the block — so you can review and act on it without leaving the document. That is the genuinely hard overlay (live text decoration, ghosts mounted in the virtualized flow via a distinct inert `GhostBlock` branch — **not** the `QuarantineBlock` seam, which renders only store-present nodes — accept/reject), and every piece of it depends on the **R6-J** proposal model (`Proposal`, `SuggestionSource`, optimistic apply, origin `"suggested"`). It rides R6-J and its full design system is [`docs/038`](038_woven-overlay-design.md); R6-I does not fake it.

So the load-bearing rule is **origin-gated**: the overlay is woven only for a change whose origin is *not* the local human author (a proposal, `origin:"suggested"`, or an agent); a human's own edits get the indicator plus the diff view. This also means the indicator and the woven overlay share one substrate — a per-block "this block differs from the baseline / from the pre-proposal state" signal — and differ only in richness (a border vs. the full in-place diff), so R6-J extends R6-I rather than replacing it.

The R6-I change indicator, concretely:

1. **A per-block gutter bar on changed blocks.** The editor diffs the captured `baseline` against the live document (through the commit-coalesced `useReviewSnapshot(store)` hook — a cached snapshot recomputed on `subscribeCommit`, off the keystroke path per §8) and marks each top-level block whose status is not `unchanged`. The marker is a decoration on the block's existing DOM element keyed by a `data-*` attribute — an `::after` **gutter bar in the surface's left inset, outside the block** (the first cut used a `box-shadow` inset border on the block's own box, but that overlapped the prose left edge and rounded its ends; the outside bar leaves the prose untouched and reads as a clean straight rail). It rides the block's existing `position: relative` (the base block style — the list-marker `::before` already anchors to it), so it adds **no layout shift**, needs no re-render of the block, and does not perturb the model-derived overlays (they position off viewport rects, not the block's offset parent) — not a re-render of the render path and not a separate absolutely-positioned rail with its own position bookkeeping (resolved question 3). It uses `::after` because a list item's marker already owns the block's `::before`. It virtualizes for free: a block that scrolls out unmounts, and the marker re-applies when it remounts.
2. **The diff view is the detail surface.** The indicator answers *where*; opening the diff view (the existing `[Changes]` slot, §6.1, docs/006 §4.6) answers *what* — the full §6.3 + §6.4 decoration, including the attr / mark / object detail. There is no second card surface in the editor.
3. **Clean is silent.** No changed block ⇒ no markers; the indicator adds nothing to an unedited document.

The pure core — `changedBlockIds(diff)` (which top-level ids differ, and their status) — is unit-testable without a live editor; the hook applies it to the DOM. `useReviewSnapshot` stays (the indicator's input). The withdrawn panel component, its region-banding, and its `embedStyles`-per-band reuse are removed; the one still-useful piece of that work, `DiffView`'s `embedStyles` flag, is retained since a host may still render more than one diff surface at once.

### 6.3 The Decoration Design System

A diff is only useful if a human can review it, so the decoration is a small closed vocabulary applied by one set of rules, not per-status ad-hoc styling (the first cut mixed a floating italic note, an inline badge, a "was" chip, and inline flags, so a reader could not tell change from context — that is the failure this section exists to prevent). Five principles govern it.

1. **Change versus context are visually distinct.** A change is a bordered **change card** — a status-colored left bar, a one-line status header, then the content; unchanged content renders bare, muted, and foldable. A reviewer finds every change by scanning for cards.
2. **One label system.** Every change states itself with the same **status tag** in the same place — the card header (`✎ Edited`, `＋ Added`, `－ Removed`, `⇅ Moved from ¶5`) — never a floating note in one spot and an inline badge in another.
3. **Track-changes for text, block-treatment for structure.** A text edit shows inline: an `insert` run is a colored **underline** (the new text), a `delete` run is **strikethrough** (the removed text) — never a filled chip that reads as chrome. A structural change (a whole block added/removed/moved, an object, a table) shows as the card and its tag. Nothing that looks like UI is placed inside prose.
4. **Moves are two-ended.** A move names its origin at the destination (`Moved from ¶5`, with a direction arrow), and in side-by-side shows a ghost at both the base and target rows in the same color, so the eye can trace where a block came from and went.
5. **Context, not the whole document.** Unchanged blocks near a change are kept as context; a long unchanged run folds to a `⋯ N unchanged ⋯` separator (§6.1).

The closed set of primitives — tokens only, no raw color literals, so themes apply:

| Primitive | What it is | For |
| --- | --- | --- |
| change bar | a left border (3px) in the status color | every card |
| status tag | an icon + word in the card header (one component) | naming the change |
| inline insert | a colored underline with a faint tint | added text |
| inline delete | strikethrough, muted | removed text |
| move ghost | a thin one-line marker | the *other* end of a move |
| fold separator | `⋯ N unchanged ⋯` | folded context |
| gap | a clean blank cell | a side-by-side one-sided row |
| field summary | `key: base → target` | object/settings/collection detail |

Colors: `added` green, `removed` red, `changed` blue, `moved` amber, `unchanged` neutral.

The status × block-family matrix — the rule for every combination:

| | text leaf | object | structural container |
| --- | --- | --- | --- |
| unchanged | bare context (foldable) | bare | bare |
| added | card, green, whole block + green wash | card, green, whole block | card, green, whole block |
| removed | card, red, **text struck through** | card, red, **dimmed** (a table/image cannot be struck) | card, red, dimmed whole |
| changed | card, blue, **inline track-changes** | card, blue, **field summary** | blue bar on the container; only changed **descendants** decorate, inline, not as nested cards |
| moved | amber, `Moved from ¶N` + direction; a ghost at both ends in side-by-side | same | same |
| moved+changed | amber + the changed treatment | amber + field summary | amber + descendant decoration |

A **list item** earns the same change card as any block, even though an `<li>` cannot be a `<div class="card">` child: the card body is a **one-item `<ol>`/`<ul>`** holding just that `<li>` (valid list HTML), so its bar aligns at the article edge with the flow-block cards and it carries the same status-tag header, while consecutive unchanged items coalesce into one shared list. A number card keeps the item's real position via the list's `start`. The first cut instead put a faint inset bar on the `<li>` itself; it read as second-class beside the paragraph cards and — sitting inside the list's own indent, with an inside-marker only on changed rows — shoved changed numbers out of line with unchanged ones. Cells and rows that must remain a `<tr>`/`<td>` still cannot wear a card (a one-item table is not a sensible unit), so a re-colored cell shows its change through inline track-changes and an attr tag placed inside the cell.

The Option-A nested case (indent one item → its predecessor wraps into a structural `listitem`, docs/030 §7.3) rides the same machinery: the structural item is one card (labelled by its surviving inner leaf's edit, not the container's synthetic add), and its nested sublist renders diff-aware inside — every item, flat or nested or reparented-`moved`, shows its own attr edit (the bullet→number you just made) instead of the nesting swallowing it.

Text-run rules. In **unified** a changed leaf shows the union on one line (`keep` plain, `delete` struck, `insert` underlined — for "Hello" → "Hi": `H` · ~~ello~~ · <u>i</u>). In **side-by-side** the run pass is side-aware: the base cell shows `keep`+`delete` (the old text), the target cell `keep`+`insert` (the new). When the two leaves share no character-id lineage (the §5.2 fallback) the character-level LCS is discarded for display — the old text renders struck and the new inserted as **whole units** rather than interleaved character noise — and the leaf is flagged `heuristic` in the card header, not inline. Mark changes overlay on the surviving runs, reusing `segmentText`+`wrapMark`.

The card is a `.rt-diff-*` wrapper (the bar is its left border, block padding is the gutter inset), shipped in the reader stylesheet the same way `.rt-*` is (docs/028), so it moves and virtualizes with the block and needs no positioning layer. Per-status render entry points wrap the reader's own `renderBlock` result — `unchanged` renders it as-is (byte-identical to the reader, the §11 parity guarantee); `added`/`removed`/`moved` wrap the whole block in the card; `changed` text runs the inline pass; `changed` object appends the field summary; `changed` structural recurses `children` so only changed descendants carry decoration. Both display surfaces (§6.1, §6.2) consume this one system.

### 6.4 Change Detail: Attrs, Marks, And Object Fields

A diff that says a block "changed" but shows no visible difference is a bug, not a diff. Three change classes are invisible unless the display renders them, because the *text runs* alone do not carry them: a **node-attr** change (a table cell's background color, a paragraph's alignment or indent, a heading's level), a **mark** change with no text edit (unstyling a bold span, removing a link — every run stays `keep`), and an **object-data** change (a code block's source). The engine already computes all three — `BlockDiff.attrs` (`AttrDiff`, added/removed/changed keys), `TextLeafDiff.markChanges` (including `op:"removed"`), and `ObjectDiff` — so this is a **display contract**, not new algorithm: the changed-block decoration must surface every one of them, or the card is a lie.

The rule for *who describes the change* follows the same opaque-data boundary the whole engine rests on (D6):

- **Attrs are engine-understood**, so they render generically: a **field summary** row per changed key — `align: left → center`, `backgroundColor: #14532d → —` (removed reads to an em-dash), `tag: h3 → h2`. No per-type SPI; the key and the before/after value are self-describing. This is the same `key: base → target` primitive the object/settings summary already uses, now also fed by `BlockDiff.attrs` for text leaves and structural containers (so a re-colored table cell, which is a non-flow `<td>`, shows its attr summary *inside the cell*, since it cannot wear a card).
- **Marks are engine-understood** (matched by `mark.id`, §5.3), so they render generically too: a **mark-change summary** row per change — `Bold removed on "shipped"`, `Link changed · href …/old → …/new`, `Italic added on "carefully"`. The mark's `kind` is the label and the resolved range names the affected text, so unstyling bold or dropping a link is now visible where before the card showed identical text with no cue. (The existing dotted overlay on a kept run under a *changed* mark stays; the summary is what makes a *removed* mark visible.)
- **Object data is opaque**, so its detail is delegated to the node through the **`NodeDefinition.diffData(base, target): ObjectFieldChange[]` SPI** (D6, the mirror of `plainText`/`anchors`) — the one genuine per-type seam, because the core cannot interpret a custom object's payload. A built-in **code block implements it** (a `code` field diff and a `language` field diff), rendered as a legible before/after (truncated, not a raw `JSON.stringify`). A host wires the seam by passing `DiffOptions.getNodeDefinition` (a resolver over the block registry, which the diff-view callers now pass by default, so object detail appears without per-call wiring); a custom object **without** `diffData` still reports block-level `changed` on any data difference — never a silent "unchanged" (§8), just without field detail until it implements the seam.

The restraint (a deliberate non-SPI): attrs and marks are **not** given a per-type description SPI, because the engine already understands them structurally and a generic `key: base → target` / `kind + op + range` render is correct and legible for every node and mark type. The only class the core genuinely cannot describe is opaque object `data`, and that already has `diffData`. A future `describeAttrs`/`describeMarks` seam (a node relabelling its own attrs, e.g. "cell fill" for `backgroundColor`) is a cosmetic refinement, explicitly deferred (§10) — the feature class "the diff shows every change" is unlocked by rendering what the engine already computes plus the one opaque-data seam that already exists, not by turning every attr into an SPI.

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
  readonly baseVersion: number;                  // the document revision (D15) it was made against — a staleness signal, not a rebase key
  readonly ops: readonly Step[];                 // the change; identity-anchored (node ids + char ids at text boundaries), so apply merges by identity (D15)
  readonly status: "pending" | "accepted" | "rejected";
  readonly threadId?: string;                    // a comment Thread for discussion (§7.6)
};
export type ProposalAuthor = { readonly kind: "agent" | "human"; readonly id: string; readonly label: string };
```

The proposed document is `applyOps(currentDoc, ops)`; the inline diff is `diffSnapshots(currentDoc, proposedDoc)`. Steps are the model's own algebra (`steps.ts:160`), so a proposal expresses text edits, mark changes, block insert/remove/move, object edits, and settings/collection changes with no new vocabulary. The ops carry **identity anchors** (D15), so `applyOps` resolves each against the *current* document — a non-overlapping intervening edit does not disturb them, and a deleted anchor is a conflict (§7.3). Storing ops (not a proposed snapshot) is what makes per-block accept a subset-apply and Model B a reuse (§7.7).

### 7.3 The Suggestion Source SPI And Applying A Proposal

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

Staleness and conflict, not offset rebase (D15): a proposal's `baseVersion` (the revision it was made against) tells whether the document moved since. Because the ops are identity-anchored, applying them to the current document is a **merge by identity** — the reviewer's intervening edits *elsewhere* do not disturb the proposal, and only an op whose target node or character id was deleted by an intervening edit is a **conflict**. Whole-proposal *display* is always robust (`diffSnapshots(current, applyOps(current, ops))` resolves anchors against the live doc). On accept, each op resolves its anchor against the current document: a resolved op applies, an unresolved (deleted-anchor) op is surfaced as a conflict — routed to the **Changes pane** when its target block was deleted, since there is then no block to anchor a woven marker to ([`docs/038`](038_woven-overlay-design.md) §17) — and the rest of the proposal still applies. No intervening op-log is replayed, so the history pool's byte cap (`docs/030` SLP-4) is irrelevant. When `baseVersion ≠ current revision`, the Changes pane labels the proposal "based on an older version" so the reviewer knows some ops may conflict.

### 7.4 Attribution

Attribution is mostly free (§3.7). Every character the author inserts already carries their `ClientId`; every proposal transaction carries `origin` and the `author` on the `Proposal`. Net-new: accept a non-`"local"` origin on dispatch (`origin: "suggested"` while previewing), and map `ClientId`/`author` to a display name (an agent label, a human name) for the inline attribution and the Changes pane. The author drives the tint hue and the "proposed by" label; the diff's `TextRunDiff.ids` already tells you which client inserted each run.

### 7.5 Accept And Reject

Under the optimistic-apply model (D14) the proposal's ops are already applied to the live store during review (tagged `origin: "suggested"`, `recordHistory: false`); accept and reject resolve that pending state at whole or block granularity (D11):

- **Accept whole:** clear the `suggested` tag on all the proposal's ops so they become permanent document content, set `status:"accepted"` via the source, dissolve the overlay.
- **Reject whole:** revert all the proposal's ops (a clean inverse, since they were `recordHistory:false`), set `status:"rejected"`, dissolve the overlay.
- **Accept block:** clear the tag on the subset of `ops` for that block; the rest stay pending. Ops are grouped into the `BlockDiff` they produced **by target node id** — an `insert-node` belongs to the block it creates, a `move-block` to the moved block, a `replace-text` to the leaf it edits — so per-block accept applies exactly that group. This is why ops, not a proposed snapshot, are the representation.
- **Reject block:** revert that block's ops and drop them from the proposal (`source.update` with the reduced set); the rest stay pending.

(If a proposal is reviewed *without* optimistic apply — a read-only preview against an untouched store — accept instead *applies* the ops, resolving identity anchors against the current document (§7.3). The two modes differ only in when the ops hit the store; the source lifecycle and granularity are identical.)

The affordance is an anchored control (accept ✓ / reject ✗, and open-thread) rendered by the overlay authority, anchored to the changed block via the existing `block` anchor (accept is block-granular, D11; §3.8) — no new anchor kind is needed. It is a `taking`-focus surface so a click does not tear editor focus (the focus-reclaim seam). Many changes show many affordances at once; the authority's collision avoidance positions them.

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
- **Proposal against a moved base.** The reviewer edited after the proposal was made. Mitigation: identity-anchored apply (D15) — display is always robust (re-diff), and accept resolves each op's anchor against the current document, applying the non-overlapping ops and surfacing a deleted-anchor op as a conflict rather than mis-applying (§7.3). No op-log replay.
- **Proposal targeting a block the reviewer deleted.** The op's target node id no longer resolves. Mitigation: that op is flagged as a conflict (not silently applied); the affordance shows "no longer applies," and the proposal is partially acceptable (the remaining blocks still apply).
- **Two proposals touching the same block (Model A).** Both render as separate proposals; accepting one leaves the other's identity-anchored ops to re-resolve against the new state (D15), and an op that then conflicts is flagged. Concurrent *interleaving* in one span is out of scope until Model B.
- **Un-accepted content leaking into a save.** Optimistic apply (D14) leaves `origin:"suggested"` ops in the store while a proposal is pending. Mitigation (revised, [`docs/038`](038_woven-overlay-design.md) §14): `origin` is per-transaction and `toSnapshot()` is per-node, so there is no per-node "suggested" bit to filter — instead **saves are blocked/deferred while a proposal is under review**, with exit condition "zero pending suggested ops in the store"; on exit the store is clean and the save resumes normally.
- **Removed-block ghost positioning.** A ghosted removed block has no offset-model height, so it cannot be injected into the virtualized flow. Mitigation: render the affected span as a bounded, non-virtualized review band (§6.2, D14); a proposal touches a small region, so the band is cheap.
- **Editing on top of a suggestion.** The reviewer tweaks the proposed (editable) content before accepting. Mitigation (revised, [`docs/038`](038_woven-overlay-design.md) §15): in-review edits record into a **separate arbiter-exempt history segment** (individually undoable, yet revert cleanly on reject) and fold into the proposal's op-log **lazily** — materialized at a resolution boundary (accept/switch), not per keystroke — with block-level resolution as a hard segment boundary. Accept keeps them, reject reverts them with the rest.
- **Over-flagged moves.** A single insertion must not report every following block as `moved`. Mitigation: LCS-based move detection (§5.4) — only a block outside the longest common subsequence of the two orders, or one whose parent changed, is `moved`.
- **Orphaned proposal / stale thread.** A proposal whose ops all became inapplicable, or a thread whose anchor collapsed. Mitigation: keep-and-flag (the comment orphan pattern, `docs/027`), never silent-drop; the Changes pane surfaces it for manual dismissal.
- **Tombstone-less deletion display (Model A).** A proposed deletion has no tombstone in the live doc; the struck content comes from the base branch. Mitigation: the overlay reads deleted runs from `diffSnapshots`' base side (`TextRunDiff` `op:"delete"`), so no live-model tombstone is needed.
- **Two-view drift with the reader.** Mitigation: both surfaces reuse the reader L1; a parity test asserts an `unchanged` block renders identically to the plain reader render (§11).

## 9. Implementation Backlog

Phased, reviewable, tested, and sequenced by shippable milestone: the **diff engine** (R6-A…E) first, then the **diff view** (R6-F…H) — the first shippable feature, document-history review — then the **change indicator + change detail** (R6-I), then the **woven overlay & Model-A suggested edits** — the single **R6-J phase** ([`docs/038`](038_woven-overlay-design.md)), which starts at its ghost-render spike gate (J0). Diff core is R6-A…H; the display and suggested-edits work is R6-I plus the R6-J phase.

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

### R6-I. Change Detail + The Live Change Indicator

Scope: the diff **display contract** — the reader's `DiffView` renders every change class (§6.4), the code block gains `diffData` (§5.6/§6.4), and the editor gains a live **change indicator** (§6.2.1) instead of the withdrawn region-banded panel. The genuinely inline **woven overlay** for proposals rides R6-J (§6.2, §6.2.1), origin-gated.

Tasks (R6-I, shipped):

- [x] **Change detail rendering (§6.4).** `DiffView` renders `BlockDiff.attrs` as a field summary (a re-colored table cell, an alignment/indent/heading-level change — including a non-flow `<td>`, whose summary renders inside the cell); renders `TextLeafDiff.markChanges` including `op:"removed"` as a mark-change summary (unstyled bold, dropped link now visible); and renders object `fields` legibly (truncated before/after, not raw JSON).
- [x] **Object `diffData` SPI wired (§5.6, D6).** The built-in **code block** implements `diffData` (code + language); a registry resolver is passed as `DiffOptions.getNodeDefinition` by the diff-view callers so object field detail appears by default; a custom object without the seam still reports block-level `changed`, never a silent unchanged.
- [x] **The live change indicator (§6.2.1).** `changedBlockIds(diff)` (pure — top-level changed ids + status) + `deletionAnchors(diff)` (pure — the surviving neighbor a removed block hints against) + a `useReviewChangeIndicator` hook that decorates each changed block's DOM element with an `::after` **gutter bar outside the block** (keyed by a `data-*` attribute — no layout shift, no block re-render, and it leaves the prose untouched), plus a red **deletion tick** on the surviving neighbor of a removed block so a deletion still leaves a trace live. The bar hugs the block's content so it reads consistently across block types with uneven vertical spacing. Driven by `useReviewSnapshot`. Review detail is the diff view (§6.1); the indicator only flags *where*.
- [x] Withdrew the region-banded panel (`InlineDiffOverlay`) and its stories/tests; kept `DiffView`'s `embedStyles` flag and `useReviewSnapshot`.

The genuinely inline **woven overlay** for proposals (optimistic apply, ghosts, accept/reject, review-mode plumbing) is not part of R6-I — it is the whole **R6-J phase** below, designed in full in [`docs/038`](038_woven-overlay-design.md). The R6-I change indicator is the human-edit substrate that phase extends (§6.2.1).

Acceptance (R6-I): unstyling a bold span and removing a link both show in the diff view; removing a table cell's background color shows in the diff view (inside the cell); editing a code block shows a code/language field diff, not a bare "changed"; while editing, changed blocks carry a live left border and the diff view carries the detail; an unchanged block still renders identically to the plain reader; a clean document shows no markers. Tests: `tests/reader/diff-view.test.tsx` (attr/mark/object-field rendering) + `tests/editor/engine-review-indicator.test.tsx` (`changedBlockIds` + DOM decoration) + Playwright screenshots. The woven-overlay / accept-reject e2e rides R6-J.

### R6-J. The Woven Overlay & Model-A Suggested Edits — `docs/038`

One phase, not a set of independent features. [`docs/038`](038_woven-overlay-design.md) is the design of record; the steps below are its build order and share one Definition of Done (038 §22). Start with **J0** — it de-risks everything after it, reuses only shipped code, and is the one net-new mechanism the whole surface rests on. Do not begin J1+ until J0 holds.

Scope (whole phase): `core/model/model.ts` (`revision`), `core/diff/` + `core/suggestions/` (the proposal), `core/store/` (optimistic apply, review-mode undo, the reclaim signal, the save gate), `view/render/` (`GhostBlock`, review-aware recursion, `ReviewModel`), `view/overlays/` (passive layer, the single active surface, the review cursor), `view/spi/suggestion-source-registry.ts`, `view/chrome/` (Changes pane, affordance), and the review stylesheet (`.rt-diff-*` + review tokens, the two-tone `focusRing`).

Steps (in order):

- [ ] **J0 — Ghost-render spike (the gate).** Build `ReviewModel` + `GhostBlock` against the *shipped* `diffSnapshots(baseline, live)` (R6-I's `useReviewSnapshot`): a merged-spine recursion mounts removed blocks as **inert `GhostBlock`** elements — `data-engine-block-id` taken from the base node — spliced into the live flow at their `baseIndex` and fed to the treap. No proposal model, no accept/reject. Prove ghosts **render, measure, and virtualize in place** without tearing the per-block EditContext host (desktop *and* mobile). Reuses only shipped code, so it depends on nothing and it gates the rest. (038 §4–§5.) Tests: `engine-review-ghost.spec.ts` (e2e) + Playwright screenshots.
- [x] **J1 — Proposal model + revision + identity-anchored apply.** (Shipped 2026-07-02; `core/suggestions/**` + the snapshot `revision`; see [`docs/038`](038_woven-overlay-design.md) §5.3.) Additive monotonic `revision` on `EditorDocumentSnapshot` (D15, §3.3), bumped per step-bearing commit, omitted from `toSnapshot()` when 0, read as 0 on a legacy snapshot, and diff-invisible; the `Proposal`/`ProposalAuthor` types (§7.2); `applyProposal`/`applyProposalBlock`/`groupProposalOps` grouping ops by target node id (§7.5), a deleted anchor surfaced as a conflict, and apply **total** (never throws — a residual staleness becomes an `apply-failed` conflict) by reusing the store's dispatch chokepoint. Grounding correction it surfaced: the canonical `TransactionBuilder`/dispatch produces an **id-less `removed` slice**, so exact char-id text anchoring (surviving a same-leaf shift) holds only for ops a producer builds with `sliceTextContent`. An id-less removal trusts its exact offset on an **unmoved** base (`baseVersion === revision`) and, on a **moved** base, re-locates by the removed text's **unique occurrence** — conflicting on an ambiguous (multiple/zero-occurrence) match rather than guessing at a coincidental one. Because `moved` is document-level, id-less-on-moved-base carries two irreducible-without-char-ids residuals (both safe: a false conflict for a *repeated* substring even on an untouched leaf, and a silent mis-apply only if an intervening edit reproduced a *unique* substring elsewhere); it is best-effort until the producer supplies char ids (`docs/038` §5.3). Single-proposal scope is a design constraint; the **atomic switch sequence** at this pure-model layer is stateless recomputation (`applyProposal` is a pure function of `(current, proposal)`) — the stateful optimistic-apply-into-the-live-store + revert/switch is J6 (038 §11). Tests: `engine-proposal-apply.test.ts` (incl. a moved-base conflict) + `engine-snapshot-revision.test.ts`.
- [ ] **J2 — Productionize the `ReviewModel`.** The J0 spike driven by a real proposal (`diffSnapshots(current, applyOps(current, ops))`): the review-aware child-assembly recursion, the offset-model integration + ghost height-cache eviction on review exit, and the two escape hatches — the top-level region threshold plus the per-container ghost budget → scoped `DiffView` (038 §5–§5.1).
- [ ] **J3 — Passive marker layer + disclosure tiers + color.** Generalize `useReviewChangeIndicator` to any-depth `[data-engine-block-id]`; T1 woven track-changes (wash+underline / strike); T2 the two-tone `focusRing` element ring + a floating detail chip + the rangeless-attr anchor map; T3 drill-in to a scoped `DiffView`; the gutter bar keeps status hue, the author lives in the chip (038 §6–§9). Tests: `engine-review-decoration.test.tsx` + Playwright legibility screenshots.
- [ ] **J4 — Active review surface.** Exactly one `block`-anchored overlay-authority surface + a review cursor (next/prev, wired to scroll-to-block) + accept/reject whole & per-block; **no new anchor kind** (this corrects the old "range anchor" plan; §7.5, §13 Q2). Tests: `engine-change-affordance.spec.ts` (e2e: focus not torn, one active surface at a time).
- [ ] **J5 — SuggestionSource SPI + Changes pane.** `SuggestionSource` (sibling of `comment-source-registry.ts`, §7.3); a Changes pane in the Review dock; pane routing for anchorless changes — conflicts, settings, collections (038 §17). Tests: `engine-suggestion-source.test.ts`.
- [ ] **J6 — Review-mode plumbing (load-bearing correctness).** Enter/exit review mode; caret reclaim keyed on the **dispatch entry point**, not `origin` (038 §13); the focused-block-protection handshake; **saves blocked in review mode**, exit condition "zero pending suggested ops" (038 §14); **review-local undo** — a separate arbiter-exempt `HistoryPool`, mode-routed undo/redo, the **lazy** op-log fold, block-resolution as a hard segment boundary (038 §15); optimistic apply `origin:"suggested"`. Tests: `engine-review-mode.test.ts` (undo/redo within review, reject restores the pre-review state, the save gate).
- [ ] **J7 — Attribution wiring.** Under single-proposal review the author is constant; map `ClientId`/author to a chip label + hue; `TextRunDiff.ids` resolve to the author (§7.4, 038 §18). Tests: `engine-suggestion-attribution.test.ts`.
- [ ] **J8 — Public API map + docs.** Regenerate maps for `Proposal`, `SuggestionSource`, `ReviewModel`, and the `DiffView`/reader additions; `pnpm check` green.

Acceptance (phase): the full 038 §22 Definition of Done — a proposal renders woven in place (proposed content editable, removals ghosted inert and measured), accept/reject at whole and per-block granularity, review-mode save block + review-local undo behave, conflicts/settings/collections route to the pane, changes render attributed, and an `unchanged` block stays byte-identical to the plain reader; no product/runtime dependency enters `packages/editor`/`packages/reader`; `pnpm check` green.

## 10. Future Backlog

- **Model B — inline tombstoned suggestions.** Concurrent multi-author suggesting in one span: a tombstone flag on `CharacterRun`, read-path filtering, a convergence rule. Rides the collaboration milestone (§4.13, §7.7).
- **Per-run accept.** Accept/reject a single character run inside a block. Deferred (D11); needs finer conflict resolution.
- **Op-log warm path.** Project persisted adjacent-save `Step[]` into a `SnapshotDiff` without a full walk (§3.5).
- **Word/sentence grouping.** Group `TextRunDiff` runs into word/sentence changes for a calmer display. Display-layer post-processing.
- **Real-time collaboration.** Live convergence, awareness, multi-peer GC (`docs/013`/`docs/014`); suggested edits is the on-ramp (§7.8).

## 11. Definition Of Done

> Revised (2026-07-02): R6-A..I are done (engine, diff view, change detail, change indicator). The DoD for the **woven overlay and Model-A suggested edits** — the single **R6-J phase** (§9) — is carried by [`docs/038`](038_woven-overlay-design.md) §22 (design-complete, every mechanism grounded in code); where a bullet below says "inline overlay (R6-I)" it means the change *indicator*, not the woven surface, and the R6-K/L/M step references are now the R6-J phase's steps J1–J8.

- `diffSnapshots(base, target)` ships in `core/diff/**`, framework-free, returning `SnapshotDiff` (§5.1), R6-A…E green.
- Identity path proven: an edit made through commands, captured as two snapshots, diffs back to exactly that edit (the parity oracle `engine-diff-snapshots.test.ts`), including insert/delete text, mark add/remove, block add/remove, reorder-as-move, nested-container edits. Fallback proven: a retyped leaf reports `alignment:"text"`.
- The diff view (R6-F) renders every status on the reader L1, and the change indicator (R6-I) flags changed blocks live; an `unchanged` block renders identically to the plain reader render (the parity assertion extending `docs/028`).
- Suggested edits (Model A) ships end to end across the R6-J phase: a `Proposal` applies whole and per-block (J1), the `SuggestionSource` + Changes pane drive lifecycle (J5), accept/reject affordances anchor on the `block` anchor and do not tear focus (J4), and changes render attributed (J7). Applying a proposal to a moved document resolves identity anchors: non-overlapping edits do not conflict, a deleted-anchor op is surfaced as a conflict, never silently mis-applied. The snapshot's `revision` round-trips (legacy snapshots default to 0).
- No product/runtime dependency entered `packages/editor` or `packages/reader`; the architecture lint stays green.
- `pnpm check` green (format, lint, dup, typecheck, tests, build, `check:docs`, `check:package`); API maps regenerated with the new public symbols documented.

## 12. Final Model

A diff between two versions of an idco document is an identity problem the model already has the keys for: match blocks by `NodeId`, characters by `CharacterId`, marks by `mark.id`, and every change reads as what it is, not the delete-plus-insert noise a text diff produces. `diffSnapshots` is one pure core function returning one structured result; a dedicated diff view and a live inline overlay both decorate the reader's L1 render with it, inheriting reader↔editor parity instead of re-deriving it. Suggested edits rides on that engine without touching the authoritative document: a proposal is an attributed op-log branch, the inline overlay is the derived diff, accept applies the ops and reject drops them, at whole-proposal or per-block granularity. The change content is ops; the conversation is a comment thread; the affordance is an anchored overlay control on the existing `block` anchor; the persistence is a host-owned Suggestion Source — substrates the editor already has, plus a Changes pane. The ops are identity-anchored, so applying a proposal to a document that moved is a merge by identity — the reviewer's edits elsewhere never disturb it, only a genuine overlap conflicts — and a monotonic document `revision` labels staleness without any op-log replay. Because a proposal is ops, per-block accept is a subset-apply and the eventual Model B (inline tombstones for concurrent multi-author suggesting) is a reuse of the same ops and the same review wrapper, riding the collaboration milestone that has to build tombstones anyway. Suggested edits is async, review-gated collaboration, so building it now is the low-risk on-ramp to the real-time version later, exactly as the identity-addressed model was shaped to allow. The producer of proposals — an in-editor AI action or an external agent — is `docs/037`; this document is where their changes land, are seen, and are accepted or rejected.

## 13. Resolved Design Questions

The gaps a decision-completeness pass surfaced, each now closed in the section noted. Nothing here is deferred.

| # | Question | Decision | Where |
| --- | --- | --- | --- |
| 1 | What is `baseVersion` / a document revision? | A monotonic `revision` on the snapshot (additive, per-commit); ops are identity-anchored so apply is a merge by identity, not an offset rebase. | D15, §3.3, §3.7, §7.2, §7.3 |
| 2 | `range` vs `mark` anchor for the accept/reject control? | The existing `block` anchor — accept is block-granular (D11), so no new anchor kind is needed; inline run tinting renders in the block's own pass. | §3.8, §7.5 |
| 3 | What substrate hosts the gutter change-bar? | A CSS left-border on the per-block diff wrapper (`.rt-diff-*`), not a separate rail — it virtualizes with the block. | §6.3 |
| 4 | How does the review band scale to scattered/large proposals? | One bounded band per contiguous changed region (unchanged blocks between stay live); a region past a threshold (~viewport / 20–30 blocks) opens in the diff view. | D16, §6.2 |
| 5 | Does rebase need the intervening op-log? | No — identity-anchored apply replays no log; a deleted anchor is a surfaced conflict. | D15, §7.3 |
| 6 | How are ops attributed to a block for per-block accept? | Grouped into the `BlockDiff` they produced by target node id (insert-node → the new block, move-block → the moved block). | §7.5 |
| 7 | When is a remove+add a `replaces` pair? | Positionally 1:1 within a single gap between two LCS-spine blocks; a lone entry is not a replacement. | §5.4 |
| 8 | Re-diff cadence during live review? | Incremental and block-scoped (commit `touched` ∩ the proposal's region), coalesced on the idle lane, never synchronous per keystroke. | §6.2, §8 |
| dep | Op-log fast path availability | The cold tree diff is the baseline and ships first; the warm op-log path stays future backlog. | §3.5, §10 |
| dep | Milestone sequencing | Diff engine → diff view (first shippable) → inline overlay → suggested edits. | §9, §11 |

With these closed, the diff engine and the diff view are decision-complete here; the **woven overlay and suggested edits** are decision-complete in [`docs/038`](038_woven-overlay-design.md), which resolved the forks this document had left in §6.2's mechanics, conflict routing, save exclusion, and in-review undo. No open fork remains between the schema (§5), the display design (§6 + `038`), and the definition of done (§11 + `038` §22).
