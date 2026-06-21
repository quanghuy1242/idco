# Editor node-SPI notes (post docs/020 refactor)

> Scratch notes captured after the docs/020 refactor + CI fix. Covers: the callout
> node lifecycle, what the object SPI lets a user do (with a full worked example),
> whether object and structural SPIs are "the same shape," whether a third party
> can add nodes without editing core, and the real status of the structural plan.
>
> Source of truth is still `docs/016` (object SPI), `docs/020` (this refactor),
> `docs/019` (positional model / table fork). This file is a digest, not a spec.

## TL;DR

- **Object blocks** (atomic / heavy content) are **fully pluggable from outside the
  editor package today** — one `registerNode({ definition, view })` call, no core
  edits, including persistence, bake, search, live-edit, undo.
- **Structural containers** (block children, nested carets, gap-nav — e.g. callout)
  are **only half-pluggable today**: the *view* half is a registry (`StructuralNodeView`),
  but the *store/persistence* half is still hardcoded in core. A brand-new
  structural type cannot round-trip save/load or own its insert without core edits.
- **Object built-in vs object external = identical shape.** **Structural (callout)
  vs object = deliberately different shape** (different contract), but both register
  through the **same** `registerNode` front.
- The structural core half is **sketched + scheduled to land with the 019 table**;
  making it open to *third-party* authors is a further, explicitly-deferred change.

---

## 1. Lifecycle of `packages/editor/src/view/nodes/callout.tsx`

Key framing: **callout.tsx is the *view half* only.** It owns rendering + the insert
affordance. The data shape, the insert command, and the compat round-trip live in
`core/` (welded to the closed `StructuralNodeType` union). The built-in callout
"cheats" by leaning on core's hardcoded `insert-callout` command + `callout` compat
branch — a third-party structural type would not have those (see §4).

### 1.1 Registration (once, at module load)

`react-view.tsx` calls `registerBuiltInNodeViews()` (`view/nodes/index.ts`), which runs
`registerStructuralView(calloutStructuralView)` → `view/structural-view.ts`'s registry
now maps `"callout" → calloutStructuralView`. After this, nothing in the engine has
hardcoded knowledge of callout — the dispatcher, insert menu, and resting renderer all
resolve it by `getStructuralView("callout")` / `listInsertableStructuralNodes()`.

### 1.2 Insertion — how it reaches the store

`callout.tsx`'s `insert` is the *affordance*, not the logic:

```ts
insert: { createCommand: () => ({ type: "insert-callout" }), label: "Callout", icon: "Info", ... }
```

Flow when "Callout" is picked from the toolbar **+** menu:

1. `editor-chrome.tsx` builds the insert menu from `listInsertableStructuralNodes()` +
   `listInsertableNodes()`. The callout entry's action is
   `store.command(view.insert.createCommand())` → `store.command({ type: "insert-callout" })`.
2. `store.command` → `compileCommand` (`core/commands/index.ts`) → the `compilers` table
   routes `"insert-callout"` → `compileInsertCallout(store)`.
3. **Model is built here** — `compileInsertCallout` (`core/commands/objects.ts`):
   allocates a paragraph id + callout id, builds `makeTextNode({type:"paragraph"})` and
   `makeStructuralNode({ type:"callout", attrs:{tone:"info"}, children:[paragraphId] })`,
   resolves the positional `InsertionPoint` (docs/019), calls
   `placeSubtree(tr, store, point, callout, [paragraph])` (one `insert-node` step carrying
   the paragraph as a descendant so the subtree registers atomically), and sets the caret
   inside the child paragraph. Returns the `TransactionBuilder`.
4. `store.command` dispatches through the single chokepoint `EditorStore.dispatch`
   (`core/store/editor-store.ts`): applies steps to the mutable `Map<NodeId, EditorNode>`,
   captures the **inverse** (undo), remaps selection, updates `parentOf`, records history,
   notifies subscribers (order changed → structural).

callout.tsx never inserts anything itself; it only declares *which command to dispatch*.

### 1.3 Live render (editing surface)

The structural notify re-renders the windowed block list. `EngineBlock`
(`view/block-dispatch.tsx`) sees `node.kind === "structural"`, renders the children
recursively (with list-numbering meta), then:

