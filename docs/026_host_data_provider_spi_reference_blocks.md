# Host Data Provider SPI and Reference Blocks

> Status: Design + implementation plan — not yet built and not scheduled for release soon (this is one of several note.md backlog items). Part I (§1–§12) settles the model and seams; Part II (§13–§20) adds the implementation strategy, detailed plan, one-time import/compat with its sunset, packages/ui changes, the sliced backlog, the test plan, and the definition of done, so the build never has to return here to fill a design gap.
> Date: 2026-06-23
> Scope: `packages/editor` (owned-model engine) — the public SPI by which a deployment exposes host-backed records to the editor, and by which any block (built-in or custom) projects such a record. Excludes the toolbar/ribbon layout (docs/023, docs/024), the reader tier (docs/015), and comments authoring (separate note.md item).
> Source docs: docs/006 §5 "Data Provider Contract", §7.9 "Provenance Is Gating"; docs/011 §12.3 "The customization SPIs", §12.4 "The seam"; docs/016 "Node SPI And Pluggable Blocks"; docs/015 §9–§10 (baked-field staleness, island/baked identity); docs/020 §7.2 (node decomposition).
> Related docs: docs/010 (engine plan), docs/021 (structural node SPI), docs/022 (live table), note.md item 2 (the backlog entry this expands), note.md item 6 (`allowedNodes` schema profile, which this partly implies).
> Assumptions: the owned engine (`packages/editor`) is the target; `editor-legacy` (Lexical) is reference-only and slated for retirement (docs/015 §8). The persistence format is mid-flip from the Lexical-shaped projection to `EditorDocumentSnapshot` (docs/010 §12); this SPI is specified against the owned model's node shape and is format-flip-neutral.

## Table Of Contents

