# 037 — Agentic Control API: Driving The Editor By Protocol, Not Pixels

> Status: implementation-grade research and proposal
>
> Date: 2026-07-01
>
> Scope:
>
> - The semantic **control surface** an AI action or an external agent uses to read and manipulate the editor's model: the existing framework-free `OwnedEditorHandle` (write side) plus a net-new **read/query layer** (locate and read before editing).
> - The **transport ladder** that exposes that one surface from in-process out to a fully external process: an in-page control channel, a `postMessage` bridge, a CDP/automation `evaluate` path, and a WebSocket/MCP relay keyed by session.
> - The **capability and authority** model (read / propose / commit) and the rule that agents **propose by default** rather than silently commit.
> - The in-editor **AI tab** and its vendor-neutral **provider SPI**, whose actions output "propose review change" into the suggested-edits system.
>
> The through-line: the editor's model is the source of truth, the human's own keystrokes become `store.command(...)`, so an agent acts on the **same command layer**, never by synthesizing pointer events at guessed coordinates. The DOM is output, not input.
>
> Source docs:
>
> - `packages/editor/src/core/editor-handle.ts` — the existing `OwnedEditorHandle`, the framework-free control surface this document extends.
> - `packages/editor/src/core/commands/index.ts` — the `EditorCommand` union (~25 intents), the write vocabulary.
> - `docs/024_command_surface_spi.md` — the command-surface SPI (ribbon/menu/flyout); the agentic API is a peer consumer of the same command descriptors.
> - `docs/033_consumer_integration_contract.md` — the consumer integration contract; the transports extend it.
> - `docs/036_snapshot_diff_and_document_history_review.md` — the suggested-edits system. `037` is the **producer** of proposals; `036` is where they land and are reviewed. Propose-by-default (§7) targets `036`'s `Proposal`/`SuggestionSource`.
> - `docs/038_woven-overlay-design.md` — the **woven inline diff overlay** design system: the live in-editor surface where a proposal from an agent (this doc) is reviewed in place and accepted/rejected. It is the concrete rendering-and-resolution home for `037` option-A propose-by-default — `038` the consumer, `037` the producer.
> - `docs/006_editor_toolbar_redesign_plan.md` — §4.7 the AI tab and the "propose review change" output mode.
> - `docs/027_review_tab_side_panel_and_document_insight.md` — §2.2 the derived document index (`buildDocumentIndex`) the read/query layer reuses.
>
> Related docs:
>
> - `docs/031_editor_native_rust_wasm_core.md` — the server-authoritative, no-browser case (an agent editing when no browser is open) rides the core running server-side; a future transport (§10), not the first release.
> - `docs/013_collaborative_owned_model_yjs_adaptation.md` — real-time multi-user; distinct from an agent driving a single session.
>
> Assumptions:
>
> - **In-process first.** Build the handle + read/query layer once; each transport is a thin adapter over it. Commands and query results are JSON-serializable (they already are), so an out-of-process adapter wraps the same surface with no rework.
> - **Propose by default.** An external or AI-driven change targets a proposed branch (`docs/036` Model A) and surfaces as a reviewable, attributed suggestion. Direct commit to the live document is a trusted, opt-in capability, not the default.
> - **A live session is the near-term target.** The transports reach a running editor instance in a browser session (something in that session, or a relay it opened, exposes the channel). Editing a document with no browser open is the server-authoritative case, deferred to `docs/031` (§10).
> - No product or runtime dependency enters `packages/editor`; the control surface is the framework-free core, the transports are adapters in the view/host layer (the shared-package boundary).

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary](#2-system-summary)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 The Write Surface Already Exists](#31-the-write-surface-already-exists)
  - [3.2 The Read Gap](#32-the-read-gap)
  - [3.3 No External Transport Exists](#33-no-external-transport-exists)
  - [3.4 The AI Tab Is Registered But Empty](#34-the-ai-tab-is-registered-but-empty)
  - [3.5 Why Pixel-Driving Is Categorically Wrong](#35-why-pixel-driving-is-categorically-wrong)
- [4. Architecture Decisions](#4-architecture-decisions)
  - [4.1 D1 — The Command Layer Is The Surface, Not The DOM](#41-d1--the-command-layer-is-the-surface-not-the-dom)
  - [4.2 D2 — A Read/Query Layer: Locate Before Edit](#42-d2--a-readquery-layer-locate-before-edit)
  - [4.3 D3 — One Serializable Command+Query Envelope](#43-d3--one-serializable-commandquery-envelope)
  - [4.4 D4 — The Transport Ladder: Adapters Over One API](#44-d4--the-transport-ladder-adapters-over-one-api)
  - [4.5 D5 — A Capability Model: Read, Propose, Commit](#45-d5--a-capability-model-read-propose-commit)
  - [4.6 D6 — Propose By Default](#46-d6--propose-by-default)
  - [4.7 D7 — The AI Tab Through A Vendor-Neutral Provider SPI](#47-d7--the-ai-tab-through-a-vendor-neutral-provider-spi)
  - [4.8 D8 — In-Process First](#48-d8--in-process-first)
- [5. The Command + Query Surface](#5-the-command--query-surface)
  - [5.1 The Write Side](#51-the-write-side)
  - [5.2 The Read/Query Side (Net-New)](#52-the-readquery-side-net-new)
  - [5.3 The Serializable Envelope](#53-the-serializable-envelope)
- [6. The Transport Ladder](#6-the-transport-ladder)
  - [6.1 L1 — In-Page Control Channel](#61-l1--in-page-control-channel)
  - [6.2 L2 — postMessage Bridge](#62-l2--postmessage-bridge)
  - [6.3 L3 — CDP / Automation Evaluate](#63-l3--cdp--automation-evaluate)
  - [6.4 L4 — WebSocket / MCP Relay](#64-l4--websocket--mcp-relay)
- [7. Capability And Authority](#7-capability-and-authority)
- [8. The AI Tab And Provider SPI](#8-the-ai-tab-and-provider-spi)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Implementation Backlog](#10-implementation-backlog)
- [11. Future Backlog](#11-future-backlog)
- [12. Definition Of Done](#12-definition-of-done)
- [13. Final Model](#13-final-model)

## 1. Goal

Give an AI action or an external agent a semantic protocol to read the editor's document and manipulate it, without ever synthesizing pointer events at guessed coordinates. An agent reads ("find the heading titled X, read the paragraph after it") and writes ("insert this text, set this block to a heading, propose this rewrite") against the model, the same layer the human's keystrokes reach. The default effect of an agent's write is a **reviewable proposal** (`docs/036`), not a silent mutation.

Two audiences, one surface:

- **In-process** — an in-editor AI action (the AI tab), or a host app embedding the editor and driving it in code (content-api today drives the handle this way).
- **Out-of-process** — an external agent (a service, an MCP client, an assistant) driving a specific live editor session over a transport.

Non-goals for the first release:

- **Headless, no-browser editing.** "Revise this document overnight with no editor open" needs the document's authoritative model server-side (`docs/031`); a future transport (§11), not this release.
- **Building an AI vendor.** The AI tab is provider-injected; the editor hardcodes no model, endpoint, auth, or prompt (§8).
- **Real-time multi-user collaboration.** An agent driving one session is not multi-peer convergence (`docs/013`).

Short version: extend `OwnedEditorHandle` with a read/query layer, keep the command+query surface JSON-serializable, expose it over a transport ladder (in-page global → `postMessage` → CDP eval → WS/MCP relay), gate it with read/propose/commit capabilities, and make the proposed branch the default write target.

## 2. System Summary

```text
   in-editor AI action ─┐
   host app (in code) ──┤                              ┌─► live store (commit capability — trusted)
                        ├─► COMMAND + QUERY SURFACE ────┤
   external agent ──────┤   (OwnedEditorHandle          └─► proposed branch (propose capability — default)
   (MCP / service) ─────┘    + read/query layer,                 │
        via a transport       JSON-serializable)                 └─► docs/036 Proposal → inline diff → human accepts
        (L1 global · L2 postMessage · L3 CDP eval · L4 WS/MCP relay)
```

One semantic surface, several transports, three capabilities. Every caller reads the model with the query layer and writes with `EditorCommand`s. Where the write lands depends on the caller's capability: a trusted in-house automation may commit to the live store; an external agent proposes, and its change becomes a `docs/036` suggestion the human reviews. No transport touches pixels; the DOM is never the manipulation surface.

## 3. Current-State Findings

### 3.1 The Write Surface Already Exists

`OwnedEditorHandle` (`core/editor-handle.ts`) is framework-free and DOM-free: `dispatch(command)`, `getEditorSnapshot()`, `getSelection()/setSelection()`, `undo()/redo()`, object activation, `on(event)`. Under it, `EditorStore.command()` takes the `EditorCommand` union (`core/commands/index.ts:54-172`) — ~25 high-level intents (`insert-text`, `delete-*`, `split-block`, `toggle-mark`, `set-link`, `set-block-type`, `set-block-attr`, `indent`/`outdent`, `move-block`, `insert-object`, `insert-blocks`, `insert-structural`, `apply-markdown`, `set-object-data`, `set-collection`, …). The compilers validate intent into a legal tree, so command-level is the right granularity for an agent — an agent cannot express an illegal state the way raw step or DOM manipulation could. content-api already drives the editor entirely through this handle. The write half is done.

### 3.2 The Read Gap

Reads are caret-local only. The `EditorQuery` union (`core/commands/index.ts:164-172`) answers questions about the current selection: `is-mark-active`, `can-indent`, `current-block-type`, `current-list-type`, `current-align`, `active-link-href`. Beyond that, a caller has `store.getNode(id)` (`editor-store.ts:549`) and `store.toSnapshot()` — the whole document or one node by id. There is **no content-addressed locate/read**: no "find the heading titled X," "find blocks of type Y," "read node N's text," "resolve the range matching this text." An agent must locate before it edits; without this it is blind and falls back to scraping the DOM. This is the net-new half of the surface (§5.2), and it partly reuses the derived document index (`buildDocumentIndex` → `{ toc, text, comments }`, `bake.ts:146`, `docs/027 §2.2`), which already rolls up headings and per-block plain text off-thread.

### 3.3 No External Transport Exists

A search finds one window global — `window.__IDCO_EDITOR_PERF__`, the perf dashboard for Playwright (`core/scheduler.ts:258`) — and no control channel. There is no intentional command surface on `window`, no instance registry (multiple editors on a page), and no `postMessage` bridge (the only `postMessage` is the bake worker's internal one, `core/bake/bake.worker.ts`). So the semantic surface exists in-process but has no external door. The perf global is precedent that publishing to `window` is acceptable; the control channel is net-new but small (§6.1).

### 3.4 The AI Tab Is Registered But Empty

The `"ai"` toolbar tab is registered (`command-builtins.tsx:279`) but carries no actions and no provider. `docs/006 §4.7` specifies the intended shape: actions injected through a provider contract (no hardcoded vendor/endpoint/auth), declaring scope (selection/block/document) and output behavior (replace selection, insert below, create block, **propose review change**, return text into a dialog). Nothing is built. The provider SPI and the "propose review change" wiring into `docs/036` are net-new (§8).

### 3.5 Why Pixel-Driving Is Categorically Wrong

Clicking `(x, y)` drives the **view** and hopes the model follows — an agent pretending to be a mouse pretending to be an intent. It breaks on any restyle, guesses coordinates, and cannot express "the second paragraph" without first screen-scraping. The model is the source of truth (the whole owned-model architecture), and the human's keystrokes themselves become `store.command(...)` through the EditContext → command compilers. So the correct place for an agent to act is that same command layer, writing the intent directly. This is not merely less brittle; it is the only place a write is *semantically defined*. The corollary from the editor design holds here: the DOM is output, not input.

## 4. Architecture Decisions

### 4.1 D1 — The Command Layer Is The Surface, Not The DOM

Recommended: agents read through the query layer and write through `EditorCommand`s on the handle. The DOM is never a manipulation surface. This is the same conclusion the editor reached for its own input path (EditContext feeds commands, the DOM is a projection), applied to agents.

Rejected — synthesized pointer/keyboard events at coordinates: brittle, layout-coupled, semantically undefined, and unable to locate content without scraping. Rejected — DOM mutation of the rendered spans: the render is derived from the model; mutating it is immediately overwritten and can desync the store.

### 4.2 D2 — A Read/Query Layer: Locate Before Edit

Recommended: add a content-addressed query layer (§5.2) — find by type/text/attr/mark, read a node's or range's text, resolve a descriptor to a target — reusing the derived document index where it already computes the answer (headings, per-block text).

An agent's loop is locate → read → write. Today it can only write and read-the-whole-document. Without locate/read it cannot target an edit precisely, which forces DOM scraping and reintroduces the pixel problem one level up.

### 4.3 D3 — One Serializable Command+Query Envelope

Recommended: define a JSON envelope for a command call and a query call (§5.3). `EditorCommand` and `EditorDocumentSnapshot` are already JSON; query results are plain data. So the same surface projects over any transport with no bespoke serialization.

This is what makes the transports thin adapters rather than parallel APIs, and it is the seam an MCP server maps its tools onto (§6.4).

### 4.4 D4 — The Transport Ladder: Adapters Over One API

Recommended: build four transports as adapters over the one surface, in order of reach: L1 in-page global, L2 `postMessage`, L3 CDP eval, L4 WS/MCP relay (§6). None replaces the API; each is a different door to it.

Rejected — a single transport hardcoded into the editor: different deployments need different reach (an embedded product uses `postMessage`; an automation stack uses CDP; an external assistant uses a relay). Adapters over one surface serve all without forking the API.

### 4.5 D5 — A Capability Model: Read, Propose, Commit

Recommended: a control handle is scoped to one of three capabilities — **read** (query only), **propose** (writes create `docs/036` proposals), **commit** (writes hit the live store). The transport authenticates and grants a capability; the surface enforces it.

Rejected — one all-powerful handle: an external agent with silent commit rights to a user's document is unsafe by default. Capabilities make the safe mode (propose) the common grant and reserve commit for trusted callers.

### 4.6 D6 — Propose By Default

Recommended: a `propose`-capability write compiles the `EditorCommand`s into a `docs/036` `Proposal` (an op-log branch) instead of committing. The change surfaces as an attributed inline suggestion the human accepts or rejects. Commit is opt-in behind the commit capability.

This is where `037` and `036` join: the agentic API doesn't need a separate "suggest mode"; it needs a write *target* (live store vs proposed branch), and attribution rides along for free (`docs/036 §7.4`). An agent editing an admin's live document is safe because its edits are reviewable by construction.

### 4.7 D7 — The AI Tab Through A Vendor-Neutral Provider SPI

Recommended: the AI tab's actions come from a host-registered provider (§8); the editor hardcodes no vendor, endpoint, auth, or prompt. An action declares scope and output mode; the "propose review change" output produces a `docs/036` proposal.

Rejected — a built-in AI vendor: couples the editor to a provider and a product's auth/routing, which the shared-package boundary forbids.

### 4.8 D8 — In-Process First

Recommended: build the handle + read/query layer + capability model first (usable in-process today, like content-api and the AI tab). Add transports incrementally (L1, then L2/L4 as deployments need them). Because the surface is serializable, no transport forces a surface change.

## 5. The Command + Query Surface

### 5.1 The Write Side

The write side is the existing handle plus capability routing. An `EditorCommand` is compiled and either committed (`commit` capability) or turned into a proposal (`propose` capability). `undo`/`redo` and `setSelection` are commit-only. The surface never exposes raw `Step`s — commands only, so the compilers keep the tree legal.

### 5.2 The Read/Query Side (Net-New)

`core/query/` — framework-free, reads a snapshot or the live store:

```ts
export type NodeQuery = {
  readonly type?: string;                 // "heading" | "paragraph" | "callout" | …
  readonly kind?: "text" | "structural" | "object";
  readonly textMatches?: string;          // substring or /regex/ against plain text
  readonly attr?: Readonly<Record<string, JsonValue>>;
  readonly hasMark?: TextMarkKind;
  readonly inScope?: NodeId;              // limit to a container's subtree
};
export type NodeMatch = {
  readonly id: NodeId;
  readonly type: string;
  readonly kind: "text" | "structural" | "object";
  readonly text: string;                  // plainText for the node (leaf text, or object plainText)
  readonly path: readonly NodeId[];       // ancestor chain, body → … → node
};

export type QueryApi = {
  findNodes(query: NodeQuery): readonly NodeMatch[];
  readNode(id: NodeId): { readonly type: string; readonly text: string; readonly marks: readonly ResolvedMark[]; readonly attrs?: JsonObject } | null;
  readRange(from: EditorPoint, to: EditorPoint): string;
  outline(): readonly { readonly id: NodeId; readonly level: number; readonly text: string; readonly anchor: string }[];
  resolveTarget(descriptor: TargetDescriptor): EditorSelection | NodeId | null;
  getSnapshot(): EditorDocumentSnapshot;   // = handle.getEditorSnapshot()
};

// "the paragraph after the heading titled X", "the range matching 'foo'", "block <id>"
export type TargetDescriptor =
  | { readonly kind: "node"; readonly id: NodeId }
  | { readonly kind: "heading"; readonly title: string; readonly then?: "next-block" | "section" }
  | { readonly kind: "text-match"; readonly text: string; readonly nth?: number };
```

`findNodes` and `outline` reuse the derived document index (`buildDocumentIndex` already rolls up headings and per-block plain text, `bake.ts:146`), so the common queries hit precomputed data rather than a fresh walk. `readNode`/`readRange` read the store or snapshot directly. `resolveTarget` is the locate primitive an agent uses before a write, turning a human-style descriptor into a `NodeId` or selection the command layer accepts.

### 5.3 The Serializable Envelope

```ts
export type ControlRequest =
  | { readonly op: "query"; readonly method: keyof QueryApi; readonly args: JsonValue }
  | { readonly op: "command"; readonly command: EditorCommand }
  | { readonly op: "propose"; readonly commands: readonly EditorCommand[]; readonly author: ProposalAuthor; readonly note?: string };
export type ControlResponse =
  | { readonly ok: true; readonly result: JsonValue }
  | { readonly ok: false; readonly error: string };
```

`EditorCommand`, `EditorDocumentSnapshot`, and the query results are all JSON, so `ControlRequest`/`ControlResponse` cross any transport unchanged. A `propose` request bundles a batch of commands into one `docs/036` `Proposal` (one reviewable unit, one undo/accept), which is the natural granularity for "the agent rewrote this section."

## 6. The Transport Ladder

Each transport is an adapter that receives a `ControlRequest`, dispatches it against the surface under a granted capability, and returns a `ControlResponse`. Ordered by reach.

### 6.1 L1 — In-Page Control Channel

The editor publishes a control channel to a well-known global, keyed by instance id, capability-gated:

```ts
// window.__IDCO_EDITOR__ : Map<instanceId, ControlChannel>
window.__IDCO_EDITOR__?.get(instanceId)?.request({ op: "query", method: "findNodes", args: {...} });
```

Anything that runs JS in the page — a browser extension content script, `page.evaluate`, an injected script, the devtools console — calls it semantically. Precedent: the perf dashboard already publishes to `window` (`scheduler.ts:258`). Net-new: a stable, intentional channel (not a test hook), an instance registry for multiple editors, and capability gating (a page opts into which capability the channel grants). A DOM-level *semantic* channel — dispatching a `CustomEvent("idco:control", { detail: request })` on the editor root — is an equivalent shape for callers that prefer events to a global. Both are DOM-level and semantic; neither guesses coordinates.

### 6.2 L2 — postMessage Bridge

For an embedded editor (an iframe on admin.content.com, or a child window), the host page or a parent window drives it across frames/origins:

```ts
editorWindow.postMessage({ idco: "control", request }, targetOrigin);
// editor: window.addEventListener("message", validateOriginThenDispatch)
```

Behind an **origin allowlist** (the editor validates `event.origin` against a host-configured list before dispatching). This is how the embedding product drives its own embedded editor, or how a trusted parent app scripts it. Standard web primitive, no automation harness.

### 6.3 L3 — CDP / Automation Evaluate

An external process driving the browser (Playwright, a CDP client, a computer-use harness) calls the L1 channel via `Runtime.evaluate` instead of `click(x, y)`:

```ts
await page.evaluate((req) => window.__IDCO_EDITOR__.get("main").request(req), request);
```

Same automation stacks, but the action is a semantic command, layout-independent and unbroken by restyle. This is the direct answer to "instead of guessing the pointer x,y": keep the automation, change the action from a coordinate click to a command call.

### 6.4 L4 — WebSocket / MCP Relay

To reach a specific live user session without an extension or CDP, the browser editor opens a socket to a relay and advertises its session; an external agent connects to the same relay by session token; `ControlRequest`/`ControlResponse` pipe browser ↔ relay ↔ agent:

```text
browser editor ──WS──► relay ◄──WS/MCP── external agent (Claude, a service)
     (advertises sessionId, holds the surface)     (holds a session token + capability)
```

Wrap the relay's surface as an **MCP server** and any MCP client drives the live editor as tools: `readDocument`, `findNodes`, `readNode`, `proposeEdit(commands)`, each mapping to a `ControlRequest`. The browser editor stays authoritative; the relay only pipes. This is the transport that lets an assistant edit an admin's open document by attaching to their session, with propose-by-default keeping it safe.

## 7. Capability And Authority

A control handle carries one capability:

- **read** — `query` requests only; no writes. The safe grant for analysis, extraction, "summarize this document."
- **propose** — `propose` requests create `docs/036` proposals; `command` requests are rejected or auto-upgraded to proposals. The default grant for an agent editing a human's document; every change is reviewable and attributed.
- **commit** — `command` requests hit the live store. Reserved for trusted callers (the host's own in-process automation, a first-party migration script).

Authority per transport: L1 grants the capability the page configures (a page that exposes a read channel to an extension); L2 validates `event.origin` against an allowlist and maps origins to capabilities; L4 authenticates the session token and grants a capability server-side. The surface enforces the capability regardless of transport, so a bug in one adapter cannot escalate.

Propose-by-default (D6) is itself a safety property: even a `propose`-capability agent that misbehaves produces suggestions a human must accept, not silent document damage. This is the posture for external agents; `commit` is the exception, not the rule.

## 8. The AI Tab And Provider SPI

The AI tab (`"ai"`, registered but empty, §3.4) hosts in-editor AI actions supplied by a host-registered provider. The editor stays vendor-neutral (`docs/006 §4.7`):

```ts
export type AiAction = {
  readonly id: string;
  readonly label: string;
  readonly scope: "selection" | "block" | "document" | "collection" | "settings";
  readonly output: "replace-selection" | "insert-below" | "create-block" | "propose-review-change" | "dialog-text";
};
export type AiProvider = {
  readonly id: string;
  actions(): readonly AiAction[];
  run(action: AiAction, ctx: AiRunContext, signal: AbortSignal): Promise<AiResult>;
};
// registerAiProvider(provider): the host injects the model/endpoint/auth; the editor calls run()
```

An action reads through the query layer (its `scope` scopes what it sees) and returns a result the editor applies through the same command surface. The **`propose-review-change`** output is the important one: it produces a `docs/036` `Proposal` from the action's commands, so an AI rewrite becomes a reviewable inline suggestion, not a silent mutation. `replace-selection`/`insert-below`/`create-block` commit directly (the user invoked the action explicitly, in-process), while `propose-review-change` is the review-gated mode for larger or lower-confidence changes. The provider owns the model, endpoint, auth, and prompt; the editor owns only the action contract and the application of results.

The AI tab (in-process) and the external transports (§6) are the same surface from inside and outside: both read through the query layer, write through commands, and default to proposals for anything beyond an explicit in-editor action.

## 9. Edge Cases And Failure Modes

- **Ambiguous `resolveTarget`.** "the heading titled X" matches two headings. Mitigation: `findNodes`-style match returns all candidates; `resolveTarget` returns the first with a documented tie-break (document order) and the caller can disambiguate with `nth`. Never silently pick and hope.
- **Stale read before write.** An agent reads, the human edits, then the agent writes against a moved target. Mitigation: `propose` writes carry a `baseVersion` (`docs/036 §7.3`), so the proposal rebases or flags; `commit` writes go through the command compilers, which resolve against current state and reject an impossible command rather than corrupt.
- **Illegal command.** An agent asks for something the model forbids (split a non-text block). Mitigation: the compiler returns `null`/no-op (`core/commands`), and the `ControlResponse` reports `ok:false` with a reason; the tree is never left illegal.
- **Capability escalation attempt.** A `propose`-capability caller sends a raw `command`. Mitigation: the surface auto-upgrades it to a proposal or rejects it per config; it never commits.
- **Cross-origin postMessage from an untrusted frame.** Mitigation: `event.origin` allowlist; unlisted origins are dropped silently (no error surface that could leak state).
- **Relay session hijack.** A stolen session token. Mitigation: tokens are short-lived and capability-scoped server-side; the browser editor can revoke by closing its socket; propose-by-default bounds the blast radius to reviewable suggestions.
- **Multiple editors on a page.** Mitigation: the L1 registry keys channels by instance id; a caller must name the instance, and an unknown id returns `ok:false`.
- **No browser open.** An agent wants to edit with no live session. Mitigation: out of scope for the transports here; it needs the server-authoritative core (`docs/031`, §11). Report it as unsupported rather than degrade to a headless DOM.
- **Runaway agent.** An agent issues thousands of writes. Mitigation: rate/size limits per capability at the transport; `propose` batches into one proposal per logical change; a human still gates acceptance.

## 10. Implementation Backlog

Backlog IDs `R7-A` … `R7-G`.

### R7-A. The Read/Query Layer

Scope: `packages/editor/src/core/query/**`.
Tasks:

- [ ] `QueryApi` (§5.2): `findNodes`, `readNode`, `readRange`, `outline`, `resolveTarget`, `getSnapshot`.
- [ ] Reuse `buildDocumentIndex` for `findNodes`/`outline` where it already computes the answer.

Acceptance: `findNodes({type:"heading"})` returns all headings with text and path; `resolveTarget({kind:"heading", title, then:"next-block"})` returns the block after that heading; `readNode` returns text + resolved marks. Tests: `tests/editor/engine-query.test.ts`.

### R7-B. The Control Surface + Capability Model

Scope: `core/control/**` (surface + `ControlRequest`/`ControlResponse` + capability routing).
Tasks:

- [ ] `createControlChannel(store, { capability })`: dispatch `query`/`command`/`propose`.
- [ ] Capability enforcement (read/propose/commit); `propose` compiles a `docs/036` `Proposal`.

Acceptance: a read channel rejects writes; a propose channel turns a command batch into a proposal; a commit channel commits. Tests: `engine-control-surface.test.ts`.

### R7-C. L1 In-Page Channel + Instance Registry

Scope: `view/control/window-channel.ts`, wired in `react-view.tsx`.
Tasks:

- [ ] Publish `window.__IDCO_EDITOR__` registry keyed by instance id; a `CustomEvent("idco:control")` equivalent.
- [ ] Opt-in per editor (which capability the channel grants).

Acceptance: `window.__IDCO_EDITOR__.get(id).request(...)` drives the editor; an unknown id returns `ok:false`. Tests: e2e `engine-control-l1.spec.ts` (Playwright `page.evaluate`, the L3 path exercised).

### R7-D. L2 postMessage Bridge

Scope: `view/control/postmessage-bridge.ts`.
Tasks:

- [ ] Origin-allowlisted `message` listener → surface; origin→capability mapping.

Acceptance: an allowlisted parent frame drives the editor; an unlisted origin is dropped. Tests: `engine-control-postmessage.spec.ts`.

### R7-E. L4 Relay + MCP Mapping

Scope: a host-side relay (out of `packages/editor`) + an MCP tool mapping doc.
Tasks:

- [ ] Session-keyed WS relay; the editor advertises a session; an external client attaches by token.
- [ ] MCP tools (`readDocument`, `findNodes`, `readNode`, `proposeEdit`) mapping to `ControlRequest`.

Acceptance: an external MCP client reads and proposes against a live session; changes appear as suggestions. Tests: an integration harness (out of this repo).

### R7-F. The AI Provider SPI + Tab

Scope: `view/spi/ai-provider-registry.ts`, AI-tab actions in `command-builtins.tsx`.
Tasks:

- [ ] `AiProvider`/`AiAction` (§8), `registerAiProvider`.
- [ ] Wire the AI tab to a registered provider; `propose-review-change` → `docs/036` proposal.

Acceptance: a stub provider populates the AI tab; a rewrite action produces a reviewable proposal; the editor hardcodes no vendor. Tests: `engine-ai-provider.test.tsx`.

### R7-G. Public API Map + Docs

Scope: regenerate API maps for `QueryApi`, the control surface, `AiProvider`. Acceptance: `pnpm check` green. Tests: `pnpm check`.

## 11. Future Backlog

- **Server-authoritative headless.** An agent editing with no browser open, against the model running server-side (`docs/031`). The same command+query surface, hosted on the Rust/native core, with the browser (if any) as a reflecting view. This is also the real-time-collaboration substrate; suggestions and agentic writes both ride it.
- **A first-party MCP server package.** Ship the L4 relay + MCP mapping as a supported package so any MCP client drives a live idco editor out of the box.
- **Richer query.** Structural queries ("blocks between heading A and heading B"), semantic search over the derived index, and streaming reads for very large documents.
- **Batch transactions with one review unit.** An agent's multi-step edit as one proposal with sub-step attribution.

## 12. Definition Of Done

- The read/query layer (R7-A) ships in `core/query/**`, framework-free, with `findNodes`/`readNode`/`readRange`/`outline`/`resolveTarget` covered by tests, reusing the document index where it applies.
- The control surface (R7-B) enforces read/propose/commit capabilities; a `propose` write produces a `docs/036` `Proposal` and never touches the live store; a `commit` write goes through the command compilers and cannot leave the tree illegal.
- At least the L1 channel (R7-C) is built and proven by an e2e that drives the editor via `page.evaluate` with zero synthesized pointer events; L2/L4 land as deployments need them.
- The AI provider SPI (R7-F) is vendor-neutral; a stub provider drives the AI tab; `propose-review-change` lands as a reviewable suggestion.
- No product/runtime dependency entered `packages/editor`; the architecture lint stays green; `pnpm check` green with the new public symbols documented.

## 13. Final Model

An agent should drive the editor the way the human does — by intent on the model, not by gesture on the screen. The write surface already exists as the framework-free `OwnedEditorHandle`; the missing half is a read/query layer so the agent can locate and read before it edits, and the missing door is a transport, of which there are four over one serializable command+query envelope: an in-page global, a `postMessage` bridge, a CDP `evaluate` call, and a session-keyed WS/MCP relay. None of them touches a pixel. A capability model scopes each caller to read, propose, or commit, and the default for an external or AI-driven change is **propose**, which routes the write into `docs/036`'s suggested-edits system so the change surfaces as an attributed inline suggestion the human accepts or rejects. The in-editor AI tab is the same surface seen from inside, its actions supplied by a vendor-neutral provider whose "propose review change" output is the same proposal. Build the surface once, expose it over the transport a deployment needs, and make the proposed branch the default target: that is how an assistant edits an admin's open document at admin.content.com safely and precisely, without ever guessing where to click. The one case this does not cover — editing with no browser open — is the server-authoritative core in `docs/031`, which hosts this exact surface and is also where real-time collaboration eventually lives.