```ts
const structuralView = getStructuralView(node.type);          // "callout"
return structuralView.renderContainer({ node, store, registerBlock, children });
```

`calloutStructuralView.renderContainer`:

- reads tone from the **store-backed node**: `calloutTone(node.attrs?.tone)` (default `info`),
- `group/block relative` wrapper,
- mounts `<CalloutChrome node store/>` as a sibling overlay,
- the measured box: `data-engine-block-id`, `data-engine-callout-tone={tone}`,
  `data-engine-structural="callout"`, and `ref={(el) => registerBlock(node.id, el)}`
  (registers the DOM element so the engine can measure height for virtualization,
  hit-test, and resolve the gap cursor around it),
- `AlertGlyph` in the gutter, then `{children}`.

`children` are the callout's own blocks rendered by the same recursive `EngineBlock`, so
editing *inside* a callout is normal text editing on those child leaves; arrows walk
in/out because a callout is a **scope** (`childrenOf` treats any `kind:"structural"` node
as one).

### 1.4 Editing the callout itself (chrome → store)

`view/callout-chrome.tsx` is the only place the callout *container* is mutated, all via
the command layer:

- **Tone change** → `store.command({ type:"set-block-attr", node:id, key:"tone", value })`
  → `compileSetBlockAttr` → `set-node-attr` step → dispatch → `attrs.tone` updates (the
  immutable node is replaced) → that node's subscriber notifies → re-render with new glyph
  color + `data-engine-callout-tone`.
- **Delete** → `store.command({ type:"remove-block", node:id })` → `compileRemoveBlock`
  → `remove-node` step → dispatch removes the subtree, remaps selection.

`display:contents` wrapper + `stopPropagation` on the chrome's mousedown keep a chrome
click from re-placing the caret.

### 1.5 Resting render (publish / reader)

`resting-document.tsx`'s `renderRestingStructural` dispatches the same way →
`calloutStructuralView.renderResting({ node, children, renderSequence, renderListItems })`
→ emits the real DaisyUI `<aside class="alert alert-{tone} items-start" role="note">` +
`AlertGlyph` + `renderSequence(children)` (wraps consecutive flat list items into real
`<ul>`/`<ol>`). No chrome, semantic HTML. Live and resting are co-located in callout.tsx
so the editor surface and published page cannot drift (docs/020 §3.7).

### 1.6 Persistence / round-trip (core, not callout.tsx)

The callout *node* exists in the model independently of callout.tsx. `core/compat.ts`
has a **hardcoded** `if (node.type === "callout")` branch for import and a matching export
path. That is core, welded to the closed `StructuralNodeType` union — which is exactly why
there is *no* core `StructuralDefinition` for callout, and why a third-party structural
type cannot persist (see §4).

### 1.7 One-line mental model

```
register (view) ─┐
                 ▼
insert menu → store.command({type:"insert-callout"}) → compileInsertCallout → dispatch → model subtree
                 ▼ (notify)
EngineBlock → getStructuralView("callout").renderContainer  ← reads node.attrs.tone
                 ▲
CalloutChrome → store.command(set-block-attr / remove-block) → dispatch → re-render
                 │
resting:  renderRestingStructural → renderResting → <aside class="alert">
persist:  core/compat.ts  ⇄  { type:"callout", children }   (hardcoded, core)
```

callout.tsx contributes only `renderContainer` + `renderResting` + `insert`. Everything
that *touches the store* flows through `store.command(...)` → core compilers → the
`EditorStore.dispatch` chokepoint.

---

## 2. What a user can do with an OBJECT block (the fully-pluggable path)

