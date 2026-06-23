# Owned editor — parity gaps to close (grounded against legacy Lexical + the reader plan)

## What this is

A backlog of what the owned-model editor (`packages/editor`) still misses versus the legacy Lexical editor (`packages/editor-legacy`) and the read tier (docs/015), found by grounding the two side by side. Each item names the gap, where it is specified, the current state, and — for the SPI items — the concept it should be built on, so it can be picked up one at a time. This is a working list, not a design doc; it carries enough concept to start each slice without re-deriving it. Layout-shell parity (field label, bordered frame, error slot) and the side/aside TOC rail are deliberately out of scope; the aside rail was removed by design and the shell is the host's concern.

## 1. Alignment control (left / center / right / justify)

Missing as an editing control on both editors; only the reader renders it. The owned engine never exposes it (docs/023 §"Built-in Home layout" says Home is "006 §4.2 minus alignment which the owned engine does not expose as a control today"). Legacy also dropped element `format` in its serializer and renderer (docs/001 §111). The read tier already maps `format` to align, so the reader is ahead of the editor here (`packages/content-renderer/src/index.tsx` `elementAlign`, lines 459-463).

What it takes: an `align` block attribute on the model, a command to set it, and one `Align v` dropdown slot on Home showing the active value (target shape at docs/006 §4.2:284 and the node field sketch at docs/006 §5.5:661). Self-contained and small; no host binding involved. The reader already paints it, so this is editor-control-only.

## 2. Host data provider SPI (the spine)

Specified at docs/006 §5 "Data Provider Contract", restated for the owned engine at docs/011 §12.1/§12.3. The owned engine built only the upload corner — `uploadImage(file) → {src}` (`owned-model-editor.tsx:51`). Media and post-ref are manual text fields today (`view/nodes/post-ref.tsx:14-20`); there is no picker, no host data resolution, no general provider registry, and `allowedEmbedDomains` gating is gone. Do not port the legacy `RichTextEditorBindings` verbatim — build it on the concept below and route it through the existing node SPI (`registerNode` / `configFields`, docs/016), not a parallel registry.

### 2.1 The concept: sort object nodes by where the source of truth lives

Every object node is exactly one of two kinds, and the data-provider SPI applies to one of them only.

- **Owned blocks** — the content *is* the truth. Code block, callout, table, divider, mermaid. The author types it, the node owns it, nothing external. Editing means editing the node's own data. These keep `configFields` as typed inputs plus the live-edit surface and are **out of scope** for this SPI.
- **Reference blocks** — the node is a *serialized projection of a record that lives in a host collection*. Media (an asset record), post-ref / chapter-ref / author-ref / citation (a collection record). The truth lives in the host; the node stores `{ ref, snapshot }` — a stable id plus a denormalized copy of the display fields. Media storing `alt/url/caption` and post-ref storing `title/url/postId` are the same shape of thing: a cached projection of an external record.

The test for which kind a block is: *does editing it mean picking a different external record, or typing content?* Picking → reference block → this SPI. Typing → owned block → stays on `configFields`/live-edit.

### 2.2 Reference block, defined precisely

`data = { ref, snapshot }`, bound to a host **source**. The node never owns the truth; it caches a projection. **Pick** sets the ref + snapshot; **resolve** refreshes the snapshot from the ref. **Upload** is a pick that *creates* the record first, then references it.

A source offers up to two capabilities, and today's kinds are just different capability combos — one concept, capabilities vary, so media/post/embed stop being three bespoke bindings:

- Media library: `load` (browse/search) + `resolve`; author picks from the collection, or uploads (create → pick).
- Post / chapter / author ref: `load` + `resolve`; author searches the collection.
- Embed (youtube): **no `load`**, `resolve` only (oEmbed); author pastes a URL as a free-text ref. This is why embed is not a third species — it is a reference block whose source can't browse.

### 2.3 The three-actor seam (this is what keeps it general, not random)

Three actors, decoupled by a source-id string — the same registry-by-string pattern already used for blocks, marks, and commands.

- **The source** (deployment-owned): returns whatever the host's records look like — domain-agnostic `ResourceOption`s. Knows nothing about blocks.
- **The block** (author-owned): owns the *projection* — `toData(option) → patch` adapts a generic option into *its* data shape, and `renderResting` paints the snapshot. Knows nothing about the host's backend.
- **The engine**: the picker, the `{ref, snapshot}` cache, resolve scheduling, gating, reader static render.

The payoff of that seam: **one source can feed many blocks.** A `products` source feeds a `product-card`, an inline `product-mention`, and a `comparison-row`, each with its own `toData` projection. That multiplexing is the concrete reason sources and blocks must be *separate* registries joined by id, not one fused thing — and it means a host adds a new referenceable collection by registering one source, and every block that projects it lights up.

