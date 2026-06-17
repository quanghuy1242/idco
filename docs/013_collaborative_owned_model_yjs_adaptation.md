# 013 - Rejected: Collaborative Owned-Model Yjs Adaptation

> Status: rejected proposal. Do not implement as written.
>
> Date: 2026-06-17
>
> Rejection date: 2026-06-17
>
> This document is retained as a rejected design record. It should not be treated as the collaboration foundation, a Phase 3/4 backlog, or an accepted delta on docs/011. The body below is useful only as an analysis of one possible Yjs-native direction and as a source of individual constraints that may be salvaged into a different adapter plan.
>
> Rejected thesis: the original proposal specified, at the depth of docs/011, every change the owned-model foundation would need in order to adopt Yjs as the collaborative substrate. It claimed to be a delta on 011, not a replacement, while also making the `Y.Doc` authoritative. That authority inversion is the reason this proposal is rejected.
>
> Scope:
>
> - `/home/quanghuy1242/pjs/idco`
> - `packages/editor/src/owned-model/**` (the future Phase 3 runtime that 011 specifies)
> - `packages/editor/src/model/schema.ts` (`RichTextEditorDocument`, the compatibility projection)
> - future `packages/editor/src/owned-model/collab/**` (the Yjs binding, providers, awareness; does not yet exist)
>
> Source docs:
>
> - `docs/010_owned_model_virtualized_editor_plan.md` — product thesis, generic path, phasing. 010 §12 already names collaboration as "must not foreclose."
> - `docs/011_foundation_dsa_owned_model_editor.md` — the foundation contract this document amends. Section numbers below (§2…§12) refer to 011 unless prefixed with `013`.
>
> Related docs:
>
> - `docs/008_editor_performance_contract.md` — the lane/budget scheduler; remote updates become a new input source on it.
> - `docs/012_owned_model_spike_proof_plan.md` — the spike that proved the local input/selection/paint substrate the binding reuses.
>
> External references (Yjs, fetched 2026-06-17 via Context7 `/yjs/docs`):
>
> - Yjs core, shared types, deltas: <https://docs.yjs.dev/>
> - `Y.Text` rich text and the delta format (`toDelta` / `applyDelta` / `format`): <https://docs.yjs.dev/api/shared-types/y.text>
> - Relative positions (`Y.createRelativePositionFromTypeIndex`, `assoc`): <https://docs.yjs.dev/api/relative-positions>
> - `Y.UndoManager` (`trackedOrigins`, `captureTimeout`, `stopCapturing`, stack-item meta): <https://docs.yjs.dev/api/undo-manager>
> - Awareness protocol (`y-protocols/awareness`): <https://docs.yjs.dev/getting-started/adding-awareness>
> - Subdocuments: <https://docs.yjs.dev/api/subdocuments>
> - Providers: `y-websocket`, `y-webrtc`, `y-indexeddb`; managed alternatives Hocuspocus / Liveblocks / PartyKit / y-sweet.
>
> Original assumptions from the rejected proposal, not accepted project assumptions:
>
> - Collaboration is added within ~1 year, after 011's single-user Phase 3 spine exists, not before. This document is the forward contract that keeps that addition bounded, plus the cheap day-one insurance that must land even in the single-user build.
> - Yjs (not Automerge, not OT/ShareDB) is the chosen CRDT, because the owned model is ProseMirror-shaped (011 §6) and the `y-prosemirror` binding is the closest existing blueprint, and because Yjs leads on performance and editor-binding ecosystem.
> - The owned model's §6.1 single chokepoint exists and is inviolable. Without it this adaptation is not bounded and this document does not hold.
> - The compatibility projection `RichTextEditorDocument` (010 G1) remains a required output; under collaboration it becomes a derived export of the `Y.Doc`, never a second source of truth.

## 0. Rejection Decision

Reject this proposal as the collaboration foundation. It replaces too much of the owned-model architecture with Yjs-native authority and would turn docs/011 into a projection layer rather than the editor's model contract.

The decisive issue is not whether Yjs is a competent CRDT library. Yjs can synchronize text, maps, updates, relative positions, undo scopes, awareness, and subdocuments. The issue is fit. IDCO's owned editor is deliberately not a generic rich-text editor: docs/010 and docs/011 make the model, not the DOM, the source of truth so a book-scale document can virtualize; docs/012 already proves that model-owned selection, copy, paste, search, active-leaf input, and bounded mounting can work in a basic FlowSpike; docs/006 adds heavy objects, author-time baking, export-only static snapshots, data grids, mermaid, object chrome, strict renderer parity, and host schema boundaries. A Yjs-native document foundation does not carry those semantics. It would have to be wrapped until it behaves like the owned model, at which point Yjs is no longer the foundation; it is only an adapter candidate.

Strong reasons for rejection:

- It makes `Y.Doc` the authoritative document and demotes the docs/011 node graph to a derived read-model. That gives up the core owned-model premise: editor semantics live in our normalized model, not in a foreign shared-type graph.
- It replaces the docs/011 mark model with `Y.Text` attributes and accepts Yjs formatting boundary behavior in place of our specified range-mark semantics. That is not an adapter; it changes text-format correctness.
- It replaces the planned local history model with `Y.UndoManager` before proving equivalent single-user behavior. Collaborative undo is a separate requirement, but it should not erase the carefully scoped local history design.
- It pushes code-block and object internals toward `Y.Text`, `Y.Map`, or subdocuments in ways that conflict with docs/006's heavy-object contract: resting baked output, in-place edit mode, mandatory export completeness, and object-owned validation.
- It treats virtualization as a projection above Yjs. Yjs does not provide the FlowSpike property we need: offscreen content must remain selectable, searchable, copyable, pasteable, and editable through the owned model while only a bounded DOM window mounts. Yjs can sync data, but it does not prove that architecture.
- It recommends Yjs update history as the durable truth and demotes `RichTextEditorDocument` to export. That is premature and cuts across the strict schema, renderer, host-union, and export contracts already established for book content.
- It stacks a second hard bet on top of the new EditContext/hidden-textarea input architecture. The proven Yjs editor ecosystem is built around generic bindings and editor assumptions that are not the same as IDCO's active-leaf, overlay-painted, virtualized book editor.

What may be salvaged into a future collaboration plan:

- Globally unique node ids.
- The absolute mutation chokepoint.
- Provider-agnostic awareness as an optional remote-presence channel.
- Relative positions as an adapter boundary for remote cursors, if they preserve owned-model selection semantics.
- Headless two-client convergence tests.
- A small Yjs spike shaped like FlowSpike, where the owned model remains authoritative and Yjs is only a replication adapter. If the existing FlowSpike invariants cannot remain green unchanged, the adapter does not fit.

## Table Of Contents

