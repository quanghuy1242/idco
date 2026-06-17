# 014 - Future-Proofing The Owned Model For CRDT: A Brainstorm

> Status: brainstorming and rough planning, owner-drafted, pre-implementation. Not a backlog, not a phase plan, not a set of tickets. It records a line of reasoning we worked through so it is not lost, and it names the few decisions that have to land early. Treat the recommendations as leans to revisit, not commitments.
>
> Date: 2026-06-18
>
> Relationship to the other docs:
>
> - 011 (the DSA foundation) is authoritative for the single-user model. This doc proposes a small set of amendments to 011 and explains why they belong in Phase 3 rather than later. The amendments themselves live in 011 §2.2, §3.7, §4.4, §5.1, §6.1, and the consolidated rationale in 011 §17.
> - 013 (the rejected Yjs adaptation) is the thing this doc is the constructive answer to. 013 made `Y.Doc` authoritative and demoted 011 to a projection, which inverted authority and was rejected. This doc keeps 011 authoritative and treats any CRDT as a replication layer underneath it.
> - 010 (the plan) gets its Phase 3 contract and its collaboration open-decision updated to point here.

## 0. What This Is And Is Not

This is a brainstorm about one question: if we want the single-user owned-model editor to be future-proof for real-time collaboration, what has to be true on day one of Phase 3, and what can wait until collaboration is actually built?

It is not a collaboration design. We are not building collaboration in Phase 3. We are making sure that adding it later is a bounded addition rather than a teardown of the model, the marks, the selection, and the input code.

The whole doc rests on one distinction that turned out to be the key to everything: behavior is free to add later, addressing is forever. A merge rule is a function you write the week you build collaboration. The way a mark boundary or a stored caret is addressed is baked into every saved book and into every line of code that reads a position, so getting it wrong means rewriting that code and migrating that data. The day-one job is to fix the addressing and the data shapes, and to build zero collaboration machinery.

## 1. The Frame: Collaboration-Shaped Without Building Collaboration

010 §12 already committed to "no collab plumbing now, but avoid model decisions that are collab-hostile." This doc sharpens that from a vague intention into a short, concrete list, because "avoid collab-hostile decisions" is not actionable until you name which decisions are hostile.

The honest correction to 010 §12: it said collaboration stays possible "at no extra cost." That is not quite true. There is a small, deliberate day-one cost, and paying it is the whole point. The cost is that prose leaves carry character identity and marks anchor to it from the start, instead of being retrofitted. The alternative, deferring that to the collaboration project, is the rewrite we are trying to avoid.

## 2. The One Decision: Identity-Addressing, Not Offset-Addressing

011 today addresses text by integer offset. A mark is `{from, to}` as UTF-16 offsets into the leaf string. A `Point` is `{node, offset}`. That is correct and cheap for single-user, because a local edit remaps every offset atomically inside the step that caused it (011 §4.5), so an offset is never stale between edits.

Offsets break under concurrency for a structural reason, not a bug. An offset is a coordinate, and a coordinate is only meaningful relative to a particular version of the text. When a remote edit arrives, it changes the text out from under every offset that was computed against the old version, and there is no general way to fix them without a translation layer that maps old offsets to new ones through the remote change. That translation layer is exactly the thing that drifts.

The CRDT answer, used by every serious collaborative text system, is to address by character identity instead. Every character gets a stable id when it is born. A position is expressed relative to a character id plus a side (before or after it), not as an integer. When remote edits insert and delete around it, the id still points at the same character, so the position cannot land on the wrong content. There is nothing to translate and nothing to drift.

Two postures get you there, and we considered both.

- Posture A, the shadow. Keep 011's model offset-pure, and maintain a parallel character-identity structure at the collaboration adapter that translates offsets to relative positions at the seam. The model stays clean, but the shadow has to be kept in perfect sync with the model, and that sync is a new drift surface. It also has to carry mark-boundary translation, not just text positions, which is more drift surface than it first appears.
- Posture B, native identity. The prose leaf carries character identity itself. Marks anchor to character ids. Positions anchor to character ids. There is no shadow, because the model already speaks identity.

We chose B. It is cleaner, it has no shadow to drift, and it turns mark correctness from a property we maintain into a property that is structurally impossible to violate. The earlier lean was toward A, on the theory that A keeps the model pure, but once you see that A's shadow has to mirror the mark anchoring too, B is the honest choice.