An object block is the **fully externalizable** case: a single
`registerNode({ definition, view })` from a third-party package, no core edits. Object =
*atomic, heavy, self-contained content with opaque internals* (it cannot hold
engine-navigable block children or nested carets — that's the structural case).

### 2.1 Worked example — a custom `math` (KaTeX) block, shipped externally

```tsx
import { registerNode, type NodeDefinition, type NodeView } from "@quanghuy1242/idco-editor";
import katex from "katex";

// ── core half (framework-free, worker-safe) ────────────────────────────────
const mathDefinition: NodeDefinition = {
  type: "math",

  // born / normalized: coerce arbitrary input into a JSON-safe, consistent shape
  normalizeData: (value) => {
    const r = (typeof value === "object" && value) || {};
    const latex = typeof (r as any).latex === "string" ? (r as any).latex : "";
    return { data: { latex }, status: latex ? "ready" : "invalid" };
  },

  // persistence round-trip — registry-driven, so save/load "just works"
  fromCompatNode: (node) => ({ data: { latex: String(node.latex ?? "") }, status: "ready" }),
  toCompatNode: (value) => ({ latex: (value.data as any).latex }),  // emits { type:"math", latex }
  isExportComplete: (value) => Boolean((value.data as any).latex),

  // baked snapshot: pure compute, no DOM — runs off-thread for built-ins
  bake: (data) => {
    const latex = (data as any).latex ?? "";
    if (!latex) return null;                       // null → recoverable "invalid"
    return { kind: "math", payload: { latex } };
  },

  // document services
  plainText: (data) => (data as any).latex ?? "", // search/index sees the formula
};

// ── view half (React) ──────────────────────────────────────────────────────
const mathView: NodeView = {
  type: "math",
  ariaLabel: "Math formula",
  chromeMeta: { icon: "Sigma", label: "Math" },
  configFields: [{ key: "latex", label: "LaTeX" }],   // free config popover, OR use renderLive

  // resting / published render of the baked snapshot
  renderResting: ({ baked }) => {
    const html = katex.renderToString(String((baked.payload as any).latex), { throwOnError: false });
    return <div data-engine-object-baked="math" dangerouslySetInnerHTML={{ __html: html }} />;
  },

  // optional richer live editor (instead of configFields)
  renderLive: ({ node, store, registerObjectEditor }) => (
    <MathEditor node={node} store={store} registerObjectEditor={registerObjectEditor} />
  ),
  liveMode: "popover",

  // slash/insert menu entry
  insert: { label: "Math", group: "Blocks", icon: "Sigma", keywords: ["latex","formula","katex"],
            createData: () => ({ latex: "" }) },
};

registerNode({ definition: mathDefinition, view: mathView });   // ← one call, done
```

### 2.2 Each slot → store lifecycle stage, all free without touching core

| Lifecycle stage | Your slot | What the engine does for free |
|---|---|---|
| Insert | `insert.createData()` | the **generic `insert-object` command** builds + bakes + places the node and lands selection on it. **No custom command needed** (unlike structural). |
| Born → normalized | `normalizeData` | runs on insert and on import |
| Baked | `bake` | off-thread in the worker for built-ins; on the main thread for custom — same `bakeObjectData` call; `null` → recoverable `invalid` |
| Rest render | `renderResting(baked)` | dispatcher resolves you by `type`; editor at-rest **and** reader `RestingDocument` call the same fn (can't drift) |
| Activate / live edit | `renderLive` + `registerObjectEditor` | one-live-object-at-a-time slot, popover/in-place mounting, caret suspends, focus mgmt |
| Edit → re-bake | host: `store.command({ type:"set-object-data", node, data })` | dispatch chokepoint applies it, captures **inverse for undo**, re-bakes, notifies |
| Queried (search) | `plainText` (+ optional `anchors`) | wired into find/index |
| Exported / persisted | `fromCompatNode` / `toCompatNode` | **registry-driven** (`compat.ts` consults the registry for objects, line ~384 `isObjectNodeType` → `registry.normalizeCompatObject`) so save/load round-trips with zero core edits |
| Fine-grained invertible edit | `applyEdit` / `invertPatch` (optional) | for large objects, edits invert without a wholesale data swap |
| Chrome | `ariaLabel` / `ariaRole` / `chromeMeta` / `configurable` / `configFields` / `renderChromeControl` | floating badge + delete + settings popover, all read from your contract |

Also free: undo/redo coalescing, block-atomic selection, virtualization/measurement,
copy/paste, a11y.

The **only** real constraint is what an object *is*: atomic, with sequestered internals.
Good fits: math, Mermaid diagram, tweet/Spotify/Figma embed, chart, poll widget,
code-sandbox, a "definition card," any heavy self-contained chunk.

---

## 3. Is the object SPI "different" from callout.tsx, or the same shape?

This was the nagging question. Precise answer:

- **callout.tsx is a STRUCTURAL node** (`StructuralNodeView`). The math block above is an
  **OBJECT node** (`NodeView` + `NodeDefinition`). These are **two different contracts** —
  deliberately different shapes — because the two node kinds do different things:
  - an **object** paints a *baked snapshot* and sequesters opaque internals;
  - a **structural** container wraps *engine-managed block children* and participates in
    caret geometry / scope navigation.
- **But both register through the SAME front:** `registerNode({ ... })`. One call,
  internally routed by which halves you pass (`view`/`definition` = object;
  `structuralView` = structural). `registerNode` now asserts you pass exactly one kind and
  that paired halves agree on `type`.
- **Within a kind, internal and external are identical shape:**
  - the built-in `media`/`code`/`divider` object views use the **same** `NodeView`/
    `NodeDefinition` an external `math` block uses;
  - the built-in `callout`/`list` structural views use the **same** `StructuralNodeView`
    an external structural type would use (for the *view* half).

So: callout.tsx ≠ math block in shape *because one is structural and one is object*, not
because internal/external differ. Internal vs external is the same shape; object vs
structural is two parallel SPIs under one `registerNode`.

### 3.1 Contract shapes side by side

```
OBJECT node                              STRUCTURAL node
─────────────────────────────────────   ─────────────────────────────────────
NodeDefinition (core/registry.ts)        StructuralDefinition  (NOT BUILT YET)
  type                                      (sketched in docs/020 §4.1)
  normalizeData                          StructuralNodeView (view/structural-view.ts)
  fromCompatNode / toCompatNode            type
  bake                                     renderContainer({node,store,
  plainText / anchors                                      registerBlock,children})
  applyEdit / invertPatch                  renderResting({node,children,
NodeView (view/node-view.ts)                              renderSequence,renderListItems})
  type                                      insert?.createCommand(): EditorCommand
  renderResting({node,baked})            ── insertion: reuse an existing core command
  renderLive?({node,store,...})          ── persistence: hardcoded in core/compat.ts
  insert?.createData(): JsonValue        ── data shape: closed StructuralNodeType union
  ariaLabel/ariaRole/chromeMeta/...
  insert command: generic `insert-object`
  persistence: registry-driven (compat.ts)
```

The asymmetry is the point: the object column is complete end-to-end; the structural
column has a real *view* registry but no *core* registry yet, so its store/persistence
behavior still comes from hardcoded core paths.

---

## 4. Can a third party add a node entirely outside core (no core edits)?

### 4.1 Object node: YES — fully externalizable today

The object SPI has a symmetric core half (`NodeDefinition`) registered globally
(`registerGlobalNodeDefinition`, via `registerNode`). `createDefaultBlockRegistry()`
includes globally-registered custom definitions, and `compat.ts` import/export is
registry-driven for objects, so save/load + bake + the worker all see your node with no
core change. The insert is the generic `insert-object` command. Fully external. (See §2.)

### 4.2 Structural node: NO — not today (view-only). Four concrete barriers

1. **No core half exists.** `registerNode` accepts `{ view, definition, structuralView }`
   — there is **no `structuralDefinition`**. Nowhere to declare core behavior.
2. **Closed type union.** `StructuralNode.type: StructuralNodeType` =
   `"body"|"list"|"listitem"|"quote"|"callout"`. `makeStructuralNode` is typed to it, so a
   new `type:"admonition"` fails typecheck (runtime is permissive — `childrenOf` treats any
   `kind:"structural"` as a scope — but you'd be casting past the type system).
3. **No persistence round-trip hook (the real blocker).** In `core/compat.ts`, structural
   types are **hardcoded branches** (`if (node.type === "callout")` etc.). There is **no**
   registry equivalent of `isObjectNodeType`/`normalizeCompatObject` for structural nodes.
   A custom structural node would be dropped on load and unknown on save. Can't fix without
   editing `compat.ts`.
4. **Insertion can only reuse existing commands.** `StructuralNodeView.insert.createCommand()`
   must return an `EditorCommand`, and that union is **closed** (`insert-text`,
   `insert-object`, `insert-blocks`, `insert-callout`). No generic `insert-structural`, and
   `placeSubtree` (atomic container-with-children insert) isn't exported. So you can't
   register a *new* insert command that builds your container's subtree.

### 4.3 What a third party *can* do for structural without core edits

- **Render** live + resting via `registerNode({ structuralView })` ✓
- **Scope / gap-cursor / arrow-in-out / selection / deletion** — generic by
  `kind:"structural"`, free ✓
- **Insertion** — reuse `insert-blocks` (flat) or hand-roll a transaction with exported
  primitives (`makeStructuralNode`, `TransactionBuilder`, step types, `store.dispatch`) —
  but that goes *around* the command layer, still casts past the closed union, and **still
  won't persist** (barrier 3).

So: render + interaction yes; a node that genuinely **survives save/load and owns its
store lifecycle**, no.

---

## 5. Structural plan status: deferred-with-a-sketch, not "nothing but 019"

Two different things, distinguished by docs/020:

### 5.1 Engine-internal structural core half — sketched + scheduled, driven by the table

- docs/020 §4.1 **sketches the `StructuralDefinition` shape**
  (`{ type, isScope?, normalizeChildren? }`); §10 R1 even lists a task "Add
  `core/structural-registry.ts`" — but it was **deliberately not built** (it'd be dead code
  today: scope-ness is structural-by-kind via `childrenOf`, no per-type `isScope`).
- §11 names the **driver**: *"Table node as a structural container (docs/019 §5.2)…
  Replaces the opaque `tableNodeView` with a `StructuralNodeView` + `StructuralDefinition`."*
  So building the 019 table **forces** the core half (insert + compat + scope/normalization)
  for the table.
- §5.6 is explicit: *"The table is added as a new `StructuralNodeType` member **inside the
  engine**."* → engine-internal capability, built by us for the table.

### 5.2 Fully external, third-party structural nodes — intent acknowledged, out of scope

- §5.6 **rejects it for first release**: *"Opening the closed structural union to external
  authors… a far deeper change books may need later, not blog parity now."*
- §11 lists it as future: *"Open structural kinds to external authors… promote
  `StructuralNodeType` from a closed union to a registry-driven open set — **a deeper
  change explicitly out of this document's scope**."*

### 5.3 Net

It is **not** "nothing but 019," and **not** "fully planned." It is:

- a **documented sketch** (the `StructuralDefinition` shape, §4.1), +
- a **concrete near-term driver** (the 019 table, which builds the core structural half for
  *engine-internal* types, §11), +
- an **explicit, unscheduled future item** for the part actually asked about — *external /
  third-party* structural nodes — which needs opening the closed `StructuralNodeType` union
  and adding a structural-compat registry hook, deliberately deferred as a deeper change.

When that last item is picked up (the symmetric core half: `core/structural-registry.ts`
`StructuralDefinition` wired into `registerNode`, a compat registry hook so structural
import/export stops being a hardcoded switch, an opened/registry-driven type, and a
registry-driven insert), a custom structural node becomes the same one-call, fully-external
story objects already enjoy. docs/020 §13 calls this end state "one symmetric Node SPI."

---

## 6. Quick reference — where things live

- Object view contract + `registerNode`: `packages/editor/src/view/node-view.ts`
- Object core contract (`NodeDefinition`) + registry: `packages/editor/src/core/registry.ts`
- Structural view contract + registry: `packages/editor/src/view/structural-view.ts`
- Built-in object views (one file each): `packages/editor/src/view/nodes/{code-block,media,embed,post-ref,divider,table,table-of-contents}.tsx`
- Built-in structural views: `packages/editor/src/view/nodes/{callout,list}.tsx`
- Object dispatcher: `packages/editor/src/view/object-block.tsx`
- Block dispatcher (kind → object/structural/text): `packages/editor/src/view/block-dispatch.tsx`
- Command compilers (incl. `insert-callout`, `insert-object`): `packages/editor/src/core/commands/`
- Store + dispatch chokepoint: `packages/editor/src/core/store/editor-store.ts`
- Compat round-trip (object = registry-driven; structural = hardcoded): `packages/editor/src/core/compat.ts`
- Public surface: `packages/editor/src/index.ts` (owned engine) + `/legacy` subpath

---

## 7. The plan — symmetric structural core half, proven by callout, before the table

Decision (2026-06-21): **not** table-first, **not** "migrate every structural node
first." The SPI core half and the callout migration are the *same* first step (callout
can't migrate onto an SPI that doesn't exist); the table is the second consumer that
proves generality; lists are last and may legitimately stay in core.

Why this order:
- **Table-first warps the SPI** around one example and pays for the table twice (build
  hardcoded, then retrofit). The table must be the *second* consumer, not the first.
- **"Migrate every structural node first" over-scopes and distorts.** The built-ins are
  not equivalent: callout genuinely *cheats* (hardcoded `insert-callout` + clean
  `if (type==="callout")` compat branch) and is worth removing; **list/listitem** compat
  does deliberate *flattening* (`compat.ts` ~750) that keeps `compileIndentItem`'s
  structural branch unreachable-by-design — a **dialect boundary, not a cheat**. Forcing
  lists through the registry early warps the contract around a concern that belongs in
  core. `body` is the root; `quote` is a simple container.

### 7.1 Sequence

1. **Build the minimal core structural half.**
   - `core/structural-registry.ts` — `StructuralDefinition`
     (`{ type, isScope?, normalizeChildren?, fromCompatNode, toCompatNode }`), registered
     via `registerNode({ structuralDefinition })`; a `registerGlobalStructuralDefinition`
     mirroring the object path; included in `createDefaultBlockRegistry()`.
   - Structural-compat registry hook in `compat.ts` mirroring `isObjectNodeType` /
     `normalizeCompatObject` (~384/~860) so structural import/export consults the registry
     instead of hardcoded `if (node.type === ...)` branches.
   - Generic `insert-structural` command + export `placeSubtree`
     (`commands/objects.ts` ~152) so a view's `createCommand` builds a
     container-with-children subtree without a bespoke core command.
   - Open `StructuralNodeType` (`model.ts` ~193) from a closed union to registry-driven
     (built-ins still known, registered types allowed).

2. **Migrate callout onto it — and only callout.** Delete `insert-callout` and the
   callout compat branch; re-register callout through `structuralDefinition` +
   `insert-structural`. **Done when core has zero `callout` knowledge.** This is the proof
   the table would otherwise be (badly).

3. **Land the table** (docs/019) as `StructuralNodeView` + `StructuralDefinition`, no core
   edits. Two differently-shaped consumers (pure container + grid) now validate the
   contract.

4. **Opportunistic mop-up.** Migrate `quote`; decide about `list/listitem` — likely leave
   their flattening in core as a legitimate dialect concern. Defer the public third-party
   *opening* (open union as public API, docs/020 §13) until the shape settles after step 3.

### 7.2 Status

- [x] **Step 1 — core structural half** (2026-06-21). New `core/structural-registry.ts`
  (`StructuralDefinition` = `createSubtree` + `fromCompatNode`; built-in callout core +
  global registry + `getStructuralDefinition`/`isStructuralDefinitionType`). Generic
  `insert-structural` command (`compileInsertStructural`) replaces `compileInsertCallout`.
  Registry-driven structural *import* in `compat.ts` (callout no longer a hardcoded
  branch; `isBlockChild` consults the registry). `registerNode({ structuralDefinition })`
  front wired with a type-agreement assert. New core surface exported from
  `core/index.ts` + public `index.ts`. *Note:* the closed `StructuralNodeType` union is
  intentionally still closed (one `as StructuralNodeType` cast in the compat branch);
  opening it is step 3's job. Structural *export* was already generic — untouched.
- [x] **Step 2 — callout migration** (2026-06-21). `callout.tsx` insert now emits
  `{ type: "insert-structural", structuralType: "callout" }`; callout's subtree + compat
  logic live in its `StructuralDefinition`. **Core has zero `callout`-specific knowledge**
  (no `insert-callout` command, no `if (type==="callout")` compat branch). Proof green:
  typecheck clean, all 768 vitest pass, format clean.
- [ ] Step 3 — table (opens the union; second consumer of the SPI)
- [ ] Step 4 — quote/list mop-up + public opening (deferred)
