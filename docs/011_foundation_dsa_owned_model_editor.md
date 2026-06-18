# 011 - Foundation: Data Structures & Algorithms for the Editor Engine

> Status: design foundation (pre-implementation). Pure design and rationale.
>
> Date: 2026-06-17
>
> This document fixes the data structures under docs/010. Where 010 covers the product thesis, the four layers, and the phasing, this one pins the data structures, the coordinate system, the mutation algebra, the history model, and the selection model. Every structure gets explained, every cost gets a number, every alternative gets weighed, and every place a mainstream engine beats us (Lexical snapshots on bulk undo, native contenteditable on accessibility) gets named.
>
> It carries no implementation, no backlog, no tickets, no phases. Type shapes and algorithms appear as design artifacts, the precise object of each decision, not as code to copy.
>
> Source and corrected docs:
>
> - `docs/010_owned_model_virtualized_editor_plan.md` is the engine plan. This document corrects 010 §7.2's flat-store tilt and §5.5/§7.4's hand-paint-as-baseline emphasis (see §12). Everything else in 010 holds.
> - `docs/002_gap_cursor_and_block_flow.md` is the gap-cursor problem, folded into the selection union (§8.2).
> - `docs/006` is the heavy-object / bake model that makes atomic objects (§2.4).
> - `docs/008` is the lane/budget scheduler the hot paths here respect.
>
> Browser contracts this design stands on (reused, never reimplemented):
>
> - `caretPositionFromPoint` / `caretRangeFromPoint` for pixel to text position.
> - `Range.getClientRects()` / `getBoundingClientRect()` for text position to pixel geometry.
> - Engine-painted overlay rects from `Range.getClientRects()` for range painting without contenteditable (CSS Custom Highlight is an optional future optimization over the same ranges, not a contract this design stands on).
> - `Intl.Segmenter` (UAX #29) for grapheme, word, and sentence segmentation.
> - Hidden `<textarea>` / native `EditContext` for keyboard, IME, and clipboard capture plus an accessibility anchor.

## Table Of Contents

- [0. Reading Guide](#0-reading-guide)
- [1. The Foundational Stance](#1-the-foundational-stance)
- [2. The Document Model: A Normalized Node Graph](#2-the-document-model-a-normalized-node-graph)
- [3. Text Representation: The Per-Leaf DSA](#3-text-representation-the-per-leaf-dsa)
- [4. Inline Content: Marks And Atoms](#4-inline-content-marks-and-atoms)
- [5. Positions And Coordinates](#5-positions-and-coordinates)
- [6. Mutation: Transactions And Steps](#6-mutation-transactions-and-steps)
- [7. History](#7-history)
- [8. Selection](#8-selection)
- [9. The Input Substrate](#9-the-input-substrate)
- [10. Data Flow And Scheduling](#10-data-flow-and-scheduling)
- [11. The View Layer](#11-the-view-layer)
- [12. The Public Surface And SPI](#12-the-public-surface-and-spi)
- [13. Low-Level Invariants: The Bleed List](#13-low-level-invariants-the-bleed-list)
- [14. The Cost Ledger](#14-the-cost-ledger)
- [15. What This Corrects In docs/010](#15-what-this-corrects-in-docs010)
- [16. Genuinely Open Sub-Decisions](#16-genuinely-open-sub-decisions)
- [17. Collaboration-Readiness: The Day-One Footprint And Why It Lands Now](#17-collaboration-readiness-the-day-one-footprint-and-why-it-lands-now)

---

## 0. Reading Guide

The whole design turns on one inversion: the model is the document, and the DOM is a disposable view of it. Every structure below exists to make that inversion cheap and correct. Read each section as the answer to one question.

- §2 asks what the document is made of. A normalized tree of nodes.
- §3 asks how the text of one node is stored. An immutable, identity-bearing sequence (a string with character ids, §3.7), while the active one lives in the browser's input buffer.
- §4 asks how formatting is stored over that text. Sorted range marks plus inline atoms, remapped by the edit itself.
- §5 asks how a location is named. A node-relative point, UTF-16, with affinity.
- §6 asks how the document changes. Invertible steps through a single chokepoint.
- §7 asks how undo works. Inverse steps, never snapshots, with the one place that hurts named.
- §8 asks what is selected and who paints it. The model owns it; overlay rects from browser `Range` geometry are the proven baseline painter; contenteditable does neither.
- §9 asks how keystrokes reach the model. One re-keyed hidden input host mirrors the active leaf.
- §10 asks what bites at the character level. UTF-16 versus graphemes, IME, affinity, the final line.

One theme repeats: the block partition is itself the most important data structure. Because the document is a tree of small nodes, every per-node cost (string copy, mark shift, DOM patch) is bounded by one small node, never the book. Most "is this expensive?" questions dissolve once you hold that the blast radius of an edit is one node.

### 0.1 Vocabulary, because several words name different things on different layers

The same content exists in three representations — the **model** (the source of truth), the **input buffer** (what captures keystrokes), and the **rendered DOM** (what the user sees). Most terms belong to exactly one layer, and **"node" is the worst offender**: in the model it is a block; in the DOM it is a formatting run. Hold the layer and the rest of the document stops equivocating.

| Term | Layer | Means |
| --- | --- | --- |
| **node** | model | a node in the document graph — a block (paragraph, heading, list item, container). **Not a DOM node.** |
| **block** | model | a top-level structural node; the unit of virtualization, move, copy (§2.6) |
| **(text) leaf** | model | a node that holds `text` + marks + inline atoms and no child nodes (§2.3, §3) |
| **mark** | model | a formatting range (`bold`, `link`, …) over a leaf's `text`, anchored to character ids and resolved to offsets (§3.7, §4.4); invisible to the input buffer |
| **inline atom** | model | a non-text inline (glossary chip, inline image), one `￼` in `text` (§4.3) |
| **point** | model | a position, node-relative: `{ node, anchor, offset }`, durable identity is `node` + character-id `anchor`, `offset` resolved (§5) |
| **object / atomic object** | model | a heavy block (table, `code-block`, media) whose internals are opaque to the outer engine (§2.4, §2.7) |
| **store** | runtime | the one mutable container holding nodes, order, selection, history (§6.8) |
| **step / transaction / command** | mutation | the invertible primitive / its bundle / the high-level intent (§6) |
| **active leaf** | model + input | the one leaf currently being edited; snapshot-pinned, patched imperatively (§3.3, §11.2) |
| **input buffer / capture host** | input | the single hidden `<textarea>` / `EditContext` for the active leaf; holds the flat-string projection of that one leaf, no marks (§8.4, §9) |
| **run** | rendered DOM | one styled slice of a rendered leaf (`<strong>…</strong>`, a plain text node); one per formatting segment. This is the "DOM node" §3.4 patches |
| **overlay rects** | rendered DOM | engine-painted caret/selection rectangles, the baseline painter (§8.5) |

The recurring trap, stated once: one paragraph is **one block (one model node)**, captured by **one input buffer (one flat string, no marks)**, but rendered as **several runs (several DOM nodes)** — one run per formatting segment. Typing patches the single run you typed into; the marks shift as model offsets; nothing else in the DOM is rebuilt (§3.4, §3.5).

---

## 1. The Foundational Stance

### 1.1 Do not derive the model backward from virtualization

The original tilt (010 §7.2) reasoned this way: we want to virtualize, virtualization likes a flat list of self-contained blocks, so the model is a flat `order: BlockId[]` of `text: string` blocks. That derives the document shape from a rendering convenience. It forces real structure (nested lists, table grids, multi-block quotes) to flatten, blob, or sentinel-hack itself to fit. Those contortions are how an editor accrues permanent warts nobody can reason about later.

The corrected stance: the model is faithful to the document first. A technical book is a tree. Lists nest, tables are grids, quotes and callouts hold blocks, inline content has structure. The model represents that tree honestly. Virtualization layers on top of a faithful model and never deforms it.

### 1.2 "Normalized" and "flat" are independent properties

The flat tilt conflated two properties that are orthogonal.

- Normalized means addressed by id through a `Map<NodeId, Node>`, for O(1) lookup, per-node subscription, and structural sharing. We want this.
- Flat means the top-level body is the only level and nodes cannot contain nodes. We do not want this, because it cannot represent a table.

A normalized graph can be a tree when nodes reference children by id. Lexical's own `NodeMap` works this way (010 §7.2 praises it), and so does Notion's block graph. We keep normalized and drop flat.

### 1.3 The inversion, stated once

Every capability that historically required DOM presence (selection, copy, find, TOC, caret) reads the model or a derived index, never the DOM. The DOM holds only the visible window and gets rebuilt freely. This is the property `contenteditable` cannot give, since it makes the DOM the document, and it is what lets us virtualize a live editing surface.

---

## 2. The Document Model: A Normalized Node Graph

### 2.1 Shape

```
Document
├── nodes:   Map<NodeId, Node>          // O(1) lookup, per-node subscription
├── root:    NodeId                      // the body container
└── settings: DocumentSettings           // publication/page settings (docs/006)

Node = StructuralNode | TextLeafNode | AtomicObjectNode
```

- A structural node carries ordered `children: NodeId[]` and no text: `body`, `list`, `listitem`, `table`, `tablerow`, `tablecell`, `quote`, and `callout` when it contains blocks.
- A text-leaf node carries inline content (§3, §4) and no child nodes: `paragraph`, `heading`, `listitem` when it directly holds text, `callout` in its plain-text variant, and `quote` when it holds text directly.
- An atomic object node carries opaque registry-owned `data` plus a `baked` snapshot and a `status`, and the caret never enters it character by character: `code-block`, `media`, `table` (by product choice, §2.4), `mermaid`, `data-grid`, `embed`, `post-ref`, and `table-of-contents`.

### 2.2 Why a graph of ids, not a deep object tree

Editing a text node in a deeply nested cell must not rebuild its ancestor chain. With children referenced by id:

- A text edit replaces only that text node's map entry. The cell, row, table, and body keep their object identity, because their `children: NodeId[]` arrays still hold the same ids. No ancestor rebuild.
- A structural edit (insert, remove, move a child) changes exactly one parent's `children` array and nothing above it.

Structural sharing falls out of id-addressing for free. A deep object tree (`{type, children: [{...}]}`) would mint a new object for every ancestor on every keystroke, which is the rejected walk-the-whole-document path.

A `NodeId` is globally unique, opaque, and minted by the client, never a per-document index or array position. Single-user this looks like over-specification, but it is the one identity decision that is irreversible once books are persisted: every saved document bakes its ids and every cross-reference (selection anchors, marks, the body order, `parentOf`) resolves through them, so a later switch from a document-local id to a global id is a data migration across every stored book, not a code change. It is also the precondition for the future collaboration seam, where two clients must mint non-colliding ids offline. We pay the global-id discipline on day one and the format never has to move (§17).

### 2.3 Node kind to layer assignment (the master table)

This table is the synthesis that dissolves the flatten contortions. Each compat node type maps to exactly one role.

| Compat type | Role | Stored as |
| --- | --- | --- |
| `paragraph`, `heading` | text leaf | inline content (§3/§4) |
| `quote` | text leaf or structural | inline content, or `children` if it holds blocks |
| `callout` | text leaf (plain) | inline content (single plain run today) |
| `list` | structural | `children: listitem ids` plus `listKind`, `start` |
| `listitem` | text leaf, may hold a nested `list` child | inline content; optional nested `list` child id; `checked?` |
| `table`, `tablerow`, `tablecell` | atomic object (table) wrapping a faithful grid | grid subtree inside the object's `data` (§2.4) |
| `code-block` | atomic object | `data.code` (piece-table, §3.6), `language`, `baked` |
| `media`, `embed`, `post-ref` | atomic object | registry `data` plus `baked` |
| `table-of-contents` | atomic object (positional) | registry `data` = its settings (§2.5) |
| inline `link` | range mark (§4.2) | `{kind:"link", href, from, to}` |
| inline `mark` (highlight) | folded into the `highlight` format mark (§4.2) | `{kind:"highlight", from, to}` |
| inline `glossary` | inline atom (§4.3) | `￼` plus atom entry |
| inline `linebreak` | soft break | `\n` in the text string |
| text-node `format` bitmask | per-format range marks (§4.2) | one mark per format bit per run |

The only recursion that survives lives where it belongs: inside the model (lists nest, cells hold blocks), or inside an atomic object's `data` where the text layer never walks it.

### 2.4 Tables are an atomic object by choice, and the grid stays faithful

A table is one of docs/006's named heavy objects, so it takes the bake and one-live-slot lifecycle: at rest it is a baked static grid, and once activated it edits as a single live surface. That is a lifecycle decision, not a modeling compromise. The grid is not a blob hiding from a flat store. The table object's `data` holds a faithful `row → cell → block` subtree. We chose object-hood for the editing lifecycle, and the structure stays honest.

The contrast with the earlier mistake matters. The wrong move was "table becomes a blob because the flat model can't represent a grid." The right move is "table is a faithful grid that happens to edit as one live object." Same word, opposite reason.

### 2.5 Settings live in two honest places, never repurposed nodes

- `table-of-contents` stays a positional atomic object in the body, because its position in the flow is real and aside placement is a rendering of that node. Its settings are its `data`.
- `DocumentSettings` (publication and page settings, docs/006) live on the document root, not as body nodes and not as ad-hoc fields on the compat tree.

We do not lift the TOC node's settings into `DocumentSettings`. That would split one positional concept across two places and invent a round-trip for data that is already positional.

### 2.6 Virtualization grain

Virtualization windows over the body's top-level `children` (the body order array). A top-level block mounts with its whole subtree, so a 50-item list is one top-level block that mounts whole, which is correct because you do not virtualize within a list. The virtualization index is the body order array, and each entry resolves to its subtree by id in O(1). A pathologically huge single subtree (a 10,000-row table, a 5,000-line code block) is the deferred internal-virtualization case, handled inside that one object later, never by deforming the top-level model.

Virtualization is a view-layer decision, not a model property, so it carries an on/off switch that changes nothing the model guarantees. The mount prop `virtualize` (§12.1) defaults to `true` and the engine windows the body order as above; set it to `false` and every top-level block mounts at once, which is the same render the engine produces before the windowing layer exists. Because the model owns selection, copy, find, and order (§1.3, §10.4), turning virtualization off strictly removes the offscreen case: there are no virtualized gaps to paint (§8.5) and no cross-virtual copy edge to handle. The switch is a boolean by design; an "auto by block count" mode would reintroduce a runtime threshold of the kind §3.1 rejects, so it stays a named future lever, not a third state. The cost of keeping the switch honest is that the non-virtualized path stays a maintained, tested render rather than dead code, since a small document edits with it off and the reader builds on the same all-mounted render (docs/015).

### 2.7 Atomic object internals are sequestered

An atomic object's internal structure (a table's `row → cell → block` grid, §2.4) lives inside the object's opaque `data`, not in the main `nodes` Map. The outer engine never addresses a node inside a live object and never compares points across the boundary. While an object rests it is a baked snapshot. While it is live it runs its own internal model and selection, and the outer document's selection over it is a single `{type:"node", node: objectId}` (§8.2). This keeps `comparePoints` (§5.4) scoped to the outer tree, keeps focus and selection arbitration to one surface at a time (010 §6.4), and makes each heavy object a self-contained sub-engine. The cost is that an object like a table reimplements a small internal selection model, which stays isolated and bounded.

Opaque to the outer mutation engine does not mean invisible to document services. A `BlockDefinition` for an object with meaningful internal content must expose object-level adapters for whole-node copy, plain-text search, export/bake completeness, and any indexable anchors it owns. The outer selection still treats the object as one unit; when that unit is copied, searched, exported, or indexed, the object definition supplies the internal projection. If a definition omits an adapter, the service treats the object as atomic and uses the baked fallback or reports the capability as unsupported, never silently pretending table cells or code lines were searched.

---

## 3. Text Representation: The Per-Leaf DSA

### 3.1 The DSA is a property of the node type, decided statically, with no runtime threshold

A runtime "if the block grows past N chars, switch its structure" rule is a mode with a boundary, and boundaries breed bugs. We reject it. The text DSA is chosen by node type at design time and never changes for a given node.

- Prose text leaves use an immutable, identity-bearing character sequence, always: a run-encoded string where each character has a stable id (§3.7). For all single-user cost reasoning below, read this as "an immutable string," since a write-once paragraph is one run; the character ids are the durable anchor that makes marks and positions collaboration-ready (§17) and add about 1 to 2 percent at rest.
- `code-block` uses a piece-table inside the object's `data`, always (§3.6).

A paragraph never becomes a code block. A 5,000-char paragraph is not a trigger to switch structures. It is malformed content, a wall of text with no breaks, and ingest splits or rejects it the way it would a 2 GB image.

### 3.2 Why a plain immutable string for prose, and why not a rope everywhere

The block partition means every prose leaf is one paragraph, tens to low hundreds of UTF-16 units. At that size a plain immutable string is the actual optimum. Read "string" in this section as the cost model for the run-encoded sequence of §3.7: a write-once paragraph is a single run, so its insert/delete/index/overhead costs are exactly the string costs analyzed here, and the character ids ride along for about 1 to 2 percent. The string-versus-rope reasoning below is what decides the per-leaf structure; the character ids are an addressing layer on top of it, not a different structure.

| Structure | insert/delete | index | per-small-block overhead | right for |
| --- | --- | --- | --- | --- |
| Immutable string | O(n) copy | O(1) | none | inactive prose leaves (read, share, serialize), the 99.9% |
| Browser input buffer | O(1) amortized (native) | O(1) | n/a (platform-owned) | the one active leaf (§3.3) |
| Piece table | O(log n) | O(log n) | several objects/buffers per block | `code-block` body (large by nature) |
| Rope | O(log n) | O(log n) | higher constants | unused, piece-table covers code |

A rope or piece-table carries higher constant factors and only wins asymptotically at sizes a prose leaf never reaches. Applied to every one of ~10,000 small blocks it is pure overhead (extra objects, memory, allocation) times 10,000. A single document-level rope (the CodeMirror and VS Code model) loses for a different reason: it flattens the document into one text buffer with structure layered on top, which fights the nested block tree we chose (010 §6.8). Given a block tree, the per-leaf optimum is string plus browser-buffer plus piece-table-in-code.

The only cost of this choice is eating an O(n) string copy on a degenerate huge paragraph, and even at 5,000 chars that copy runs about 1 µs (§3.5). We take that over a runtime mode-switch.

### 3.3 The active leaf's text lives in the browser's input buffer

While a leaf is being edited, its authoritative mutable text is an `ActiveLeafDraft` backed by the browser's input buffer (the hidden `<textarea>` or `EditContext`). That buffer is a native, gap-buffer-grade mutable text structure the platform maintains for free. The frozen node object stays pinned for React (§11.2), but the store's read path is still current: reads of the active leaf return `draft.currentText`; reads of inactive leaves return the frozen leaf content, the run-encoded character sequence of §3.7 (its text is a string; its durable form carries character ids).

Three consequences follow.

- We do not replace the frozen leaf content per keystroke. Each input event hands us a diff `(at, removed, inserted)`, and `dispatch` records the corresponding `ReplaceText` step immediately.
- Marks, atoms, history, and selection remap off that diff (§4.5, §8.8), so the model is current after every keystroke even though React still sees the pinned snapshot.
- The immutable leaf content (the run-encoded sequence, §3.7) materializes from the draft on deactivation, on a discrete structural command that needs a rerender, or when a non-active reader/serializer asks for the canonical snapshot.

Per-keystroke frozen-content cost during active editing rounds to zero. Inactive leaves stay immutable run-encoded sequences (§3.7), optimal for reading, structural sharing, and serialization.

### 3.4 DOM update: locate the exact styling node, patch it, bypass the framework

A text leaf renders as a flat list of run elements (`<strong>…</strong><em>…</em>…`). On a keystroke we do not re-render the block.

1. Look up the edit offset in the cached offset-to-text-node map (binary search, O(log runs)).
2. That yields the single DOM text node of the affected run.
3. Mutate that one node's `.data` off the diff. O(1).

The other runs are not recreated, not diffed, not touched. React is bypassed for the active leaf's text. React owns mounting and structure; the input controller owns the active leaf's text-node content imperatively, and React reconciles the block once, on deactivation. Letting the framework reconcile the block's children per keystroke is O(block) and does jank, which is the mistake we avoid.

What touches the whole block is the browser's reflow, re-wrapping the lines below an insertion. That is intrinsic to text on every platform (a native `<textarea>` reflows identically), it is the browser's optimized layout engine, and it is not a cost we own. "Browser reflows the lines" is not "we rebuilt the DOM."

### 3.5 Worked example: insert one char at offset 0 of a 5,000-char, ~200-mark paragraph

The canonical worst case, decomposed into its four real costs.

| Cost | What actually happens | Order | Real number |
| --- | --- | --- | --- |
| DOM (ours) | patch one text node's `.data` (run at offset 0) | O(1) | ~ns |
| Marks (ours) | suffix shift of a sorted array, each item one integer add | O(N) | ~0.1 µs for 200 |
| Offset map (ours) | lazy rebuild or patch | O(1)–O(N) lazy | ~0.1 µs or deferred |
| String (ours) | none until blur, browser buffer owns it (§3.3) | O(0) | 0 |
| Reflow (browser) | re-wrap lines below | browser's | intrinsic, fast |
| React | nothing | — | 0 |

Total cost we control rounds to sub-microsecond, about five orders of magnitude under a 16 ms frame. O(N) on marks is fine because big-O hides the constant: the per-item work is a single ADD instruction, and N is bounded by one paragraph. The two ideas that make this fine are patch the precise styling node (do not re-render) and keep the heavy structures as named escapes the partition prevents us from needing (§3.2, §4.5).

### 3.6 `code-block` uses a piece-table inside the object, always

Code is large by nature, since a 5,000-line listing is one big string. The `code-block` atomic object holds its body as a piece-table in `data.code`: an immutable original buffer plus an append buffer, with a balanced tree of immutable pieces. Insert and delete run O(log n), the original is never mutated (undo-friendly, since pieces are immutable spans), and offset-to-piece runs O(log n). This is the VS Code model scoped to the one node type that needs it. It is a different node type with a different, statically chosen DSA, not a runtime switch of a prose leaf. Internal viewport virtualization of a very large single listing is deferred (010 §6.8) and lives behind this same node.

### 3.7 Character identity under prose leaves, the collaboration-ready substrate

The prose leaf's durable substrate is not a bare string. It is a run-encoded character sequence in which every character has a stable id, while the offset stays the working coordinate for input, rendering, and the offset-to-node map. This is the one place the model addresses text by identity instead of by integer, and it is the load-bearing change for collaboration-readiness (§17). It does not violate the §3.1 rule, since it is the statically chosen structure for the prose-leaf type, not a runtime mode switch, and it is not a rope smeared over the whole document.

The shape, stated once.

- A character id is `{client, clock}`, where `clock` is a per-client monotonic counter. Single-user there is one client, so ids are a local counter, with no network and no rebasing. The id of the k-th character in a run is `{client, startClock + k}` by arithmetic, so a run stores one id and a length, not an id per character.
- Sequential typing appends to the current run and bumps the counter, so a write-once paragraph is one run, not one struct per character. Editing at a new position splits a run, one extra run per distinct edit point, bounded by the leaf's edit history, and adjacent runs from the same client with consecutive clocks merge back.
- The offset is derived from the sequence at use, so §3.3 (active leaf in the input buffer), §3.4 (patch the precise styling node), §5.2 (UTF-16 storage, grapheme navigation), and the offset-to-node map are unchanged. The character id is added as the durable anchor for marks (§4.4) and stored points (§5.1); the offset remains the transient coordinate the browser speaks.

The cost is about 1 to 2 percent of a leaf's memory at rest for ordinary write-once prose, one run header plus character-id mark boundaries, on the order of a megabyte across a 10,000-block book. Per keystroke is a wash, since 011 already keeps the active leaf's text in the browser buffer (§3.3) and commits on the diff, so neither a string nor a sequence is copied per key. The one genuinely new cost is tombstones, the id-range placeholder a deleted run leaves until the deletion is causally stable; single-user collects them on every commit, so they never accumulate, and the collaborative case bounds them by edits in flight, not document age. The full cost reasoning and the build-it-ourselves decision live in docs/014.

---

## 4. Inline Content: Marks And Atoms

### 4.1 The compat tree has two inline mechanisms; the model unifies them

Read-side, inline content arrives two ways.

- A bitmask `format` on text nodes: bold, italic, strikethrough, underline, code, subscript, superscript, highlight.
- Wrapping element nodes with children: `link` (carries `href`) and `mark` (a highlight wrapper), plus inline leaves `glossary` (renders its own term and definition, ignores children) and `linebreak` (a soft `<br>`).

A text leaf's content is therefore more than a string. The model holds three parts.

```
TextLeafContent = {
  text:    string            // UTF-16; '\n' = soft line break (linebreak)
  marks:   RangeMark[]       // sorted by `from`; formatting & links over `text`
  inlines: InlineAtom[]      // sorted by `at`; glossary etc., one '￼' each in `text`
}
```

The active leaf projects this to a flat string for the input buffer (§4.3): each inline atom becomes one `￼` (one UTF-16 unit, so offsets stay aligned). Marks stay invisible to the buffer because they are formatting, except IME preedit, which gets painted separately (§9.4).

### 4.2 `RangeMark`: per-format ranges plus link

```
RangeMark =
  | { kind: "bold"|"italic"|"underline"|"strike"|"code"|"sub"|"super"|"highlight"; from; to }
  | { kind: "link"; href: string; from; to }
```

Two decisions carry weight here.

- Per-format ranges, not one bitmask range. A single bitmask over a range cannot represent overlapping formats with different boundaries (`bold[0,10]` plus `italic[5,15]`). Per-format ranges can. Projection to the compat bitmask computes, per maximal equal-format run, the union of covering format marks (§4.6).
- Fold the `mark` highlight element node into the `highlight` format mark. They render the same, and one representation removes the "is this highlight a bit or a wrapper?" ambiguity before it can drift.

`link` is the one mark that carries data and projects to a wrapping element rather than a bitmask.

### 4.3 Inline atoms: `￼` sentinel plus offset entry

Inline leaves that are not ranges over text (glossary chips today, inline images later) are atoms.

```
InlineAtom = { at: number; kind: "glossary"|…; data: … }
```

In `text`, each atom occupies exactly one `￼` (OBJECT REPLACEMENT CHARACTER, one UTF-16 unit) so every offset stays aligned across the model, the input buffer, the marks, and the selection. `linebreak` is not an atom. It is a plain `\n` in `text`, a soft break inside the block, since block boundaries are the only hard splits. Navigation treats an atom as one grapheme cluster (§10).

### 4.4 Mark storage: a sorted array of absolute offsets, with per-kind boundary rules

Marks for a leaf form a flat array sorted by `from`. A boundary's durable anchor is a character id plus a stickiness side (§3.7), resolved to an absolute UTF-16 offset at use; the sorted array and every algorithm below operate on those resolved offsets, so this is an addressing change at the boundary, not an algorithm change. Boundary semantics (what happens when you type exactly at an edge) are fixed per kind, so two implementers cannot diverge, and under the character-id anchor each kind's rule is simply which side the anchor sticks to.

- Formats (`bold` through `highlight`) are closed-start, open-end: the start sticks after its character and the end sticks after the last character, so typing at the end of a bold run continues bold and typing immediately before it does not retroactively bold.
- `link` is closed-start, closed-end. Typing at either edge does not extend the link.
- Deletion spanning a boundary clamps the mark; deletion that empties a mark drops it; the destroyed marks ride in the inverse (§4.5).

Anchoring to character ids is what makes §4.5's "drift is structurally impossible" hold across a remote edit and not only within the local step that caused it: a boundary that is a character id cannot point at the wrong character no matter what concurrent edits happen, which is the Peritext result (docs/014). Single-user the offset remap of §4.5 and the id anchor agree; the id anchor is the form that survives collaboration.

### 4.5 Marks remap as part of the step, which is why they never drift

A mark never exists as a stale offset between edits. It remaps atomically inside the apply of the step that mutated the text, as a pure function of that step. For `ReplaceText(at, removed, inserted)` with `delta = inserted.length − removed`, per mark:

```
at ≥ mark.to                   → unaffected
at ≤ mark.from                 → mark.from += delta; mark.to += delta
at inside [mark.from, mark.to] → extend or clamp per the kind's open/closed rule
```

Cost is O(marks-in-this-leaf), a handful of integer adds, sub-microsecond even at hundreds of marks (§3.5). Because the remap is part of applying the step, no window exists in which an offset is stale. Drift is structurally impossible, not merely avoided.

Undo stays lossless. The inverse of a text step carries the removed slice with its marks (ProseMirror's `ReplaceStep` model, per leaf): the inverse of "delete [a,b)" stores the text and the marks that lived in [a,b), so undo restores them exactly. We never reconstruct marks by guessing; the information a clamp would lose rides in the inverse.

The named escape, not built, is a delta-encoded mark structure (a `RangeSet` B-tree). A prefix insert shifts every mark, O(N) with a flat array. Store positions as deltas between adjacent marks in a balanced tree (CodeMirror's `RangeSet`) and an insert touches only the one gap at the insertion point: O(log N) update, O(log N) absolute-position lookup (you walk in order to paint anyway, so absolute positions are free during the walk). This wins only when a single leaf holds thousands of marks, the same malformed-content territory as a 200 KB paragraph, excluded by the block partition. We keep the flat array (O(N), tiny N) as the static choice and document the B-tree as the escape, the exact parallel of string-versus-rope (§3.2). No runtime threshold; a static choice justified by the partition.

### 4.6 Deterministic projection, so round-trip is idempotent

The model-string to compat split-text-nodes mapping is a pure, idempotent function, or the golden round-trip flakes.

- Ingest coalesces adjacent equal-format text nodes into one run.
- Projection splits minimally, one text node per maximal equal-format run.
- Only block-level nodes carry ids; text and inline nodes are id-less derived output, so `ensureDocumentNodeIds` stays the only id source and id stability is a block-level concern.

---

## 5. Positions And Coordinates

### 5.1 Node-relative points, not flat-integer document positions

```
Point = { node: NodeId; anchor: CharId; offset: number /* UTF-16, resolved */; assoc?: -1 | 1 }
```

A point's durable identity is `node` plus a character-id `anchor` (§3.7); the `offset` is the working coordinate resolved from the anchor against the leaf's current sequence, and every comparator and remap below runs on that resolved offset. A transient caret produced from a hit-test starts as an offset and resolves to an anchor when it is stored in the selection. The `anchor` is why a stored position survives a remote edit, the same reason marks anchor to ids (§4.4); single-user the anchor and offset agree, and the anchor costs nothing because the leaf already carries character ids. The `assoc` affinity bit (§5.3) is independent of the anchor and disambiguates wrap and bidi boundaries.

Two candidate coordinate systems compete.

| | Flat-integer (ProseMirror) | Node-relative (this design) |
| --- | --- | --- |
| One global linear coordinate | yes | no |
| Edit in node X affects positions in node Y | yes, everything past X shifts, map through a global mapping | no, Y untouched, only offsets within X remap |
| Survives unmount (virtualization) | integer meaningless without the linearized doc | yes, NodeId persists in the map regardless of DOM |
| Fits a virtualized, block-partitioned model | awkward, constant global remap | natural |

ProseMirror chose flat-integer because it does not virtualize, and one coordinate space is fine when the whole doc sits in the DOM. We virtualize and partition, so node-relative wins twice: most edits remap no other node's positions, and a point survives unmount because the id lives in the map. Lexical, also normalized but not virtualized, likewise uses `(key, offset)`, the closer analog.

### 5.2 UTF-16 storage, grapheme navigation

The input buffer reports UTF-16 code-unit offsets. The model stores offsets (and mark `from`/`to`, and `Point.offset`) as UTF-16 units so model and input layer stay 1:1, never converted to code-point indices, which would desync from the buffer. Caret movement and deletion are grapheme-cluster aware (`Intl.Segmenter`, UAX #29): never split a surrogate pair, a ZWJ emoji, a Hangul syllable, a Thai cluster, or combining Vietnamese. Storage in UTF-16, navigation in graphemes. Keeping these straight is a top bug source (§10).

### 5.3 Affinity

An offset at a soft-wrap or bidi boundary can render at the end of line N or the start of line N+1. Under §8's custom-paint model we derive geometry ourselves, so the `assoc: -1 | 1` bit on the point disambiguates. It lives in the type from day one, because retrofitting affinity later is painful.

### 5.4 The document-order comparator, a required primitive

To know whether `anchor` precedes `focus` (to render a range, to delete in order, to extend a selection) we compare two `Point`s in document order without walking the DOM, since offscreen nodes have no DOM. The model owns:

```
comparePoints(a: Point, b: Point): -1 | 0 | 1
```

The comparator is pure, but it leans on a reverse index that is not pure.

```
parentOf: Map<NodeId, { parent: NodeId; index: number }>   // reverse index, maintained by apply()
pathOf(node): readonly number[]                            // walk parentOf to root; O(depth)

comparePoints(a, b):
  if a.node === b.node: return sign(a.offset − b.offset)
  pa = pathOf(a.node); pb = pathOf(b.node)
  compare pa, pb lexicographically; the first differing index decides
  if one path is a prefix of the other → the ancestor/descendant case
```

`parentOf` is part of the `Document` invariant and is maintained inside `apply()`: every `InsertNode`, `RemoveNode`, and `MoveNode` updates the moved child's entry and shifts the `index` of following siblings, which is O(siblings) per structural edit and rare. Depth is about five in practice (paragraph in cell in row in table in body), so `pathOf` and the comparator run effectively O(1). The ancestor/descendant case only arises for a `NodeSelection` on a container against a text point inside it; resolve the container point as the position just before its child at the descendant's index. `parentOf` is the single correctness hinge: if `apply()` lets it drift, `comparePoints` lies and selection corrupts silently, so a property test asserts after every transaction that each node's `parentOf` entry matches its actual parent's `children`. Rendering, copy, delete, and selection-extend all lean on this, so it is a foundational primitive, not an incidental helper. Atomic object internals never appear here, because they are sequestered (§2.7).

---

## 6. Mutation: Transactions And Steps

### 6.1 The single chokepoint

The only way the document changes is `dispatch(transaction)`. The store exposes no other mutation API, so there is nowhere to quietly mutate. Encapsulation enforces this, not discipline, and it is the structural property that makes the inverse-step history model safe (§7.4).

```
Transaction = {
  steps:           Step[]        // ordered, atomic, invertible
  inverse:         Step[]        // inverse steps, reverse order
  selectionBefore: Selection
  selectionAfter:  Selection
  origin:          "local"       // who produced it; always "local" in Phase 3 (§17)
}
```

`origin` is always `"local"` single-user and is the one collaboration field that lands in Phase 3, because retrofitting it is a history-layer rewrite. It is what a future history filters on to undo only local steps, and what the dispatch loop checks to avoid echoing a remote step back to its sender. A free field now; an expensive seam if added after the history is built (§17).

### 6.2 The step set

A small, closed union of invertible primitives.

- `ReplaceText { node, at, removed, inserted, removedMarks?, removedAtoms? }`
- `AddMark { node, mark }` / `RemoveMark { node, mark }`
- `SetBlockType { node, from, to }` (paragraph to heading, etc.)
- `SetBlockAttr { node, key, from, to }` (heading level, list kind, align, callout tone)
- `InsertNode { parent, index, node }` / `RemoveNode { parent, index, node }`
- `MoveNode { from:{parent,index}, to:{parent,index} }`
- `SetObjectData { node, from, to }` (atomic objects, §6.5)
- `SetSettings { from, to }`

Split and merge (Enter at a boundary, Backspace joining blocks) are composite transactions over these primitives, not new step types. A transaction inverts by reversing its step list, so composites invert for free, with no bespoke split/merge inverse logic.

### 6.3 Invertibility contract

Each step type provides `invert(step, docBefore) → step`, property-tested so that `apply(apply(doc, s), invert(s, doc)) ≡ doc` over generated edits. `invert` takes the pre-edit document because it must capture what the step destroys: the removed text, its marks, its atoms, the old attr or data value. Steps are closed under mapping (`mapStep(step, over)`), which is what selection-remap (§8.6) and future collaboration rebasing build on. `mapStep` is the day-one rebase hook: Phase 3 builds it for selection-remap, and collaboration reuses the same closure to rebase a remote step over local ones, so the rebase seam exists from the start rather than being bolted on (§17). Every step type must implement it, since a step that cannot be mapped cannot be rebased.

### 6.4 Normalization is appended steps, never a side effect

Editors normalize: merge adjacent equal-format runs, drop empty nodes, repair list nesting. If any of that runs as a side effect outside a transaction, the inverse cannot know about it and undo drifts. So normalization runs as additional steps appended inside the transaction (ProseMirror's `appendTransaction` model) and inverts as one unit with the user's steps. There is no "outside a transaction." This rule keeps history from silently diverging (§7.4).

### 6.5 Object and custom-node mutations are steps too

An atomic object's `data` is opaque to the engine. Its edits stay invertible without the engine understanding the data.

- Wholesale immutable swap: `SetObjectData{from, to}` keeps the old `data` reference, and invert swaps `from`/`to`. Free invert, no deep copy.
- Registry patch: a `BlockDefinition` may provide `applyEdit(data, patch) → data'` plus `invertPatch(patch, dataBefore) → patch'` for objects that want fine-grained, cheap-to-store edits (a large grid).

Either way the engine never reads object internals to undo them. The registry contract therefore carries an invertibility obligation, not just a parse and serialize one.

### 6.6 Structural sharing on apply

`apply(doc, step)` returns a new `Document` that shares every untouched node by reference (§2.2). A text edit produces a new map entry for one node; a structural edit, a new `children` array for one parent. Memory churn per edit is proportional to the change, never the document.

### 6.7 The commit pipeline

Every change runs one sequence inside `dispatch`, and the three selection primitives hang off it.

```
dispatch(transaction):
  doc'     = apply(doc, steps)                              // §6.1–6.6, structural sharing
  parentOf = update for structural steps                   // keeps comparePoints honest (§5.4)
  selectionAfter = command ?? mapSelection(before, steps)  // §8.8
  commit (doc', selectionAfter) to history                 // §7
  notify subscribers (per-node + selection)
    → changed leaves re-render; their offset↔node map rebuilds (§3.4)
    → the selection view re-derives Ranges, repaints overlay rects + caret (§8.5)
```

`comparePoints` keeps document order truthful, `mapSelection` keeps the selection valid, and the per-leaf offset↔node map serves both the edit patch and the paint. The chokepoint (§6.1) guarantees the whole sequence runs on every change, so no path mutates the document and forgets to remap the selection or repaint. Miss one step and you get the classic failure of owning the model: a selection that points at a node that no longer exists, or a highlight painted over stale geometry. The notify step is where the scheduler (docs/008) takes over: the model step lands on the `sync` lane, and the render and repaint coalesce onto one `frame` task (§7.3 of 010), so a keystroke never triggers a synchronous per-subscriber re-render.

### 6.8 The store representation: mutable store, immutable nodes

The signatures above (`apply(doc): Doc`) read as a fresh document per edit. Taken literally that means cloning the `nodes` map every keystroke, which is O(nodes) and dies at book scale, or adding a persistent-map dependency that 010 G4 forbids. The resolution puts immutability at the node level, not the document level.

```
Store {                          // mutable; one instance, mutated in place
  nodes:    Map<NodeId, Node>    // entries replaced one at a time, the map is never cloned
  order:    NodeId[]
  parentOf: Map<NodeId, { parent: NodeId; index: number }>
  selection, dirty, history, activeLeafId
}
// Node objects are frozen and immutable. A change REPLACES one node object;
// untouched nodes keep their identity.
```

`apply(step)` mutates the store: `nodes.set(id, newNode)` for the one changed node, an `order` splice for a structural step. O(1), no map clone. React change detection still works because the changed node is a new object reference, so its per-node snapshot fails `Object.is` (§11.2), while untouched nodes keep their reference and do not re-render. Structural sharing falls out of node identity for free, and no old document objects are retained.

We drop immutable-document snapshots because history is inverse steps, not snapshots (§7). Nothing needs yesterday's whole document; undo mutates the store backward with inverse steps. The two forces that usually push toward an immutable document, change detection and history, are each served better another way: node identity for the first, inverse steps for the second.

This refines the §6.3 invertibility contract. `invert` cannot take a pre-edit `Doc` object, because none exists in a mutate-in-place store. The inverse is captured at apply time, from the live node, just before mutation.

```
applyStep(store, step):
  before  = read the affected node(s)      // still pre-mutation
  inverse = deriveInverse(step, before)     // capture destroyed text/marks/data now
  mutate store in place
  return inverse
```

The transaction builder collects each step's inverse as it applies, so by commit it holds the full reverse list without ever materializing a pre-edit document. The core is controlled mutation behind the `dispatch` facade (§6.1), not a pure `Doc → Doc` fold. The immutability that matters for correctness lives in the frozen node objects and the inverse-step history, not in a cloned document.

### 6.9 Step handlers as a data table

The step union is closed, since the engine owns it and providers never add steps (§6.2), so a discriminant-keyed handler table beats a class hierarchy.

```
type StepHandler<S> = {
  apply(store: Store, step: S): void;          // mutate in place
  deriveInverse(store: Store, step: S): Step;   // read pre-state, return the inverse step
  map(step: S, over: Step): S | null;           // move this step's positions through another
  touches(step: S): readonly NodeId[];          // feeds dirty.nodes and touchedNodes
};

const stepHandlers: { [K in Step["type"]]: StepHandler<Extract<Step, { type: K }>> } = { … };
applyStep = (store, step) => stepHandlers[step.type].apply(store, step);
```

The mapped type makes the table exhaustive: omitting a handler for a step kind is a compile error, so the step set and its four operations stay in lockstep. `SetObjectData` delegates `deriveInverse` to the block's `BlockDefinition.invertPatch` (§6.5), so the engine inverts an object edit without understanding the object's internals. No inheritance, no visitor, just a lookup keyed by the discriminant. The mutable store (§6.8) defines what state looks like; this table defines the only functions allowed to touch it.

### 6.10 The transaction builder

A command holds a `TransactionBuilder` to express an edit. The decision: it accumulates steps without touching the store, and the store applies them atomically at `dispatch` (§6.11). `apply` stays in one place, the builder is side-effect-free until commit, and a command that bails halfway changes nothing.

```
class TransactionBuilder {
  private steps: Step[] = [];
  private mapping: Mapping;          // cumulative map of positions through steps pushed so far
  private selectionAfter?: Selection;

  constructor(private store: Store) {}     // bound for reads; never mutates the store

  push(step: Step): this { this.steps.push(step); this.mapping.append(step); return this; }

  replaceText(node, at, removed, inserted): this { /* push a ReplaceText */ }
  insertNode(parent, index, node): this { /* push an InsertNode */ }
  addMark(node, mark): this { /* push an AddMark */ }
  // ... one helper per step kind

  mapPoint(p: Point, bias?: -1 | 1): Point { return this.mapping.map(p, bias); }
  setSelection(sel: Selection): this { this.selectionAfter = sel; return this; }
}
```

Two properties make this enough for real commands without ever staging a mutated store.

Ids are allocated by the command, not by `apply`. A split-block command needs the new node before it can move trailing content into it, so the command mints the `NodeId`, puts the fully-formed node inside the `InsertNode` step, and later steps reference that id. There is no "read the store to find what I just inserted" round-trip, so the store stays untouched until dispatch.

A cumulative mapping handles intra-transaction position math. A command that deletes `[a, b)` then inserts where `b` was maps `b` through the first step with `tr.mapPoint(b)`. The builder threads each pushed step's `map` (the §6.9 handler) into a running `Mapping`, so positions computed against the original state stay correct after earlier steps. This is ProseMirror's `tr.mapping`, and it is the only state the builder carries beyond the step list. How that `Mapping` behaves in node-relative coordinates is the open question in §16.

### 6.11 The dispatch loop

`dispatch(tr)` is the single place steps apply. It is the §6.7 commit pipeline at code shape, with atomic rollback.

```
dispatch(tr):
  applied: Step[] = []                       // inverses collected so far, for rollback
  touched: Set<NodeId> = {}
  try:
    for step in tr.steps:
      h = stepHandlers[step.type]
      inverse = h.deriveInverse(store, step)   // from LIVE pre-state (§6.8)
      h.apply(store, step)                     // mutate in place
      applied.push(inverse)
      add h.touches(step) to touched
      update parentOf if step is structural
  catch e:
    for inv in reverse(applied): applyStep(store, inv)   // roll back; store unchanged on failure
    throw e

  runNormalization(store, touched)             // appended steps, same loop, captured in `applied` (§6.4)
  selBefore = store.selection
  selAfter  = tr.selectionAfter ?? mapSelection(selBefore, tr.steps)   // §8.8
  store.selection = selAfter
  history.record({ steps: tr.steps, inverse: reverse(applied), touched, selBefore, selAfter })
  fillDirty(store.dirty, touched, selChanged, structureChanged)        // §10.3
  scheduleFrame()
```

`deriveInverse` reads live pre-state, which is correct because a command builds and dispatches synchronously with no concurrent edit between, so the store at dispatch equals the state the command built against. The rollback path replays collected inverses on a thrown step, so a half-applied store is impossible and atomicity costs nothing extra, since the inverses are collected anyway. Normalization (§6.4) runs in the same loop and its steps land in `applied`, so undo reverses the user's steps and the normalization as one unit.

### 6.12 The command compiler

A command (the public intent, §12.2) becomes a transaction through a compile registry. Each command kind is a pure function from current state plus args to a builder, or null when the command does not apply.

```
type CommandSpec<C> = {
  type: C["type"];
  compile(store: Store, command: C): TransactionBuilder | null;   // null = no-op
};

const commands: Record<string, CommandSpec> = {
  toggleMark, setBlockType, insertObject, indent, outdent, splitBlock, ...
};

store.command(c):
  const tr = commands[c.type].compile(store, c);
  if (tr) store.dispatch(tr);
```

A command reads the current selection and nodes, builds steps through the builder, and returns it. It never touches the store; only `dispatch` does. A `null` return means the intent is inapplicable (toggle a mark with nothing selected), so the call is a no-op. This is where the public SPI meets the internal machine: `dispatch(command)` from §12.2, then `compile` here, then the builder (§6.10), then the dispatch loop (§6.11), then the store mutates. The host's `CommandExtension` (§12.3) registers new entries in this same registry, so a custom object's commands compile exactly like built-in ones.

The read-side counterpart is a query registry: pure functions over the current state for the toolbar's active and enabled states (`isMarkActive(store, "bold")`, `canIndent(store)`). Queries never build steps. Toolbar state is queries; toolbar actions are commands.

---

## 7. History

### 7.1 Inverse steps, change-proportional, never snapshots

History is two stacks (`done`, `undone`) of transactions. Undo applies a transaction's `inverse` and restores `selectionBefore`; redo is the mirror. Memory is proportional to how much was edited, since inverse steps reference immutable prior nodes with no content copy, not to document-size times edit-count. This is the deliberate departure from Lexical's `HistoryPlugin`, which retains a full `EditorState` snapshot per entry (an O(document) `NodeMap` rebuild per edit, even for one keystroke).

### 7.2 Worked examples

- Select 4 blocks across the document, replace. One transaction: `ReplaceText` on the two partial endpoints, `RemoveNode` for fully-covered blocks, `InsertNode`, and the order edits. Inverse holds references to the removed blocks (immutable, no copy). Memory tracks those 4 blocks; undo replays in O(4 blocks). Change-proportional, fine.
- Ctrl+A, delete the whole 10,000-block document. Inverse holds references to all 10,000 immutable blocks (~80 KB of pointers; content already in memory, not copied), so memory is fine. Undo replays in O(10,000), about a millisecond, one-time, on an explicit destructive action.

### 7.3 Honest comparison: where each model wins

| Operation | Lexical (snapshots) | This design (inverse steps) |
| --- | --- | --- |
| Type one char | O(document) map clone | O(1) |
| Find-replace across 500 blocks | O(document) snapshot | O(matches) |
| Undo a keystroke | O(1) swap plus reconcile | O(1) apply plus re-render |
| Undo a bulk (≈whole-doc) edit | O(1) pointer swap | O(change) replay |
| Memory over a long session | O(distinct nodes) plus a Map per entry | O(total change) |

We win on the hot path (typing) and on broad-but-shallow edits. Lexical wins in exactly one spot: undo of a single bulk edit is an O(1) pointer swap for it versus our O(change) replay. That is a one-time latency on an explicit destructive action, never a correctness issue, and a periodic checkpoint (a snapshot every K transactions to cap replay depth) bounds it. We do not build checkpoints up front; we name the lever.

### 7.4 The genuine risk, history loss, and its structural mitigation

A snapshot model captures whole state regardless of how it changed. The inverse-step model is only as correct as the invariant that every change went through an invertible step. The precise risk:

> Any mutation that bypasses `dispatch`, or any step whose `invert` is lossy, silently corrupts undo. The document reaches a state the inverse cannot reproduce, and undo lands on a different document. Snapshots are immune to this.

This is the real cost of the inverse model, and snapshots' forgiveness of undisciplined mutation is their one categorical safety advantage. We neutralize it structurally, not by being careful.

1. No mutation API but `dispatch` (§6.1), so undisciplined mutation is impossible, not discouraged.
2. Normalization is appended steps (§6.4), so no out-of-band transform exists.
3. Every step's invertibility is property-tested, so a lossy invert fails CI.

If we ever cannot guarantee rule 1, the calculus flips and snapshots' forgiveness becomes worth its cost. Rule 1 is non-negotiable foundation, not a convenience.

### 7.5 Coalescing and selection restoration

- A typing run coalesces into one undo entry, with hard boundaries at format toggle, paste, object activation, block split/merge, and a ~500 ms idle gap.
- Each entry carries `selectionBefore`/`selectionAfter`, so undo and redo restore the caret and selection, not just content.

---

## 8. Selection

Selection is the most dangerous subsystem, because getting its source of truth wrong corrupts edits silently. The design follows from one refusal and one reuse.

### 8.1 The model is the single source of truth; no `contenteditable`

We rejected the "controlled `contenteditable` over the mounted window" hybrid. It stays seamless until the selection's anchor scrolls out of the mounted DOM, or an arrow key crosses a block boundary the browser treats as the document edge, or Backspace joins at the window seam. At that point native and model disagree, and you maintain two sources of truth that perpetually reconcile. "99% free" is paid for with "1000% reconciliation," because our virtualized model does not fit the browser's assumption that the selected content sits in the DOM.

So the model owns selection, exclusively. There is one source of truth.

### 8.2 The selection union: text, node, gap

```
Selection =
  | { type: "text"; anchor: Point; focus: Point }            // collapsed (anchor≈focus) = caret
  | { type: "node"; node: NodeId }                           // an atomic object selected whole
  | { type: "gap";  node: NodeId; side: "before" | "after" } // caret between two objects (docs/002)
```

All three are required. You cannot place a text offset inside an image, so selecting it for delete, move, or copy is a `NodeSelection`. A caret resting between two stacked objects with no text to host it is a `GapCursor`, the docs/002 problem, folded in here. Cross-object ranges are block-atomic (010 §6.5): a range covering an object includes it whole, and selection never descends into object internals from the outer flow.

### 8.3 Custom does not mean from-scratch: the browser-reuse contract

Owning the selection model does not mean reimplementing text layout, hit-testing, geometry, segmentation, or even selection painting. Each capability stands on a browser contract.

| Capability | Browser contract reused | What we own |
| --- | --- | --- |
| Keyboard / IME / clipboard capture, a11y anchor | hidden `<textarea>` / `EditContext` | the capture host (the floor, §8.4) |
| Click to position | `caretPositionFromPoint` / `caretRangeFromPoint` | feature-detect wrapper plus map to `Point` |
| Paint a selection range | `Range.getClientRects()` / overlay rects; future CSS Custom Highlight | which model ranges map to which DOM `Range`s |
| Selection / caret geometry | `Range.getClientRects()` / `getBoundingClientRect()` | nothing, wrapping and bidi come free |
| Up / Down (vertical nav) | `caretPositionFromPoint(goalX, caretY ± lineHeight)` | goal-column bookkeeping |
| Left/Right, Home/End, word | `Intl.Segmenter` (graphemes/words) | boundary rules at node edges |
| Double / triple click | `Intl.Segmenter` (word) plus node bounds (line/para) | gesture to range mapping |
| Clipboard | `copy`/`cut`/`paste` plus `clipboardData` | model serialize / parse |

What we build is the mapping (model offset to DOM position) and the selection state machine (key or pointer to new model selection to re-derived geometry to repaint). Bounded.

### 8.4 The capture floor

Even fully custom, one hidden focusable input element remains, not for selection but for what the browser only grants a focused text surface: keyboard events, IME composition, `copy`/`cut`/`paste` events, and an accessibility anchor. With no editing host and no native selection, the browser fires no `copy`, routes no IME, and exposes nothing to a screen reader. The hidden input is the capture surface; it never holds the document and never drives the paint (§9).

### 8.5 Derived Ranges And Overlay Rects, The Proven Paint Primitive

The proven Phase 2.5 paint baseline is deliberately boring: construct `Range`s over the rendered non-editable text DOM, call `Range.getClientRects()`, and draw absolutely positioned overlay rects in scroller coordinates. The browser still supplies full layout, wrapping, bidi fragments, and glyph geometry because the ranges are real ranges over laid-out text. The engine owns only which model ranges map to which DOM ranges and how those rects are layered.

Two things it cannot do, which we own.

- Caret (collapsed selection): a zero-width range has no area, so the caret is a separate blinking element positioned from `range.getBoundingClientRect()`. We own blink and position only.
- Offscreen middles: a `Range` cannot point at unmounted nodes, so for a selection spanning virtualized gaps we paint ranges over the mounted edges only, and the model holds the full range for copy and extend.

The paint layer reuses the per-leaf offset-to-text-node map (§3.4) in reverse: an edit patches the DOM from that map, and the paint derives DOM `Range`s from it. `deriveRanges(selection, mountedBlocks)` orders the endpoints via `comparePoints`, clips the range to mounted leaves, and builds one `Range` per mounted leaf. A selection spanning N mounted leaves becomes N measured range fragments, while the offscreen middle is absent from the overlay and the model holds the full range. The layer re-derives on selection change, on leaf re-render (a replaced text node detaches its old `Range`), and on relayout (`ResizeObserver`), never per scroll tick, because the overlay lives in scroller coordinates. The virtualized text carries `user-select: none` so the browser's own selection never competes during pointer drags; we own selection through model-derived overlay rects and synthesize the native double-click-word and triple-click-line gestures with `Intl.Segmenter` (§8.3).

CSS Custom Highlight remains a future optimization over the same `deriveRanges` output. It can replace the overlay painter where its cross-browser behavior is proven, but it is no longer a prerequisite for multi-block selection work.

### 8.6 The selection invariants

1. Model is truth, DOM is a projection. Native selection is never read as authority except to translate a user gesture into a model selection.
2. One-way valves. Gesture to model: read `caretPositionFromPoint` or the native range, map, done. Model to DOM and paint: set behind an "updating" flag so the resulting `selectionchange` cannot echo back and re-trigger. Without this guard you get an infinite DOM-to-model loop.
3. Remap on every transaction. After any step, `selection = mapSelection(selection, steps)`. A delete that removes the focus node moves focus to the nearest valid position. A selection must never point at a node that no longer exists, which is the number-one model-owned selection crash, prevented by remap-or-reset on every transaction, no exceptions. The full mapping contract is §8.8.
4. Survives virtualization for free. Endpoints are `(NodeId, offset)`, so unmounting the middle changes painting, not the selection.
5. Document-order comparator (§5.4) backs render, copy, delete, and extend.
6. Block-atomic across objects (§8.2).
7. Focus and selection are separate. Losing DOM focus (clicking a toolbar) does not clear the model selection; restore native focus and paint on refocus.

### 8.7 The two honest costs with no browser reuse

- Accessibility. No browser API gives screen-reader-correct editing accessibility without `contenteditable` or a native input. The hidden textarea buys a `textbox` the screen reader sees, but reconciling its linear view with the virtualized rich render is real work: `role="textbox"`, `aria-multiline`, `aria-activedescendant` for the focused block or object, and live-region selection announcements. This is 010 §11's "a11y must be designed, not inherited," and it is the price of rejecting the editing host. Treat it as a first-class workstream, not a checkbox.
- iOS native text affordances. The selection loupe, the magnifier, and the drag handles are tied to native editable content, so custom selection loses them. The hidden textarea still provides the iOS keyboard and basic touch. **Decided (010 §5.8/§6.6, Phase 7): the native-`contenteditable`-on-the-active-block escape is dropped.** A per-platform editing path would fork selection/IME/caret for one platform, which the architecture refuses; iOS runs the same single input substrate as everywhere else, accepting no loupe/magnifier on the owned editing surface (documented, not worked around). A mobile defect is a platform bug or a polyfill-logic gap fixed in the substrate, never a platform special-case.

Both costs need binary gates before this becomes a product surface. The accessibility gate is: keyboard-only editing works, the focused block/object is reflected through `aria-activedescendant`, selection changes are announced without flooding, copy/cut/paste work from the hidden host, and NVDA plus VoiceOver smoke tests agree with the model selection. The iOS gate is decided (Phase 7): accept no loupe/handles for the owned surface and document it; the single-active-block native `contenteditable` fallback is not pursued (no platform fork). Touch caret placement, on-screen-keyboard editing, and model-authoritative touch selection are proven on mobile-WebKit emulation (`tests/e2e/engine-mobile.spec.ts`).

### 8.8 The selection remap contract

`mapSelection(sel, steps)` runs inside `dispatch` (§6.7) after `apply`, before subscribers are notified. A command may set `selectionAfter` explicitly (Select All, a click); otherwise the mapped result is the default: `selectionAfter = command ?? mapSelection(selectionBefore, steps)`. The transaction carries a `touchedNodes: Set<NodeId>` so `mapPoint` early-outs in O(1) for the common case, editing block X with the selection in block X and every other node untouched. That early-out is the node-relative payoff (§5.1).

```
mapPoint(p, step, bias):
  ReplaceText(at, removed, inserted), delta = inserted.length − removed:
    p.offset <= at            → unchanged
    p.offset >= at + removed  → p.offset += delta
    inside the removed range  → p.offset = at + (bias < 0 ? 0 : inserted.length)
  MoveNode:                   → unchanged (offsets inside a moved node do not move; only its
                                document order changes, which comparePoints recovers for free)
  RemoveNode of p.node or an ancestor → relocate to the deletion boundary per bias
```

Three rules keep this correct. Anchor and focus take opposite bias when collapsing into a deleted range, or the selection inverts; focus biases toward the edit, anchor away. If both endpoints are deleted, collapse to a caret at the deletion site. The "node deleted, where does the caret land" policy is prev-sibling-end, else next-sibling-start, else a gap cursor in the now-empty parent (docs/002); this is a UX decision, written down rather than derived.

---

## 9. The Input Substrate

### 9.1 One re-keyed host mirrors the active text leaf

A single input host (native `EditContext` where its IME quality is wanted, hidden `<textarea>` as the universal baseline) is re-pointed at the active leaf, never one element per block, since 10,000 hidden textareas is absurd and breaks focus. It holds the active leaf's flat-string projection (§4.1): the leaf's `text` with each inline atom as one `￼`, plus `selectionStart`/`selectionEnd` at the caret. Its size is bounded by one paragraph, never the document, and IME gets full intra-block context, which is all Telex and CJK ever need, since composition never crosses a block boundary.

Native `EditContext` is a capture backend, not a separate editor: it provides Chromium's vendor-grade IME and accessibility. Selection painting is always custom (§8.5), so this design does not depend on the unproven hypothesis that an `EditContext` host paints a native caret (010 §7.4). We paint the caret regardless, which removes a foundational risk 010 carried.

### 9.2 Three input regimes, one host with one job

- Text leaf (paragraph, heading, listitem, plain callout, text quote): the host mirrors its projection. That is the host's only job.
- Structural node (list, table grid navigation): Tab, indent, Enter-split, and cell-move are commands intercepted before reaching the host as text. The host never sees "list-ness" or "table-ness"; it mirrors the innermost active text leaf.
- Atomic object (code-block, media, mermaid): not a text leaf, so it does not use the host. Going live suspends the host; the object owns input through its own surface; deactivation resumes the host. This is the one live slot owning input.

### 9.3 The focus-transition state machine and its races

Moving the active leaf (block 5,432 to 5,433) is an ordered, drain-first, single-flight operation, because input that arrives mid-swap must not land in the wrong node.

1. Finish in-flight composition on the old leaf (force or await `compositionend`) and commit it. Never carry a half-composed IME buffer across leaves.
2. Drain and flush the old leaf: apply pending `textupdate` as its final `ReplaceText`, and close its transaction and undo-group boundary.
3. Re-key to the new leaf: map the click via `caretPositionFromPoint` to a model offset, set host value and selection, and update IME bounds to the new rect.
4. Repaint caret and selection at the new spot.

| Race | Failure | Guard |
| --- | --- | --- |
| async `textupdate` for A lands after re-key to B | input into wrong node | every input event carries target `NodeId` plus an active-token; mismatched events dropped or routed, never blindly applied |
| click B while composing in A | half-composed buffer bleeds across | await or force `compositionend` before commit and rekey; else queue activation until it resolves |
| activate an offscreen leaf | caret placed before geometry exists | two-phase: scroll and mount, then place caret on first measure |
| re-render clears native selection | caret and selection vanish | re-apply selection and paint after the frame |
| rapid A-to-B activation | overlapping transitions corrupt state | single-flight activation keyed by a monotonic token; newer supersedes pending older |

The tractability invariant is exactly one active text leaf, and every input event is id-tagged, so a stray event drops rather than corrupting the document.

### 9.4 The IME composition state machine

The sequence is `compositionstart` then N times `compositionupdate`/`textupdate` with a preedit range then `compositionend`. Mutations during composition are provisional; only `compositionend` commits a model step; preedit formatting (underline) is engine-painted (overlay rects / DOM spans over the preedit range, §8.5), because a fully owned view gets no browser-drawn preedit. Backend quirks are the platform's behavior, to tolerate rather than fix by guessing: the Microsoft-Telex-on-Firefox trailing-`insertCompositionText` duplication (fixed in the spike) and the Firefox IME-language-switch dropping to plain `insertText` (010 §11, accepted) are both characterized, not patched by guessing.

---

## 10. Data Flow And Scheduling

### 10.1 The model is immediate; only the render-notify is batched

Two things happen on a keystroke, and only one is deferred.

```
dispatch(tr):
  apply steps to the store         // immediate, synchronous: the model is current now
  patch the active leaf's DOM       // immediate, synchronous (§11.2): the glyph is on screen now
  reposition the caret              // immediate, synchronous: the caret is at the new spot now
  mark dirty + schedule one frame   // the only deferred work: notify other subscribers to re-render
```

The store change is never held back, and neither is the typed character or the caret. The deferred part is the re-render notification to everything that is not the active leaf: sibling blocks, the selection overlay for ranges, derived views. Batching that notify onto one `requestAnimationFrame` collapses a multi-step transaction into one render, caps high-frequency bursts (drag-select, IME, scroll) at one render per painted frame, and gives docs/008 one measurable place to budget and detect dropped frames. React 18 would auto-batch a single keystroke on its own; the frame lane earns its place on the cross-event bursts and the measurement, not on the lone keystroke.

### 10.2 The lane mapping

The scheduler core already exists (`plugins/editor-performance.ts`, docs/008): four lanes, within-lane priority, per-task budget with cooperative yield, three coalesce policies, and the `__IDCO_EDITOR_PERF__` dashboard. 010 §7.3 promotes that core into the engine and keeps one process-wide scheduler shared with the standard editor. The engine's work maps onto the lanes.

| Lane | Engine work |
| --- | --- |
| `sync` | the synchronous tail of the input handler: step, active-leaf DOM patch, caret reposition. Not queued. |
| `frame` | `requestAnimationFrame`, coalesce by dirty-set union: store-notify the dirty nodes, repaint the range overlay rects, recompute the virtual window on scroll. |
| `idle` | incremental derived indexes (anchors, numbering, TOC, search), height measurement, neighbor prefetch. |
| `debounced` | host `onChange`, serialize, object bake. |

The `sync` work is not a scheduler task; it runs inline in the event handler. The scheduler throttles only the deferred lanes.

### 10.3 The dirty set

The frame task carries a typed accumulator, not a document snapshot.

```
StoreDirty = {
  nodes:     Set<NodeId>     // re-render these blocks
  selection: boolean         // re-derive ranges, repaint overlay rects
  structure: boolean         // body order changed → recompute the virtual window
}
```

`dispatch` fills it as steps apply; exactly one `frame` task drains and clears it. One writer, one reader. The coalesce policy is union on `nodes` and OR on the flags, so a burst of N steps collapses into one flush over the union. Four rules make it correct.

- The active leaf is excluded from `nodes`. Its text is already on screen (the controller patched it, §11.2) and its snapshot is pinned, so a notify would be a no-op. Its text steps set `selection` and feed derived indexes; they do not add the leaf to the view-notify set, so the hot typing path contributes nothing to the frame's render work.
- Collapsed-caret moves are `sync`, not `frame`: arrow navigation repositions the one caret element in the handler, so the caret never lags a frame. Only range selection (shift-arrow, drag) sets `selection` and coalesces the overlay-rect repaint onto the frame.
- Flush order is structure, then nodes, then selection: mount and unmount before notifying nodes, finalize the DOM before deriving selection geometry. A node touched and then deleted in the same frame drops from `nodes` and rides `structure` for unmount.
- The frame budget measures, it does not chunk. The flush is cheap; the cost is React rendering the dirty blocks, measured as the frame cost. Over budget is a recorded dropped frame, never a half-rendered tree carried to the next frame.

### 10.4 The strictness model: the cascade is unwriteable

Lexical debounces because any plugin can read the whole document on any change, so one edit can recompute and repaint the entire doc (the canonical case: editing a header recomputes every heading's anchor id across the document). This design removes the capability that makes the cascade possible. Four rules, none opt-in.

- The only mutation path is `dispatch`. The store exposes no other mutation API (§6.1), so there is nowhere to mutate out of band.
- There is no whole-document subscription. A view subscribes to a specific node id, the selection channel, or the structure channel. `dispatch` emits a transaction carrying `touchedNodes`, and the notify wakes only subscribers of those ids. A component on node 5,432 is never woken by an edit to 9,001, because no "subscribe to everything" exists to misuse.
- Derived work is incremental over `touchedNodes`, never a re-scan (§11.4). A paragraph keystroke that touches no heading runs zero anchor work. A heading edit recomputes one slug against a maintained `usedAnchors` set.
- Virtualization caps the DOM blast radius at the viewport. Even a genuinely global derivation (heading numbering shifting after an insert) touches the DOM only for the visible affected nodes; offscreen ones are unmounted and re-render from the updated model when scrolled in.

The result is that Lexical's "every plugin must be careful" requirement is replaced by "the careless thing cannot be expressed." The whole-document listener does not exist, and the derived-index reader cannot iterate every node (§11.4). This is isolation as architecture, not as convention.

---

## 11. The View Layer

### 11.1 Per-node subscription, no whole-document consumer

The view is a list of mounted top-level block components, the virtual window (§2.6). Each subscribes to its own node id and the relevant ids in its subtree. The selection overlay is a separate component on the selection channel. Nothing subscribes to "the document," because that consumer does not exist, which is what makes §10.4 hold at the view layer.

### 11.2 Snapshot pinning for the active leaf

`useSyncExternalStore` re-renders a component only when `getSnapshot()` returns a value that fails `Object.is` against the last. So if the store returns the same reference for the one active leaf while its text mutates, React never re-renders it; the controller patches the DOM, and every other subscriber updates normally.

```
store.activeLeafId: NodeId | null

getNodeSnapshot(id):
  if (id === activeLeafId) return pinnedSnapshot   // stable ref captured at activation
  return nodes.get(id)                             // live node, changes per edit
```

The lifecycle has three steps.

1. Activation: the store sets `activeLeafId` and pins the leaf's current content. The component renders its runs one last time, and the controller binds to the rendered text nodes (builds the offset↔node map, §3.4).
2. Typing: each keystroke mutates the model node, but `getNodeSnapshot` still returns the pin, so React skips the leaf while the controller patches the one text node synchronously.
3. Deactivation: the controller commits the final text to the model (§3.3), the pin releases, and the leaf reconciles once against the final string.

This is the concrete mechanism behind "React owns structure, the controller owns active text" (§3.4): the store pins one node's snapshot, and a 5,000-char active paragraph stops reconciling per keystroke.

### 11.3 Mark toggles re-render once

A mark toggle (bold a selection) changes the inline run structure, not just text, so it is the one mid-edit case the active leaf re-renders. The toggle is a command, not a per-keystroke path, so the cost is fine: the store updates the pinned snapshot to the post-toggle content, the leaf rebuilds its spans once, and the controller re-binds the offset↔node map to the new spans. Text edits stay React-free; discrete structural commands get one clean declarative rebuild.

### 11.4 The DerivedIndex SPI

An index folds a committed transaction's touched set into a delta. A full scan is unwriteable because the reader cannot iterate every node.

```
interface NodeReader {
  node(id: NodeId): Node | undefined;
  prevSibling(id: NodeId): NodeId | undefined;
  nextSibling(id: NodeId): NodeId | undefined;
  orderFrom(id: NodeId): IterableIterator<NodeId>;   // forward walk from a point; caller must stop
  // deliberately no allNodes() / iterate-whole-document method
}

interface DerivedIndex<T> {
  readonly label: string;            // scheduler metrics key
  readonly lane: "idle" | "debounced";
  concerns(kind: string): boolean;   // skip update when touchedNodes ∩ concern = ∅
  init(doc: Doc): T;
  update(prev: T, tr: CommittedTransaction, read: NodeReader): T;   // the only update path
}
```

A paragraph keystroke touches no heading, so `concerns("paragraph")` is false for the anchor index and `update` never runs. A heading edit runs `update` with `touchedNodes = {headingId}`, recomputes that one slug, and walks `orderFrom` only if numbering shifted. The absence of `allNodes()` is what makes the whole-document rescan impossible to write.

### 11.5 The subscription registry

The notify mechanism behind §11.1, and the concrete reason §10.4's "no whole-document subscription" holds: there is no all-subscribers set to wake.

```
SubscriptionRegistry {
  nodeSubs:      Map<NodeId, Set<() => void>>
  selectionSubs: Set<() => void>
  structureSubs: Set<() => void>

  subscribeNode(id, cb): () => void          // returns an unsubscribe
  subscribeSelection(cb): () => void
  subscribeStructure(cb): () => void

  notify(dirty: StoreDirty):                  // called by the frame flush, in §10.3 order
    if dirty.structure: for cb in structureSubs: cb()
    for id in dirty.nodes: for cb in (nodeSubs.get(id) ?? []): cb()
    if dirty.selection: for cb in selectionSubs: cb()
}
```

Each component subscribes to its own node id only. A structural change to a parent's children propagates because the parent's node object is replaced with a new `children` array (§6.8), so the parent's `nodeSub` fires, the parent re-renders, and React reconciles its child components, which mount or unmount and self-subscribe. There is no subtree subscription; a child-set change rides the parent's identity change. The active leaf's `nodeSub` exists but is excluded from `dirty.nodes` while active (§10.3), so it does not fire during typing; on a mark toggle it fires once and the leaf re-renders (§11.3). Unsubscribe removes the callback and prunes empty sets, so a block scrolled out of the virtual window releases its subscription, which is the teardown 010 §10.5 names.

---

## 12. The Public Surface And SPI

The framework's outward face has three layers. The rule under all of them: the host speaks commands and definitions, never steps.

### 12.1 Mount

```tsx
<OwnedEditor
  initialValue={compatDocument}                 // RichTextEditorDocument (the persisted compat JSON)
  onChange={(value: RichTextEditorDocument) => save(value)}   // debounced compat projection
  mode="edit"                                   // "edit" | "read" (read = baked render only; the server reader is docs/015)
  virtualize={true}                             // window the body order (default); false mounts all blocks (§2.6)

  blocks={[codeBlock, table, mermaid, media, ...customObjectDefs]}
  indexes={[headingAnchors, toc, search, comments, ...customIndexes]}
  resolvers={{ resolveMedia, resolvePost }}     // host data resolution, as in content-renderer
  upload={hostUploadBinding}                     // image drop/paste → host upload
  sanitize={hostSanitizer}                        // the single XSS boundary (010 §10.5)

  editorRef={ref}
/>
```

The host hands the editor the document it already persists (compat JSON), gets the compat projection back on change, and plugs in the pieces only the host knows: media resolution, upload, sanitization.

### 12.2 Control: commands, not steps

```
interface OwnedEditorHandle {
  getDocument(): RichTextEditorDocument;          // current compat projection
  getEditorSnapshot(): EditorDocumentSnapshot;       // the authoritative model
  isDirty(): boolean;

  focus(at?: Point): void;
  getSelection(): Selection;
  setSelection(sel: Selection): void;

  dispatch(command: EditorCommand): void;          // high-level intent, never a raw Step
  undo(): void;
  redo(): void;

  on(event: "selectionchange" | "dirtychange" | "change", cb: () => void): () => void;
}
```

The toolbar (docs/006), shortcuts, and slash menus all call `dispatch(command)`. A command compiles to a transaction inside the engine.

### 12.3 The customization SPIs

```
interface BlockDefinition<Data> {
  kind: string;
  parse(v: unknown): Data | null;
  normalize(d: Data): Data;
  toCompatibilityValue(b: ObjectBlock<Data>): unknown;
  fromCompatibilityValue?(v: unknown): ObjectBlock<Data> | null;
  bake?(b: ObjectBlock<Data>): Promise<BakedSnapshot>;
  applyEdit?(d: Data, patch: unknown): Data;         // §6.5 fine-grained invertible edit
  invertPatch?(patch: unknown, before: Data): unknown;
  LiveEdit?: React.ComponentType<ObjectEditProps<Data>>;   // the one-live-slot surface
  Config?: React.ComponentType<ObjectConfigProps<Data>>;   // chrome popover
}

interface UploadBinding { upload(file: File): Promise<{ mediaId: string; previewUrl: string }>; }
interface Sanitizer { sanitizeHtml(html: string): string; sanitizeSvg(svg: string): string; }
interface CommandExtension { command: string; run(ctx: CommandContext): void; }
```

`DerivedIndex` (§11.4) is the fifth plug point. Each is an interface the host or a feature implements; none of them touches the store.

### 12.4 The seam

Commands down, definitions in, compat JSON across the boundary; the store and the steps stay sealed inside. A command compiles to a transaction at the §6.1 chokepoint, so the host inherits invertible history, scoped notify, and the no-cascade guarantee for free and cannot bypass them. The internal core (`EditorStore`, `Step`, the dirty set, `comparePoints`, `mapSelection`) is the machine room; this layer is the dashboard.

---

## 13. Low-Level Invariants: The Bleed List

The character-level things that silently corrupt an editor if ignored. Each is a hard invariant of the structures above.

1. UTF-16 storage, grapheme navigation. Offsets are UTF-16 units (1:1 with the input buffer); arrow and delete operate on grapheme clusters (`Intl.Segmenter`). Never convert storage to code-point indices (§5.2).
2. The empty or trailing final line. A leaf whose text ends without a trailing box gives the caret nowhere to land on an empty last line, so a zero-width layout marker reserves that line box. A standard fix, present in the spike.
3. Composition is provisional until `compositionend` (§9.4).
4. Affinity at wrap and bidi boundaries lives in `Point.assoc` (§5.3); under custom paint we resolve it ourselves.
5. Idempotent model-string to split-node projection (§4.6), or the golden round-trip flakes.
6. Inline atoms are atomic to navigation: one `￼`, treated as one grapheme, and backspace deletes the unit plus its atom entry together (§4.3).
7. The cached offset-to-text-node map is invalidated only on text, mark, or layout change, never on plain caret movement; rebuilding it per arrow key is a future perf bug (§3.4).
8. Body order is an array. Splice is O(top-level blocks) (~µs at 10k), fine for occasional structural edits, never the keystroke path. Fractional order-keys are the named upgrade if it ever bites, and they are collaboration-friendly, another "not foreclosed" (§16).
9. Clipboard reads the model, not the DOM. Copying a partial-leaf range slices the string and clips the marks to the copied range (the same remap function, §4.5), so cross-virtual copy is structural, not bolted on.

---

## 14. The Cost Ledger

A consolidated, honest scorecard so no advantage is overclaimed.

| Surface | This design | Mainstream comparison | Verdict |
| --- | --- | --- | --- |
| Keystroke in a small leaf | O(marks) plus O(1) DOM patch | Lexical: O(document) history map clone | we win decisively |
| Keystroke in a 5k-char leaf | sub-µs (ours) plus browser reflow | contenteditable: same reflow plus framework reconcile | we win (no reconcile) |
| Undo a keystroke | O(1) | O(1) | tie |
| Undo a whole-doc bulk delete | O(change) replay | Lexical: O(1) pointer swap | Lexical wins (one-time, checkpointable) |
| Session history memory | O(total change) | O(distinct nodes) plus Map per entry | we win |
| Cross-virtual selection / copy | structural (model holds range) | DOM-bound editors copy only on-screen | we win |
| Selection painting quality | engine overlay rects over real `Range` geometry | native via `::selection` | tie (overlay rects proven cross-browser in the spike) |
| Desktop editing a11y | owned via ARIA, must design | inherited from contenteditable | contenteditable wins (our §8.7 cost) |
| iOS loupe / handles | lost (optional per-block fallback) | native | native wins (our §8.7 cost) |
| History robustness to undisciplined mutation | requires the §6.1 chokepoint | snapshots forgive anything | snapshots safer (we mitigate structurally, §7.4) |

The shape of the bet: we trade three things, bulk-undo latency, owned accessibility, and iOS native affordances, for virtualized live editing at book scale with correct cross-virtual selection and copy and an O(1)-per-keystroke hot path. The three we give up are bounded and named; the thing we get is the one no `contenteditable` foundation can.

---

## 15. What This Corrects In docs/010

010 holds except where this document sharpens it.

- §7.2 (model). 010's "flat per-block text string" and "`order` plus `Map<blockId, BlockModel>`" framing tilted toward a flat store. Corrected to a normalized node graph (§2): structural nodes hold children by id, the model is a faithful tree, and the flat list is only the top-level virtualization index, not the whole model.
- §5.5 / §7.4 (selection paint). 010 originally framed hidden-textarea hand-painting as a backend fallback and native selection as an optimization. Corrected after the spike: the model owns selection and paints through model-derived overlay rects from DOM `Range` geometry (§8.5); CSS Custom Highlight is only a future optimization over the same derivation.
- `code-block` classification. 010 listed it as both a typed text block and a heavy object. Resolved: atomic object with a piece-table body (§3.6).
- Tables. Clarified as an atomic object by lifecycle choice with a faithful internal grid (§2.4), not a blob to dodge a flat model.
- TOC and settings. TOC stays a positional atomic object; `DocumentSettings` is reserved for docs/006 page settings (§2.5).

Everything else in 010 (the product thesis, the four layers, bake, the scheduler lanes, the worker boundary, the phasing and gates) is unchanged. This document is the substrate those phases build on.

---

## 16. Genuinely Open Sub-Decisions

The choices below are recommended here but not yet locked. Each is isolated enough to settle without disturbing the foundation.

- Marks: range-array versus marked-run nodes. Recommended: range-array over a flat string (§4.4) for the hot-path allocation win; marked-run nodes are more compat-faithful but churn objects per keystroke. Open only if a profiling case argues otherwise.
- Body order: array versus fractional order-keys. Recommended: array now, order-keys as the named upgrade (§13.8) when O(n) splices or collaboration make them worth it.
- CSS Custom Highlight API cross-browser behavior. This is now an optimization track, not a blocker for multi-block selection. If adopted later, prove range painting, IME-preedit underline painting, `user-select: none` interaction, and relayout invalidation against real rendered text in Chromium, WebKit, and Firefox; if any browser fails, keep using the overlay rect painter over the same `deriveRanges` output.
- iOS active-block `contenteditable` fallback. **Resolved (010 §5.8/§6.6/§8.7, Phase 7): dropped.** The iOS loupe is not restored via a per-platform native `contenteditable` path; its absence is accepted and documented. One input substrate runs everywhere — no platform fork.
- Periodic history checkpoints. Whether to cap bulk-undo replay with a snapshot every K transactions (§7.3) is a lever named, not pulled.
- **The intra-transaction `Mapping` in node-relative coordinates (the internal-core open item, with a recommended default).** The transaction builder (§6.10) maps a position through earlier steps in the same transaction, so a multi-step command can target a post-edit position. Same-node `ReplaceText` uses the §8.8 rule. Structural mapping should default to: points follow a `MoveNode` by id; points inside a removed node or removed ancestor relocate to the deletion boundary by bias; split/merge commands must provide explicit point redirects for the newly minted or absorbed node ids; and commands may not depend on an implicit "point inside removed structure" rule beyond that boundary relocation. Keep this open only until the first split/merge implementation lands, then lock it with property tests for split, merge, move, delete, undo, and redo.

---

## 17. Collaboration-Readiness: The Day-One Footprint And Why It Lands Now

Collaboration is not built in Phase 3 and is not designed in this document; docs/014 holds that brainstorm and 010 §12 keeps it a gated decision. What lands in Phase 3 is a small set of format and addressing changes that make a later collaboration addition bounded instead of a teardown. They are gathered here so the reasoning lives in one place; the mechanical changes are folded into the sections named below.

The one principle that sorts what lands now from what waits: behavior is free to add later, addressing is forever. A merge rule, a rebase policy, a conflict resolution is a function written the week collaboration is built, and it touches no saved bytes. The way a node, a mark boundary, or a stored caret is addressed is baked into every persisted book and into every line of code that reads a position, so getting it wrong means rewriting that code and migrating that data. Only the addressing-and-format items make this list, and the test for each is that it is cheap now and expensive-or-impossible to retrofit.

The five items.

1. **Global node ids (§2.2).** `NodeId` is globally unique, opaque, and client-minted, never a per-document index. Irreversible because every saved doc bakes its ids and cross-references; also the precondition for two clients minting non-colliding ids offline.
2. **Character identity under prose leaves (§3.1, §3.7).** The prose-leaf substrate is a run-encoded sequence of identity-bearing characters, not a bare string. This is the one change that prevents the rewrite, because the mark, position, selection, and input code all get written once against ids rather than written against offsets and rewritten against ids. The offset stays the working coordinate; the id is the durable anchor. Cost at rest is about 1 to 2 percent (§3.7).
3. **Marks anchored to character ids (§4.4).** A mark boundary is a character id plus stickiness, resolved to an offset. The open-and-closed-sides rules become the anchor's stickiness. This is what makes "drift is structurally impossible" (§4.5) hold across remote edits, the Peritext result.
4. **Positions anchored to character ids (§5.1).** A stored `Point`'s durable identity is `node` plus a character-id anchor; the offset is resolved. A transient hit-test point resolves to an anchor when it enters the selection.
5. **A transaction `origin` slot (§6.1).** Always `"local"` in Phase 3. The field a future history filters on and the dispatch loop checks to avoid echoing remote steps; a history-layer rewrite if added later.

What needs nothing, and why structure is already done. The tree is identity-addressed already, since containers hold `children: NodeId[]`, so `InsertNode`, `RemoveNode`, and `MoveNode` stay index-based in Phase 3 and rebase later through `mapStep` (§6.3). Only text needed the posture change, because text was the one place the model still addressed content by integer. `mapStep` itself is built in Phase 3 for selection-remap, so the rebase seam exists from day one rather than being bolted on.

What we deliberately do not build in Phase 3: rebasing, awareness and presence, multi-peer tombstone GC, the concurrent-move conflict rule, any network or provider. Single-user tombstone GC is collect-on-commit, since there are no peers to wait for. The hard problems that any CRDT choice would face, concurrent tree-move, heavy-object merge semantics, selective undo, interleaving, projection determinism, are catalogued with recommended leans in docs/014 §7; none blocks Phase 3, and the single-user model forecloses none of them.

The build-versus-buy call, recorded: we own the minimal run-encoded sequence rather than embedding a CRDT library for it. We are already building the model, steps, history, selection, and input; taking a foundational dependency on a library, plus its formatting assumptions we do not want, to get one data structure is the wrong trade. A CRDT library stays available later as a replication adapter under the model we own, the posture docs/013's rejection approved, never as the authoritative document.