## 3. Why Range Marks Are Already The CRDT-Native Model

A tempting wrong turn is to think the range-mark system is the thing to give up, and to reach for a "native" CRDT formatting model instead. The conclusion flips once you look at what the native model actually is.

The state of the art for collaborative rich text is Peritext (Ink and Switch, 2022). Its central argument is, almost word for word, an argument for the model 011 already has and against the model you would reach for. Peritext stores formatting as separate range-mark objects whose endpoints are anchored to character identities with before-or-after stickiness, because the two alternatives are worse.

- Per-character inline attributes, which is what a `Y.Text` format run actually is under the hood, cannot cleanly express "bold grows when I type at its end, a link does not." That open-start, closed-end distinction is exactly what 011 §4.4 already pins, and it is exactly what 013's rejection flagged `Y.Text` for losing.
- Inline formatting modeled as real nodes in the tree, the split-and-merge-spans approach, reintroduces the concurrent split-and-merge anomaly that Peritext was invented to kill.

So "give up range marks for a native CRDT model" would mean trading Peritext down to the `Y.Text` model. That is backward. 011's mark side-table is the design that wins under concurrency, not the naive choice that loses.

The reframe that matters: the mark question is not a separate decision from the text-identity decision. They are one decision. If leaves carry character identity, marks anchor to it and become drift-free by construction, because a boundary that is a character id cannot point at the wrong character no matter what concurrent edits happen. The remap-by-step machinery in 011 §4.5 stops being a thing you have to get right and becomes a thing that cannot be wrong. So picking posture B hands us Peritext marks for free and retires the mark-drift risk entirely.

## 4. The Cost Reality

The fear is that character identity means a struct per character and an allocation per keystroke. That is the naive model and it is not what real CRDT sequences do.

Two things kill that cost.

- Ids are computed, not stored. A character id is `{clientId, clock}` where clock is a per-client counter. The id of the k-th character in a run is `{client, startClock + k}` by arithmetic. A run stores one id and a length, not an id per character. "Every character has an identity" is true conceptually and costs nothing per character to store.
- Sequential typing coalesces into one run. Typing forward appends to the current run's string and bumps the counter. No new struct. Typing "hello world" is one run that grows, not eleven structs.

The numbers, for the book workload.

- A leaf at rest, written once, which is the overwhelming common case for a book, costs about 1 to 2 percent more than the bare string: one run header of roughly 120 bytes plus mark boundaries that are character ids rather than 4-byte integers. Across a 10,000-block book that is on the order of a megabyte of structural overhead total, smaller than a single image.
- A leaf reworked hard over its life fragments into a handful of runs, one extra run per distinct edit point, bounded by the number of edit points in its history, and adjacent runs from the same author with consecutive clocks merge back together. So fragmentation is bounded and partly self-healing.
- Per keystroke is a wash. 011 already keeps the active leaf's text in the browser input buffer and only commits to the model on the diff (011 §3.3), so neither model copies a 5,000-char string per key. The run split on commit is O(1)-ish.

The one genuinely new cost, with no analog in the current model, is tombstones. A deleted run leaves an id-range placeholder until the deletion is causally stable. Single-user you collect it immediately, since there are no peers to wait for, so it never accumulates. Collaborative GC waits until every peer has acknowledged the delete. So tombstone growth is bounded by edits in flight, not by document age, and it is a discipline rather than a hard problem. It is the price posture B charges for retiring drift, and on a read-heavy book workload it is cheap.

The conclusion the numbers point to: memory is not the axis this decision turns on. At rest, for a book, the difference is 1 to 2 percent. The thing actually worth attention is whether we want to own tombstone GC as a permanent responsibility, and even that is cheap in the single-user build because we collect on every commit.

## 5. What Posture B Retires

Picking B clears three problems off the table before collaboration is even built, because anything anchored to a character id cannot drift.

- Positions survive concurrent edits with no translation layer.
- Marks become drift-free by construction, the Peritext result.
- Step rebasing has a clean substrate, because the steps already carry ids, and 011 §6.3 already reserves `mapStep` as the rebase hook.