### 2.4 What the SPI gates — and only this

The host registers **sources** (`{ id, load?, resolve? }`). A reference-block node declares "my data projects source X" through a resource config-field. That is the entire gated surface. Everything downstream is generic engine the host never touches: the picker UI (the standardized React Aria ComboBox + `ListBoxLoadMoreItem`, per the "standardize don't diverge" rule), the `{ref, snapshot}` caching, the resolve scheduling, and the reader rendering the stored snapshot statically with no host call (docs/015 — the snapshot is what makes the reference block reader-safe; legacy was resolve-on-render only).

### 2.5 This SPI *is* the custom-block-data SPI, not a parallel one

"Generalize the data provider" and "let a custom block reference host data" are the same work. The moment the resource config-field kind and `registerDataSource` are public, a custom block gets host-data reference for free, because a custom reference block is literally `registerNode` + a resource field bound to a source. So there is no separate "custom block data" phase to defer — it only appears as separate work if item 2 is built *wrong*, as media/post-only bindings. The forcing function: **rebuild the built-in `media` and `post-ref` on this SPI.** If the two built-ins still work after the refactor, the SPI is general by construction; they become proof instances, not special cases left beside it.

### 2.6 Worked example — a `product-card` custom reference block (end to end)

The shape a feature author writes, to make the SPI concrete (sketch, not final API):

```text
// Deployment wires the collection once, against its real backend:
registerDataSource({
  id: "products",
  load:    (q, signal) => api.searchProducts(q, signal),   // ResourceOption[]
  resolve: (id, signal) => api.getProduct(id, signal),     // ResourceOption | null
})

// Block author registers the node — knows the source id, not the backend:
registerNode({
  view: {
    type: "product-card",
    insert: { label: "Product", group: "Data", keywords: ["product", "shop"] },
    configFields: [
      { kind: "resource", key: "ref", source: "products", label: "Product",
        toData: (opt) => ({ ref: opt.id, title: opt.title, price: opt.price, img: opt.image }) },
    ],
    renderResting: ({ node }) => <ProductCardView {...node.data /* the snapshot */} />,
  },
})
```

End-to-end flow this exercises: register source → register node with a resource field → author picks via the standard ComboBox → `toData` projects the option into the node's snapshot → `renderResting` paints the snapshot → bake persists the snapshot so the reader is static → `resolve` refreshes on mount → if `products` is not registered in this deployment, the insert affordance is hidden (provenance). Nothing here is media-specific, which is the whole point.

### 2.7 Pull-forward checklist (cheap now, expensive to retrofit)

These are the corners usually deferred; do them on day one because the data shape and seams harden around them.

- **Optional capabilities from the start.** `load?` and `resolve?` are optional on the source type, so embed (resolve-only, paste-a-URL) and a browse-only picker are the same type with different fields filled — no special-casing embed later.
- **`toData` returns a patch, not a value.** A citation or product card projects several fields at once; `toData(option) → Partial<data>` makes multi-field projection native. A single-value return forces a rewrite the first time a block needs two fields.
- **The snapshot is the error fallback.** A dangling ref or a failed `resolve` renders the stale snapshot plus a quiet "couldn't refresh" affordance, never a blank. This is the docs/015 §10 baked-field-staleness risk applied to refs — solved once, in the engine, for every reference block.
- **Provenance gating wired immediately.** Source present → insert affordance enabled; absent → hidden (006 §7.9). A registry lookup, not a feature; deferring it ships custom blocks broken in deployments that lack their source.
- **Stale-while-revalidate, not store-only.** Render the snapshot instantly, then `resolve` on mount and patch. Store-only means a renamed post never updates; SWR is small and is the difference between a live reference and a dead copy.

### 2.8 Decision to settle before building

Whether the **host-node registry** (006 §5.3 — opaque `renderEditor`/`renderReadOnly` host blocks) is a separate escape hatch or just the degenerate reference block whose projection is "store the whole record" and whose render is host-supplied. Lean: the latter — one concept, not two parallel "host block" mechanisms. Settle it before building so a second mechanism does not grow.

### 2.9 Slices to pick up (lock the shape first, per the SPI-first rule)

- Public source registry: `registerDataSource` / `getDataSource` / `listDataSources` (`{ id, load?, resolve? }`).
- Resource config-field kind: `NodeViewConfigField` becomes a union — `{ kind: "text" }` (today) | `{ kind: "resource", source, toData }`. The editor renders the standard ComboBox for the resource kind.
- Resolved-ref access in render: a hook/arg so `renderResting` shows the snapshot now and refreshes from `resolve` (SWR).
- Snapshot persistence: confirm bake/serialize carries the snapshot so the reader is static (node data already serializes; make the contract explicit).
- Rebuild built-in media + post-ref on the SPI; restore `allowedEmbedDomains` as an embed source with `resolve`-only.
- Resolve the §2.8 host-node-registry decision and implement whichever shape wins.