- [1. Purpose And Scope](#1-purpose-and-scope)
- [2. System Summary: Where This Sits](#2-system-summary-where-this-sits)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 The Upload Corner Is The Only Host-Data Binding](#31-the-upload-corner-is-the-only-host-data-binding)
  - [3.2 Reference Blocks Are Manual Text Fields](#32-reference-blocks-are-manual-text-fields)
  - [3.3 The Config Field Is A Degenerate Text-Only Shape](#33-the-config-field-is-a-degenerate-text-only-shape)
  - [3.4 The Node SPI Registration Spine Already Exists](#34-the-node-spi-registration-spine-already-exists)
  - [3.5 The Model Already Carries The Reference-Block Lifecycle States](#35-the-model-already-carries-the-reference-block-lifecycle-states)
  - [3.6 The Legacy Bindings: The Anti-Pattern Not To Port](#36-the-legacy-bindings-the-anti-pattern-not-to-port)
  - [3.7 The Picker Primitive Already Exists In `@idco/ui`](#37-the-picker-primitive-already-exists-in-idcoui)
  - [3.8 `allowedEmbedDomains` Gating Is Absent From The Owned Engine](#38-allowedembeddomains-gating-is-absent-from-the-owned-engine)
- [4. Target Model: Object Nodes Sorted By Where Truth Lives](#4-target-model-object-nodes-sorted-by-where-truth-lives)
  - [4.1 The Two Kinds Of Object Node](#41-the-two-kinds-of-object-node)
  - [4.2 The Discriminator](#42-the-discriminator)
  - [4.3 Reference Block, Defined Precisely](#43-reference-block-defined-precisely)
  - [4.4 Capabilities, Not Kinds](#44-capabilities-not-kinds)
- [5. The Three-Actor Seam](#5-the-three-actor-seam)
  - [5.1 Source, Block, Engine](#51-source-block-engine)
  - [5.2 Why Two Registries Joined By Id, Not One Fused Thing](#52-why-two-registries-joined-by-id-not-one-fused-thing)
  - [5.3 One Source Feeds Many Blocks](#53-one-source-feeds-many-blocks)
- [6. The Gated Surface — And Only This](#6-the-gated-surface--and-only-this)
  - [6.1 What The Host Registers](#61-what-the-host-registers)
  - [6.2 What The Block Declares](#62-what-the-block-declares)
  - [6.3 What Is Generic Engine The Host Never Touches](#63-what-is-generic-engine-the-host-never-touches)
  - [6.4 Pick Is A Seam, Not A Surface: The Editor's Boundary](#64-pick-is-a-seam-not-a-surface-the-editors-boundary)
- [7. Lifecycle: Instantiate, Resolve, Bake, Render](#7-lifecycle-instantiate-resolve-bake-render)
  - [7.1 Instantiation: Born Unresolved, Choose-First Via Rollback](#71-instantiation-born-unresolved-choose-first-via-rollback)
  - [7.2 Resolve: Stale-While-Revalidate](#72-resolve-stale-while-revalidate)
  - [7.3 The Snapshot Is The Error Fallback](#73-the-snapshot-is-the-error-fallback)
  - [7.4 Snapshot Persistence Makes The Reader Static](#74-snapshot-persistence-makes-the-reader-static)
  - [7.5 Mapping Onto The Existing Model](#75-mapping-onto-the-existing-model)
- [8. This SPI Is The Custom-Block-Data SPI](#8-this-spi-is-the-custom-block-data-spi)
  - [8.1 Worked Example: A `product-card` Custom Reference Block](#81-worked-example-a-product-card-custom-reference-block)
  - [8.2 The Forcing Function: Rebuild Media And Post-Ref On The SPI](#82-the-forcing-function-rebuild-media-and-post-ref-on-the-spi)
- [9. Provenance Gating](#9-provenance-gating)
- [10. Architecture Decisions](#10-architecture-decisions)
- [11. Open Decisions To Settle Before Building](#11-open-decisions-to-settle-before-building)
- [12. Edge Cases And Failure Modes](#12-edge-cases-and-failure-modes)
- [Part II — Implementation](#part-ii--implementation)
- [13. Implementation Strategy](#13-implementation-strategy)
- [14. Detailed Implementation Plan](#14-detailed-implementation-plan)
  - [14.1 Source Registry](#141-source-registry)
  - [14.2 Resource Config-Field Kind](#142-resource-config-field-kind)
  - [14.3 Default Picker Integration](#143-default-picker-integration)
  - [14.4 The `renderPicker` Overlay Host](#144-the-renderpicker-overlay-host)
  - [14.5 Resolve Scheduler And SWR](#145-resolve-scheduler-and-swr)
  - [14.6 Reference-Block Status Lifecycle](#146-reference-block-status-lifecycle)
  - [14.7 Data Shape And Projection Helpers](#147-data-shape-and-projection-helpers)
  - [14.8 Choose-First Via Rollback](#148-choose-first-via-rollback)
  - [14.9 Three Resting States Chrome](#149-three-resting-states-chrome)
  - [14.10 Provenance Gating](#1410-provenance-gating)
  - [14.11 Rebuild The Three Built-Ins](#1411-rebuild-the-three-built-ins)
  - [14.12 Fold `uploadImage` Into `source.upload`](#1412-fold-uploadimage-into-sourceupload)
- [15. Compat And One-Time Import: The Sunset](#15-compat-and-one-time-import-the-sunset)
- [16. `packages/ui` Changes](#16-packagesui-changes)
- [17. Implementation Backlog](#17-implementation-backlog)
- [18. Future Backlog](#18-future-backlog)
- [19. Test And Verification Plan](#19-test-and-verification-plan)
- [20. Definition Of Done](#20-definition-of-done)
- [21. Final Model](#21-final-model)

## 1. Purpose And Scope

This document settles the design of one SPI: how a deployment exposes host-backed records (media assets, posts, authors, products, anything that lives in a host collection) to the owned-model editor, and how any block — a built-in or a feature author's custom block — projects such a record into its own data shape. It is the spine note.md calls item 2, expanded to research grade and grounded against the current `packages/editor` tree.

The point of writing this before any code is the SPI-first rule the project follows: lock the public usage-shape before the internal core so day-by-day implementation does not drift away from day-one intent. This document is the locked shape. It deliberately carries no implementation backlog, no ticket breakdown, no test plan, and no definition-of-done; those belong to the slice that consumes this design. What it does carry is the model, the seams, the lifecycle, the failure modes, and the decisions that must be settled before a line is written — at enough depth that the implementing engineer never has to re-derive why the shape is what it is.

The non-negotiable thesis, stated once: there is exactly one host-facing extension point — a source registry — and everything downstream of it (the default picker, the cache, the resolve scheduling, the gating, the static reader render) is generic engine the host never touches. The one deliberate seam through that boundary is `renderPicker`, an optional source capability by which a host may supply its own pick surface (its media library) without owning anything else (§6.4); because it is a capability *on the source*, it does not add a second extension point. If the design grows a second host-facing *registration* mechanism for "custom block data," it has failed, because "generalize the data provider" and "let a custom block reference host data" are the same work (§8). The forcing function that proves generality is that the two built-in reference blocks — `media` and `post-ref` — must be rebuilt on this SPI and continue to work, becoming proof instances rather than special cases living beside it.

A second thesis, settled during design (§7.1, §10): there is no "pick" primitive in the SPI. Pick is a UI affordance — the resource field's input surface — not an engine verb. A reference block's completeness is already a data-derived model state (the `bake` pipeline turns data into a `ready` / `invalid` / `unresolved` status), so "this block needs a record before it is complete" is the existing lifecycle, not a new contract. The only SPI addition this entire area makes is the `resource` config-field kind.

Out of scope by deliberate decision: alignment control (note.md item 1), comments authoring (item 3, though §11 records the glossary cross-decision), the reader tier extraction (item 4), drag-reorder (item 5), and the toolbar surface. The `allowedNodes` schema profile (item 6) is partly implied by this SPI's provenance gating and is cross-referenced in §9 and §11, but its full design is its own document.

## 2. System Summary: Where This Sits

The owned editor models a document as a normalized node graph (docs/011 §2). Three node kinds exist: structural nodes (containers that hold children by id), text leaves (one node, one string, many marks), and object nodes (atomic blocks the engine treats as opaque units). Reference blocks are a species of object node, so this SPI lives entirely in object-node territory and touches neither text nor structural nodes.

An object node carries three fields that this design leans on directly (`packages/editor/src/core/model/model.ts:242`): `data` (the node's own opaque payload, author-edited), an optional `baked` snapshot (the static render product the export/reader tier consumes), and a `status` drawn from `"ready" | "dirty" | "invalid" | "unresolved"`. The `"unresolved"` status is the one the reference-block lifecycle was, in effect, already reserved for — a node whose snapshot exists but whose backing record has not yet been confirmed against the host (§3.5, §7.5).

Object nodes register through the node SPI (docs/016, decomposed in docs/020 §7.2): a `NodeDefinition` owns the core/worker-safe half (parse, bake, compat round-trip) and a `NodeView` owns the React half (resting render, optional live-edit surface, insert affordance, config fields). `registerNode` registers both halves at once and is the single public call a feature author makes to add a block (`packages/editor/src/view/spi/node-view.ts:239`). This SPI must route through that existing call, not stand up a parallel registry.

The picker UI this SPI mounts already exists in `@idco/ui` as `ResourceSelector` (React Aria ComboBox + `ListBoxLoadMoreItem` sentinel) with a `ResourceSource` load contract and a `ResourceOption` shape (`packages/ui/src/resource-selector.tsx`). The standardization rule the project follows says pickers converge UP onto this React Aria ComboBox standard, never down to bespoke inline lists, so this SPI's *default* picker is that component, not a new one. A host may still supply its own pick surface (its real media-library modal) through the `renderPicker` seam (§6.4) without the editor owning a media library — the boundary §6.4 draws.

The downstream consumer of every reference block is the reader (docs/015): a server-native render tier that renders the baked snapshot statically and runs no heavy libraries and makes no host call. The snapshot is precisely what makes a reference block reader-safe — legacy Lexical resolved references on render, which a server reader cannot do. This is why §7.4 (snapshot persistence) is load-bearing and not an optimization.

## 3. Current-State Findings

Every claim below was verified against the working tree on the date in the metadata. File and line references are to `packages/editor` unless noted.

### 3.1 The Upload Corner Is The Only Host-Data Binding

The sole host-data binding the owned engine ships is image upload. `OwnedModelEditor` takes an `uploadImage?: UploadImage` prop (`src/view/owned-model-editor.tsx:52`), where `UploadImage = (file) => Promise<{ src: string; alt?: string }>` (`src/view/upload-context.tsx:14`). It is threaded through `UploadProvider` and consumed in two places: the surface-level drag-drop handler, which uploads a dropped image file and inserts a `media` node with the resolved `src` (`src/view/owned-model-editor.tsx:95`), and the media live-edit surface's upload button (`src/view/nodes/media.tsx:56`). Upload is the only path resembling "create a record, then reference it." There is no browse, no search, no pick-from-collection, and no resolve.

### 3.2 Reference Blocks Are Manual Text Fields

The three blocks that are conceptually reference blocks all store their projected fields as free-typed strings today:

- `post-ref` declares `configFields: [{ key: "postId" }, { key: "title" }, { key: "url" }]` (`src/view/nodes/post-ref.tsx:14`). The author types a post id, a title, and a URL by hand; nothing links them to a real post record.
- `embed` declares `configFields: [{ key: "url" }, { key: "title" }]` (`src/view/nodes/embed.tsx:30`). The author pastes a URL; `toEmbeddableUrl` rewrites YouTube watch links to the `/embed/` player at render time (`src/view/nodes/embed.tsx:19`).
- `media` renders `src`/`alt`/`caption` as three `Input`s plus the upload button (`src/view/nodes/media.tsx:71`). The image library browse that legacy had is gone.

These three already store the `{display fields}` half of what §4.3 calls a snapshot; what they lack is the `ref` (a stable record id) and any path that sets the snapshot by picking rather than typing.

### 3.3 The Config Field Is A Degenerate Text-Only Shape

`NodeViewConfigField` is currently `{ readonly key: string; readonly label: string }` — no `kind`, no variant (`src/view/spi/node-view.ts:56`). The generic config popover `ObjectConfigPanel` renders one `@idco/ui` `Input` per field and commits each as a string through `set-object-data` (`src/view/render/object-config.tsx:53`). This is the single render site that branches on field kind, so it is the single place a `resource` field kind would add a ComboBox branch. The field type being text-only today is exactly the "degenerate union member" the target model widens.

### 3.4 The Node SPI Registration Spine Already Exists

`registerNode(args)` registers an object's `NodeView` (and optional `NodeDefinition`) or a structural container's view in one call, with type-agreement guards (`src/view/spi/node-view.ts:239`). The view registry is a module-level singleton; built-ins self-register at module load and custom nodes call `registerNode` once with no edit to engine internals (`src/view/spi/node-view.ts:177`). This is the spine the SPI routes through. There is no `registerDataSource`, `getDataSource`, or `DataSource` anywhere in `packages/editor/src` — the source registry does not exist yet; it is net-new and sits beside `registerNode`.

### 3.5 The Model Already Carries The Reference-Block Lifecycle States

`ObjectNode` is `{ kind: "object"; data: JsonValue; baked?: BakedSnapshot; status: ObjectNodeStatus }` (`src/core/model/model.ts:242`), and `ObjectNodeStatus = "ready" | "dirty" | "invalid" | "unresolved"` (`src/core/model/model.ts:209`). The reference-block lifecycle maps onto these without inventing new model state: a freshly picked-but-unconfirmed reference is `"unresolved"`; a resolved reference is `"ready"`; a reference whose `resolve` failed or whose ref dangles is `"invalid"` but still renders its stale snapshot (§7.3). `BakedSnapshot = { kind: string; payload: JsonValue }` (`src/core/model/model.ts:211`) is the static product the reader renders. The data shape needed already lives in the model; the SPI adds the machinery that drives the node through these states, not the states themselves.

### 3.6 The Legacy Bindings: The Anti-Pattern Not To Port

`editor-legacy` (Lexical) exposes `RichTextEditorBindings` (`packages/editor-legacy/src/nodes/base.tsx:34`), a per-kind bag: `mediaLibrary.{load,resolve}`, `postLibrary.load` (load only, no resolve), `onUploadMedia`, `allowedEmbedDomains`, plus four comment callbacks. docs/006 §5.1 records this same shape. The defect is structural, not cosmetic: media, posts, and embeds are three bespoke fields with different capability sets hard-coded by name, so adding a fourth referenceable collection (authors, products, citations) means adding a fourth named binding and teaching every consumer about it. The target model collapses these into one source type whose capabilities vary (§4.4), so a new collection is one registration and never a new binding field. docs/006 §5.2 already sketches the same generalization (`dataSources?: RichTextEditorDataSource[]`); this document is the owned-engine resolution of that sketch.

### 3.7 The Picker Primitive Already Exists In `@idco/ui`

`ResourceSelector` (`packages/ui/src/resource-selector.tsx:174`) is a React Aria ComboBox over a `ListBoxLoadMoreItem` sentinel, and it is exported from the barrel (`packages/ui/src/index.ts` re-exports `./resource-selector` and `./scope-builder`), so the editor can consume it directly — there is no barrel gap. It carries `ResourceOption = { id; label; sublabel?; image?; badge? }` and a `ResourceSource` union of `async` (debounced `load(query, signal)`), `paginated` (`load({ query, cursor, signal }) → { items, cursor? }`), and `sync` modes — all three exported types the engine reuses. The engine's source `load` maps onto `ResourceSource` directly; the engine adds `resolve` (single-id refresh), which is the engine's concern and not part of the UI picker. The real wrinkle is `ResourceKind` (line 31): it is a closed enum of admin resource kinds (`user`/`organization`/`team`/`member`/`media`/`oauth-client`/`resource-server`/`record`) with no `post`/`product`, used only to pick a default avatar in `defaultRenderOption`. A generic editor source therefore passes `kind="record"` plus a custom `renderOption`, or `ResourceKind` is relaxed to accept an arbitrary string — a small `@idco/ui` change tracked in §16, not a blocker.

### 3.8 `allowedEmbedDomains` Gating Is Absent From The Owned Engine

`rg allowedEmbedDomains packages/editor/src` returns nothing. The gating survives only in `packages/content-renderer` (the reader being retired, `src/index.tsx:558`) and `editor-legacy` (`src/nodes/base.tsx:234`). So restoring it is a genuine re-add in the owned engine, and the target model re-adds it not as a special embed flag but as the natural shape of an embed source: a source with `resolve` only and a domain-allowlist guard living in that source's `resolve` (§4.4, §12).

## 4. Target Model: Object Nodes Sorted By Where Truth Lives

### 4.1 The Two Kinds Of Object Node

Every object node is exactly one of two kinds, and this SPI applies to one of them only.

An owned block is one where the content *is* the truth. Code block, callout, table, divider, mermaid. The author types it, the node owns it, nothing external backs it. Editing means editing the node's own `data`. These keep `configFields` as typed inputs plus their live-edit surface and are out of scope for this SPI.

A reference block is one where the node is a *serialized projection of a record that lives in a host collection*. Media projects an asset record; post-ref/chapter-ref/author-ref/citation project a collection record. The truth lives in the host; the node stores `{ ref, snapshot }` — a stable id plus a denormalized copy of the display fields. The crucial observation that justifies the whole SPI: media storing `alt`/`url`/`caption` and post-ref storing `title`/`url`/`postId` are the same shape of thing — a cached projection of an external record — and today they are two bespoke implementations of one concept.

### 4.2 The Discriminator

The test for which kind a block is, stated so it can be applied mechanically: *does editing it mean picking a different external record, or typing content?* Picking means it is a reference block and this SPI governs it. Typing means it is an owned block and it stays on `configFields`/live-edit. There is no third answer; a block that does both (an owned block that also references a record) is modeled as a reference block whose snapshot happens to carry extra author-typed fields, because the discriminator is "where does the *identity* of the thing come from," and identity comes from the ref.

### 4.3 Reference Block, Defined Precisely

A reference block's data is `{ ref, snapshot, local? }`, bound to a host **source** by a source-id string. The node never owns the truth; it caches a projection of it.

- `ref` is a stable, host-meaningful identifier (a media id, a post id, a free-text URL for an embed). It is the only thing required to re-fetch the record.
- `snapshot` is a denormalized copy of the *projected* display fields — title, URL, alt text, price, image, whatever `toData` pulls from the record. It is what the reader renders and what survives offline, deletion of the source binding, and a failed refresh.
- `local` is the *author-local* fields the block owns but the record does not — a media `caption`, a display-title override. They are author-typed, editable in the chrome, and never overwritten by `resolve`.

The projected-vs-author-local split is load-bearing for revalidation: stale-while-revalidate (§7.2) patches only the `snapshot` (projected) keys, so a refresh that pulls a fresh title never clobbers a caption the author typed. Without the split, the first reference block with an author-authored field — media's `caption` is exactly this — would lose that field on every resolve. The split is the smallest data shape that lets one block carry both record-derived and author-authored fields.

Three operations move a reference block through its life — none of them a new SPI primitive (pick is the resource field's input surface, resolve and upload are source capabilities; see §7.1):

- **Pick** sets `ref` + `snapshot` from a chosen option, through the resource field's input surface (§7.1).
- **Resolve** refreshes `snapshot` from `ref` against the source (§7.2). This is the engine action; it runs on mount and keeps the projection live.
- **Upload** is a pick that *creates* the record first, then references it — the media-upload path generalized (§7.1). Upload is not a fourth concept; it is pick with a create step in front.

### 4.4 Capabilities, Not Kinds

A source offers up to four capabilities, all optional, and today's three "kinds" are just different capability combos. This is the move that collapses the legacy per-kind bindings (§3.6) into one type:

- `load?` — browse/search the collection, feeding the default picker. A 10,000-post collection is never shipped whole: `load` is the cursor-paginated search contract (§6.1), so the host owns paging and returns one page per call.
- `resolve?` — refresh one record's projection by ref (the stale-while-revalidate step, §7.2). Engine-only; no UI counterpart.
- `renderPicker?` — the host supplies its own pick surface (its real media-library modal). When present the engine delegates to it instead of the default ComboBox; when absent the default picker drives off `load`. This is the seam that keeps a media library out of the editor (§6.4).
- `upload?` — create a record, then reference it; folds today's separate `uploadImage` prop into the source. Upload is pick-with-a-create-step, not a fourth lifecycle (§7.1).

Today's three kinds are now just capability combos. Media library = `load` + `resolve` (+ `upload`, + optionally a host `renderPicker`). Post / chapter / author ref = `load` + `resolve`. Embed (YouTube) = `resolve` only — no `load`, because there is no collection to browse; the author pastes a URL as a free-text ref, and the `allowedEmbedDomains` guard (§3.8) lives inside that source's `resolve`. Embed is therefore not a third species; it is the degenerate `resolve`-only source.

Every capability being optional from the start is the single most important shape decision in the document. A `load`-only source is a browse-only picker with no live refresh; a `resolve`-only source is paste-a-ref like embed; a `renderPicker` source brings its own browser. Retrofitting optionality after the type ships as `{ load; resolve }` required would force a breaking change the first time a browse-only, paste-only, or host-rendered source appears.

## 5. The Three-Actor Seam

### 5.1 Source, Block, Engine

What keeps this general rather than a pile of special cases is that three actors are decoupled by a source-id string — the same registry-by-string pattern the engine already uses for blocks, marks, and commands (docs/011 §12.3, docs/024).

The **source** is deployment-owned. It returns whatever the host's records look like as domain-agnostic `ResourceOption`s, and it knows nothing about blocks. A deployment that has a `posts` table writes one source that searches and fetches posts; that is its entire obligation.

The **block** is author-owned. It owns the *projection*: `toData(option) → patch` adapts a generic option into *its* data shape, and `renderResting` paints the snapshot. The block knows the source id it consumes but nothing about the host's backend. A `post-ref` block knows it projects the `posts` source into `{ ref, title, url }`; it does not know how posts are stored or fetched.

The **engine** owns everything between them: the default picker UI, the `{ ref, snapshot, local }` cache, resolve scheduling, provenance gating, and the reader's static render. The engine knows neither the host's backend nor any block's projection shape; it moves opaque options and patches across the seam.

### 5.2 Why Two Registries Joined By Id, Not One Fused Thing

The source and the block must be *separate* registries joined by a source-id string, not one fused "host block" object that bundles fetch + projection + render. The reason is concrete and is the payoff of the seam: **one source can feed many blocks.** A `products` source can feed a `product-card` block, an inline `product-mention` block, and a `comparison-row` block, each with its own `toData` projection of the same option. If fetch and projection were fused into one registration, you would write the products fetch three times, once per block. Keeping them separate means a host adds a referenceable collection by registering one source, and every block that projects that source lights up at once.

This also means the dependency runs one way: blocks depend on a source id (a string), not on a source object. A block can be registered before its source exists; it simply has no insert affordance until the source is present (§9). This is what makes custom reference blocks shippable in a package that does not know which deployments will wire the backing collection.

### 5.3 One Source Feeds Many Blocks

Stated as the design invariant it is: the multiplexing in §5.2 is the concrete justification for the registry split, and it is also the reason §8 holds — the moment sources and the `resource` field kind are public, a custom block gets host-data reference for free, because a custom reference block is literally `registerNode` plus a resource field bound to a source. There is no separate "custom block data" mechanism to design later; it falls out of this seam.

## 6. The Gated Surface — And Only This

### 6.1 What The Host Registers

The host registers **sources** through a public registry that mirrors the existing node/command registries: `registerDataSource`, `getDataSource`, `listDataSources`. A source is `{ id, load?, resolve?, renderPicker?, upload? }`, every capability optional (§4.4):

```text
type DataSource = {
  readonly id: string;
  // browse/search the collection; the cursor-paginated contract so the host
  // owns paging (a 10k-post collection ships one page per call). Absent for
  // paste-a-ref sources (embed). The full @idco/ui ResourceSource union (§3.7):
  //   { mode: "sync"; items }
  //   { mode: "async"; load(query, signal) }
  //   { mode: "paginated"; load({ query, cursor, signal }) -> { items, cursor? } }
  load?: ResourceSource;
  // refresh one record's projection by ref; absent for browse-only sources.
  resolve?: (ref: string, signal: AbortSignal) => Promise<ResourceOption | null>;
  // the host's own pick surface (its media-library modal); the engine delegates
  // to it instead of the default ComboBox when present (§6.4). Declarative so the
  // engine owns overlay lifecycle (dismissal, focus, theme); the host fills the body.
  renderPicker?: (props: { onChoose: (o: ResourceOption) => void; onCancel: () => void; query?: string }) => ReactNode;
  // create a record then reference it (upload-as-create, §7.1).
  upload?: (file: File, signal: AbortSignal) => Promise<ResourceOption>;
};
```

`load` is the full `@idco/ui` `ResourceSource` union (sync / async / cursor-paginated, §3.7), adopted up front so a large collection cursors without a later breaking change — the host picks the mode that fits its backend and owns paging. `resolve` is engine-only and has no UI counterpart. `renderPicker` lets the host own the pick surface; the engine still owns the overlay container so dismissal, focus return, and theme placement stay consistent (the React Aria rules). `upload` folds in the old `uploadImage` prop. Every field is optional, so a source declares only the capabilities it has. That is the entire host-facing surface — one registration call and one object shape.

### 6.2 What The Block Declares

A reference-block node declares "my data projects source X" through a `resource` config field. `NodeViewConfigField` widens from today's text-only shape (§3.3) into a union:

```text
type NodeViewConfigField =
  | { kind: "text"; key: string; label: string }                       // today's shape
  | { kind: "resource"; key: string; label: string;
      source: string;                                                   // joins to a registered DataSource by id
      toData: (option: ResourceOption) => Partial<JsonObject> };        // the projection, returns a patch
```

The block author writes `toData` to project a generic option into the node's own snapshot fields. `toData` returns a *patch* (a partial of the node data), never a single value — a citation or a product card projects several fields at once, and a single-value return would force a rewrite the first time a block needs two fields. The `source` string is the only coupling between block and host; everything else the block declares is its own projection and render.

### 6.3 What Is Generic Engine The Host Never Touches

Everything downstream of those two declarations is generic engine. The host never writes any of it:

- The **picker UI** — by default the standardized React Aria ComboBox + `ListBoxLoadMoreItem` (§3.7), rendered by the config popover when it meets a `resource` field and driven by the source's `load`; when the source supplies `renderPicker`, the engine mounts the host's surface in the same overlay instead (§6.4).
- The **`{ ref, snapshot, local }` cache** — the engine writes the ref and the `toData` patch into the node's `data` on pick.
- **Resolve scheduling** — the engine calls `resolve` on mount and patches the snapshot (§7.2).
- **Provenance gating** — the engine hides a reference block's insert affordance when its source is not registered (§9).
- The **reader static render** — the reader paints the stored snapshot with no host call (§7.4).

This is the whole point: the gated surface is `registerDataSource` plus the `resource` field kind, and nothing else crosses into host code. `renderPicker` is part of `registerDataSource` (a source capability), so it does not widen that surface — it lets the host render *its own* pick UI through the one registry, not add a second one.

### 6.4 Pick Is A Seam, Not A Surface: The Editor's Boundary

A media library — grid browse, folders, upload, drag-drop, crop, asset metadata, pagination, permissions — is a host application surface, not an editor feature. The host already ships one (the deployment's CMS, content-api admin). If the editor grew its own, it would duplicate that surface, drag upload transport and folder/asset models into the product-neutral package (exactly what the `@idco/ui` boundary rules forbid), and ship a browser permanently weaker than the host's real one. So the editor does not own a media library; it owns the *pick seam* and one default pick surface.

The boundary, stated as ownership:

| Actor | Owns |
| --- | --- |
| **Editor** | the `{ ref, snapshot, local }` cache, resolve scheduling, the status lifecycle, the *default* pick surface (the one React Aria ComboBox with thumbnail rows via `renderOption`), provenance gating, and the resting render of the snapshot |
| **Host / source** | the records, `load` / `resolve` / `upload`, and *optionally the entire pick surface* via `renderPicker` (its media-library modal — grid, table, upload, folders; its call) |
| **Block author** | the `toData` projection and `renderResting` |

The default picker stays a plain ComboBox; no grid is added to the neutral package, because real deployments bring their own browser through `renderPicker`. That keeps the standardize-don't-diverge rule intact: the neutral editor still ships exactly one built-in picker, and a host modal is not the editor diverging — it is the host rendering its own surface through a declared seam, the pick-time twin of the host-supplied render escape hatch (§11). The engine treats both paths identically: it asks the source to pick, gets back a `ResourceOption`, applies the block's `toData`, and never knows whether the option came from a dropdown, a table, or a grid.

## 7. Lifecycle: Instantiate, Resolve, Bake, Render

### 7.1 Instantiation: Born Unresolved, Choose-First Via Rollback

There is no "pick" primitive in the SPI, and that is deliberate. Pick is a UI affordance — the resource field's input surface — not an engine verb. What looks like "the engine must expose a pick operation" dissolves once you see that readiness is already a data-derived model state. The bake pipeline turns a block's `data` into a status on every edit (`src/core/bake/bake.ts:96`): a snapshot bakes to `ready`, data with no valid bake to `invalid`, an unbaked/unbakeable object to `unresolved`, and the render pipeline already paints a placeholder for any non-ready object (`src/view/render/object-block.tsx:39`). So a reference block whose `data` has no `ref` is simply an `unresolved` object — the same state as an object whose baker has not run. "This reference needs a record before it is complete" is not a new contract; it is the existing lifecycle. The only SPI addition this whole area makes is the `resource` field kind (§6.2); there is no `requestPick` and no `initialize()`, because a block already declares its data validity through the `bake` / `parse` the node SPI requires (docs/016), and readiness falls out of it.

Insertion is **choose-first, implemented as rollback.** Inserting a reference block creates the node immediately in its `unresolved` state (the synchronous `createData` path, unchanged), auto-opens its picker, and — if the author cancels that first pick — removes the just-inserted node. This is choose-first (you pick to bring the block into being) without the cost of a deferred, node-less insert pipeline, which would have nothing to anchor a host `renderPicker` modal against. The reasoning is not UX taste: a reference block's identity comes from the picked record, so "pick to instantiate" is the honest insert semantics of the reference kind, and a reference with no referent is a contradiction the `unresolved` state should hold only transiently, never persist. The two-kinds split (§4.1) therefore predicts two insert behaviors — owned blocks insert empty and you type into them; reference blocks you pick, then they exist — and choose-first makes the insert semantics follow the kind rather than paper over it.

Rollback carries three consequences worth stating. First, insert-plus-initial-pick must coalesce into a single undo unit, so a completed pick is one history step and a cancel cleanly removes the node without a ghost block or a stray entry; this is an internal command/history detail, not an SPI concern. Second, choose-first forecloses dropping empty reference slots to fill later (a scaffolding workflow); the design accepts that globally for now, and §11 records a per-block `deferrable` opt-out as the named escape if a block ever needs it. Third, `unresolved` / `invalid` do not disappear — they remain necessary for the runtime cases choose-first cannot prevent: a ref that goes dangling after the fact, or a `resolve` that fails later (§7.3).

The engine provides the three resting affordances around `renderResting` so every reference block is consistent without re-implementing them: *empty* (no ref yet) shows a "Pick a {label}" call-to-action that opens the picker; *unresolved* (picked, not yet resolved) shows the snapshot with a subtle loading hint; *invalid* (dangling or failed) shows the stale snapshot with a quiet "couldn't refresh" affordance (§7.3).

On pick — whether at instantiation or a later **Replace** — the engine runs `toData(option)`, merges `{ ref: option.id, ...patch }` into the node's `data` via the existing `set-object-data` command (the same command `media` and the config panel already use, `src/view/render/object-config.tsx:34`), re-bakes, and the derived status moves toward `ready` (or stays `unresolved` until the first `resolve` confirms it, §7.5). Replace is not special machinery: it is editing the same `resource` field through the normal chrome, so pick appears in exactly one place — the field's input surface — used at two times. Upload is the same path with a create step in front: the source's `upload` makes the record, returns an option, and the pick proceeds identically. There is no separate upload lifecycle and no separate replace lifecycle.

### 7.2 Resolve: Stale-While-Revalidate

On mount, the engine renders the stored snapshot instantly, then calls the source's `resolve(ref, signal)` and patches the snapshot with the fresh projection. This is stale-while-revalidate, not store-only. Store-only would mean a post renamed in the host never updates in a document that already references it — a dead copy. SWR is small and is the difference between a live reference and a dead one. Resolve is abort-aware (the `signal`) so a block scrolled out of the virtual window mid-fetch cancels cleanly, and it is idempotent so repeated mounts (virtualization remounts blocks constantly, docs/011) never corrupt state. A source with no `resolve` (browse-only) simply skips this step; its snapshot is whatever the last pick wrote.

### 7.3 The Snapshot Is The Error Fallback

A dangling ref (the record was deleted host-side) or a failed `resolve` (network error, off-allowlist embed) renders the *stale snapshot* plus a quiet "couldn't refresh" affordance — never a blank, never a broken artifact. The node moves to `"invalid"` status but stays visible. This is the docs/015 §10 baked-field-staleness risk applied to refs, and it is solved once in the engine for every reference block rather than per block. The principle: the snapshot exists precisely so that the absence of the host is survivable, so the engine must never let a host failure erase content the author already placed.

### 7.4 Snapshot Persistence Makes The Reader Static

The snapshot must persist into the baked output so the reader renders it with no host call. The reader is server-native and runs no heavy libraries and makes no host fetch (docs/015 §9); it renders `baked.payload` directly. A reference block whose snapshot did not bake would force the reader to resolve on render — exactly the legacy behavior docs/015 retires. Node `data` already serializes, and the bake pipeline already produces `BakedSnapshot` for object nodes (§3.5); the work this design names is to make the contract *explicit* — confirm bake/serialize carries the snapshot fields, and treat the snapshot as a required baked field whose staleness fallback (§7.3) the reader honors. This is the one place the editor and reader share a hard contract: the snapshot is the shared baked field, the editor's live picker and the reader's static render are separate surfaces behind it (docs/015 §6.2 identity-shared / surfaces-separate).

### 7.5 Mapping Onto The Existing Model

The lifecycle uses the model states already present (§3.5), which is why no new model machinery is introduced:

- At insert, before any pick: the node is created `unresolved` with empty `data` (no `ref`); the resting render shows the empty "Pick a {label}" affordance and the picker auto-opens (choose-first, §7.1). A cancel here rolls the insert back.
- After pick, before first resolve: `status = "unresolved"`, `data = { ref, snapshot, local? }`, `baked` carries the snapshot.
- After successful resolve: `status = "ready"`, `snapshot` (projected keys only) patched to the fresh projection, re-baked; `local` untouched.
- After failed resolve or dangling ref: `status = "invalid"`, snapshot unchanged (stale), affordance shown (§7.3).
- A browse-only source (no `resolve`): stays `"ready"` after pick; there is nothing to revalidate against.

The engine drives these transitions generically off the `resource` field's presence and the source's capabilities; no block writes status logic.

## 8. This SPI Is The Custom-Block-Data SPI

"Generalize the data provider" and "let a custom block reference host data" are the same work, and conflating them on purpose is the design's economy. The moment the `resource` config-field kind and `registerDataSource` are public, a custom block gets host-data reference for free, because a custom reference block is literally `registerNode` (§3.4) plus a `resource` field (§6.2) bound to a source (§6.1). There is no separate "custom block data" phase to defer; it only *appears* as separate work if item 2 is built wrong — as media/post-only bindings (§3.6) instead of a general source registry.

### 8.1 Worked Example: A `product-card` Custom Reference Block

The shape a feature author writes, end to end (sketch, not final API):

```text
// Deployment wires the collection once, against its real backend:
registerDataSource({
  id: "products",
  load:    (q, signal) => api.searchProducts(q, signal),   // ResourceOption[]
  resolve: (ref, signal) => api.getProduct(ref, signal),   // ResourceOption | null
})

// Block author registers the node — knows the source id, not the backend:
registerNode({
  view: {
    type: "product-card",
    insert: { label: "Product", group: "Data", keywords: ["product", "shop"] },
    configFields: [
      { kind: "resource", key: "ref", source: "products", label: "Product",
        toData: (opt) => ({ title: opt.label, price: opt.badge, img: opt.image }) },
    ],
    renderResting: ({ baked }) => <ProductCardView {...asRecord(baked.payload) /* the snapshot */} />,
  },
})
```

The flow this exercises, naming each seam: register source → register node with a resource field → author picks via the standard ComboBox → `toData` projects the option into the node's snapshot patch → engine writes `{ ref, ...patch }` to `data` and bakes → `renderResting` paints the snapshot → bake persists the snapshot so the reader is static (§7.4) → `resolve` refreshes on mount (§7.2) → if `products` is not registered in this deployment, the insert affordance is hidden (§9). Nothing in that flow is media-specific, which is the whole point: `product-card` and `media` traverse identical machinery.

### 8.2 The Forcing Function: Rebuild Media And Post-Ref On The SPI

The discipline that keeps the SPI honest is to rebuild the built-in `media` and `post-ref` (and `embed`) on this SPI rather than leaving them as bespoke text-field nodes beside it. If the two built-ins still work after the refactor, the SPI is general by construction — they become proof instances, not special cases. Concretely: `post-ref`'s three text fields (§3.2) become one `resource` field bound to a `posts` source with a `toData` that projects `{ title, url, postId }`; `media`'s manual fields plus upload become a `media` source with `load` (library browse), `resolve` (asset refresh), and the upload-as-create path (§7.1); `embed` becomes a `resolve`-only source whose `resolve` carries the `allowedEmbedDomains` guard (§3.8, §4.4). If any of the three cannot be expressed on the SPI, the SPI is under-powered and the gap is found before custom blocks depend on it — which is the entire value of using the built-ins as the forcing function.

## 9. Provenance Gating

Provenance is gating, not navigation (docs/006 §7.9). A reference block's insert affordance is enabled when its source is registered in the current deployment and hidden when it is absent — a registry lookup, not a feature flag. A deployment with no `posts` source does not show "Linked post" in the insert menu, because the block cannot function without its source. This wires immediately, on day one, for the same reason capabilities are optional from the start (§4.4): deferring it ships custom blocks broken in deployments that lack their backing collection, and the gating is a `listDataSources` lookup keyed by the block's declared `source` string, not new infrastructure.

This is also where this SPI partly implies note.md item 6 (the `allowedNodes` schema profile). For reference blocks the profile is already partly enforced by provenance: no source means the block is gated regardless of any allowlist. The schema profile only needs to make *deliberate* calls about owned blocks (does this deployment allow tables?) and about which collections are exposed; the reference-block half of "what can this deployment insert" is provenance, already gated here. The two mechanisms compose — provenance gates by capability presence, the schema profile gates by deliberate policy — and §11 records that their interaction must be settled when item 6 is designed.

## 10. Architecture Decisions

**Decision: one source registry joined to blocks by id; reject fused host-block objects.** Sources and blocks are separate registries linked by a source-id string (§5). Rejected: a single `RichTextHostNodeDefinition` that bundles fetch + projection + render (the docs/006 §5.3 host-node sketch). The fused shape forces the fetch to be rewritten once per block that projects a collection (§5.2) and couples a shippable block package to a specific backend. The split costs one extra indirection (a string lookup) and buys source-feeds-many-blocks multiplexing, which is the property that makes custom reference blocks viable.

**Decision: route through `registerNode` / `configFields`; reject a parallel data-provider registry.** The `resource` field kind extends the existing node SPI (§6.2) rather than introducing a second registration mechanism. Rejected: porting `RichTextEditorBindings` verbatim (§3.6) or standing up a `dataProviders` prop parallel to `registerNode`. A parallel registry would re-create the per-kind coupling and split block registration across two surfaces, and it is the specific failure mode §8 warns about — it is what makes "custom block data" look like separate work.

**Decision: `load?` and `resolve?` both optional from day one; reject required capabilities.** §4.4. Rejected: shipping `DataSource` as `{ load; resolve }` and adding optionality later. Optionality is the difference between embed being the degenerate `resolve`-only source and embed being a bespoke flag; making it optional after the type ships is a breaking change to every registered source.

**Decision: `toData` returns a patch, not a value; reject single-value projection.** §6.2. Rejected: `toData(option) → value` writing one field. Multi-field projection (citation, product card) is the common case for anything richer than a bare link, and a single-value return forces a rewrite the first time a block needs two fields. The patch shape is native to multi-field projection and degrades gracefully to one-field blocks.

**Decision: stale-while-revalidate with the snapshot as fallback; reject store-only and reject resolve-on-render.** §7.2, §7.3. Rejected store-only: a renamed record never updates, producing a dead copy. Rejected resolve-on-render (legacy Lexical): the server reader cannot fetch, so resolve-on-render is incompatible with docs/015 and re-opens the staleness the bake model closes. SWR over a persisted snapshot is the only shape that is both live in the editor and static in the reader.

**Decision: provenance gating wired immediately; reject deferring it.** §9. Rejected: shipping insert affordances ungated and adding source-presence checks later. Ungated insert ships broken blocks in deployments missing the source, and the gate is a registry lookup, not a feature worth phasing.

**Decision: no pick primitive — readiness is bake-derived. Reject `requestPick` / an init contract.** §7.1. Pick is the resource field's input surface, not an engine verb. A reference block's completeness is already a data-derived status (`bake` → `ready` / `invalid` / `unresolved`), so "needs a record" is the existing lifecycle, not a new contract. Rejected: a `requestPick` operation or an `initialize()` method — both re-invent state the bake pipeline already computes, and both privilege "pick" as a concept when it is one UI affordance used at two times (instantiate, replace). The only SPI addition this whole area makes is the `resource` field kind.

**Decision: choose-first insertion via rollback. Reject deferred (node-less) insert and reject droppable-empty as the default.** §7.1. Insertion creates the node immediately (`unresolved`), auto-opens the picker, and rolls back on cancel. Rejected deferred insert (no node until picked): it has nothing to anchor a host `renderPicker` modal against and needs a new, cancellable insert pipeline. Rejected droppable-empty as the default: a persisted reference with no referent is a contradiction the kind should hold only transiently; choose-first is the honest insert semantics of the reference kind. The per-block `deferrable` opt-out (§11) is the named escape for scaffolding workflows, not the default.

**Decision: the editor owns the pick seam, not a media library; the host may own the pick surface via `renderPicker`. Reject building a grid/library into the neutral package.** §6.4. The default picker is the one ComboBox; a media browser is a host surface plugged in through `renderPicker`. Rejected: adding a grid / upload / folder browser to `@idco/ui` or the editor — it duplicates the host's CMS, pulls product-specific concerns into the neutral package, and is permanently weaker than the host's real library. `renderPicker` is the pick-time twin of the §11 host-supplied render, so this adds no second escape-hatch philosophy.

**Decision: split projected (`snapshot`) from author-local (`local`) fields; SWR patches projected only. Reject a flat snapshot.** §4.3, §7.2. A flat snapshot loses an author-typed caption on the first `resolve`. The split is the smallest shape that lets a reference block carry both record-derived and author-authored fields, which media (`caption`) needs on day one.

**Decision: `load` is the full `ResourceSource` union (sync / async / cursor-paginated) up front; the host owns paging. Reject async-only with paging deferred.** §4.4, §6.1. A 10k-record collection must page, and paging is the host's concern (it knows its backend's cursoring). Adopting the union up front mirrors the capability-optionality reasoning: deferring the paginated mode is a breaking change the first time a large collection appears.

## 11. Open Decisions To Settle Before Building

These are genuine design choices that must be locked before implementation, per the SPI-first rule. They are not implementation tasks; they are shape decisions whose answer changes the SPI.

**The host-node registry: separate escape hatch or degenerate reference block?** docs/006 §5.3 sketches an opaque `RichTextHostNodeDefinition` with host-supplied `renderEditor` / `renderReadOnly`. The decision is whether that is a second, parallel mechanism or just the degenerate reference block whose projection is "store the whole record" and whose render is host-supplied. Recommended lean: the latter — one concept, not two parallel host-block mechanisms. A host that wants an opaque block registers a source whose option carries the full record and a block whose `toData` stores it whole and whose `renderResting` is the host-supplied render. This lean is now reinforced by `renderPicker` (§6.4): the host-supplied *pick* surface and a host-supplied *render* are the same escape-hatch philosophy applied at two times (pick-time and render-time), so collapsing the host-node registry into the degenerate reference block keeps one philosophy, not two. Settle it before building, because a second mechanism, once grown, is expensive to remove and re-fragments the seam this document unifies.

**Glossary: reference block or inline-owned term?** note.md item 3 (comments) carries `glossary` as an identity mark today. The open question is whether a glossary term is a `glossary-term-ref` projecting a host glossary collection (a reference block under this SPI) or an inline-owned term/definition the author types (an owned block). Decide alongside this SPI, not blind — if glossary terms live in a host collection, glossary authoring becomes a reference-block instance and inherits the picker, resolve, and gating for free; if they are inline-owned, glossary stays out of this SPI entirely.

**Interaction with the `allowedNodes` schema profile (item 6).** §9 establishes that provenance gates reference blocks by source presence and the schema profile gates by deliberate policy. The open question is the precedence and composition rule when both apply: a deployment that registers a `posts` source but whose schema profile excludes `post-ref` should hide the block (policy wins over capability), and the inverse (profile allows, source absent) hides it too (capability wins over policy when capability is missing). Lock the composition as "hidden if either gate closes" when item 6 is designed; this document only records that the two gates coexist and must not contradict.

**`ResourceSource` mode alignment — resolved.** The engine's `DataSource.load` is the full `@idco/ui` `ResourceSource` union (sync / async / cursor-paginated), adopted up front so the host owns paging and a large collection cursors without a later breaking change (§4.4, §6.1, §10). Recorded here as settled rather than open.

**Global choose-first vs per-block `deferrable` opt-out.** Choose-first-via-rollback is the global default (§7.1, §10). The open knob is whether a specific block may opt into `deferrable` — insert empty, fill later — for scaffolding workflows (an academic citation you place then resolve; a related-posts layout you lay out then populate). Lean: global for now, no knob; add `deferrable` per block only when one demonstrably needs it. Designing the opt-out before a consumer needs it is the kind of speculative surface SPI-first exists to avoid, but it is recorded so the retrofit, if it comes, is expected and local (a per-block flag the insert path reads, not a model change).

## 12. Edge Cases And Failure Modes

**Dangling ref (record deleted host-side).** `resolve` returns `null`. The block stays visible rendering its stale snapshot, moves to `"invalid"` status, and shows a quiet "couldn't refresh" affordance (§7.3). It never blanks. The author can re-pick to repair the ref or delete the block.

**Failed resolve (network/transient).** Same surface as a dangling ref — stale snapshot plus affordance — but the engine may retry on the next mount since the ref is presumed valid. Resolve is abort-aware and idempotent (§7.2), so a flapping network never corrupts the snapshot.

**Source unregistered in this deployment.** Existing reference blocks in a loaded document still render their persisted snapshot (the snapshot is self-sufficient, §7.4), but their insert affordance is hidden and their config picker is inert (no `load` to feed it). The document degrades to read-of-snapshot, which is exactly the reader's behavior, so a document authored in a rich deployment opens harmlessly in a thin one.

**Off-allowlist embed URL.** The embed source's `resolve` enforces `allowedEmbedDomains` (§3.8, §4.4); an off-allowlist URL resolves to `null` (or a flagged option), the preview is suppressed, and the block shows the stale/placeholder state rather than framing an untrusted origin. The guard lives in the source, so the engine needs no embed-specific branch.

**Upload that creates but fails to reference.** The upload-as-create path (§7.1) is two steps; if the create succeeds but the subsequent pick/resolve fails, the engine must not leave an orphan node with a ref to a record it cannot project. The node lands `"unresolved"` with whatever the create returned as its snapshot, so it is never blank, and a later resolve completes it.

**Virtualization remount mid-resolve.** Blocks unmount and remount as the virtual window moves (docs/011). Resolve must cancel on unmount (the `signal`) and re-issue on remount without double-writing. This is why resolve is specified abort-aware and idempotent rather than fire-once.

**Snapshot drift from source schema change.** A source whose option shape changes (a field renamed host-side) produces a `toData` patch that may miss fields. The snapshot keeps its last-good fields for anything the new patch omits (patch-merge, not replace, §6.2), so a partial projection degrades to partial-fresh rather than data loss. A block author who renames a projected field owns the migration of their `toData`.

**Two blocks projecting one source disagree.** By construction they cannot show different *records* for the same ref — both resolve the same id against the same source — but they can project different *fields* (a card shows price, a mention shows only the name). That is intended multiplexing (§5.3), not a failure; the shared thing is the record identity and the resolved option, not the projected snapshot.

# Part II — Implementation

Part I fixed the model. Part II is the build plan: the phasing, the per-subsystem detail, the one-time import and its sunset, the `@idco/ui` changes, the sliced backlog, the tests, and the finish line. It exists so the implementation never has to return to Part I to resolve an undesigned corner. Nothing here is scheduled — 026 is one of several note.md items and ships when its turn comes; the plan is written so a future slice can be picked up cold.

## 13. Implementation Strategy

The strategy is spine-first, host-and-history-last, each phase a self-contained editor that builds and tests green so work can stop after any phase without a half-wired feature. The ordering is driven by dependency and by risk: the parts with no external dependency and no engine-internals change come first; the parts that touch the transaction/history chokepoint (rollback) and the parts that cross the package boundary (`@idco/ui`, the host) come last.

Six phases, each reviewable and shippable in isolation:

- **P1 — SPI spine (no host surface, no resolve, no rollback).** The source registry, the `resource` config-field kind, the default ComboBox in the config popover, the `{ ref, snapshot, local }` data contract, and `post-ref` rebuilt on the SPI against a sync demo source in Ladle/tests. This proves an end-to-end reference block with the least machinery. Placeholder-first insertion (today's flow) is acceptable here; choose-first lands in P5.
- **P2 — resolve / SWR + status lifecycle.** The resolve scheduler on the existing task scheduler, the engine-driven ref status (`unresolved`/`ready`/`invalid`), and the three resting states. After P2 a reference block is live: it revalidates on mount and degrades to its snapshot on failure.
- **P3 — media + upload.** The `upload` source capability (folding the old `uploadImage` prop), the default ComboBox upload affordance, and `media` rebuilt on the SPI with `caption` as a `local` field.
- **P4 — host pick surface + the boundary.** The engine-owned `renderPicker` overlay and delegation, plus the `@idco/ui` `ResourceKind` relaxation. After P4 a deployment can plug its real media-library modal in.
- **P5 — choose-first via rollback + provenance gating.** The insert-auto-opens-picker flow with cancel-rolls-back coalesced into one undo unit, and the insert-menu gating by source presence. This is the only phase that touches the transaction/history chokepoint.
- **P6 — embed + one-time import.** `embed` rebuilt as a `resolve`-only source with the `allowedEmbedDomains` guard, and the `payload-import.ts` update to emit reference-block-shaped media for the `payloadcms.db` corpus.

Cross-phase invariant: after every phase, `pnpm check` (format → lint → dup → typecheck → test → build) is green and the built-ins that exist still round-trip. P1–P3 are pure additions inside `packages/editor` and `packages/ui`; P4 introduces the host seam; P5 is the riskiest (history); P6 is import-corpus work that can run in parallel with P4–P5 since it only touches `payload-import.ts`.

## 14. Detailed Implementation Plan

### 14.1 Source Registry

New file `view/spi/data-source-registry.ts`. The registry lives in the **view** layer, not core, because `renderPicker` returns React and `load`/`resolve` feed a React picker. It mirrors the existing module-level singletons (`view/spi/node-view.ts`, `view/spi/command-registry.ts`): `registerDataSource(source)`, `getDataSource(id)`, `listDataSources()`, idempotent-by-id so HMR/test re-import replaces rather than throws. The `DataSource` type is `{ id; load?; resolve?; renderPicker?; upload? }` (§6.1), with `load` typed as `@idco/ui`'s `ResourceSource` and `resolve`/`upload` returning `ResourceOption`/`ResourceOption | null` from `@idco/ui`. The core stays untouched: a reference block's `bake` consumes only its own `data.snapshot` (plain JSON), so the worker-safe core never imports the registry. This split is the architecture-lint-safe placement — `packages/editor/src/core` keeps no React and no `@idco/ui` import.

### 14.2 Resource Config-Field Kind

Widen `NodeViewConfigField` from `{ key; label }` to the union in §6.2: `{ kind: "text"; key; label } | { kind: "resource"; key; label; source; toData }`. Default `kind` to `"text"` when omitted so every existing `configFields` declaration (post-ref, embed) keeps compiling — a non-breaking widening. In `ObjectConfigPanel` (`view/render/object-config.tsx:53`), branch per field kind: a `text` field renders today's `Input`; a `resource` field renders the picker (§14.3) and, on choose, commits `{ ref: option.id, ...toData(option) }` through the existing `set-object-data` command (`object-config.tsx:34`). The panel keeps no per-type knowledge — it reads `kind` generically, exactly as it reads `key`/`label` today.

### 14.3 Default Picker Integration

The `resource` field's default surface is `ResourceSelector`. The editor passes `kind="record"` (or the relaxed generic kind, §16), a `renderOption` that shows a thumbnail for image-bearing options, and a `source` adapted from the block's `DataSource.load` (the `ResourceSource` union is passed through unchanged since the types are shared). When `source.upload` exists, the picker shows an upload button beside the ComboBox that calls `upload(file)` and feeds the returned option straight into the choose path (upload-as-create, §7.1). No grid is built here; the vertical thumbnail list is the default, and a richer browser is the host's `renderPicker` (§14.4).

### 14.4 The `renderPicker` Overlay Host

In `view/render/object-config.tsx`, or a new `view/render/resource-picker.tsx`. When the chosen source exposes `renderPicker`, the engine mounts the host body inside an engine-owned React Aria overlay (`ModalOverlay`/`Modal`/`Dialog`, per the `@idco/ui` modal rule — never native `<dialog>`), passing `{ onChoose, onCancel, query? }`. The engine owns dismissal, focus return, and theme placement; the host fills only the body (its grid/table/upload). On `onChoose(option)` the engine runs the same `toData` + `set-object-data` path as the default picker, so the host surface and the default ComboBox converge on one commit path. `renderPicker` is opened from the same two entry points as the default picker (config edit, and choose-first instantiation in P5), so there is no host-surface-specific lifecycle.

### 14.5 Resolve Scheduler And SWR

New file `view/controllers/use-resolve.ts`, built on `core/scheduler.ts`. Resolve is a new lane on the existing framework-free scheduler (`core/scheduler.ts`), so on-mount resolves coalesce and stay budgeted rather than firing one fetch per mounted block. A `useResolve(node)` controller, mounted by the object dispatcher for any node whose active `resource` field's source has `resolve`, fires `resolve(ref, signal)` on mount, patches **only the projected `snapshot` keys** via `set-object-data` (never `local`, §7.2), and aborts on unmount. It is idempotent: virtualization remounts a block constantly (docs/011), so the controller dedupes in-flight resolves per `ref` and tolerates repeated mounts. A browse-only source (no `resolve`) mounts no controller. Resolve outcome drives status (§14.6).

### 14.6 Reference-Block Status Lifecycle

The model has one `status` field, and today it is bake-derived on every `set-object-data` (`commands/objects.ts:79`, `bake.ts:96`). For reference blocks that rule is refined, because "needs a record" is a resolve-lifecycle fact, not a bake fact. The decision, made here so the state machine is unambiguous: **a reference block's `bake` always produces its snapshot artifact (so the reader has something static), returning `ready`; the engine then overrides status from the resolve lifecycle.** Concretely:

- On insert / pick of a `resource`-field block whose `data` has no `ref` yet: the engine sets `status = "unresolved"` (a small branch in the insert/`set-object-data` path: a block with a required resource field and no `ref` is `unresolved` regardless of bake).
- On `resolve` success (or immediately, for a browse-only source after a pick that set a `ref`): `status = "ready"`.
- On `resolve` failure or a `null` (dangling ref): `status = "invalid"`, snapshot left stale.

To let the resolve scheduler move status without re-deriving it from bake, add a minimal engine path — a `set-object-status` command (or a status argument on the snapshot-patch path) — so §14.5 can mark `ready`/`invalid` after a fetch. Owned blocks are unchanged: their status stays purely bake-derived. The reconciliation in prose: §7.1's "readiness is data-derived" means *completeness = a `ref` is present*; the resolve outcome then refines `unresolved → ready/invalid`. §7.5's bullets are the authority on the transitions.

### 14.7 Data Shape And Projection Helpers

Add helpers beside `asRecord`/`stringField`/`currentObjectRecord` (`view/object-data.ts`): readers for `data.ref`, `data.snapshot` (projected), and `data.local` (author-local), and a `patchSnapshot(data, projected)` that merges projected keys while preserving `ref` and `local`. The `toData(option)` projection writes into `snapshot`; the config panel's `text` fields for a reference block write into `local`. Bake reads `snapshot` (+ whatever `local` the resting render needs) into `BakedSnapshot.payload`, so the reader paints the snapshot statically (§7.4). This keeps the projected/author-local split (§4.3) mechanical and in one place.

### 14.8 Choose-First Via Rollback

Insertion of a `resource`-field block creates the node immediately (`unresolved`, empty `data`, via the existing `compileInsertObject` path, `commands/objects.ts:65`), then auto-activates the block and opens its picker (§14.3/§14.4). The new behavior is cancellation: cancelling the *initial* pick of a never-resolved block removes the node. The hard part is history — insert (`insert-object`) and the first `set-object-data` must coalesce into one undo unit, and a cancel must undo cleanly with no ghost block or stray entry. This is done at the §6.1 transaction chokepoint (`core/store/history.ts`): mark the insert transaction as *provisional* until the first pick commits, so a committed pick coalesces insert+data into one history entry and a cancel discards the provisional transaction rather than pushing a remove. This is the only engine-internals change in the whole plan and is isolated to P5; nothing in P1–P4 depends on it (P1–P4 use placeholder-first insertion).

### 14.9 Three Resting States Chrome

The object dispatcher already renders a status placeholder for non-ready objects (`object-block.tsx:39`). Extend it, for reference blocks only, into the three affordances of §7.1: *empty* (no `ref`) renders a "Pick a {label}" call-to-action that opens the picker; *unresolved* (picked, resolving) renders the snapshot with a subtle loading hint; *invalid* (dangling/failed) renders the stale snapshot with a quiet "couldn't refresh" control that re-opens the picker. These wrap `renderResting` generically, so every reference block — built-in or custom — gets them without per-block code.

### 14.10 Provenance Gating

A reference block declares its `source` on its `resource` field. The insert/slash menu, which already enumerates `listInsertableNodes()` (`node-view.ts:194`), filters out any block whose required `resource` field names a source absent from `listDataSources()`. This is a registry lookup at menu-build time, not a per-block flag. Existing reference blocks already in a document still render their persisted snapshot regardless (the snapshot is self-sufficient, §7.4); gating only governs the *insert affordance*.

### 14.11 Rebuild The Three Built-Ins

`post-ref` (P1): replace its three `text` fields with one `resource` field bound to a `posts` source, `toData(opt) → { title: opt.label, url: opt.sublabel ?? "", postId: opt.id }`; `renderResting` already paints `RichTextPostReference` from the snapshot, so only the config half changes. `media` (P3): `load` (library browse) + `resolve` (asset refresh) + `upload` (create); `src`/`alt` are projected `snapshot`, `caption` is `local`; the existing `MediaLiveSurface` upload button moves onto the source's `upload`. `embed` (P6): a `resolve`-only source (no `load`) whose `resolve` carries the `allowedEmbedDomains` guard; the author still pastes a URL as the free-text `ref`. If any of the three cannot be expressed on the SPI, the SPI is under-powered and the gap surfaces here, before custom blocks depend on it (§8.2).

### 14.12 Fold `uploadImage` Into `source.upload`

The standalone `uploadImage` prop (`owned-model-editor.tsx:52`) and `UploadProvider`/`useUpload` (`view/upload-context.tsx`) become a compatibility shim that registers a `media` source whose `upload` is the supplied function, or are removed once the `media` source is the only path (P3). Drag-drop of an image file (`owned-model-editor.tsx:95`) routes through the `media` source's `upload` + insert, so there is one upload path, not two.

## 15. Compat And One-Time Import: The Sunset

The compat picture is far smaller than a runtime back-compat layer, because of two facts confirmed in the tree: content-api is greenfield (no editor wired, nothing persisted in any old reference-block shape), and the only legacy corpus is `payloadcms.db` at the repo root, ingested by the existing one-time importer `core/compat/payload-import.ts`.

**Decision: the `{ ref, snapshot, local }` shape is canonical from day one; there is no perpetual flat-shape adapter, and the importer is the only compat surface, with a planned sunset.** The reasoning: nothing ever persisted a flat `media`/`post-ref` in the new platform, so there is no old content-api document to migrate; the only legacy data is Payload/Lexical, which already passes through `payload-import.ts`, and that importer already extracts a media id. Building a runtime adapter that round-trips a flat shape would be dead code guarding data that does not exist.

What changes in the importer: `uploadToMedia` (`payload-import.ts:78`) today emits `{ type: "media", mediaId, src, alt, caption }` — a flat compat node where `mediaId` is already the record id. It is updated to emit the reference-block shape: `ref = mediaId`, `snapshot = { url: src, alt }`, `local = { caption }`. `youtubeToEmbed` already yields an embed with a URL `ref`, which is the `resolve`-only embed shape, so it needs only the `snapshot`/`ref` field naming. There is no post-ref import: Payload has no post-reference block, and `epub-internal-link` stays an inline link (`mapInline`, unchanged), so post-ref is a new-platform-only feature with no import target. The `fromPayload` hook (W8, `payload-import.ts`) already lets a custom node map its own Payload dialect, so a custom reference block can supply its own import mapping without editing the importer.

The sunset, stated so it is not forgotten: once `payloadcms.db` is imported and persistence flips to `EditorDocumentSnapshot` (docs/010 §12, docs/015 §8), the transitional `RichTextCompatDocument` projection, the runtime `compat.ts` Lexical-shape reader, and `payload-import.ts` itself are removable — the importer is a migration tool, not a runtime dependency. The reference-block shape is defined on the owned model, not on Lexical, so the format flip does not touch it. The DoD (§20) records "importer runs, report verified, corpus migrated" as the trigger that makes the importer dead code; removing it is a Future-Backlog item (§18), not part of this SPI.

## 16. `packages/ui` Changes

The picker primitive is reused, not rebuilt, so the `@idco/ui` surface area added is deliberately tiny. The neutral package must stay product-neutral (the architecture-lint boundary), so none of these changes import the editor or anything product-specific.

- **Relax `ResourceKind` to accept a generic string.** Change `ResourceKind` (`resource-selector.tsx:31`) from a closed union to `... | (string & {})`, or add a `"reference"` member, so a generic editor source is not forced to masquerade as `"record"`. `defaultRenderOption` uses `kind` only to choose an avatar, so the relaxation is backward-compatible — unknown kinds simply get no default avatar and rely on `renderOption`.
- **Confirm the shared types are exported (they are).** `ResourceOption`, `ResourceSource`, `ResourcePage` are exported from `resource-selector.tsx` and re-exported by the barrel, so `packages/editor` imports them as the canonical types for `DataSource.load`/`resolve`/`upload`. No new type is invented in the editor; the engine depends on `@idco/ui` for the picker contract, which is the correct one-way dependency (editor → ui).
- **Optional: a thumbnail `renderOption` preset.** A small exported helper (e.g. `mediaRenderOption`) that renders an image-bearing option as a thumbnail row, so the editor's `media` source and any custom image source share one option renderer rather than re-deriving it. Nice-to-have, not required.
- **Explicitly not added: a grid/library browser.** Per §6.4, the default picker stays the one ComboBox; a grid is the host's `renderPicker`, composed in the host from existing `@idco/ui` primitives (`drawer`, `data-table`, `file-dropzone` are already exported). Adding a grid to the neutral package is rejected (§10).

Cross-repo note: these `@idco/ui` edits are in-workspace for `packages/editor` (it consumes the workspace ui), but reach consumers (content-api, auth) only through the tagged-release flow in the root CLAUDE.md. The editor-side work needs no release; shipping the rebuilt blocks to a product does.

## 17. Implementation Backlog

Sequenced by the phases in §13. Each item is sized to a reviewable PR with its own tests; acceptance criteria are observable, not aspirational. The 15 tickets group into the six phases as below — each phase is a self-contained, `pnpm check`-green editor, so work can pause after any row.

| Phase | Tickets | Deliverable | Phase gate |
| --- | --- | --- | --- |
| **P1 — SPI spine** | RB-1, RB-2, RB-3, RB-4 | An end-to-end reference block: source registry + `resource` field + default ComboBox + `post-ref` rebuilt on a sync demo source | A pick stores `{ ref, snapshot, local }`, bakes, and round-trips through compat |
| **P2 — Resolve + status** | RB-5, RB-6, RB-7 | A *live* reference block: revalidates on mount, degrades to its snapshot, shows the three resting states | Resolve patches projected keys only; `unresolved → ready/invalid` transitions hold |
| **P3 — Media + upload** | RB-8, RB-9 | `media` rebuilt with browse/pick/upload; `caption` as a `local` field | Upload-as-create works; a resolve never clears the caption |
| **P4 — Host pick surface** | RB-10, RB-11 | `renderPicker` delegation + the `@idco/ui` `ResourceKind` relaxation | A `renderPicker` source shows the host modal and commits identically; generic kind renders |
| **P5 — Rollback + gating** | RB-12, RB-13 | Choose-first insertion via rollback + provenance gating | A completed insert is one undo step, a cancel leaves nothing; source-absent hides the insert affordance |
| **P6 — Embed + import** | RB-14, RB-15 | `embed` as a `resolve`-only source + the one-time `payloadcms.db` import update | Off-allowlist URL suppressed; the corpus imports to reference-block shape with a report |

Dependency notes: P1–P4 are pure additions (no engine-internals change), so they can land in order with low risk. **P5 is the only phase that touches the transaction/history chokepoint** (`core/store/history.ts`) — review it on its own. **P6 only touches `payload-import.ts` and `embed.tsx`**, so it can run in parallel with P4–P5. If you want five review rounds instead of six, merge **P3+P4** (both additive, both media-adjacent) into one batch of four tickets; do not merge P5 into anything, since its history work deserves an isolated review.

### RB-1. Source Registry

Scope:

- `packages/editor/src/view/spi/data-source-registry.ts` (new), `packages/editor/src/view/spi/index.ts`

Tasks:

- [ ] Define `DataSource` (`{ id; load?; resolve?; renderPicker?; upload? }`) with `load`/`resolve`/`upload` typed against `@idco/ui` `ResourceSource`/`ResourceOption`.
- [ ] Implement `registerDataSource` / `getDataSource` / `listDataSources` as an idempotent module singleton.

Acceptance criteria:

- Registering a source twice by id replaces, never throws; `listDataSources` returns registration order.
- `packages/editor/src/core` imports nothing from this module (architecture lint stays green).

Tests:

- `tests/editor/data-source-registry.test.ts`

### RB-2. Resource Config-Field Kind + Default Picker

Scope:

- `packages/editor/src/view/spi/node-view.ts`, `packages/editor/src/view/render/object-config.tsx`

Tasks:

- [ ] Widen `NodeViewConfigField` to the `text | resource` union, defaulting `kind` to `"text"`.
- [ ] Branch `ObjectConfigPanel` on field kind; render `ResourceSelector` for `resource`, commit `{ ref, ...toData(option) }` via `set-object-data`.

Acceptance criteria:

- Existing `text` config fields (no `kind`) render unchanged.
- Choosing an option writes `ref` + projected snapshot to the node's `data`.

Tests:

- `tests/ui/object-config-resource-field.test.tsx`

### RB-3. `{ ref, snapshot, local }` Contract + Helpers

Scope:

- `packages/editor/src/view/object-data.ts`

Tasks:

- [ ] Add `ref`/`snapshot`/`local` readers and `patchSnapshot(data, projected)`.
- [ ] Route a reference block's `text` config fields to `local`, `toData` output to `snapshot`.

Acceptance criteria:

- `patchSnapshot` merges projected keys and leaves `ref` and `local` untouched.

Tests:

- `tests/editor/reference-data-shape.test.ts`

### RB-4. Rebuild `post-ref` On The SPI

Scope:

- `packages/editor/src/view/nodes/post-ref.tsx`, `stories/editor.stories.tsx`

Tasks:

- [ ] Replace post-ref's three `text` fields with one `resource` field bound to a `posts` source; project `{ title, url, postId }`.
- [ ] Provide a sync demo `posts` source in stories/tests.

Acceptance criteria:

- Picking a post in Ladle stores `{ ref, snapshot }` and `renderResting` shows the `RichTextPostReference` card from the snapshot.
- The block bakes and round-trips through compat with the new shape.

Tests:

- `tests/editor/post-ref-reference-block.test.tsx`

### RB-5. Resolve Scheduler (SWR)

Scope:

- `packages/editor/src/view/controllers/use-resolve.ts` (new), object dispatcher wiring

Tasks:

- [ ] Add a resolve lane on `core/scheduler.ts`; fire `resolve(ref, signal)` on mount, patch projected snapshot only, abort on unmount, dedupe in-flight by `ref`.

Acceptance criteria:

- A renamed record updates on next mount; `local` (caption) is never overwritten by a resolve.
- Unmount mid-fetch aborts; remount re-issues without double-write.

Tests:

- `tests/editor/resolve-swr.test.ts`

### RB-6. Reference Status Lifecycle

Scope:

- `packages/editor/src/core/commands/objects.ts`, `packages/editor/src/core/commands/shared.ts`, status path

Tasks:

- [ ] Mark a `resource`-field block with no `ref` as `unresolved` at insert/set-data.
- [ ] Add the minimal `set-object-status` path so the resolve scheduler sets `ready`/`invalid`.

Acceptance criteria:

- Insert → `unresolved`; resolve success → `ready`; resolve failure/null → `invalid` with stale snapshot retained.
- Owned-block status remains purely bake-derived.

Tests:

- `tests/editor/reference-status-lifecycle.test.ts`

### RB-7. Three Resting States Chrome

Scope:

- `packages/editor/src/view/render/object-block.tsx`

Tasks:

- [ ] Render empty ("Pick a {label}"), unresolved (snapshot + loading), invalid (stale snapshot + "couldn't refresh") for reference blocks, wrapping `renderResting`.

Acceptance criteria:

- Each status renders its affordance; the empty and invalid affordances re-open the picker.

Tests:

- `tests/ui/reference-resting-states.test.tsx`

### RB-8. `upload` Capability

Scope:

- `packages/editor/src/view/spi/data-source-registry.ts`, default picker, `view/upload-context.tsx`

Tasks:

- [ ] Add `upload?` to `DataSource`; show an upload button in the default picker when present; feed the returned option into the choose path.
- [ ] Make `uploadImage` a shim that registers a `media` source's `upload` (or remove it once `media` is rebuilt).

Acceptance criteria:

- Uploading a file creates a record, references it, and stores the resulting snapshot.

Tests:

- `tests/editor/upload-as-create.test.tsx`

### RB-9. Rebuild `media` On The SPI

Scope:

- `packages/editor/src/view/nodes/media.tsx`

Tasks:

- [ ] `media` source with `load`+`resolve`+`upload`; `src`/`alt` projected, `caption` local; move `MediaLiveSurface` upload onto `source.upload`.

Acceptance criteria:

- Browse, pick, upload, and caption-edit all work; a resolve refresh never clears the caption.

Tests:

- `tests/editor/media-reference-block.test.tsx`

### RB-10. `renderPicker` Overlay + Delegation

Scope:

- `packages/editor/src/view/render/resource-picker.tsx` (new) or `object-config.tsx`

Tasks:

- [ ] When `source.renderPicker` exists, mount the host body in an engine-owned React Aria modal; converge `onChoose` on the default commit path.

Acceptance criteria:

- A source with `renderPicker` shows the host surface; choosing commits identically to the default ComboBox; dismissal/focus are engine-owned.

Tests:

- `tests/ui/render-picker-delegation.test.tsx`

### RB-11. `@idco/ui` `ResourceKind` Relaxation

Scope:

- `packages/ui/src/resource-selector.tsx`, `tests/ui/`

Tasks:

- [ ] Relax `ResourceKind` to accept a generic string (or add `"reference"`); confirm `defaultRenderOption` is backward-compatible.
- [ ] Optional: export a `mediaRenderOption` thumbnail preset.

Acceptance criteria:

- A generic `kind` renders without an avatar and honors `renderOption`; existing admin kinds are unchanged.

Tests:

- `tests/ui/resource-selector-generic-kind.test.tsx`

### RB-12. Choose-First Via Rollback

Scope:

- `packages/editor/src/core/store/history.ts`, insert path, object dispatcher

Tasks:

- [ ] Insert a `resource`-field block, auto-open its picker; cancel of the initial pick removes the node.
- [ ] Coalesce insert + first `set-object-data` into one undo unit (provisional-transaction at the §6.1 chokepoint).

Acceptance criteria:

- A completed insert is one undo step; a cancel leaves no node and no stray history entry.

Tests:

- `tests/editor/choose-first-rollback.test.ts`

### RB-13. Provenance Gating

Scope:

- `packages/editor/src/view/spi/node-view.ts` (`listInsertableNodes`), insert/slash surfaces

Tasks:

- [ ] Filter insertable reference blocks by `listDataSources()` presence of their declared `source`.

Acceptance criteria:

- A reference block whose source is unregistered is absent from the insert menu; existing instances still render their snapshot.

Tests:

- `tests/editor/provenance-gating.test.ts`

### RB-14. Rebuild `embed` + `allowedEmbedDomains`

Scope:

- `packages/editor/src/view/nodes/embed.tsx`

Tasks:

- [ ] `embed` as a `resolve`-only source; the URL is the free-text `ref`; the `allowedEmbedDomains` guard lives in `resolve`.

Acceptance criteria:

- An off-allowlist URL resolves to `null`, the preview is suppressed, and the block shows the placeholder/invalid state.

Tests:

- `tests/editor/embed-resolve-only.test.tsx`

### RB-15. One-Time Payload Import Update

Scope:

- `packages/editor/src/core/compat/payload-import.ts`

Tasks:

- [ ] Update `uploadToMedia` to emit `{ ref: mediaId, snapshot: { url, alt }, local: { caption } }`; align `youtubeToEmbed` field naming to the embed `ref`/`snapshot`.

Acceptance criteria:

- A `payloadcms.db` fixture imports to reference-block-shaped media/embed with a drop/map report; no throw on real data.

Tests:

- `tests/editor/payload-import-reference-blocks.test.ts`

## 18. Future Backlog

Separate from first-release work; pulled in only when a consumer needs them.

- **Per-block `deferrable` opt-out** (§11): allow a specific block to insert empty and fill later, for scaffolding workflows (citations, related-posts layout). A per-block flag the insert path reads; no model change.
- **Collapse the host-node registry into the degenerate reference block** (§11, docs/006 §5.3): once a host needs a fully opaque block, implement it as a source with `renderPicker` + a block whose `renderResting` is host-supplied, rather than a parallel `RichTextHostNodeDefinition`.
- **Glossary as a reference block** (§11): decide `glossary-term-ref` vs inline-owned alongside comments authoring (note.md item 3).
- **`allowedNodes` schema profile** (§9, note.md item 6): the deliberate per-deployment allowlist that composes with provenance gating.
- **Remove the import + transitional compat** (§15): after `payloadcms.db` is migrated and persistence flips to `EditorDocumentSnapshot`, delete `payload-import.ts`, the `RichTextCompatDocument` projection, and the Lexical-shape reader.
- **Reader parity** (note.md item 4): the static snapshot render is verified against the editor's resting render today; full reader-tier verification waits on `packages/reader`.

## 19. Test And Verification Plan

Unit (Vitest, `tests/editor` and `tests/ui`): the registry idempotency and ordering (RB-1); `toData` projection and `patchSnapshot` (RB-2/RB-3); resolve SWR abort/idempotency/projected-only patch (RB-5); the status transitions insert→unresolved→ready/invalid (RB-6); choose-first rollback as one undo unit (RB-12); provenance filtering (RB-13); the off-allowlist embed guard (RB-14).

Integration: each rebuilt built-in (`post-ref`, `media`, `embed`) picks/uploads, bakes, round-trips through compat, and renders its snapshot in the non-virtualized resting render (`view/render/resting-document.tsx`) — the editor half of the reader's static contract until `packages/reader` exists (§18).

Import: a `payloadcms.db`-shaped fixture imports through `payload-import.ts` to reference-block shapes with a verified drop/map report and no throw on real data (RB-15).

Boundary and gate: the consumer boundary scan from the root CLAUDE.md stays clean when content-api eventually wires the editor (no product-local markup compensating for a missing primitive); `pnpm check` (format → lint → dup → typecheck → test → build) is green after every phase.

## 20. Definition Of Done

- The source registry, the `resource` field kind, the `{ ref, snapshot, local }` contract, the resolve scheduler, the status lifecycle, the three resting states, choose-first rollback, `renderPicker` delegation, provenance gating, and the `upload` capability are implemented and unit-tested per §17.
- `post-ref`, `media`, and `embed` are rebuilt on the SPI, round-trip through compat, and render their snapshots in the resting render — the forcing function (§8.2) holds, proving the SPI general by construction.
- The `@idco/ui` `ResourceKind` relaxation ships; `ResourceSource`/`ResourceOption` are the shared types the editor consumes; no grid is added to the neutral package.
- `payload-import.ts` emits reference-block-shaped media/embed for the `payloadcms.db` corpus with a verified report and no throw, and the importer's sunset (deletable after migration) is recorded.
- `pnpm check` is green; the architecture lint confirms `packages/editor/src/core` imports neither React nor `@idco/ui`; the consumer boundary scan is clean when the editor is wired.
- Every Part I cross-reference still resolves and the TOC matches the headings.

## 21. Final Model

The owned editor exposes exactly one host-facing extension point for host-backed data: a source registry, `registerDataSource({ id, load?, resolve?, renderPicker?, upload? })`, every capability optional. A reference block is an object node whose `data` is `{ ref, snapshot, local? }` — a stable id, a denormalized projection of the host record (refreshed by `resolve`), and the author-local fields a refresh must never clobber — declared by a `resource` config field that names a source by id and supplies `toData(option) → patch`. Three actors are decoupled by that source-id string: the deployment-owned source returns domain-agnostic options and knows nothing about blocks; the author-owned block owns the projection and render and knows nothing about the backend; the engine owns the cache, resolve scheduling, provenance gating, the default picker, and the reader's static render, and knows neither side. Because source and block are separate registries joined by id, one source feeds many blocks, and because the `resource` field routes through the existing `registerNode` SPI, a custom reference block is `registerNode` plus a resource field — so the data-provider SPI and the custom-block-data SPI are one thing, not two.

There is no pick primitive: pick is the resource field's input surface, and a reference block's completeness is the bake-derived status the model already computes (`ready` / `unresolved` / `invalid`), so the only SPI addition this whole area makes is the `resource` field kind. Insertion is choose-first via rollback — the node is born `unresolved`, the picker auto-opens, and a cancel rolls the insert back — because a reference's identity comes from the record it picks. The editor owns the pick *seam* and one default ComboBox, never a media library; a deployment plugs its own media browser into the seam through `renderPicker`, the pick-time twin of the host-supplied render. The block renders its snapshot instantly and revalidates it from `resolve` on mount; the snapshot persists into the baked output so the server reader paints it with no host call, and a dangling ref or failed refresh falls back to the stale snapshot rather than blanking. The model needs no new state — `ObjectNode.data`, `ObjectNode.baked`, and the `"unresolved"` / `"invalid"` statuses already carry the lifecycle. The proof that the SPI is general is that `media`, `post-ref`, and `embed` rebuild on it as ordinary reference blocks — a `load`+`resolve`+`upload` source, a `load`+`resolve` source, and a `resolve`-only source — and keep working, becoming proof instances rather than the bespoke text-field nodes they are today.