So the hard problems that remain are all the ones that are not character-level. That is the next section.

## 6. Build, Not Buy

Posture B needs a character sequence with run encoding and ids under each prose leaf. Two honest ways to get it.

- Own it. Write a minimal run-encoded sequence ourselves. It is not much code, and the technique is well understood. This keeps zero foreign dependencies at the foundation, keeps the owned model genuinely authoritative, and leaves any CRDT library as a future replication adapter we can choose or not.
- Embed `Y.Text` as a pure character sequence, using only its identity and run encoding, none of its formatting, with our mark layer anchored on top. This saves implementation work and matches the "CRDT as a bounded layer under the owned model" posture that 013's rejection actually approved. The cost is a foundation-level dependency on Yjs.

Decision: own it. We are already building the model, the steps, the history, the selection, and the input substrate ourselves. Importing a library for one data structure, while taking on a foundational dependency and that library's formatting assumptions we explicitly do not want, is the wrong trade. The minimal owned sequence keeps the owned model authoritative in fact, not just in name, and a CRDT library stays available later as a replication adapter if we ever want one.

## 7. The Hard Problems No Choice Makes Cheap

These are the problems that would be hard under any CRDT choice, including a Yjs-native one. None of them blocks Phase 3. Each is decided the week collaboration is actually built. The recommendations are leans, delegated to common sense and standard practice, to revisit when the time comes. The value of writing them now is that the single-user model must not foreclose them, and so far it does not.

### Tier 1: shape the foundation eventually, decide nothing now

- Concurrent tree-move. Two peers move X under Y and Y under X at once, and naive convergence makes a cycle or loses a subtree. This is orthogonal to posture B; it is a tree problem, and a CRDT library gives no help, since most cannot even re-parent. We own it. Lean: Kleppmann's 2021 algorithm, last-writer-wins on the parent pointer under a total operation order, skip any move that would form a cycle. On move-versus-delete, orphan the subtree up to root rather than delete it, because losing a block is worse than a stray one. 011 already has the right primitive, since `MoveNode` is first-class, so this is a rule to add, not a redesign.
- Heavy-object collaboration semantics. Tables, code-blocks, mermaid, and data-grids sequester their internals in opaque data (011 §2.7, docs/006). The sequester boundary is a gift here, because it lets each object type pick its own merge story, but each one has to pick. Lean: atomic whole-object last-writer-wins by default, opt into finer granularity per type. A code-block is text, so it opts into char-level. A table opts into cell-level. Mermaid and data-grid stay whole-object until someone proves they need more. This is the area most likely to be hand-waved and the one with the least prior art, so it is the first one to work through when collaboration becomes real.
- Selective, local undo under remote edits. Undo must pop your last edit, not your collaborator's, and if a remote edit landed on top of yours, your inverse step has to rebase through it. Lean: keep 011's inverse-step history, make it origin-filtered, and rebase the inverse through intervening remote steps with `mapStep`. Do not import a foreign undo manager wholesale; that was 013's over-reach.

### Tier 2: convergence quality and determinism

- Insertion interleaving. Two peers type at the same caret at once. Convergence is guaranteed either way; the question is whether the result interleaves or stays in contiguous blocks. Lean: take YATA's behavior, which is proven and good enough for prose, and do not hand-roll Fugue unless real interleaving complaints appear.
- Compatibility-projection determinism. The `RichTextEditorDocument` export is a derived projection, and for export, caching, and the docs/006 static snapshot to be valid, two converged peers must produce a byte-identical projection. Lean: define a total order on marks at a boundary, by type, then anchor id, then value, so the projection is a pure function of converged state.
- Bake on a causal cut. The docs/006 author-time bake captures a point in time, and under collaboration it must bake a causally consistent snapshot, not whatever the live store says this millisecond. Lean: bake operates on a versioned, quiescent cut, which ties to projection determinism.

### Tier 3: present now, build later

- Remote cursors in a virtualized view. A remote peer edits a leaf that is scrolled offscreen and unmounted, and you cannot paint a caret on DOM that does not exist. Lean: awareness data always flows, paint a caret if the leaf is mounted, and degrade to an edge marker if it is offscreen.
- Delete-while-edit. A peer deletes the block you are typing in. Lean: content wins, revive the node to host it, the same principle as the move rule.
- Offline reconciliation and initial-sync cost. A peer edits offline and reconnects, and everything rebases at once; a book-scale doc with long history is expensive to replay on first load. Lean: persist periodic snapshots plus state-vector diffs, and never replay the full op log on load. This is more an operations concern than a foundation one, but the persistence format should leave room for it.