## 3. Comments (half-migrated)

The data model and derived index are ported; the authoring workflow is not. `comment`/`glossary` are identity marks in the model (`core/model/marks.ts:119`), render as annotation spans (`view/render/mark-render.tsx:129`), and bake builds a `CommentIndexEntry` rollup (`core/bake/bake.ts:152-193`). Missing: a comment command, the popover UI, and the host callbacks `onComment` / `comments` / `onCommentUpdate` / `onCommentDelete` (legacy at `editor-legacy/src/nodes/base.tsx:56-69`). So a comment mark can be stored and shown but never authored or threaded. Glossary authoring is in the same state. Placement: adding a comment to a selection is a Home action, thread management is Review (docs/006 §4.2:294).

Note: glossary is a candidate reference block (a `glossary-term-ref` projecting a host glossary collection) rather than an inline-owned term/definition. Decide alongside item 2, not blind.

## 4. The reader tier — `packages/reader`, retiring content-renderer (docs/015)

Not started. `packages/reader` does not exist; `content-renderer` (`@quanghuy1242/idco-content-renderer`) is still live and wired (tsconfig, pnpm-lock), still `"use client"` for one no-op checkbox (docs/015 §3.1). The substrate exists: the non-virtualized resting render (`virtualize={false}`) and `RestingDocument` (`view/render/resting-document.tsx`) are the editor half of the shared primitive layer (docs/015 §4.1 L2b). Sequence as docs/015 lays out:

- Create `packages/reader` at the bottom of the dependency graph; extract the RSC-safe `RichText*` / resting primitives into L1 (no `"use client"`, no hooks, no handlers), splitting the interactive bits (checklist checkbox, live code, scroll-spy TOC) into L3 islands.
- Write the server `<Reader>` over a projection adapter (consume `RichTextEditorDocument` today, `EditorDocumentSnapshot` after the persistence flip) so retiring Lexical later is just an adapter swap.
- Add the import-boundary lint that fails on any client import reaching L1 (mirror of the editor-core purity rule).
- Re-point content-renderer's consumers at `packages/reader`, then delete content-renderer.
- After editor↔reader parity and the persistence flip, remove `editor-legacy` (Lexical) — the editor is the only editor, the server reader the only reader (docs/015 §8).

## 5. Drag-to-reorder blocks

Legacy has `draggable-block-plugin.tsx` (grab a block by a handle, drop it elsewhere). The owned editor has no draggable / drop-indicator / move-by-drag — it can `remove-block` but not reposition by drag (`view/render/object-block.tsx:92-94`). The one direct-manipulation affordance legacy had that the owned editor dropped. The model already supports moving nodes (the table column/row move composes `move-node`); this is the view-layer handle + drop-indicator + a move command, not new core.

## 6. `allowedNodes` — a per-deployment schema profile

Legacy takes an `allowedNodes` prop; the owned editor has none (it has `toolbarCapabilities` flags but no node-type allowlist). It is not one thing — it is two enforcement points over one set:

- **Palette gate (insert time):** which node types the author can add — hide "table" where the deployment disallows it. UX.
- **Schema gate (import/round-trip time):** which node types may exist in a stored document — drop or reject a disallowed node on load. Data integrity; the host already enforces this server-side with a Zod union (docs/006 §2.7), and the editor should honor the same contract.

The honest model is a **schema profile** ("blog profile" vs "book profile"), each a subset of the registry. The registry knows every node type that could exist; the profile is the allowlist of what this deployment permits, enforced at insert and at import. For reference blocks (item 2) the profile is partly implied — no `posts` source registered means post-ref can't function, so provenance already gates it (006 §7.9); the profile only makes deliberate calls about owned blocks (does the blog allow tables?) plus which collections are exposed.

## Order suggestion

Item 2 (host data SPI) is the spine — it blocks real authoring parity and is the thing custom blocks consume; lock its shape before building any slice. Item 4 (reader) is the other spine — it blocks retiring content-renderer and Lexical. Item 1 (alignment) is the cheapest standalone win (the reader already paints it). Item 5 (drag-reorder) is view-layer-only on an existing model capability. Item 3 (comments) is mostly UI + binding wiring on an existing model, and should be decided against item 2's reference-block concept. Item 6 (schema profile) pairs naturally with item 2 and the registry.