- [0. Rejection Decision](#0-rejection-decision)
- [1. Goal](#1-goal)
- [2. System Summary: The One Inversion](#2-system-summary-the-one-inversion)
- [3. Current-State Findings: What Helps, What Fights](#3-current-state-findings-what-helps-what-fights)
  - [3.1 What 011 Already Got Right For Collaboration](#31-what-011-already-got-right-for-collaboration)
  - [3.2 What In 011 Is Single-User And Must Change](#32-what-in-011-is-single-user-and-must-change)
  - [3.3 What Yjs Is, In One Paragraph Of Mechanics](#33-what-yjs-is-in-one-paragraph-of-mechanics)
- [4. Target Model: The Yjs Document Representation](#4-target-model-the-yjs-document-representation)
  - [4.1 The Document Tree In Yjs Shared Types](#41-the-document-tree-in-yjs-shared-types)
  - [4.2 Node Identity And Ordering](#42-node-identity-and-ordering)
  - [4.3 Text Leaves And Marks As `Y.Text`](#43-text-leaves-and-marks-as-ytext)
  - [4.4 Atomic Objects As Nested Types Or Subdocuments](#44-atomic-objects-as-nested-types-or-subdocuments)
  - [4.5 Settings, Version, And The Doc Root](#45-settings-version-and-the-doc-root)
- [5. Architecture Decisions](#5-architecture-decisions)
  - [5.1 `Y.Doc` Authoritative, Node Graph Derived](#51-ydoc-authoritative-node-graph-derived)
  - [5.2 The Chokepoint Becomes The Binding Seam](#52-the-chokepoint-becomes-the-binding-seam)
  - [5.3 Replace Inverse-Step History With `Y.UndoManager`](#53-replace-inverse-step-history-with-yundomanager)
  - [5.4 Ordering By Fractional Order-Key, Not `Y.Array` Move](#54-ordering-by-fractional-order-key-not-yarray-move)
  - [5.5 Marks Become `Y.Text` Formatting, Offsets Become A Projection](#55-marks-become-ytext-formatting-offsets-become-a-projection)
  - [5.6 Selection: Local Offsets, Boundary-Crossing Relative Positions](#56-selection-local-offsets-boundary-crossing-relative-positions)
- [6. Section-By-Section Adaptation Of docs/011](#6-section-by-section-adaptation-of-docs011)
  - [6.1 §2 Document Model](#61-2-document-model)
  - [6.2 §3 Per-Leaf Text DSA](#62-3-per-leaf-text-dsa)
  - [6.3 §4 Marks And Atoms](#63-4-marks-and-atoms)
  - [6.4 §5 Positions And Coordinates](#64-5-positions-and-coordinates)
  - [6.5 §6 Mutation: Transactions And Steps](#65-6-mutation-transactions-and-steps)
  - [6.6 §7 History](#66-7-history)
  - [6.7 §8 Selection](#67-8-selection)
  - [6.8 §9 The Input Substrate](#68-9-the-input-substrate)
  - [6.9 §10 Data Flow And Scheduling](#69-10-data-flow-and-scheduling)
  - [6.10 §11 The View Layer](#610-11-the-view-layer)
  - [6.11 §12 The Public Surface And SPI](#611-12-the-public-surface-and-spi)
- [7. New Subsystems Yjs Introduces](#7-new-subsystems-yjs-introduces)
  - [7.1 Providers And Transport](#71-providers-and-transport)
  - [7.2 Persistence And The Durable Source Of Truth](#72-persistence-and-the-durable-source-of-truth)
  - [7.3 Awareness: Remote Cursors And Presence](#73-awareness-remote-cursors-and-presence)
  - [7.4 Schema Versioning And Migration Of The `Y.Doc`](#74-schema-versioning-and-migration-of-the-ydoc)
- [8. The Hard Problems](#8-the-hard-problems)
- [9. Day-One Insurance (Land In The Single-User Build)](#9-day-one-insurance-land-in-the-single-user-build)
- [10. Implementation Strategy And Phasing](#10-implementation-strategy-and-phasing)
- [11. Implementation Backlog](#11-implementation-backlog)
- [12. Edge Cases And Failure Modes](#12-edge-cases-and-failure-modes)
- [13. Test And Verification Plan](#13-test-and-verification-plan)
- [14. Future Backlog](#14-future-backlog)
- [15. Definition Of Done](#15-definition-of-done)
- [16. Open Decisions](#16-open-decisions)
- [17. Final Model](#17-final-model)

## 1. Goal

Make the owned-model editor multi-user without a rewrite, by binding it to Yjs through the one seam 011 already has, and to name every place 011's single-user assumptions break under concurrency so none of them is discovered in production. The output is not a collaboration feature; it is the foundation delta that lets a collaboration feature be built later in weeks rather than as a teardown.

The short version:

- One inversion: the `Y.Doc` becomes the document; 011's `Map<NodeId, Node>` store becomes a derived, React-friendly read-model rebuilt from Yjs observers; 011's `dispatch` chokepoint (§6.1) becomes the bidirectional binding (local command → one `Y.transact`; remote update → reconcile → notify).
- Three things change at the foundation, not the edges: history (inverse steps → `Y.UndoManager`, local-only), positions (absolute offsets → relative positions at boundaries), and marks (offset-range remap → `Y.Text` formatting). Everything else in 011 survives.
- One thing must land even in the single-user build because it is corrupting and un-retrofittable: globally unique `NodeId`s.

Non-goals:

- No access control, document permissions, or auth model. Named in §16, owned elsewhere.
- No specific hosting choice (self-hosted WebSocket vs managed). §7.1 frames the axis; the pick is a product/ops decision.
- No real-time cursor design polish (colors, name tags, follow-mode). §7.3 specifies the data path; UX is later.
- No CRDT theory exposition. Yjs is treated as a proven black box with a documented API.
- No change to 010's phasing other than inserting collaboration after the single-user runtime (Phase 4+).

## 2. System Summary: The One Inversion

011 builds a single-user editor whose authoritative document is an in-process normalized node graph mutated through `dispatch`, with history as inverse steps. Collaboration cannot be a sync channel bolted onto that, because then two structures both claim to be the document and they will diverge. The correct shape inverts authority:

```
                 single-user (011)                          collaborative (013)

  command  ──▶  dispatch ──▶ apply(store) ──▶ notify     command ──▶ dispatch ──▶ Y.transact(mutateYDoc, localOrigin)
                                  │                                                    │
                              the document                                       the document  ◀── remote updates
                                                                                      │
                                                                  Y.Doc observers ──▶ reconcile read-model ──▶ notify
```

The node graph still exists, but as a **derived read-model**: a per-node frozen projection of the `Y.Doc`, rebuilt incrementally by Yjs observers so the §11 view layer and `useSyncExternalStore` keep working unchanged. Commands still speak 011's step vocabulary (§6.2), but a step now *writes to the `Y.Doc`* inside one transaction instead of mutating the store directly. Remote edits arrive as `Y.Doc` updates from a provider, reconcile into the same read-model, and notify the same subscribers. The chokepoint is the only place either direction crosses, which is precisely why this is a binding and not a rewrite.

What stays identical: the overlay-rect selection painter (§8.5), the input capture host (§8.4/§9), grapheme navigation (§10), per-node subscription and snapshot pinning (§11), virtualization grain (§2.6), and the command/query SPI surface (§12). The blast radius of collaboration is the store representation (§6.8), history (§7), positions (§5), and marks (§4) — bounded, and each addressed below.

## 3. Current-State Findings: What Helps, What Fights

### 3.1 What 011 Already Got Right For Collaboration

These are not luck; 010 §12 set the constraint and 011 honored it.

- The single chokepoint (§6.1). One place to translate both directions. This is the load-bearing precondition.
- ProseMirror-shaped steps and mapping (§6.2, §6.3, §6.10). The `y-prosemirror` binding is a working template for exactly this translation.
- A normalized, id-addressed node graph (§2, §6.8: `Map<NodeId, Node>` with containers referencing children by id). This maps almost directly onto a flat `Y.Map` of node entries (§4.1).
- Atomic-object sequestration (§2.7): each heavy object is a self-contained sub-engine with opaque internals. That is the subdocument boundary (§4.4) for free.
- Affinity as an explicit bit (§5). Yjs relative positions carry the same concept as `assoc` (§5.6).
- Virtualization as a pure view concern (§2.6, §11): the model holds everything, the DOM renders a window. Yjs also holds everything in memory, so nothing about virtualization fights the CRDT.
- The named upgrade to fractional order-keys "when collaboration makes them worth it" (§16). Collaboration makes them worth it; §5.4 pulls that lever.

### 3.2 What In 011 Is Single-User And Must Change

- History (§7). Inverse-step two-stack history that restores the exact pre-edit document. Under concurrency you cannot restore a document a remote user has since edited, and replaying an inverse step can clobber a remote insert. AC3 in 010 Phase 3 ("undo returns a document deep-equal to the pre-edit document") is a single-user-only invariant and is false collaboratively. Replace with `Y.UndoManager` (§5.3, §6.6).
- Positions (§5). Absolute UTF-16 offsets within a leaf drift when a remote insert lands earlier in that leaf. Cursors (local survival across merges, and all remote cursors) need relative positions (§5.6, §6.4).
- Marks (§4). Offset-range `RangeMark[]` with the §4.4 closed/open boundary rules and the §4.5 step-time remap. Yjs `Y.Text` owns formatting as in-sequence attributes; the remap disappears and the boundary semantics become Yjs's (§5.5, §6.3).
- The store representation (§6.8). Mutable store of frozen nodes mutated by `apply`. Becomes a derived projection of the `Y.Doc`, rebuilt by observers; `deriveInverse` is deleted because `Y.UndoManager` owns inversion (§6.5).
- `MoveNode` (§6.2). The CRDT move problem; resolved by §5.4 (move = set parent + order-key, no array splice).
- `SetObjectData` wholesale swap (§6.5). Last-writer-wins on the whole object under concurrency; fine for coarse objects, but fine-grained objects (a table's cells, a code-block body) need collaborative internals (§4.4).
- `NodeId` minting. If §6.10's "command mints the id" uses a local counter, two offline clients mint the same id and merge into corruption. Must be globally unique (§9, day-one insurance).

### 3.3 What Yjs Is, In One Paragraph Of Mechanics

Yjs is a CRDT library, not a server or framework. A `Y.Doc` holds shared types (`Y.Map`, `Y.Array`, `Y.Text`, `Y.XmlFragment`) in memory; every mutation runs inside `doc.transact(fn, origin)` and emits a compact binary update (`Uint8Array`) tagged with that `origin`. A provider (`y-websocket`, `y-webrtc`, managed) ships updates between peers; `Y.applyUpdate` merges them conflict-free. Initial/diff sync uses a state vector (`Y.encodeStateVector` → `Y.encodeStateAsUpdate(doc, remoteVector)`). `Y.Text` exposes rich text as a delta (`toDelta()` → `[{insert, attributes}]`, `applyDelta(...)`, `format(from, to, attrs)`). Positions that survive concurrent edits are relative positions (`Y.createRelativePositionFromTypeIndex(type, index, assoc)`). Undo is `Y.UndoManager`, which reverts only changes whose `origin` is in `trackedOrigins`, leaving remote edits intact. Ephemeral presence (cursors, who's online) rides a separate awareness protocol (`y-protocols/awareness`) that is never part of document history. Heavy isolated content can be a subdocument (a nested `Y.Doc`) that loads lazily.

## 4. Target Model: The Yjs Document Representation

### 4.1 The Document Tree In Yjs Shared Types

Recommended representation: a single flat node map keyed by id, mirroring 011 §6.8 almost exactly, so the derived read-model is a near-identity transform.

```
Y.Doc
  root: Y.Map
    version:  number                      // 013 schema version (§7.4)
    nodes:    Y.Map<NodeId, Y.Map>        // every node, flat, keyed by id (mirrors §6.8 nodes)
    settings: Y.Map                       // document settings (§2.5), never a body node
    rootId:   NodeId                       // the body container's id

  // each node entry (a Y.Map) carries:
  //   kind:   string                      // "paragraph" | "heading" | "listitem" | "quote" | "callout" | "<object-kind>" | "container"
  //   parent: NodeId | null               // null only for rootId; powers comparePoints (§5.4) and move
  //   order:  string                      // fractional order-key among siblings (§5.4)
  //   attrs:  Y.Map                        // heading level, list kind, align, callout tone, etc. (SetBlockAttr targets)
  //   text:   Y.Text                       // present iff this is a text leaf (§4.3)
  //   data:   Y.Map | subdoc-ref           // present iff this is an atomic object (§4.4)
```

Children are not a `Y.Array`. A container's children are derived: the nodes whose `parent` equals the container's id, sorted by `order`. This is the single decision that disarms the move problem (§5.4) and keeps the shape congruent with 011's `Map<NodeId, Node>` plus `parentOf` reverse index (§5.4): `parent` *is* the reverse index, maintained by Yjs for free.

Rejected: a `Y.XmlFragment` mirroring the tree (the `y-prosemirror` shape). It is the most proven binding, but it couples the model to an XML-DOM-shaped tree, makes virtualization-by-id awkward (no flat id map), and inherits `Y.Array`/fragment move semantics. The flat node map is closer to 011 and to virtualization; we adopt `y-prosemirror`'s *step-translation* idea without its *document* shape.

### 4.2 Node Identity And Ordering

`NodeId` must be globally unique across clients with no coordination. Use `${clientID}-${monotonicLocalCounter}` (where `clientID` is the Yjs client id, stable per session) or a 128-bit random id. Never a bare local counter. This is mandatory even in the single-user build (§9) because ids minted before collaboration must remain valid after it; a migration that re-keys every node is a history-invalidating event.

Ordering uses a fractional order-key string (the `fractional-indexing` scheme: a base-62 string such that `orderKey(a) < orderKey(b)` lexicographically iff `a` precedes `b`). Insert between neighbors mints a key between theirs; move re-mints one key. Concurrency: two clients inserting at the same gap can mint nearby keys that sort deterministically; to avoid the rare identical-key interleave, append a short per-client jitter suffix so equal positions break ties by client. Sibling order is therefore a pure function of the nodes' `order` fields, recomputed on the read-model side, never an array Yjs has to splice.

### 4.3 Text Leaves And Marks As `Y.Text`

A text leaf's `text: Y.Text` replaces 011 §3's immutable string plus §4's `RangeMark[]`. Formatting lives in the `Y.Text` as in-sequence attributes:

- 011 `bold|italic|underline|strike|code|sub|super|highlight` → `ytext.format(from, to, { <kind>: true })`, cleared with `{ <kind>: null }`.
- 011 `link` (the mark carrying `href`) → `ytext.format(from, to, { link: href })`.
- 011 inline atoms (the `￼` sentinel plus offset entry, §4.3) → `ytext.insertEmbed(at, { kind, data })`; each embed is one position, preserving offset alignment.
- The read-model projects `ytext.toDelta()` back into 011's `{ text, marks, inlines }` shape (§6.2/§6.10) so the §3.4 run renderer and §8.5 overlay painter are unchanged. The projection is deterministic, so the rendered run structure stays stable.

The §4.5 step-time offset remap is deleted: Yjs remaps formatting through concurrent edits itself. The §4.4 boundary rules (closed-start/open-end for formats, closed-closed for links) are no longer ours to enforce on an array; they become whatever `Y.Text.format` does, plus the editor's input behavior at run edges. The delta between 011's clamp rules and Yjs's attribute semantics must be characterized in tests (§13), not assumed equal.

### 4.4 Atomic Objects As Nested Types Or Subdocuments

An object node's internals (§2.7) are sequestered, which gives a clean choice per object kind:

- Coarse / wholesale objects (a chart config, a media ref): `data: Y.Map`. Edits are field sets; concurrent edits to the same field are last-writer-wins, which is acceptable for coarse data. This replaces `SetObjectData{from,to}` with field-level Yjs sets, and `BlockDefinition.applyEdit/invertPatch` (§6.5) is no longer needed for undo because `Y.UndoManager` owns it.
- Fine-grained / large objects (a table grid, a `code-block` piece-table body): a **subdocument** (`Y.Doc`) referenced from the node, with its own internal shared types (a `Y.Map` of cells, a `Y.Text` per cell; a `Y.Text` for the code body). Subdocuments load lazily (a 500-page book need not hydrate every table's CRDT up front) and keep an object's internal merges and undo isolated, matching "each heavy object a self-contained sub-engine" (§2.7). The `code-block` piece-table (§3.6) is superseded for the collaborative case by a `Y.Text` body inside the subdoc; the piece-table remains the correct single-user choice and the two reconcile only at the object boundary.

Recommended default: `Y.Map` for objects whose concurrent-edit story is "rare, last-writer-wins is fine," subdocument for any object a second user can meaningfully co-edit. The registry (`BlockDefinition`) gains one obligation: declare its collaborative representation (`"y-map"` or `"subdoc"`) and provide the `toDelta`/`fromDelta`-equivalent for its compat projection.

### 4.5 Settings, Version, And The Doc Root

`settings` is a `Y.Map` at the root (§2.5), never a body node, surviving normalization and compat projection unchanged. `version` is the 013 schema version (§7.4). `rootId` names the body container so the read-model can find the top of the tree without a magic id. These three plus `nodes` are the entire root surface.

## 5. Architecture Decisions

### 5.1 `Y.Doc` Authoritative, Node Graph Derived

Recommended: the `Y.Doc` is the document; the §6.8 store becomes a derived projection rebuilt by Yjs observers; React change detection stays per-node via frozen snapshots produced from observer deltas.

Why: a CRDT only merges if it is the single source of truth. Keeping 011's store authoritative and "also syncing" guarantees divergence, because remote merges and local `apply` would both claim the last word. Deriving the store keeps every consumer above the store (§11 view, §12 SPI, derived indexes §11.4) unchanged, because they still read frozen per-node snapshots; only the producer of those snapshots changes from `apply` to a Yjs observer.

Rejected: keep the store authoritative, treat Yjs as a transport that serializes steps. This is OT-by-hand on top of a CRDT, discards Yjs's entire merge guarantee, and reintroduces the conflict resolution Yjs exists to remove.

### 5.2 The Chokepoint Becomes The Binding Seam

Recommended: `dispatch(command)` compiles to 011's step list (§6.12), then a single `Y.transact(() => applyStepsToYDoc(steps), localOrigin)` writes them to the `Y.Doc`. A `Y.Doc` `update`/`observeDeep` handler is the other half: it reconciles changed nodes into the read-model, fills the §10.3 dirty set, and schedules the frame. Local echo is suppressed by `origin === localOrigin`.

Why: one seam, both directions, so no code path can mutate the document outside it. The step set stays the stable command vocabulary, so commands, queries, and the SPI (§12) are unchanged above the seam.

Rejected: per-command bespoke Yjs writes scattered through command handlers. That re-creates the "many mutation paths" hazard 011 §6.1 closed and makes the local/remote echo guard impossible to centralize.

### 5.3 Replace Inverse-Step History With `Y.UndoManager`

Recommended: delete 011 §7's two-stack inverse-step history and `deriveInverse` (§6.8/§6.9). Use `new Y.UndoManager(scope, { trackedOrigins: new Set([localOrigin]), captureTimeout })`, where `scope` is the root `nodes`/`settings` types (and each active subdocument). Undo grouping (010 §10.5's "typing run = one undo") is `captureTimeout` plus `stopCapturing()` at format/paste/object-activation boundaries. Cursor restoration uses `stack-item-added`/`stack-item-popped` meta carrying relative positions (§5.6).

Why: collaborative undo must mean "undo my changes," not "restore the document." `Y.UndoManager` reverts only `trackedOrigins` changes by item id, so it undoes the local user's edits even after remote merges and leaves remote work intact — the exact semantic a multi-user editor needs and the exact semantic inverse steps cannot provide.

Rejected: keep inverse steps and rebase them through remote updates. This is a research project (operational-transform-grade) layered on a CRDT that already solves it; it would also keep AC3's false invariant alive.

### 5.4 Ordering By Fractional Order-Key, Not `Y.Array` Move

Recommended: store sibling order as a per-node `order` fractional key (§4.2); `MoveNode` becomes "set `parent` and `order`" (two field writes in one transaction), `InsertNode` mints a key between neighbors, with no array splice.

Why: `Y.Array` has no general concurrency-safe move; concurrent move of the same item degrades to delete-plus-insert and can duplicate. A fractional key makes move a last-writer-wins on two scalar fields: concurrent moves of the same node converge (one position wins) with no duplication and no cycles. It also matches 011's existing `parentOf` reverse index and keeps virtualization a sort-by-key over a flat map.

Rejected: `Y.Array` children with array move semantics (duplication risk) and the experimental Yjs array-move (not a stable, documented guarantee at time of writing).

### 5.5 Marks Become `Y.Text` Formatting, Offsets Become A Projection

Recommended: formatting lives in `Y.Text` (§4.3); the read-model derives 011's `RangeMark[]` from `toDelta()` for rendering and queries; commands `AddMark`/`RemoveMark` compile to `ytext.format`.

Why: a CRDT must own formatting positions to merge concurrent formatting; an external offset array cannot be remapped against remote inserts without re-implementing the CRDT. The cost is that 011's precise §4.4 boundary rules become Yjs's attribute semantics, and the hot-path §4.5 remap is gone (Yjs does it). This is a net simplification of our code and a net loss of control over exact boundary behavior; the loss is bounded to edge typing at run boundaries and is characterized by tests, not guessed.

### 5.6 Selection: Local Offsets, Boundary-Crossing Relative Positions

Recommended: keep 011's node-relative `{ node, offset }` selection (§5) for the active leaf's local, synchronous caret math (fast, no allocation). Convert to/from `Y.RelativePosition` (`createRelativePositionFromTypeIndex(ytext, offset, assoc)`, where `assoc` carries 011's affinity bit) at exactly three boundaries: when a remote update lands while a selection is held (rebase the local caret), when storing a selection in undo stack-item meta (§5.3), and when publishing/consuming awareness cursors (§7.3).

Why: relative positions are the only stable cursor representation under concurrent edits, but they are heavier than an integer, so we pay for them only where concurrency can move the ground — not on every arrow key. `assoc` is a direct home for the affinity 011 already isolated, so this is an extension, not a redesign.

## 6. Section-By-Section Adaptation Of docs/011

Each subsection states: what 011 says, what changes, and the target.

### 6.1 §2 Document Model

Unchanged in spirit: a normalized node graph, faithful tree, virtualization on top. Changed in substrate: the graph lives in `Y.Doc.root.nodes` as `Y.Map<NodeId, Y.Map>` (§4.1); `children`-by-id becomes `parent`-plus-`order` (§4.2/§5.4); the in-process `Map<NodeId, Node>` is now a derived read-model. `comparePoints` (§5.4) is unaffected: it walks `parent` (now a Yjs field, still O(depth)), and the `parentOf` invariant test still holds because `parent` is maintained by the same transaction that moves a node. Atomic-object sequestration (§2.7) becomes the subdocument/`Y.Map` boundary (§4.4).

### 6.2 §3 Per-Leaf Text DSA

011's immutable string plus active-leaf draft becomes a `Y.Text` per leaf. The active-leaf input buffer (§3.3: the hidden `<textarea>`/`EditContext`) still exists and still owns transient typing, but on each input diff it now writes `(at, removed, inserted)` into the leaf's `Y.Text` inside one `Y.transact` (§5.2) rather than recording a `ReplaceText` against an immutable string. The §3.4 direct DOM run patch is unchanged for local typing. The new hard case is a remote edit arriving in the leaf you are actively composing in (§6.8, §8). The §3.6 `code-block` piece-table is replaced by a `Y.Text` body in the object's subdocument for the collaborative path (§4.4); single-user keeps the piece-table.

### 6.3 §4 Marks And Atoms

`RangeMark[]` and `InlineAtom[]` become `Y.Text` formatting attributes and embeds (§4.3). Delete §4.5's remap (Yjs owns it). Convert §4.6's deterministic compat projection to run off `toDelta()` rather than the offset array; the projection target (`RichTextEditorDocument` split text nodes plus `format` bitmask) is unchanged, only its input is `toDelta()` instead of `marks`. §4.4 boundary rules are restated as "documented Yjs `format` semantics plus input-time edge behavior," with a conformance test capturing any divergence from the single-user rules.

### 6.4 §5 Positions And Coordinates

`Point = { node, offset, affinity }` stays as the local coordinate. Add a `RelativePoint` = `{ node, Y.RelativePosition }` used only at the three boundaries in §5.6. `comparePoints` and the document-order comparator (§5.4) are unchanged for local points; cross-client ordering of relative points is resolved by Yjs when they are converted back to absolute indices against the current `Y.Text`.

### 6.5 §6 Mutation: Transactions And Steps

The step set (§6.2) stays as the command vocabulary. `apply` (§6.6/§6.8) is rewritten to mutate the `Y.Doc` inside `Y.transact` (§5.2). `deriveInverse` (§6.8/§6.9) and the rollback-by-inverse loop (§6.11) are deleted; atomicity is provided by `Y.transact` (a transaction is all-or-nothing and emits one update). The step→Yjs mapping:

```
ReplaceText{node, at, removed, inserted}  → ytext.delete(at, removed.length); ytext.insert(at, inserted)
AddMark{node, mark}                         → ytext.format(mark.from, mark.to, { [mark.kind]: value })
RemoveMark{node, mark}                      → ytext.format(mark.from, mark.to, { [mark.kind]: null })
SetBlockType{node, to}                       → nodes.get(node).set("kind", to)
SetBlockAttr{node, key, to}                  → nodes.get(node).get("attrs").set(key, to)
InsertNode{parent, index, node}              → create node Y.Map; set parent, order=keyBetween(neighbors); nodes.set(id, m)
RemoveNode{parent, index, node}              → delete node + descendants from nodes (§12 tombstone note)
MoveNode{from, to}                            → nodes.get(node).set("parent", to.parent); set("order", keyBetween(...))
SetObjectData{node, to}                       → object's data Y.Map field sets, or a transaction inside its subdoc
SetSettings{to}                               → root.settings field sets
```

The §6.10 `TransactionBuilder` and §6.12 command compiler are unchanged above the seam; the cumulative intra-transaction `Mapping` (§6.10, the §16 open item) still applies for multi-step commands computing positions against pre-step state, because the steps still apply in order inside the single `Y.transact`. The §16 split/merge mapping must be locked before this, since concurrent split/merge is a known sharp edge (§8).

### 6.6 §7 History

Replaced wholesale by §5.3. The §7.2 worked examples (bulk delete undo cost) are moot: `Y.UndoManager` reverts by tracked item ids, not document replay, and remote concurrent edits are never reverted. 010 Phase 3 AC3 is downgraded to a single-user-only test and a new collaborative-undo AC replaces it (§13).

### 6.7 §8 Selection

The selection model (§8.2 union: text range, node, gap cursor) is unchanged. The painter (§8.5 overlay rects) is unchanged and is reused to paint remote selections in a distinct color (§7.3). What is added: relative-position rebasing of the local selection when remote updates land (§5.6), and an awareness channel carrying remote selections as relative positions. Local single-user behavior is byte-identical to 011.

### 6.8 §9 The Input Substrate

The capture host (§8.4) and the three input regimes (§9.2) are unchanged for capturing local input. The commit path changes: composition commits write to `Y.Text` (§6.2). The defining new problem is the focus/composition race under remote edits: a remote update that mutates the active leaf during local IME composition must not rewrite the composing region mid-composition. The rule: while `composing` is true, queue remote `Y.Text` changes to the active leaf and apply them on `compositionend`, then re-derive the caret from its relative position. This mirrors `y-quill`/`y-prosemirror` composition handling and is the highest-risk single behavior in the adaptation (§8, §12).

### 6.9 §10 Data Flow And Scheduling

A new input source joins the §10/008 lanes: remote `Y.Doc` updates. They arrive asynchronously from the provider, reconcile the read-model, fill the §10.3 dirty set, and coalesce onto the same `frame` flush as local edits. They must carry a remote origin so `Y.UndoManager` ignores them (§5.3) and so the §10.4 "no whole-document subscription" property holds: a remote edit notifies only the subscribers of the nodes Yjs reports as changed (`event.changes`), never a global listener. Awareness updates ride a separate, cheaper channel and never enter the document dirty set.

### 6.10 §11 The View Layer

Per-node subscription (§11.1), snapshot pinning for the active leaf (§11.2), mark-toggle-renders-once (§11.3), the `DerivedIndex` SPI (§11.4), and the subscription registry (§11.5) are all unchanged, because they consume frozen per-node snapshots that the read-model still produces. The only change is upstream: a snapshot is now produced when a Yjs observer reports a node changed, whether the change was local or remote. The active leaf's pin still suppresses re-render during local typing; a remote edit to the active leaf is the one case that must reconcile into the pinned leaf (§6.8) rather than skip it.

### 6.11 §12 The Public Surface And SPI

The command/query SPI (§12.2) is unchanged: hosts still speak commands, never steps, and never Yjs. New mount props (§7.1, §7.3) are added behind the same `<OwnedEditor>` surface: a `collab?: { provider, awareness, user }` option; absent, the editor is single-user and the `Y.Doc` is a purely local in-memory document (Yjs with no provider is a valid single-user store, so the binding does not fork the codebase). `onChange` (the debounced `RichTextEditorDocument` projection, 010 G1) is now derived from the `Y.Doc` on the `debounced` lane. `getOwnedSnapshot()` returns the read-model; a new `getCollabState()` exposes the `Y.Doc`/state vector for persistence (§7.2).

## 7. New Subsystems Yjs Introduces

### 7.1 Providers And Transport

Yjs core does not network. A provider moves updates. The axis (a product/ops decision, not made here): `y-websocket` to a server you run (or Hocuspocus, a Yjs-native server framework) gives a classic client-server model and a natural persistence point; managed (Liveblocks, PartyKit, y-sweet) trades ops for cost; `y-webrtc` is peer-to-peer with no central document server (good for ephemeral, awkward for durable persistence and auth). Recommended default to evaluate first: a server-authoritative WebSocket provider, because this app already has a backend and needs durable persistence and access control anyway. The binding (`owned-model/collab/**`) is provider-agnostic; it consumes a `Y.Doc` and an `Awareness`, so the provider choice does not touch the editor.

### 7.2 Persistence And The Durable Source Of Truth

Under collaboration the durable truth is the `Y.Doc` update history, not `RichTextEditorDocument`. Recommended: persist the Yjs update log plus periodic snapshots (`Y.encodeStateAsUpdate`) in the existing database, keyed by document id; `y-indexeddb` provides local offline persistence and instant reload. `RichTextEditorDocument` becomes a derived export computed on the `debounced` lane for compatibility consumers and for any system that still reads the old JSON (010 G1 stays green as a projection test). This is the persistence migration 010 §12 and 011 §15 flagged as a separate decision; 013 makes it: store Yjs, project compat. Document ingest (an existing `RichTextEditorDocument`) becomes a one-time builder that seeds a fresh `Y.Doc` from the compat JSON (the §4.3 projection in reverse).

### 7.3 Awareness: Remote Cursors And Presence

`y-protocols/awareness` carries ephemeral per-client state (`user: {name, color}`, `selection: RelativePoint[]`, `activeNode`). It is not in document history, so it never affects undo or persistence. Remote selections render through the existing §8.5 overlay painter in the client's color; remote carets render as the existing caret element, colored and labeled. Presence (who is online) reads `awareness.getStates()`. The data path is specified here; cursor/label UX polish is future backlog (§14).

### 7.4 Schema Versioning And Migration Of The `Y.Doc`

Yjs enforces no schema; the shape in §4.1 is ours to evolve. `root.version` carries the 013 schema version. A shape change (rename a field, add a node kind, change an object's collaborative representation) needs a migration that runs inside a transaction when a client opens an older doc, because all clients must converge on one shape. Migrations must be forward-only and idempotent (a client may open a doc another client already migrated). This is a standing obligation collaboration adds that single-user JSON-with-a-version did not, because there is no single "load, migrate, save" moment — documents are long-lived and concurrently open.

## 8. The Hard Problems

These are the genuinely dangerous edges, ranked by how much they bite.

- Remote edits into the active, composing leaf (§6.8). The IME composition race. Mitigation: queue-and-apply-on-`compositionend`, re-derive caret from relative position. Highest risk; needs a dedicated spike with real IMEs before trusting it.
- Concurrent structural edits: split/merge of the same block, move of the same node, delete of an ancestor while a descendant is edited. §5.4 disarms move-duplication; split/merge needs the §16 mapping locked and explicit convergence tests; editing inside a concurrently-deleted ancestor resolves to the deletion (the node is gone) and the local caret must relocate to the deletion boundary by affinity.
- Undo across merges (§5.3). `Y.UndoManager` handles the mechanics, but the product semantics ("what does Ctrl+Z do when my last edit is interleaved with theirs?") need explicit acceptance tests, including redo after a remote edit and undo of a formatting change a remote user partially overwrote.
- Marks concurrency (§5.5). Two users bolding overlapping ranges, or one bolding while another deletes the range. Yjs converges; whether it converges to what a user expects is a UX question to test, not assume.
- Object internals (§4.4). A `Y.Map` object loses concurrent field edits (LWW); promoting an object to a subdocument later is a migration (§7.4), so the `y-map`-vs-`subdoc` decision per object kind should be made before that object ships, not after.
- Large-document memory and tombstones. The whole `Y.Doc` lives in memory with deletion tombstones; Yjs garbage-collects tombstones automatically unless full history is retained. For book-scale docs, subdocuments per heavy object (and possibly per chapter) bound the hydrated CRDT. Virtualization stays a pure view concern and does not reduce `Y.Doc` memory.
- Offline divergence. Two clients edit the same doc offline for a long time, then sync. Yjs merges without conflict, but the merged result may surprise (interleaved paragraphs). This is inherent to optimistic collaboration; the mitigation is product (presence, soft locks on heavy objects), not a code fix.

## 9. Day-One Insurance (Land In The Single-User Build)

These cost almost nothing now and are corrupting or expensive to retrofit. They belong in 011's Phase 3, before any Yjs code exists.

- Globally unique `NodeId` (§4.2). The one non-negotiable. A local counter must never be the id source. This is a one-line change to §6.10's id minting and it prevents silent merge corruption.
- Keep the §6.1 chokepoint absolute. No out-of-band mutation, ever. Already an 011 rule; do not erode it, because it is the binding seam.
- Quarantine history. Build §7 as a swappable module behind an interface (`undo()`, `redo()`, `transactionBoundary()`), so swapping inverse steps for `Y.UndoManager` does not touch call sites. Mark AC3 explicitly single-user-only so no feature builds on exact-document-restoration.
- Abstract ordering behind `orderOf(node)` / `keyBetween(a, b)` (§5.4), even if the single-user build stores an array index underneath, so the fractional-key swap is local.
- Keep marks and positions expressible as deltas and relative offsets. Do not build a feature that assumes an absolute offset stays valid across an external edit.
- Make object internals modeling-ready: the `BlockDefinition` registry should already carry a "collaborative representation" field (defaulting to `y-map`) even if unused, so adding subdocuments later is data, not a registry redesign.

## 10. Implementation Strategy And Phasing

Collaboration slots after 011's single-user runtime (010 Phase 3) and the React view (Phase 4), as a new phase. Sequence by risk.

1. Day-one insurance (§9) lands inside Phase 3. No Yjs dependency yet.
2. Headless Yjs model: build `owned-model/collab/ydoc-schema.ts` (the §4 shapes), the step→Yjs writer, and the Yjs→read-model reconciler. Prove a local-only `Y.Doc` (no provider) round-trips through the binding identically to the §6.8 store. No network.
3. History swap: replace the quarantined history module with `Y.UndoManager`; re-key undo ACs (§13).
4. Two-client headless merge: two in-process `Y.Doc`s synced via `update` events (no provider); property-test convergence for text, marks, move, split/merge, delete-ancestor.
5. Positions and selection: relative-position rebasing and the §6.8 composition race, spiked against real IMEs.
6. A provider and persistence (§7.1/§7.2): wire one provider, `y-indexeddb`, and the server update-log/snapshot store; keep the `RichTextEditorDocument` projection green.
7. Awareness (§7.3): remote cursors and presence through the existing painter.
8. Object internals (§4.4): subdocuments for the first co-editable heavy object.

Each phase ends with a passing headless or browser check; a failed convergence property test blocks the next phase. The single-user build must stay green throughout (the binding is additive; `collab` absent = local `Y.Doc`).

## 11. Implementation Backlog

### R13-A. Day-One Insurance In Phase 3

Scope:

- `owned-model/core/**` (id minting in the §6.10 builder, the history interface, the ordering helpers, the `BlockDefinition` registry)

Tasks:

- [ ] Mint `NodeId` as `${clientID}-${counter}` or a 128-bit random id; remove any bare local counter.
- [ ] Put undo/redo behind an `EditorHistory` interface with a single implementation (inverse steps) for now.
- [ ] Introduce `orderOf`/`keyBetween` helpers even over an array index.
- [ ] Add a `collabRepresentation: "y-map" | "subdoc"` field to `BlockDefinition`, default `"y-map"`, unused for now.
- [ ] Mark 010 Phase 3 AC3 as single-user-only in the test name and a comment.

Acceptance criteria:

- No node id collides across two simulated clients minting concurrently.
- Swapping the history implementation requires touching only the `EditorHistory` module.

Tests:

- `pnpm test` (unit: id uniqueness across simulated clients; history-interface seam).

### R13-B. Headless Yjs Schema And Binding

Scope:

- `owned-model/collab/ydoc-schema.ts`, `owned-model/collab/step-writer.ts`, `owned-model/collab/read-model-reconciler.ts`

Tasks:

- [ ] Implement the §4.1 root shape and node-entry shape.
- [ ] Implement step→Yjs writer for every step kind (§6.5 table).
- [ ] Implement Yjs `observeDeep`→read-model reconciler producing per-node frozen snapshots.
- [ ] Round-trip: drive 011 commands through the binding against a local `Y.Doc`; assert the read-model equals the single-user store output.

Acceptance criteria:

- A scripted edit sequence produces an identical read-model whether run on the §6.8 store or the `Y.Doc` binding.
- Local origin echo is suppressed; no double-apply.

Tests:

- `pnpm test` (unit: per-step writer; reconciler; round-trip equality).

### R13-C. History Swap To `Y.UndoManager`

Scope:

- `owned-model/collab/history-yjs.ts`, the `EditorHistory` interface from R13-A

Tasks:

- [ ] Implement `EditorHistory` over `Y.UndoManager` with `trackedOrigins`, `captureTimeout`, `stopCapturing` at format/paste/object boundaries.
- [ ] Store/restore selection via stack-item meta as relative positions.
- [ ] Replace AC3 with a collaborative-undo AC (§13).

Acceptance criteria:

- Undo reverts only local-origin changes; a remote-origin change is never reverted.
- Undo after a remote interleave restores the local caret correctly.

Tests:

- `pnpm test` (unit: tracked-origin undo; selection restore).

### R13-D. Two-Client Convergence

Scope:

- `tests/owned-model/collab/**`

Tasks:

- [ ] Two in-process `Y.Doc`s synced via `update` events.
- [ ] Property tests for convergence: concurrent text edits, overlapping formatting, concurrent move of one node, concurrent split/merge, edit-inside-deleted-ancestor.

Acceptance criteria:

- Both docs converge to byte-identical state for every generated concurrent scenario.
- No node duplication under concurrent move (§5.4 holds).

Tests:

- `pnpm test` (property tests, fixed seeds in CI).

### R13-E. Selection, Relative Positions, And The Composition Race

Scope:

- `owned-model/collab/relative-position.ts`, the input controller (§9), a Ladle story, `tests/e2e/owned-model-collab-*.spec.ts`

Tasks:

- [ ] Convert selection to/from relative positions at the three §5.6 boundaries.
- [ ] Rebase the local caret on remote updates.
- [ ] Queue remote active-leaf changes during composition; apply on `compositionend`; re-derive caret.
- [ ] Spike against real Microsoft Telex / a CJK IME (reuse the 012 recorder).

Acceptance criteria:

- A remote insert before the local caret does not move the visible caret off its character.
- A remote edit during local composition neither corrupts the composing text nor the model.

Tests:

- `pnpm exec playwright test tests/e2e/owned-model-collab-*.spec.ts --project=chromium --project=webkit --project=firefox`; manual IME log (012 evidence format).

### R13-F. Provider, Persistence, Compat Projection

Scope:

- `owned-model/collab/provider.ts`, server update-log/snapshot store, `y-indexeddb` wiring, the `RichTextEditorDocument` exporter

Tasks:

- [ ] Wire one provider behind a provider-agnostic interface.
- [ ] Persist update log plus periodic snapshots server-side; `y-indexeddb` locally.
- [ ] Derive `RichTextEditorDocument` on the `debounced` lane; keep 010 G1 round-trip green.
- [ ] Ingest an existing `RichTextEditorDocument` into a fresh `Y.Doc`.

Acceptance criteria:

- A reconnecting client restores state from the server log plus local IndexedDB without data loss.
- The compat projection deep-equals the golden (010 G1) after normalization.

Tests:

- `pnpm test`; an integration test for ingest→edit→project→ingest stability.

### R13-G. Awareness And Remote Cursors

Scope:

- `owned-model/collab/awareness.ts`, the §8.5 painter, a presence UI slot

Tasks:

- [ ] Publish local selection as relative positions and `user` identity on awareness.
- [ ] Render remote selections/carets through the overlay painter in per-client colors.
- [ ] Expose presence (`getStates`) to the host UI.

Acceptance criteria:

- A remote selection paints at the correct geometry and survives local edits.
- Awareness changes never enter the document dirty set or undo.

Tests:

- `pnpm exec playwright test` (two-context cursor rendering); unit: awareness encode/decode.

## 12. Edge Cases And Failure Modes

- Active-leaf remote edit during IME composition: queue and apply on `compositionend`; never rewrite the composing region (§6.8). Worst single risk.
- Concurrent move of the same node: converges to one position via order-key LWW; no duplication (§5.4). Test it explicitly.
- Edit inside a concurrently-deleted ancestor: the node vanishes on merge; relocate the local caret to the deletion boundary by affinity; do not resurrect the node.
- Concurrent split/merge: requires the §16 intra-transaction mapping locked; assert convergence and that no orphan node ids remain.
- Local `NodeId` collision: prevented structurally by §4.2; a property test mints concurrently and asserts uniqueness.
- Undo after remote interleave: `Y.UndoManager` reverts only local items; assert remote edits persist and the caret restores from meta.
- Object `Y.Map` LWW data loss under concurrency: accepted for coarse objects; for co-editable objects use a subdocument (§4.4). Do not silently lose a co-editable object's edits.
- Tombstone/memory growth on huge docs: bound via subdocuments and Yjs GC; monitor `Y.Doc` memory in the perf dashboard (008).
- Provider disconnect / offline: edits apply locally to the `Y.Doc`, persist to IndexedDB, and sync on reconnect; the UI must show a sync state, never block typing.
- Schema-version skew: an older client opening a newer doc runs the forward-only idempotent migration (§7.4); a client too old to migrate must refuse to edit rather than corrupt.
- Subdocument fails to load: the object renders its baked snapshot (§2.4/006) read-only until the subdoc hydrates; never block the outer document.
- Compat projection divergence: 010 G1 golden round-trip runs in CI against the `Y.Doc`-derived projection; a divergence fails the build.

## 13. Test And Verification Plan

- Unit: per-step Yjs writer, read-model reconciler, relative-position conversion, order-key `keyBetween`, awareness encode/decode, id uniqueness.
- Property (headless, two in-process docs): convergence for text, marks, move, split/merge, delete-ancestor; node-id uniqueness; no-duplication-under-move.
- Collaborative undo: tracked-origin-only revert; redo after remote edit; caret restoration; AC3 retired and replaced.
- Browser e2e (chromium/webkit/firefox, two contexts): live two-client typing, remote cursor rendering, remote edit during composition, offline-edit-then-reconnect.
- IME manual (012 evidence format): remote edit during real Telex/CJK composition on a Windows machine.
- Compat: 010 G1 golden round-trip from the `Y.Doc` projection; ingest→edit→project→ingest stability.
- Perf (008 dashboard): `Y.Doc` memory at book scale; remote-update frame cost stays within budget; no whole-document notify on a remote single-node edit.
- Commands: `pnpm test`; `pnpm exec playwright test tests/e2e/owned-model-collab-*.spec.ts --project=chromium --project=webkit --project=firefox`; `pnpm check`.

## 14. Future Backlog

- Cursor/label UX polish, follow-mode, selection name tags.
- Soft locks or presence hints on heavy objects to reduce offline-divergence surprise.
- Comments/suggestions as awareness-plus-document hybrids.
- Per-chapter subdocuments for very large books (lazy CRDT hydration beyond heavy objects).
- Server-side `Yrs` (Rust) for validation/transform if the backend is not Node.
- History checkpoints / snapshot compaction policy for very long-lived documents.
- Access control and per-document permissions (owned outside this document).

## 15. Definition Of Done

Collaboration is foundationally adopted when all hold:

- The `Y.Doc` is the authoritative document; the §6.8 store is a derived read-model; the §6.1 chokepoint is the only mutation path, both directions.
- History is `Y.UndoManager`, local-only; AC3 is retired and the collaborative-undo ACs pass.
- `NodeId`s are globally unique; a concurrent-mint property test proves no collision.
- Two clients converge to identical state across the §13 property scenarios, with no node duplication under concurrent move.
- Selection survives remote edits via relative positions; a remote edit during IME composition corrupts neither text nor model.
- A provider plus `y-indexeddb` plus server persistence restores a reconnecting client without loss; the `RichTextEditorDocument` projection (010 G1) stays green.
- Remote cursors render through the existing overlay painter; awareness never touches document history or undo.
- The single-user build is unchanged and green with `collab` absent (local `Y.Doc`, no provider).
- `pnpm check` passes.

## 16. Open Decisions

- Provider/hosting: self-hosted WebSocket (or Hocuspocus) vs managed (Liveblocks/PartyKit/y-sweet) vs p2p (`y-webrtc`). Recommended to evaluate server-authoritative WebSocket first (§7.1); the binding is provider-agnostic, so this is deferrable without architectural cost.
- Order-key scheme details: base, jitter length, rebalancing policy for pathological interleaving (§4.2). Lock with the §5.4 implementation.
- Per-object `y-map` vs `subdoc` defaults per heavy-object kind (§4.4). Decide before each object ships; changing later is a migration.
- The §16-of-011 intra-transaction `Mapping` for split/merge must be locked before R13-D, because concurrent split/merge convergence depends on it.
- Persistence retention: full update history vs periodic snapshot-plus-recent-log (affects undo depth across sessions and storage cost, §7.2).
- Whether the durable store flips fully to Yjs or keeps `RichTextEditorDocument` as a dual-write during a migration window (§7.2; 010 §12's persistence-migration decision, now recommended toward Yjs-durable).

## 17. Final Model

Final verdict: reject this model.

The owned model was built single-user but collaboration-aware, and that remains the right direction. The mistake in this proposal is treating Yjs as the collaborative foundation rather than as a possible adapter below the owned-model contract. The proposal's central inversion - `Y.Doc` becomes the document, the node graph becomes a derived read-model, marks become `Y.Text` formatting, history becomes `Y.UndoManager`, and persistence trends toward Yjs updates - is too large a replacement of docs/011.

The future collaboration direction should keep docs/011 authoritative. A valid plan may borrow narrow pieces from this rejected proposal, but it must start from the opposite premise: IDCO's owned model, selection model, object lifecycle, bake/export contract, and virtualization invariants remain the source of truth. Any CRDT, including Yjs, has to prove itself as a bounded replication layer under those invariants, not redefine them.