## 8. The Line: Behavior Is Free Later, Addressing Is Forever

The reason none of section 7 blocks Phase 3 is that every item there is behavior, decided and implemented the week collaboration is built. Adding the Kleppmann rule later is a function you write. Choosing YATA interleaving later is a function you write. None of it touches the saved bytes or forces a rewrite of position, mark, selection, or input code.

What cannot wait is anything that bakes into the persisted bytes or forces that rewrite. Re-anchoring every mark in every saved book from integer offsets to character ids, and rewriting every line of selection, input, and mark code that assumed integers, is a teardown. That is the entire content of the day-one footprint, and it is small.

## 9. Day-One Footprint In Phase 3

These are the changes that land in Phase 3, single-user, building zero collaboration machinery. They are the amendments folded into 011, listed here as the rough plan. Each is cheap now and expensive-or-impossible to retrofit, which is the test for being on this list.

- Global node ids. `NodeId` is globally unique, opaque, and client-minted, never a per-document index. 011 already mints ids in the command, so this is pinning the scope, not new machinery. Irreversible if missed, because every saved doc bakes its ids and its cross-references.
- Character identity under prose leaves. The prose leaf's durable substrate is a run-encoded character sequence with stable ids, not a bare string. Single-user there is one client id and a monotonic clock, so the ids are real and stable with no network and no rebasing. The offset stays the working coordinate for input and rendering; the character id is the durable anchor. This is the one format change that prevents the rewrite, because all the mark, position, selection, and input code gets written once against ids instead of twice.
- Marks anchored to character ids. A mark boundary is a character id plus stickiness, resolved to an offset at use. The open-and-closed-sides rules from 011 §4.4 become the stickiness of the anchor. Everything else about marks stays as written.
- Positions anchored to character ids. A stored `Point`'s durable anchor is a character id; the offset is the resolved working coordinate. The affinity bit from 011 §5.3 already exists and pairs with the anchor.
- A transaction origin slot. Every transaction carries an origin, always local in Phase 3. A free field now, a history-layer rewrite if added later, because origin is what lets the future history filter local from remote and what lets the dispatch loop avoid echoing remote steps.

What needs nothing: the tree structure is already collaboration-ready, because `children: NodeId[]` is identity-addressed already. So `MoveNode`, `InsertNode`, and `RemoveNode` can stay index-based in Phase 3 and rely on `mapStep` for rebasing later. Structure does not need the posture-B treatment; only text does, because text is the one place 011 currently addresses by integer.

What we explicitly do not build in Phase 3: rebasing, awareness, multi-peer GC, move-conflict resolution, the Kleppmann rule. Single-user GC is trivial, collect tombstones on every commit. This keeps Phase 3 fully single-user while being collaboration-shaped to the byte.

## 10. What We Deliberately Defer

Everything in section 7. The persistence format question of whether storage eventually becomes an op log plus snapshots, which is 010 §12 and should leave room but decide nothing. Awareness and presence. Any choice of network provider or transport. Multi-peer GC tuning. The decision of when, or whether, collaboration is built at all, which is a product call after Phase 8.

## 11. Open Questions To Revisit

- The exact shape of the owned minimal sequence. Run encoding, the id-to-offset resolution, and how the active leaf's input buffer reconciles into runs on commit. This is implementation detail, settled when Phase 3 builds the leaf substrate, not now.
- Whether tombstone GC in the single-user build is truly free or merely cheap. The lean is collect-on-commit, but the first implementation should measure it.
- The heavy-object collaboration semantics in Tier 1, which is the one with no prior art and the one most likely to drift. It is fine to leave open, but it is the first thing to design when collaboration becomes real, not the last.
- Whether the day-one character-identity weight is acceptable on the read-heavy book workload as measured, rather than as estimated. A one-afternoon spike that loads a real book's worth of blocks into the run-encoded representation and reads the actual byte counts would turn the 1-to-2-percent estimate into a measured number before we commit hard.
