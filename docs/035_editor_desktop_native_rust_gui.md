# 035 — editor-desktop: a native-Rust document editor on the shared owned-model core

> Status: implementation-grade research and proposal — brainstorm-stage in places (the open questions in §10 are first-class, not afterthoughts)
>
> Date: 2026-06-30
>
> Scope:
>
> - `packages/editor/src/core/**` — the framework-free owned-model core (model, commands, marks, treap/offset-model, steps, history, bake, table). This document proposes it become the **shared spine of two front-ends**: the browser editor (today) and a native desktop editor (new). The core port itself is docs/031's subject; this document is the desktop consumer of that port.
> - A new target `editor-desktop` (a native-Rust GUI application) consuming the same core. It is **not** a webview, **not** Electron/Tauri, and **not** a port of `packages/editor/src/view/**`; it is a second view built on the linebender native-Rust stack.
> - The **lossless document format** (§7), which is a desktop motivation but a TS-today deliverable: it ships in `packages/editor` before any Rust exists, and the desktop app inherits it.
>
> Source docs:
>
> - `docs/031_editor_native_rust_wasm_core.md` — the Rust/WASM core for the **browser** editor. 035 is its sibling: 031 keeps the model in WASM and reads it from a TS view over an FFI seam; 035 adds a **second, native** view on the same core, where there is no FFI seam at all. 031 §5.6's FFI-read gate — its load-bearing risk — **does not apply** to the desktop target, which is one of the strongest reasons the desktop case strengthens 031 rather than competing with it. The async-runtime decision in 035 §4.10 is mirrored into 031 (a new decision there).
> - `docs/010_owned_model_virtualized_editor_plan.md` — the owned-model foundation, the framework-free `core/**` boundary, and the precedent that a philosophy/decision doc deliberately omits a ticket backlog (010 §48). 035 follows that precedent at the user's instruction.
> - `docs/011_foundation_dsa_owned_model_editor.md` — the node model, coordinate system, mutation algebra, and selection model the native view consumes unchanged.
> - `docs/025_virtual_geometry_offset_model_and_fling.md` — the `OffsetModel` SPI + treap; 035 §5.3 explains how its *algorithm* ports but its *measurement source* changes (async `ResizeObserver` → synchronous layout).
> - `docs/028_reader_convergence_snapshot_native_dispatch.md` — the reader renders the native snapshot; the "resting vs living" split 035 §5.5 simplifies originates here.
> - `docs/029_editor_overlay_authority_spi.md` — "the editor decides to close, the overlay only reports"; the native overlay policy (§4.7, §6.5) is this model expressed against `floating-ui-core`.
> - `docs/030_ts_editor_markdown_nesting_snapshot_lifecycle.md` — the markdown I/O and the documented lossy set (`view/markdown/transformers.ts`) that §7 makes lossless.
> - `note.md` §2 (overlay SPI) and §4 (markdown/export hardening) — the TS-side backlog the lossless mode (§7) extends.
>
> Related docs:
>
> - `docs/034_host_placed_editor_chrome_spi.md` — host-placed chrome; relevant to how a native shell positions the rail/toolbar.
> - `docs/013_collaborative_owned_model_yjs_adaptation.md` / `docs/014_crdt_future_proofing_brainstorm.md` — the collaboration future; a Rust core is the native home for a CRDT op-log, and a desktop app is a second beneficiary.
>
> Assumptions:
>
> - This is a direction-setting proposal, not a commitment. The whole thing is gated on (a) docs/031's core port being viable, and (b) a desktop spike (§8) that proves the one load-bearing native unknown: a parley editor canvas hosted in a native window, painting our caret/selection, fed by the OS IME, driven by the shared core. "Stay browser-only" is an acceptable outcome.
> - The core is, or becomes under docs/031, **runtime-agnostic and synchronous at its API** — no `tokio`, no browser, no DOM. §4.10 makes this a hard rule because it is the precondition for one crate serving both wasm and native. If the core today has any hidden async or platform coupling, removing it is prerequisite work, shared with 031.
> - `compat.ts` is off-spine and deletable (`compat-is-temporary-not-official-path`); the native view never speaks the legacy shape, exactly as 031 assumes.
> - **Backlog and per-ticket breakdown are intentionally omitted** (010 §48 precedent; the user's instruction — the tickets are not ready). This document carries philosophy, current-state findings, decisions with rejected options, concrete code sketches, the spike, edge cases, open questions, and a definition of done for the spike. The implementation backlog is split out only once the direction and the §10 open questions are settled.
> - The native-Rust stack named here (winit, wgpu, vello, parley, taffy, accesskit, masonry, floating-ui-core) is alpha-to-young in 2026. The architecture (§4.2/§4.3) is chosen so that the alpha risk is *ejectable*: we own the primitives and treat the convenience layer (Masonry) as replaceable, never as a framework we marry.

## Table Of Contents

- [1. Goal](#1-goal)
- [2. System Summary: One Core, Two Front-Ends](#2-system-summary-one-core-two-front-ends)
- [3. Current-State Findings](#3-current-state-findings)
  - [3.1 What The Editor Is Made Of (Core vs View, Measured)](#31-what-the-editor-is-made-of-core-vs-view-measured)
  - [3.2 What The Browser Was Doing For Us For Free](#32-what-the-browser-was-doing-for-us-for-free)
  - [3.3 The Native-Rust Stack That Exists Today](#33-the-native-rust-stack-that-exists-today)
- [4. Architecture Decisions](#4-architecture-decisions)
  - [4.1 D1 — Reuse The Core, Rewrite The View (Two Front-Ends, One Spine)](#41-d1--reuse-the-core-rewrite-the-view-two-front-ends-one-spine)
  - [4.2 D2 — Stack 2: Own The Linebender Primitives, Not A Framework](#42-d2--stack-2-own-the-linebender-primitives-not-a-framework)
  - [4.3 D3 — The Altitude Ladder: A Different Rung Per Surface](#43-d3--the-altitude-ladder-a-different-rung-per-surface)
  - [4.4 D4 — Own The Text Stack (parley) For Determinism And Line-Height](#44-d4--own-the-text-stack-parley-for-determinism-and-line-height)
  - [4.5 D5 — Delete EditContext; Talk To The OS IME Directly](#45-d5--delete-editcontext-talk-to-the-os-ime-directly)
  - [4.6 D6 — Caret And Selection Are Already Ours; Native Is Easier Here](#46-d6--caret-and-selection-are-already-ours-native-is-easier-here)
  - [4.7 D7 — react-aria Decomposed: What Has A Rust Home, What Does Not](#47-d7--react-aria-decomposed-what-has-a-rust-home-what-does-not)
  - [4.8 D8 — daisyUI Becomes A Theme-Token Struct We Own](#48-d8--daisyui-becomes-a-theme-token-struct-we-own)
  - [4.9 D9 — Reject Blitz/Stylo And Any Webview](#49-d9--reject-blitzstylo-and-any-webview)
  - [4.10 D10 — The Core Is Runtime-Agnostic; Async Lives In The Hosts](#410-d10--the-core-is-runtime-agnostic-async-lives-in-the-hosts)
  - [4.11 D11 — Reject Managed Cross-Platform Runtimes (React Native, Flutter)](#411-d11--reject-managed-cross-platform-runtimes-react-native-flutter)
- [5. The Port Map: Reused, Rewritten, Deleted, Simplified](#5-the-port-map-reused-rewritten-deleted-simplified)
  - [5.1 Evaporates — Browser-Only Hazards We Delete](#51-evaporates--browser-only-hazards-we-delete)
  - [5.2 Ports Cleanly — Already Framework-Free](#52-ports-cleanly--already-framework-free)
  - [5.3 Changes Shape — The Real Rewrite](#53-changes-shape--the-real-rewrite)
  - [5.4 Hard To Replace — The Honest Cost Centers](#54-hard-to-replace--the-honest-cost-centers)
  - [5.5 Nothing Is Impossible — Resting/Living Simplifies](#55-nothing-is-impossible--restingliving-simplifies)
- [6. Code Sketches: React Today vs Native Rust Tomorrow](#6-code-sketches-react-today-vs-native-rust-tomorrow)
  - [6.1 A Callout Node-View](#61-a-callout-node-view)
  - [6.2 The Editor Text Surface And Caret](#62-the-editor-text-surface-and-caret)
  - [6.3 The Input Path: EditContext vs winit IME](#63-the-input-path-editcontext-vs-winit-ime)
  - [6.4 Virtualization Measurement: ResizeObserver vs Synchronous Layout](#64-virtualization-measurement-resizeobserver-vs-synchronous-layout)
  - [6.5 An Overlay: react-aria Popover vs floating-ui-core](#65-an-overlay-react-aria-popover-vs-floating-ui-core)
- [7. The Lossless Document Format (A Track That Ships Before Any Rust)](#7-the-lossless-document-format-a-track-that-ships-before-any-rust)
  - [7.1 Why Markdown Export Is Lossy — A Projection, Not A Serialization](#71-why-markdown-export-is-lossy--a-projection-not-a-serialization)
  - [7.2 Three Format Shapes](#72-three-format-shapes)
  - [7.3 Recommendation And The Round-Trip Contract](#73-recommendation-and-the-round-trip-contract)
  - [7.4 It Ships In TS Today; The Desktop Inherits It](#74-it-ships-in-ts-today-the-desktop-inherits-it)
- [8. The Spike — The Gate Before Commitment](#8-the-spike--the-gate-before-commitment)
- [9. Edge Cases And Failure Modes](#9-edge-cases-and-failure-modes)
- [10. Open Questions And Discussion](#10-open-questions-and-discussion)
- [11. Definition Of Done (For The Spike)](#11-definition-of-done-for-the-spike)
- [12. Final Model](#12-final-model)

## 1. Goal

Decide whether, and exactly how, the owned-model editor becomes a **standalone native-desktop document editor** built in Rust with a **native GUI and no webview**, reusing the same core that docs/031 ports to Rust — and define the lossless document format that motivates it.

The thesis in one line: **the editor is already a model with a view bolted on, the model is already framework-free, so a desktop app is "a second view on the same model," not "a second editor."** docs/031 establishes the model can live in Rust. This document takes the next step 031 does not: it points a *native* front-end at that Rust model. Three facts make this an unusually clean extension rather than a leap:

1. The core is framework-free by lint (docs/010, docs/020). A native view consumes it the same way the React view does — through narrow interfaces — so the swap target is a seam, not a tangle.
2. The desktop target **removes** docs/031's single biggest risk. 031 frets about the per-frame JS↔WASM FFI read cost (031 §5.6) because in the browser every view read crosses that boundary. A native app has no WASM, no JS, no FFI: the Rust core is a library the GUI links directly. The desktop is, structurally, a *cleaner* home for the Rust core than the browser is.
3. Most of the editor's hardest machinery exists to fight the browser — `contenteditable`, EditContext, focus restoration under virtualization, the resting/living split. Porting to native **deletes** the fight (§5.1, §5.5) rather than reproducing it.

The motivation is not "Rust is fast" and not even "one core, two apps." It is that the things the browser gave us for free — text layout, IME, accessibility, selection geometry — become things we *own*, and ownership is exactly what the user wants for the long run (the §4.2 "don't fight a lib" stance) and exactly what the browser denied us where it counted (line-height control, §4.4; the unfixable focus-restore caret-loss class, §5.1).

Non-goals: collaboration/CRDT (a later milestone the model is shaped to meet, docs/013/014; a desktop app is a second beneficiary, not this document's work); a server-side native reader (031 future backlog); shipping a webview under any name (§4.9); and porting `compat.ts`. First-release boundary: the **spike** (§8) and the **lossless format** (§7) are the near-term deliverables; the full native editor is gated on the spike clearing.

The short version, if the rest is too long: keep the core, rewrite the view in native Rust on the linebender stack (winit/wgpu/vello/parley/taffy/accesskit + Masonry as an ejectable convenience), delete EditContext in favor of the OS IME, re-express daisyUI as a theme struct, own the text stack for the line-height control Zed denies you, and ship the lossless document format in TypeScript first so it exists before the desktop app does.

## 2. System Summary: One Core, Two Front-Ends

The architecture is one shared core with two views that never share view code, joined by one serialized contract.

```text
                       ┌──────────────────────────────────────────┐
                       │  owned-model CORE  (Rust under docs/031)   │
                       │  model · marks · treap/offset · commands   │
                       │  steps · history · bake · table            │
                       │  runtime-agnostic, synchronous API (D10)   │
                       └──────────────────────────────────────────┘
                          ▲                              ▲
        EditorDocumentSnapshot                EditorDocumentSnapshot
        (FFI seam, per-frame reads)           (direct link, no seam)
                          │                              │
   ┌──────────────────────┴───────┐      ┌───────────────┴──────────────────┐
   │  BROWSER VIEW  (TypeScript)   │      │  DESKTOP VIEW  (native Rust)       │
   │  React + EditContext + DOM    │      │  winit + vello + parley + Masonry  │
   │  docs/030/031                 │      │  THIS DOCUMENT                     │
   │  browser owns text+IME+a11y   │      │  WE own text+IME+a11y              │
   └──────────────────────────────┘      └────────────────────────────────────┘
```

The contract joining them is `EditorDocumentSnapshot` (`core/model/model.ts:305`) — the same JSON-serializable shape the reader (docs/028) and the host already consume. On the browser side it crosses an FFI seam and is read per-frame as a window slice (031). On the desktop side there is no seam: the view calls into the linked core directly and reads the model with ordinary function calls. The lossless format (§7) is a *file* on top of this contract, identical for both views because it is a core/format concern, not a view concern.

The single most important structural fact: **the two views share zero view code and that is correct.** The browser view is intrinsically `contenteditable`/EditContext/DOM/React; the desktop view is intrinsically a painted canvas. What they share is the model and everything above it that is not pixels. Trying to share view code (a cross-platform widget abstraction) would be the mistake — it would force both views to the lowest common denominator and re-introduce exactly the "fighting a framework" the desktop direction is meant to escape.

## 3. Current-State Findings

### 3.1 What The Editor Is Made Of (Core vs View, Measured)

Measured against the current tree:

- `packages/editor/src/core/**` ≈ **14.6k LOC**, framework-free by lint. Breakdown: `commands/` 3.2k, `store/` 2.8k, `table/` 1.6k, `registry/` 1.3k, `model/` 1.2k, `offset-model/` 0.8k, `compat/` 1.1k (deletable), `bake/` 0.7k, and a ~1.8k top-level residual whose largest file is `scheduler.ts` (819 LOC — the rAF/idle/timer lane coordinator), then `markdown-shortcuts.ts` (392), `editor-handle.ts`, `virtual-range.ts`, `dev-flags.ts`, `url-safety.ts`, plus `memory/` and `index`. **This is the reuse — but "framework-free" is not the same as "runtime-free":** the model/command/read hot path is synchronous, yet `scheduler.ts` (rAF/idle/timer cadence), `bake/bake.worker.ts` (a Web Worker), and the async `store/body-store.ts`/`store/history-pool.ts`/`bake/bake-service.ts` are browser/async-coupled today and are *prerequisite relocation work* for the port (§4.10). It ports under docs/031 once that relocation is done; it is consumed by both views.
- `packages/editor/src/view/**` ≈ **24.3k LOC**, React + DOM + EditContext, with 38 files touching the DOM directly. Breakdown: `chrome/` 5.4k, `spi/` 4.1k, `controllers/` 3.0k, `nodes/` 2.7k, `overlays/` 2.5k, `render/` 2.3k, `markdown/` 1.4k. **None of this ports.** The desktop view is a from-scratch second implementation of it on native primitives — mechanical for box-model components, real design for selection, tables, and overlays (§5.3).
- `vendor/editcontext-polyfill/**` ≈ 9 modules — the hidden-`<textarea>` bridge. **Deleted on the native path** (§4.5).

The ratio matters for honesty: the desktop app is roughly a 24k-LOC-equivalent view rewrite plus the desktop half of the 031 core port. The core reuse is what makes that rewrite "a second view," not "a second editor," but it is still the bulk of the work and §5 is the honest map of which parts are mechanical, which are hard, and which simply disappear.

### 3.2 What The Browser Was Doing For Us For Free

The native difficulty is concentrated where the browser fused five separate jobs into `contenteditable` + CSS and handed them over invisibly. Naming them is naming the work:

- **Text layout** — shaping, bidi, line-breaking, caret geometry, hit-testing. Native home: `parley`.
- **Paint** — boxes, borders, gradients, glyph runs. Native home: `vello` (on `wgpu`).
- **Box layout** — flex/grid/block. Native home: `taffy`.
- **Accessibility tree** — roles, ARIA, screen-reader semantics. Native home: `accesskit` (the *tree* only; behavior is ours — §5.4).
- **Input + IME** — keystrokes and composition. Native home: `winit` IME events (§4.5).

`VENDOR.md` in `vendor/editcontext-polyfill/` is explicit that the engine already owns "pointer selection, caret/selection painting, shortcut handling, and browser-selection suppression." That sentence is the key to §5: the things we already own port as logic; the things the browser owned are the new work; and the EditContext bridge — which exists only to get IME into the model without a real `contenteditable` — has no native counterpart and needs none.

### 3.3 The Native-Rust Stack That Exists Today

These are not aspirational; they exist and the Rust GUI ecosystem is converging on them (vello + parley + wgpu + taffy is the common substrate of Masonry, Xilem, Blitz, and Dioxus-native). Maturity is alpha-to-young in 2026, which §4.2 deliberately designs around.

| Concern | Crate | Role | Maturity (2026) |
| --- | --- | --- | --- |
| Window + input + IME | `winit` | OS window, events, IME (`Ime::Preedit`/`Ime::Commit`, `set_ime_cursor_area`) | solid, ecosystem standard |
| GPU | `wgpu` | Vulkan/Metal/DX12 abstraction | solid; we rarely touch it |
| 2D paint | `vello` | canvas-like `Scene` (`fill`/`stroke`/glyph runs), PostScript model | good; the "~120fps" headline is a *typical-scene* number — vello's GPU tessellation cost scales with path/glyph count per frame, so a dense page is a much heavier scene than the demos (virtualization bounds it — §5.3, §9; the spike's small scene does not exercise it — §8) |
| Text layout | `parley` | rich text layout + `parley::editing` (cursor, selection, AccessKit) | young, the linchpin |
| Box layout | `taffy` | flex/grid/block, driven by Rust `Style` structs (no CSS) | solid (used by Zed, Bevy, Dioxus) |
| Accessibility | `accesskit` | accessibility *tree* schema + platform adapters | tree schema solid; **adapters uneven** — Windows (UIA) and macOS (NSAccessibility) battle-tested, Linux **AT-SPI2 historically the laggard** (§9), the same platform-specific caveat this doc gives winit IME on Wayland/X11 |
| Widget convenience | `masonry` | retained widget tree on vello+parley+taffy+accesskit; runs event/update/layout/compose/paint/a11y passes and *centralizes* focus, pointer, and a11y handling | alpha; opinionated about its internals — **and pre-1.0, so every 0.x bump is a forced-maintenance event (a churn axis distinct from the one-time ejection cost — §4.2, §10 Q1)** |
| Overlay positioning | `floating-ui-core` (RustForWeb) | flip/shift positioning math, no platform logic | a real port of Floating UI — but **community-maintained (RustForWeb), a bus-factor to weigh**, not a first-party upstream like taffy/accesskit |

The substrate above is the "converging" stack (§3.3's opening claim). Three more crates are load-bearing dependencies the decisions below lean on but which never appear as substrate — inventoried here so §3.3 is the whole stack, not a partial one:

| Concern | Crate | Role | Maturity (2026) |
| --- | --- | --- | --- |
| Glyph rasterization | `swash` | outline → pixels, consistent across OSes (D4, §4.4) | young; moves with parley (same ecosystem) |
| Font enumeration + fallback | `fontique` | system-font discovery and the pinned fallback chain (D4, §4.4) | young; **the mitigation crate for §9's "big one," font-fallback divergence** — so its own maturity is load-bearing for that risk |
| i18n / RTL / collation | `icu4x` | Unicode segmentation, bidi, collation wired into text (D7, §4.7) | solid but large; we take only what we wire |
| Native compute offload | `rayon` | data-parallel host threads for bake/parse (D10, §4.10) | solid; **native host only — never in the wasm core's dependency tree** |

Reference-not-dependency: **GPUI** (Zed's framework) and **Blitz** (Dioxus's HTML/CSS engine) are read for technique — how they host custom-painted widgets, cache glyphs, wire per-platform IME — but adopted as frameworks they re-introduce the coupling §4.2 rejects.

## 4. Architecture Decisions

### 4.1 D1 — Reuse The Core, Rewrite The View (Two Front-Ends, One Spine)

Recommended: treat the core as the shared spine and the desktop view as a second, independent implementation of the view contract. Share the model and everything framework-free above it; share **no** view code.

The reasoning: the core is already the seam (3.1). The browser view and the native view are intrinsically different surfaces (DOM vs painted canvas), so a shared cross-platform view abstraction would be a third thing both views fight, not a saving. The snapshot contract (`EditorDocumentSnapshot`) makes the two views interchangeable at the data layer and parity-testable against each other (same snapshot in → same render intent), which is what keeps "two views" from meaning "two divergent editors."

Rejected — a cross-platform UI layer both views render through: it forces the lowest common denominator, cannot express the browser's `contenteditable` strengths or the native canvas's control, and is exactly the framework-coupling §4.2 exists to avoid. Rejected — fork the core per target: it discards the single biggest asset (one tested model) and inflates the parity surface; the core is framework-free precisely so it does not need forking.

### 4.2 D2 — Stack 2: Own The Linebender Primitives, Not A Framework

Recommended: build on the linebender primitives directly (winit/wgpu/vello/parley/taffy/accesskit), using Masonry only as a thin, **ejectable** widget convenience. Do not adopt a heavy opinionated framework (GPUI, Blitz, or a webview) as the foundation.

The user's stated criterion is "don't fight a lib in the long run," and the consistent answer to that criterion is ownership: a thin stack of primitives you control cannot impose lifecycle, dataflow, or styling opinions on you, and when one piece breaks (these are alpha) the blast radius is bounded. Masonry fits not because it is internally trivial — it is *not*; its own current docs say it "is opinionated about its internals: things like text focus, pointer interactions and accessibility events are often handled in a centralized way" — but because it sits on the *same* primitives we would use raw (vello/parley/taffy/accesskit), so adopting it does not lock us into a proprietary rendering or text engine the way GPUI would. The honest ejection cost follows from that opinionatedness, and the split is worth stating plainly: ejecting Masonry means re-deriving its centralized focus/pointer/a11y orchestration on the raw primitives — real work, not "an afternoon." What *survives* ejection is the cheap part (our vello/parley leaf `layout`/`paint` bodies — §6.1's mechanical category); what we rebuild is the expensive part (the centralized focus/pointer/a11y passes and Widget scaffolding every retained-mode toolkit carries). So "ejectable" is true in *kind* — we keep the substrate — but modest in *value*. The stance (own the substrate, treat the convenience layer as replaceable) holds; what does not hold is any claim that Masonry is thin enough to drop trivially. The framework alternatives fail the criterion for *different* reasons, and it matters not to conflate them: GPUI is a foreign rendering model — its own GPU paint and its own code-editor-shaped text system, sharing only taffy — so ejecting it rewrites paint and text, not just orchestration; Blitz is *not* foreign primitives (it is built on the same vello/taffy/parley — see §4.9), but it adds a CSS/Stylo authoring layer we do not want and provides no editing surface. Both are less ejectable than Masonry, GPUI on the foreign-engine axis and Blitz on the unwanted-layer axis; their value-adds (GPUI's batteries; Blitz's CSS engine) are things we either do not need or actively want to own.

Rejected — GPUI as the foundation: proven for an editor (Zed) and Tailwind-shaped, but Zed-coupled, single-vendor for its component library, and its text system is code-editor-shaped (the line-height limitation, §4.4). Keep it as reference. Rejected — Blitz/Stylo as the foundation: see §4.9. Rejected — a webview (Tauri/Electron/wry): re-imports the browser's weight and the native↔JS boundary the whole effort escapes; it is the option to actively rule out, not merely decline.

### 4.3 D3 — The Altitude Ladder: A Different Rung Per Surface

Recommended: there is no single altitude. Pick the rung per surface — own the editor canvas at the rawest level (where control matters), ride Masonry for ordinary chrome (where it does not).

```text
winit       window + raw input          → touch thinly, always
wgpu        the GPU                      → essentially never touch directly
vello       2D Scene (canvas-like)       → ONLY for surfaces we custom-paint
parley      text layout                  → the editor canvas (line-height lives here)
taffy       flex/grid layout             → Rust Style structs, NOT CSS
accesskit   accessibility tree           → feed it a tree
─────────────────────────────────────────
masonry     retained widget tree         → the "simplified API" that is STILL Stack 2 and ejectable
```

| Surface | Rung | Why |
| --- | --- | --- |
| Editor canvas (text, caret, selection, gap cursor, decorators) | raw `parley` + `vello` | Own it fully; the line-height control (§4.4) and selection geometry (§5.3) live here |
| Chrome (toolbar, menus, dialogs, panes) | `masonry` widgets | Ejectable convenience; do not rebuild button/focus/scroll/layout from zero |
| Overlay positioning (slash menu, link popover, comment affordance) | `floating-ui-core` | Pure positioning math, explicitly platform-agnostic (Native is a documented target, not web-only); the same algorithm family as the floating-ui we use on the web, ported to Rust |
| Accessibility | `accesskit` | No alternative; Masonry already wires it |
| Styling | our own theme structs | = re-expressed daisyUI tokens (§4.8), owned |

vello is not low-level GPU: its `Scene` API (`Scene::fill`, `Scene::stroke`, glyph runs) is the same PostScript/canvas model that powers SVG and the browser `<canvas>`. "Playing with vello" means drawing like canvas, on the one surface where we want the control, not writing shaders. The genuinely fiddly part — the wgpu surface setup to render a scene — is done once by the shell and never touched again.

### 4.4 D4 — Own The Text Stack (parley) For Determinism And Line-Height

Recommended: own text layout via `parley` (the lean — the engine choice is the one open sub-fork, §10 Q10) + `swash`/`fontique`, and **bundle the editor fonts**, so metrics and line-breaking are deterministic across macOS/Windows/Linux and the line box is *our* decision.

This decision is forced by two facts. First, the user's concrete frustration — you cannot control line height in Zed — is real and diagnostic: GPUI's text system is code-editor-shaped (line height derived from font metrics, uniform per buffer), which is wrong for a document editor with mixed sizes and CSS-like line-height-per-block. parley lets us own the line box, so line-height is a per-block property we set. Second, the alternative (deferring to OS text engines — CoreText/DirectWrite/FreeType) makes the *same document wrap and space differently per OS*, which is unacceptable for a product that also renders the same documents in a browser editor and a reader.

The gotchas this decision accepts and must plan for (§9): **font-fallback divergence** is the big one — a CJK or emoji glyph with no glyph in the primary font resolves to a different fallback per OS, with different metrics and therefore different wrap points; the only real fix is bundling fonts or pinning the fallback chain. Self-rasterization (swash) is consistent but renders "non-native," which macOS users notice; routing rasterization per-OS buys native look at the cost of pixel parity. Fractional DPI scaling (Linux/Windows) must be handled via winit's `scale_factor`. And the line-height box model (CSS half-leading vs baseline-to-baseline) is something we must *define and implement*, not inherit.

Rejected — GPUI's built-in text for the editor surface: re-imports the line-height limitation that motivated the whole choice. (GPUI's text is fine for chrome, where uniform line height is correct — but the editor canvas is parley regardless of the chrome choice.) Rejected — defer to OS text engines: non-deterministic across the three targets and the browser, defeating cross-render parity.

The text engine itself is the one sub-fork this decision leaves open: **parley vs cosmic-text** (§10 Q10). parley is the lean — same linebender org as vello (shared glyph types, least integration friction) and an editing module that is actively maturing — but cosmic-text (System76, shipping in the COSMIC desktop and the Iced/glyphon stack) is more battle-tested on *editing today*: a real `Buffer` with cursor, selection, and IME in a shipping product. At our block-leaf granularity the two do the same job identically (shape a rich run, break to a width, cursor rect for an offset, selection rects for a range, hit-test a point to an offset), so the leaf-layout seam should stay engine-swappable until the spike picks one — it is a fork to settle, not a closed choice.

Rejected — Qt `QTextLayout` (the low-level layout primitive, not `QTextDocument` — paint with `QPainter`, ignore Qt's document model): it is the lone *mature*, non-alpha stack that still lets us own the line box, and the only honest answer to "is there a settled alternative to parley that keeps text ownership." It loses anyway — a C++ framework marriage, a Qt↔Rust FFI seam that re-creates the boundary the Rust-native path deletes, and Qt licensing — all to escape parley's alpha. Named so the question is closed rather than left hanging.

### 4.5 D5 — Delete EditContext; Talk To The OS IME Directly

Recommended: on the native path, there is no EditContext and no hidden textarea to mimic. The input path is **winit IME events → the existing core command compilers**. Delete the polyfill concept entirely.

`VENDOR.md` describes the polyfill as a "hidden-`<textarea>`-in-shadow-root bridge that translates keystrokes/IME into EditContext `textupdate`/composition events." It is an IME *plus* keystroke *plus* focus bridge — its `input-translator.ts` remaps Ctrl+Backspace/Delete and handles Telex/IME regressions, and its `focus-manager.ts` does blur guards and `activeElement` patching. But the one job with *no* native counterpart is the IME target: the browser will not surface IME composition without *some* focused editable element, which is the reason a hidden-editable bridge has to exist at all. Natively that one reason evaporates — the OS IME talks to us directly through winit — and the keystroke/focus work does not vanish so much as relocate to our own input and focus model (the mapping below). The mapping is one-to-one:

| EditContext / polyfill | Native (winit) |
| --- | --- |
| `textupdate` (commit) | `Ime::Commit(text)` → `dispatch(ReplaceSelection(text))` |
| `compositionstart`/`update` + preedit | `Ime::Preedit { text, cursor }` → render marked text ourselves |
| `updateControlBounds` / `updateSelectionBounds` | `Window::set_ime_cursor_area(pos, size)` |
| `characterBoundsUpdate` | computed from parley, fed to `set_ime_cursor_area` |
| `beforeinput` inputType (`insertText`, `delete*`) | winit key events → `core/commands` compilers |
| hidden-textarea focus sink + focus-manager | gone — focus is our own model concept |

This is the single largest *simplification* of the whole port: it deletes ~9 vendored modules and, with them, an entire hazard class — the mobile-keyboard-flicker epic and the focus-restore caret-loss bug were both `contenteditable`-host-lifecycle artifacts that cannot exist when there is no OS-owned editable element to destroy on unmount (§5.1).

The honest caveat is *who wires the IME plumbing*. On raw winit, we handle IME events ourselves; winit's IME is lower-level than EditContext and has historical platform gaps (Wayland/X11, and fewer advanced features like reconversion). parley's editing module is designed to consume compose regions, so parley + winit IME is the intended pairing. (GPUI, by contrast, implements per-platform IME itself — a real point in its favor we are choosing not to take, accepting the winit IME burden as the price of ownership; §10 Q4 keeps this open.)

Rejected — port the polyfill to Rust / mimic a hidden textarea: it reproduces a browser workaround that has no reason to exist natively, and re-introduces the focus-sink hazard class we are deleting.

### 4.6 D6 — Caret And Selection Are Already Ours; Native Is Easier Here

Recommended: paint the caret, selection rectangles, gap cursor, and node-selection outline ourselves from the model — which is what we already do today — using parley for the geometry and vello for the fill. This surface is *easier* native than in the browser, not harder.

We already own caret/selection painting (`VENDOR.md`), today fighting `contenteditable` and reading DOM `Range` rects. Natively we remove the middleman: parley's editing module hands us the cursor rect for a model offset (including last-line and RTL/affinity, mapping onto our `TextPoint.assoc`) and the selection rectangles for a range; we draw them with `Scene::fill`. The **gap cursor** (`GapSelection` between blocks) is not a text caret at all — it is a UI affordance between block boxes, drawn at the gap's layout-y; natively this is trivial because we control the whole paint pass. The only thing lost-for-free is the system caret blink, which is a timer.

Rejected — lean on a toolkit's built-in text-field caret: it cannot express the gap cursor, node selection, or cross-block selection the model defines; the editor's selection model (`EditorSelection`: text/node/gap) is richer than any text-field's and must be painted from the model.

### 4.7 D7 — react-aria Decomposed: What Has A Rust Home, What Does Not

Recommended: stop treating "react-aria" as one thing. It is five jobs; two have real Rust homes, the valuable third does not, and the loss is *concentrated in the chrome*, not the editor.

| react-aria job | Rust home? | Notes |
| --- | --- | --- |
| ARIA semantics / screen-reader tree | yes — `accesskit` | The standard; Masonry/egui/Bevy already use it |
| Overlay positioning (anchor/flip/shift) | yes — `floating-ui-core` | A real Rust port; pure positioning math |
| Interaction behavior (focus mgmt, roving tabindex, keyboard nav, selection, dismissal, press/hover/drag, collections) | **no** | No headless Rust library exists; rebuild, or inherit from a toolkit's widgets |
| i18n / RTL / collation | partial — `icu4x` exists, we wire it | |
| The composable headless-hook pattern itself | no | Rust toolkits fuse behavior+widget; there is no Radix-style decomposition |

The reframe that bounds the cost: **the editor's hard interactions are already our own controllers, not react-aria** — `use-drag-selection`, `use-gap-cursor`, `use-focus-navigation`, `use-touch-selection`. Those port as *logic*. react-aria lives in our *chrome* (menus, dialogs, toolbar, listbox, combobox, tabs, tooltips, pickers — the `@idco/ui` primitives). So the loss is the chrome's interaction behavior, and that is exactly the slice a component library can give back: Masonry's widgets arrive already behaving (focus, keyboard, dismissal), and we restyle them. We do not rebuild react-aria's focus engine for a menu; we restyle a menu that already has one. The editor-owned dismissal policy (note.md §2, docs/029: "the editor decides to close, the overlay only reports") is expressed once over `floating-ui-core` and reused, which is the native form of the overlay SPI note.md §2 already wants to build on the web side.

Rejected — wait for or build a "react-aria for Rust": none exists, and building a general headless behavior+a11y library is a far larger project than this editor; the pragmatic path is accesskit for the tree, floating-ui-core for positioning, Masonry widgets for chrome behavior, and our own controllers for the editor's bespoke interactions (which were never react-aria).

### 4.8 D8 — daisyUI Becomes A Theme-Token Struct We Own

Recommended: re-express the daisyUI design tokens (semantic colors, radii, spacing, the theme) as Rust theme structs that the editor canvas and the Masonry chrome both read. There is no daisyUI for Rust, and we do not want one — owning styling is a stated goal.

In raw Stack 2 and in Masonry there is no CSS engine; layout is `taffy::Style` and styling is theme structs. This is *more* direct than driving a CSS-string engine, and it is exactly the ownership the user asked for. Concretely, the token surface mirrors what gpui-component already proves is sufficient (`theme.primary`, `theme.background`, `theme.foreground`, `theme.surface`, `theme.border`, `theme.accent`, plus our editor-specific tokens — `caret`, `selection`, `callout_surface(tone)`, `callout_border(tone)`). Light/dark and any future themes are alternate instances of the same struct.

Rejected — adopt gpui-component's theme wholesale: it ties us to GPUI; we take the *shape* (semantic tokens) as reference and own the values.

### 4.9 D9 — Reject Blitz/Stylo And Any Webview

Recommended: do not adopt Blitz (or any HTML/CSS engine) as a layer, and do not adopt a webview under any name. The reasons are specific, not reflexive.

Blitz is *not* a browser-engine-doing-what-Rust-cannot — Blitz **is** Rust (Stylo, its CSS engine, is Rust; so are taffy/parley/vello). It is literally Stack 2's primitives wrapped in an HTML/CSS authoring API. So "use Blitz for a simplified API" means "the HTML/CSS front door to the same house," and it collides with both of this document's decisions:

1. It does not execute JavaScript, so **react-aria cannot run on it anyway** — the very thing one might reach for Blitz to preserve, it cannot preserve; interactivity comes from Dioxus (Rust), meaning the behavior is rewritten regardless. Blitz saves CSS, not behavior.
2. It does not provide an editing surface. Blitz is a renderer with a pluggable-widget layer, not `contenteditable`-grade rich editing. Building the editor on Blitz's pluggable widgets is the *same from-scratch editor work* as parley, on a younger, alpha base with an unproven editing story.

So Blitz removes neither the hard part (the editor) nor, given §4.8, anything we want (CSS authoring, browser layout-parity). Its one genuine value is **cross-engine layout parity** (Stylo is a real browser CSS engine, so a doc wraps identically in a browser editor and a Blitz-native editor) — kept as an open question (§10 Q3) only if pixel-identical cross-render wrap ever becomes a hard requirement. A **webview** is a harder no: it re-imports the browser weight and the native↔JS boundary the whole effort exists to escape.

Rejected — Blitz "just for chrome" with parley for the editor: this is the worst hybrid — two layout/paint/event models in one window, with the most important surface (the editor) hosted as a foreign painted region inside Blitz's alpha lifecycle. More fighting, on the worst surface. The "simplified-but-ownable" layer is Masonry, not Blitz.

### 4.10 D10 — The Core Is Runtime-Agnostic; Async Lives In The Hosts

Recommended: the shared core crate is **synchronous at its public API and has no async runtime dependency** — no `tokio`, no `wasm-bindgen-futures`, no executor. All async orchestration (worker offload, persistence I/O, debounced autosave, network) lives in **per-target host crates**: the wasm/browser host and the native/desktop host. This is the precondition for one crate serving both targets, and it is mirrored into docs/031 as a decision there.

The forcing fact: the desktop host wants `tokio` (the de-facto native async runtime), but a full-featured `tokio` does not work under `wasm32-unknown-unknown`. With the features a native host actually wants — `rt-multi-thread` and `net`, typically pulled in via `features=['full']` (tokio enables *nothing* by default; `full` is what bundles them) — it does not *build* for wasm; the wasm-compatible subset (`sync`/`macros`/`io-util`/`rt`/`time`) does compile but fails at *runtime* — the timers panic (`Instant::now` traps), there are no OS threads for a multi-threaded scheduler (the browser owns a single-threaded cooperative event loop), and the runtime has a history of breaking outright on that target. Either way a `tokio`-dependent core cannot ship to wasm, and a browser-futures-dependent core cannot run native. The only stable resolution is that the core depends on **neither**. The model/command/read *hot path* already has the right shape (synchronous state machine on the main thread, synchronous reads and commands — the shape docs/031 designs). But "the core is *already* runtime-free" is not yet true of the TypeScript tree: `core/scheduler.ts` drives lane cadence with `requestAnimationFrame`/idle/`setTimeout`, `core/bake/bake.worker.ts` is a Web Worker, and `core/store/body-store.ts`/`history-pool.ts`/`bake/bake-service.ts` are async. Making the core runtime-free is therefore *prerequisite work*, not a property to assert: the scheduler's pure lane/budget logic can stay shared, but its waking mechanism (rAF/idle/timer), the bake worker, and the async stores relocate to the per-target host. Async is a *host* concern by design; the port is what makes it one in fact.

How the core exposes work that wants to be async without importing a runtime:

- **Synchronous core, host-driven cadence.** The hot path (apply a command, read a window) is synchronous. The host decides *when* to call it (a `requestAnimationFrame` tick in the browser; a winit redraw/`tokio` interval natively). The core never spawns a task.
- **Pure compute as plain functions.** Bake/highlight, markdown parse, snapshot encode are `fn(input) -> output`. The host runs them where it wants: a Web Worker (browser) or a `tokio`/`rayon` thread (native). The core does not know which.
- **Cooperative long work via a step/poll interface, not futures.** If a long operation (bulk import, full re-bake) must yield, the core exposes a `step()`/`poll()` that does bounded work and returns progress, and the host drives it across frames or threads. This avoids `async fn` in the core entirely, which is what keeps it runtime-free.
- **Channels at the host boundary, runtime-agnostic.** Where a result must flow back from a worker/thread, use a runtime-agnostic channel (`std::sync::mpsc` natively; `postMessage` adoption in the browser host), never a `tokio` channel in shared code. If any shared async truly proves unavoidable, restrict it to the runtime-agnostic `futures` traits (`Future`/`Stream`) with no executor — but the default and strong preference is that the core has *no* `async` at all (see §10 Q5, which keeps "is any shared async truly needed?" open; the current answer is no).

Compile-target split: the wasm bindings (`wasm-bindgen`) live in the browser host crate behind `#[cfg(target_arch = "wasm32")]`; the native host links the same core crate plus its own `tokio`/`winit`/`vello` dependencies behind `#[cfg(not(target_arch = "wasm32"))]`. The core's `Cargo.toml` has neither in its dependency tree.

Rejected — pick one runtime (tokio) and polyfill it on wasm (`tokio` with the `rt` feature only, or `wasm-bindgen-futures` shims): brittle, drags a large dependency into wasm for little benefit, and still cannot use tokio's threaded scheduler in the browser; the sync-core/host-async split avoids the problem instead of papering over it. Rejected — make the core `async` over a runtime-agnostic executor (`smol`/`async-executor`) embedded in the core: it couples the core to an executor's scheduling and complicates the synchronous hot path docs/031 depends on; async belongs to the host.

### 4.11 D11 — Reject Managed Cross-Platform Runtimes (React Native, Flutter)

Recommended: do not build the desktop view on a managed cross-platform runtime — not React Native, not Flutter. §4.2 and §4.9 cover Rust-native, Rust-frameworks, and webviews but leave this middle category unaddressed; it fails the same two tests every stack here is judged by, and naming the tests is the decision.

The two axes:

1. **Does the stack let us own the text/IME/selection paint, or hand us a platform text widget?** This is the thesis (§4.4/§4.5/§4.6) — line-height per block, caret/selection painted from the model, the OS IME spoken directly.
2. **How thick is the model→view seam?** The desktop win (§1) is that the Rust core links *directly, no seam*. Anything that re-imports a managed-runtime boundary throws that win away and re-creates docs/031's FFI-read cost in a new place.

**React Native fails both, and the obvious objection is the wrong one.** The instinct that kills RN is "no `contenteditable` equivalent" — but that does not apply here, because the browser editor never used `contenteditable`: it is already a painted-from-model canvas (read-only styled spans, EditContext as the IME target, caret/selection painted in an overlay from model geometry). So the contenteditable objection is moot, and RN fails on the *other* axis, harder. With the model staying in Rust and the canvas self-painted (RN's `<TextInput>` is useless to a block editor, so we would paint on RN-Skia), RN's real shape is **Rust model → JSI bridge → JS runtime + GC → a Skia canvas we hand-paint**: a JavaScript layer wedged between the Rust core and a canvas we draw from scratch, contributing none of its widget value and re-importing the exact native↔JS boundary this effort exists to delete. It is a heavy way to acquire a window and an event loop.

**Flutter passes axis 1 but loses the long-run criterion.** Flutter owns its renderer and text engine, so line-height-per-block is expressible — it is the one managed runtime that *could* satisfy the ownership thesis. It is rejected for three reasons: the user's first-hand objection that Impeller's animation engine and frame pacing are weak, which a document editor's scroll/caret/selection feel exposes directly; it is the heaviest framework marriage on the table, imposing its widget tree, lifecycle, and dataflow wholesale — the precise thing §4.2's "don't fight a lib in the long run" rejects GPUI for, only more so; and with the core staying Rust it forces a Dart↔Rust FFI seam (a thin synchronous C-ABI via `dart:ffi`, better than RN's bridge but a seam the Rust-native path does not have).

What this forces: with **core-in-Rust plus a self-painted canvas**, the stack question is not Rust-vs-managed at all — it is *intra-Rust* (§4.2's primitives, with the text-engine sub-fork at §4.4 / §10 Q10). Managed runtimes are off the table — RN gives nothing and costs the seam; Flutter gives ownership but at a framework marriage and an animation/perf cost already lived and rejected.

Rejected — React Native (or any JS-runtime UI): fails both axes; re-imports the JS boundary the native target deletes and contributes no widget value to a self-painted editor. Rejected — Flutter: passes the ownership axis but loses on the framework-marriage criterion, the Dart↔Rust seam, and a first-hand perf/animation objection.

## 5. The Port Map: Reused, Rewritten, Deleted, Simplified

This is the honest answer to "what is hard or impossible to port from the view layer?" The surprising thesis: most of the *hardest* machinery is browser-fighting that gets deleted or simplified; the genuine new costs are things not usually feared (accessibility, layout parity).

### 5.1 Evaporates — Browser-Only Hazards We Delete

- **The EditContext polyfill** (`vendor/editcontext-polyfill/**`) and its focus-manager — replaced by winit IME (§4.5).
- **Focus-restore-after-virtualization caret-loss** (the B3 consumer bug): natively the caret is model state we paint; unmounting an offscreen row cannot destroy an OS editable because there is none.
- **Mobile-keyboard flicker** (cross-block backspace destroying the per-block EditContext host): a `contenteditable`-lifecycle artifact, gone.
- **Browser-selection suppression**: there is no native browser selection to fight.

These are not ported and not reproduced — they cease to exist. Two of the editor's hardest historical bug classes are browser-boundary artifacts that the native target simply does not have.

### 5.2 Ports Cleanly — Already Framework-Free

- `OffsetModel` / `TreapOffsetModel` / `BlockEstimator` / `reconcileOffsetModel` (`core/offset-model/**`) — the virtualization *algorithm* ports with the core, untouched (its measurement *source* changes — §5.3).
- The data side of resting/living — `bake`, snapshot, reader dispatch — is core + reader, already RSC-safe (docs/028).
- Marks, `segmentText`, command compilers, step/inverse algebra, the table model (`core/table/**`, 1.6k LOC) — all framework-free; they are docs/031's adaptation targets and serve both views.

### 5.3 Changes Shape — The Real Rewrite

- **Virtualization measurement source.** Today: render block → browser lays out → measure post-`fonts.ready` → `estimator.observe` + `offsetModel.setHeight` → reconcile (async, eventually-correct, racey — `use-virtual-window.ts`). Native: parley/taffy compute a block's height *synchronously* as part of layout, so the height is known before paint — no `ResizeObserver`, no async settle, no estimate-then-correct race. The treap still earns its keep for O(log n) prefix sums on a huge doc, and the estimator still seeds *unmeasured* blocks, but "measure" becomes a cheap off-screen parley layout, not a mount + observer round-trip. The fling/velocity gating (docs/025) becomes velocity-gated *layout*. This is a real re-architecture of the virtual-window controller onto a more deterministic substrate (§6.4).
- **The entire React tree → a native element tree.** `react-view.tsx`, all of `view/render`, `view/nodes/**`, `view/chrome/**`, `view/overlays/**`. None of React ports; this is the bulk of the 24k LOC. Mechanical for box components (callout, §6.1), real design for the hard ones.
- **Overlay authority (docs/029) + anchoring.** The geometry math ports, but the *source* of rects changes from `getBoundingClientRect` to our own layout tree (we laid every box out, so we know its rect). The "one authority owns the envelope" model survives; positioning is `floating-ui-core`.
- **Selection geometry across heterogeneous blocks.** We *have* the selection model (`EditorSelection`). The new work is turning a pixel `(x,y)` into a model point *across* text→object→gap, and painting selection rectangles across wrapped lines and object boxes. parley does it within a block; cross-block we assemble. This and the table are the two meatiest view rewrites.

### 5.4 Hard To Replace — The Honest Cost Centers

- **Accessibility.** The browser handed us the a11y tree free via real DOM + ARIA. Native is `accesskit`, where we build and sync the tree node-by-node against the model (headings, lists, tables, IME live regions). This is the single biggest "free in browser, real work native" item — bigger than any visible component, and ongoing (every node-view owns its accesskit contribution). Two subtleties the browser hid, both carried in §9: the tree is sourced from the **model** (whole-document), not the virtualized paint window, so a11y and paint diverge in what they materialize; and "free in browser" was already only *partly* free, because the browser's own offscreen-block virtualization already pruned its a11y tree — the native path inherits that design question rather than inventing it. accesskit's Linux AT-SPI2 adapter is also the weak platform, not an assumed-solid one (§9). §10 Q2 keeps the depth open.
- **Layout parity across engines.** parley's line-breaking will not be *identical* to the browser's. The same document can wrap at a different word in the native editor vs the browser editor — which matters because both run on the same documents, extending docs/028's byte-convergence concern into layout-convergence. The only native path to identical wrap is a real CSS engine (Blitz/Stylo), which §4.9 rejects for other reasons; §10 Q3 holds the tension.
- **IME long-tail** on raw winit (§4.5) — the advanced cases (reconversion, some platform candidate-window behaviors) that EditContext/GPUI handle and raw winit may not.

### 5.5 Nothing Is Impossible — Resting/Living Simplifies

There is no genuine blocker. The closest to a wall is pixel-identical browser-parity layout (achievable only by embedding a CSS engine). And the thing most feared — the **"living vs resting" model** — is *not* a blocker; it is partly a browser artifact. That split exists because `contenteditable` is heavy, so the *published* render uses a separate static path. Natively we are *always* drawing ourselves, so "resting" collapses to "the same render with the caret and handles turned off" — **one render path with an editable flag, simpler than the browser's two-surface split.** The desktop editor and a future native reader (docs/031 future backlog) would share that one path.

## 6. Code Sketches: React Today vs Native Rust Tomorrow

These are illustrative — pseudo-real, grounded in the actual crate APIs (vello `Scene::fill`/`stroke`, parley layout/cursor/selection, taffy `Style`, winit `Ime`, Masonry `Widget`, floating-ui `compute_position`) but not copy-paste-compilable. The point is to give a *semantic sense* of what each surface becomes.

### 6.1 A Callout Node-View

React today (representative of `view/nodes/callout/callout.tsx`):

```tsx
function CalloutView({ node, tone, children }: NodeViewProps) {
  return (
    <div
      data-engine-block={node.id}
      className={`flex flex-col gap-2 rounded-lg border p-4 ${toneClass(tone)}`}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertGlyph tone={tone} />
        <span>{toneLabel(tone)}</span>
      </div>
      {children /* child block flow, virtualized by the parent */}
    </div>
  );
}
```

Native Rust tomorrow (a Masonry widget — box model via taffy `Style`, paint via vello, tokens are ours):

```rust
struct Callout { tone: Tone, header: WidgetPod<Row>, children: WidgetPod<BlockFlow> }

impl Widget for Callout {
    fn layout(&mut self, ctx: &mut LayoutCtx, bc: &BoxConstraints) -> Size {
        // CSS box model, expressed as Rust structs — no CSS strings (D8)
        ctx.set_style(Style {
            display: Display::Flex,
            flex_direction: FlexDirection::Column,
            gap: length(8.0),
            padding: Rect::all(length(16.0)),
            ..Default::default()
        });
        ctx.run_layout(&mut [&mut self.header, &mut self.children], bc)
    }

    fn paint(&mut self, ctx: &mut PaintCtx, scene: &mut Scene) {
        let t = ctx.theme();                                  // re-expressed daisyUI tokens
        let box_ = RoundedRect::from_rect(ctx.size().to_rect(), 8.0);
        scene.fill(Fill::NonZero, ctx.transform(), t.callout_surface(self.tone), None, &box_);
        scene.stroke(&Stroke::new(1.0), ctx.transform(), t.callout_border(self.tone), None, &box_);
        // header (glyph + label) and children paint as child widgets
    }
}
```

The takeaway: the box-model component is an almost mechanical translation — the structure is the same, the styling is tokens, the paint is canvas. This is the *easy* category (§5.3).

### 6.2 The Editor Text Surface And Caret

React today (representative of `view/render/text-block.tsx` — the browser owns layout, EditContext binds the host, we paint caret in an overlay from DOM `Range` rects):

```tsx
function TextBlock({ node, marks }: { node: TextLeafNode; marks: ResolvedMark[] }) {
  // The browser owns shaping, line-breaking, caret geometry. We emit styled spans;
  // EditContext (native or polyfill) binds the host so the OS IME has a target.
  return (
    <p data-engine-block={node.id} className={leafClass(node.type)}>
      {renderMarkRuns(node.content.text, marks)}
    </p>
  );
}
```

Native Rust tomorrow (parley owns layout *and line-height*, vello paints glyphs, the caret/selection are ours):

```rust
fn paint_text_leaf(scene: &mut Scene, leaf: &TextLeafView, sel: Option<&Selection>, t: &Theme) {
    // parley owns shaping, bidi, line-breaking — and line-height, which is OUR
    // per-block decision, not the toolkit's (the Zed limitation; D4).
    let mut b = layout_cx.ranged_builder(&mut font_cx, &leaf.text, 1.0);
    b.push_default(StyleProperty::LineHeight(leaf.line_height));     // we own this
    for run in &leaf.mark_runs {                                     // bold/italic/code → style ranges
        b.push(run.style_property(), run.range.clone());
    }
    let mut layout: Layout<ColorBrush> = b.build(&leaf.text);
    layout.break_all_lines(Some(leaf.content_width));
    render_parley_glyphs(scene, &layout, leaf.origin, t.text);      // vello consumes positioned glyphs

    // OUR caret + selection — what we already paint today, minus contenteditable (D6).
    // The geometry lives on parley's editing types — PlainEditor::selection_geometry and
    // Selection::geometry/cursor geometry — not on Layout; shown via an editor handle here.
    if let Some(ed) = &leaf.editor {
        for (rect, _line) in ed.selection_geometry() {              // selection rectangles
            scene.fill(Fill::NonZero, leaf.transform(), t.selection, None, &rect);
        }
        if let Some(caret) = ed.cursor_geometry(1.5) {              // caret rect (width 1.5px)
            scene.fill(Fill::NonZero, leaf.transform(), t.caret, None, &caret);
        }
    }
}
```

The takeaway: this is where we *gain* — line-height control, deterministic layout, and the caret/selection are model-painted (the gap cursor and node-selection outline are the same pattern at the block level). It is also where the cost lives (selection geometry across blocks, §5.3).

### 6.3 The Input Path: EditContext vs winit IME

EditContext today (what the polyfill or native EditContext feeds the view):

```ts
editContext.addEventListener("textupdate", (e) => {
  // committed text from OS/IME over [updateRangeStart, updateRangeEnd)
  dispatch(replaceText(activeLeaf, e.updateRangeStart, e.updateRangeEnd, e.text));
});
editContext.addEventListener("compositionstart", () => beginComposition());
editContext.addEventListener("compositionend", () => endComposition());
editContext.updateSelectionBounds(caretRectInScreenSpace()); // where to put the IME popup
```

winit tomorrow (the OS IME talks to us directly — no EditContext, no hidden textarea; D5):

```rust
match event {
    WindowEvent::Ime(Ime::Preedit(text, cursor)) => {
        // composition in progress: render `text` as marked text at the caret;
        // `cursor` is the highlight range inside the preedit — we draw it ourselves.
        editor.set_composition(text, cursor);
    }
    WindowEvent::Ime(Ime::Commit(text)) => {
        editor.dispatch(Command::ReplaceSelection(text)); // SAME core command as the EditContext path
    }
    WindowEvent::KeyboardInput { event, .. } => editor.handle_key(event), // → core/commands
    _ => {}
}
// where to put the candidate window (≈ updateSelectionBounds):
window.set_ime_cursor_area(caret_pos, caret_size);
window.set_ime_allowed(true); // on focus
```

The takeaway: the same *core command* runs at the bottom of both paths; only the event source differs, and the native source is lower-level but more direct (no focus-sink, no shadow DOM).

### 6.4 Virtualization Measurement: ResizeObserver vs Synchronous Layout

React today (browser measures asynchronously; we feed the estimator + treap — representative of `use-virtual-window.ts`):

```ts
const ro = new ResizeObserver((entries) => {
  for (const e of entries) {
    const id = e.target.getAttribute("data-engine-block") as NodeId;
    // measured AFTER the browser laid the block out (post fonts.ready) — async, racey
    estimator.observe(metricsForNode(store, id), e.contentRect.height);
    offsetModel.setHeight(id, e.contentRect.height);
  }
  scheduleReanchor();
});
```

Native Rust tomorrow (we lay out, so the height is known synchronously, before paint):

```rust
fn height_of(block: &BlockView, content_width: f32) -> f32 {
    match block {
        BlockView::Text(leaf) => {
            let mut l = layout_text(leaf, content_width); // a cheap off-screen parley layout
            l.break_all_lines(Some(content_width));        // no mount, no ResizeObserver round-trip
            l.height()
        }
        BlockView::Object(obj) => obj.measured_height(content_width),
    }
}
// The treap (ported from core/offset-model, unchanged) still gives O(log n) prefix sums for
// the scrollbar; the estimator still SEEDS unmeasured blocks. But "measure" is now a synchronous
// function call, not an async DOM round-trip — the measure→reconcile race collapses (§5.3).
```

The takeaway: the algorithm is reused; the measurement source flips from async/eventual to synchronous/known, which removes a whole class of timing hazard.

### 6.5 An Overlay: react-aria Popover vs floating-ui-core

react-aria today (the `@idco/ui` popover, with the editor-owned dismissal heuristic threaded through):

```tsx
<Popover triggerRef={anchorRef} placement="bottom start" isNonModal
         shouldCloseOnInteractOutside={(el) => !isInsideEditor(el)}>
  <SlashMenu items={items} />
</Popover>
```

Native Rust tomorrow (positioning is the same library ported; dismissal is our editor-owned policy):

```rust
let pos = compute_position(
    anchor_rect, floating_size,
    ComputePositionConfig {
        placement: Placement::BottomStart,
        middleware: vec![flip(), shift()],
        ..Default::default()
    },
);
overlay.place_at(pos.x, pos.y);
// Dismissal/focus is OUR policy (docs/029: "the editor decides to close, the overlay only
// reports") — not a lib default. The note.md §2 overlay SPI, expressed once over floating-ui-core.
```

The takeaway: the positioning math has a real Rust home; the *policy* (focus is model-owned, the editor decides dismissal) is the thing we own once and reuse — the native realization of the overlay SPI note.md §2 already wants.

## 7. The Lossless Document Format (A Track That Ships Before Any Rust)

### 7.1 Why Markdown Export Is Lossy — A Projection, Not A Serialization

Markdown export is lossy *by design*, and the code documents exactly why (`view/markdown/transformers.ts:75` `MARKDOWN_LOSSY_MARK_KINDS`, `view/markdown/to-markdown.ts`):

- Marks markdown cannot carry are dropped to bare text: **underline, subscript, superscript, comment, glossary**.
- Objects export from their **baked fields only** (docs/006 §5.8); anything in live `data` beyond the baked snapshot is gone, and a genuine bake failure becomes a placeholder.
- Tables are dropped on paste-in (the structural-table build is deferred, docs/030); inline images keep alt text and lose markup; and **document settings, glossary/bibliography collections, node/mark `attrs`, and the character-id identity substrate** have no markdown representation at all.

The deep reason: **markdown is a projection of the model, not a serialization of it.** The owned model is strictly richer than CommonMark+GFM. True losslessness therefore requires either carrying the model itself or extending the syntax into a bespoke superset (which stops being markdown). The architecture already knows this — the lossless in-app format is the `EditorDocumentSnapshot`, used today for copy/paste (`view/markdown/native-clipboard.ts`, `application/x-idco-snapshot`).

### 7.2 Three Format Shapes

"A mode that is lossless on export" resolves to a *file-format* decision, with three clean shapes:

1. **Markdown + embedded fidelity block.** The file is human-readable markdown (portable, diffable, git-friendly, readable by any tool) plus a trailing fenced block carrying the model delta markdown could not represent. Plain readers ignore the block; idco reopens losslessly.

   ```markdown
   # My document

   Some **bold** prose with an underlined word and a glossary term.

   <!-- idco:snapshot v=1
   { ...EditorDocumentSnapshot, or just the delta markdown dropped... }
   -->
   ```

   MVP variant: embed the **full snapshot** (trivially, provably lossless). Optimization: embed only the **delta** (the lossy marks' ranges, object `data`, collections, settings, char-id runs) and reconstruct by merging the parsed markdown with the delta — smaller, no prose duplication, but it must re-anchor the delta onto re-parsed prose (the tricky part; defer).

2. **Snapshot is the native file.** The desktop app's native save *is* the `EditorDocumentSnapshot` (JSON, or the binary `rkyv` form docs/031 §7.6 wants). Markdown stays a lossy *export* action for sharing. Simplest and 100% lossless, but the on-disk file is not markdown.

3. **Strict-subset authoring mode.** A "CommonMark mode" that forbids creating constructs markdown cannot carry (underline, sub/sup, comment, glossary, rich objects). Lossless by never making the unrepresentable. Cheapest to build; lossless-by-amputation.

### 7.3 Recommendation And The Round-Trip Contract

Recommended: **ship shape 2 (snapshot-as-native-file) as the native desktop save format, and shape 1 (markdown + embedded full snapshot) as the portable "lossless markdown" export.** Shape 2 is the desktop app's `.idco` file — provably lossless, trivial, and exactly what docs/031's binary persistence produces. Shape 1 is the answer to "I want one portable markdown file that still round-trips," which is the thing people actually mean by "lossless markdown." Shape 3 (strict mode) is an optional editor *toggle*, useful for authors who want to guarantee plain-markdown output, but it is not the default and not the lossless mechanism.

The round-trip contract, pinned by a test in both directions:

- `snapshot → file → snapshot` is the identity for shape 2 (byte-stable JSON / binary).
- `snapshot → markdown+embedded → snapshot` is the identity for shape 1 (the embedded block restores everything the markdown projection dropped; a parity test asserts the reopened snapshot equals the original).
- `snapshot → markdown` (shape-1 markdown body alone, embedded block stripped) equals the existing lossy export, and the documented lossy set (`MARKDOWN_LOSSY_MARK_KINDS`) is unchanged — the embedded block is *additive*, so the human-readable projection does not change.

### 7.4 It Ships In TS Today; The Desktop Inherits It

The decisive property: this is a **core/format concern, not a view concern**, so it ships in `packages/editor` (and the reader) in TypeScript *before any Rust exists*, and the desktop app inherits it for free. It extends note.md §4.4 (export) rather than waiting on docs/035's native work. Sequencing-wise it is the cheapest, most independent, immediately-useful slice of this entire direction — which is why note.md tracks it as its own item (note.md §6).

## 8. The Spike — The Gate Before Commitment

Current problem: the native payoff is plausible but unproven, and the one load-bearing unknown is whether a parley editor canvas, hosted in a native window and fed by the OS IME, *feels* like a real editor — caret, selection, IME, line-height, and a restyled chrome popover all working together over the shared core.

Target behavior: the smallest slice that exercises every concern raised in this document at once.

- A `winit` + `vello` window rendering a handful of blocks (paragraph, heading, a callout) laid out by `parley`/`taffy` from a real `EditorDocumentSnapshot`.
- Editing one styled paragraph: type, select (drag across wrapped lines), place the caret, with **our** caret/selection painted from the model and **line-height set per block** (proving D4).
- The OS IME composing CJK text into the model through `winit` IME events → the shared core's `ReplaceSelection` command (proving D5), with the candidate window positioned via `set_ime_cursor_area`.
- One `Masonry`-driven toolbar restyled with the daisyUI token struct (proving D8 and the chrome-reuse half of D7).
- One `floating-ui-core`-positioned popover (a slash menu) with editor-owned dismissal (proving the D7 overlay policy).
- The shared core compiled and linked natively, round-tripping a snapshot identical to the TS core's for the same input (proving D1 and D10 — the core builds with no `tokio`/no browser in its tree).

Acceptance criteria:

- The canvas renders a real snapshot, edits it, composes IME text, and round-trips a snapshot byte-identical to the TS core's.
- Line-height is demonstrably per-block controllable (the Zed limitation is gone).
- The one risky seam — a parley/vello editor canvas hosted inside a Masonry/winit window — is proven to work, or its failure is documented with a redirect.
- A go/no-go note is written: does the native feel justify the second view, and is the parley-in-Masonry seam sound?

What a green spike deliberately does *not* prove — flagged so "the seam works" is not misread as "the stack is proven" when the go decision (§11) is made: vello's paint cost on a *dense* document (a handful of blocks never tessellates enough to stress it — measure a realistically long, text-dense page before trusting the perf rating, §9); accesskit on **Linux** specifically (the AT-SPI2 adapter is the weak platform, so run the a11y check on Linux, not only macOS/Windows, §9); and Masonry version-churn tolerance (the spike pins one Masonry version and proves hosting, not that upgrades stay cheap, §10 Q1). These are widen-the-spike-slightly items, not blockers — a denser test document, a Linux a11y pass, and a version-pin note — but leaving them implicit lets a passing spike overstate what it settled.

The spike is days-to-weeks, not the full editor. It answers the questions intuition gets wrong (does native rich-text editing feel right; does the chrome-reuse hold; does the core link cleanly without a runtime) before any large view rewrite begins. "Stay browser-only" remains a valid, planned outcome of a failed spike.

## 9. Edge Cases And Failure Modes

- **Font-fallback divergence (the cross-platform text gotcha).** Different OSes resolve a missing glyph to different fallback fonts with different metrics, so the same paragraph wraps differently per platform. Mitigation: bundle the editor fonts or pin an explicit fallback chain (§4.4). Failure mode if ignored: silent layout drift across macOS/Windows/Linux and against the browser editor.
- **Layout parity vs the browser editor.** parley will not wrap identically to the browser. The same document can break lines at a different word in the two editors (§5.4). Mitigation: accept the divergence, or — only if a hard requirement — reconsider Blitz/Stylo (§10 Q3). User-visible behavior: a doc authored in one editor reflows (not corrupts) in the other.
- **vello paint cost scales with scene complexity.** The "~120fps" figure (§3.3) is a typical-scene number; vello's GPU tessellation cost grows with the path and glyph count submitted per frame, so a long, text-dense page is a much heavier scene than the demos. Mitigation: virtualization already bounds the on-screen glyph/path count to the visible window (§5.3), which is what makes this a non-issue in practice — but the spike's small scene (§8) never tessellates enough to stress it, so the perf rating stays unproven until a realistically dense document is measured. Failure mode if virtualization is ever bypassed (e.g. a print/export-to-one-page path): frame time balloons on large documents.
- **IME long-tail on raw winit.** Advanced IME (reconversion, some candidate-window behaviors) that EditContext/GPUI handle may be missing on raw winit/Wayland. Mitigation: parley editing module integration; fall back to platform-specific handling or reconsider GPUI for the surface (§10 Q4). Failure mode: a specific CJK IME workflow misbehaves on one platform.
- **Accessibility completeness.** accesskit gives the plumbing; an incomplete tree means a degraded screen-reader experience. Mitigation: every node-view owns its accesskit contribution from the start, not bolted on (§5.4, §10 Q2).
- **The a11y tree vs virtualization.** Virtualization only lays out and paints the visible window (§5.3), but a screen reader navigates the *whole logical document*, not just what is on-screen — so the accesskit tree cannot be sourced from the virtualized paint tree. Resolution: build the accesskit tree from the **model** (always whole-document and cheap — structure and text already live in `EditorDocumentSnapshot`), decoupled from the virtualized layout, and fill per-node geometry lazily only for nodes actually on-screen. This is a real architectural fork — the a11y tree follows the model, the paint follows the window — not a detail (§10 Q2). It is **not** a purely new native cost: the browser editor already virtualizes its DOM (offscreen blocks collapse to placeholders), so its a11y tree was *already* incomplete under virtualization; the native path inherits the same question but must answer it explicitly because there is no DOM answering it implicitly. Failure mode if ignored: only on-screen blocks reach the screen reader, so the document is unnavigable past the viewport.
- **accesskit platform-adapter maturity (Linux).** accesskit's tree schema is solid, but its platform adapters are uneven: the Windows (UI Automation) and macOS (NSAccessibility) backends are battle-tested; the Linux AT-SPI2 backend has historically lagged (§3.3). Mitigation: treat Linux a11y as a spike-verified item, not an assumed-solid one — the same platform-specific diligence the doc applies to winit IME on Wayland/X11 (§4.5). Failure mode: a degraded screen-reader experience specifically on Linux while Windows/macOS are fine.
- **tokio/wasm runtime leak.** If any dependency drags `tokio` into the core crate, the wasm build breaks. Mitigation: the core's `Cargo.toml` forbids runtime deps; a CI job builds the core for `wasm32-unknown-unknown` to catch a leak (§4.10).
- **DPI / fractional scaling.** Unhandled `scale_factor` (Linux/Windows fractional scaling) blurs text. Mitigation: handle winit `ScaleFactorChanged` and lay out in physical pixels.
- **Lossless embedded-block drift.** In shape-1 full-snapshot embedding, the markdown body and the embedded snapshot can disagree if an external tool edits the markdown. Mitigation: on reopen, the embedded snapshot is authoritative and the markdown body is re-derived from it (the body is the projection, the block is the truth); document this so external edits to the body are understood to be advisory until the delta variant lands.
- **Two-view drift.** A model change that updates one view's render but not the other diverges the two editors. Mitigation: the snapshot-parity test (same snapshot → same render intent) that already guards editor↔reader convergence (docs/028) extends to editor↔desktop.

## 10. Open Questions And Discussion

We are early here; these are first-class design forks to settle before the large view rewrite, not afterthoughts.

- **Q1 — Masonry vs fully-raw chrome.** Start chrome on Masonry (ejectable convenience) or hand-roll on vello+parley+taffy from the start (maximum ownership, more plumbing)? The editor canvas is raw either way. Lean: start on Masonry, eject per-widget if it chafes — but its alpha status (§3.3) is real and Q1 is where we decide our tolerance for it. The alpha risk has *two distinct axes* the ejection analysis (§4.2) conflates: the one-time cost of *ejecting* Masonry, and the ongoing cost of *staying* on it — a pre-1.0 project with a history of large API rewrites means every 0.x bump is a forced-maintenance event, a recurring tax ejection pricing does not capture. The spike (§8) proves Masonry can host a parley canvas; it says nothing about churn tolerance. So Q1 must weigh both, and should decide whether to pin a Masonry version for the spike's duration rather than track its tip.
- **Q2 — Accessibility depth and timing.** How complete must the accesskit tree be for the MVP, and is a11y a per-node-view obligation from day one or a later pass? It is the biggest "free in browser" cost (§5.4); under-scoping it early is the classic trap, but fully wiring it before the canvas works is premature. It carries a structural sub-fork surfaced in §9: the accesskit tree must be sourced from the **model** (whole-document), not the virtualized paint window, so the a11y path and the paint path diverge in what they materialize — deciding how much per-node geometry accesskit needs before it forces layout of offscreen blocks is part of scoping Q2. And the Linux AT-SPI2 adapter (§3.3, §9) is a platform-specific unknown to *verify in the spike on Linux*, not assume from the "solid" tree-schema rating.
- **Q3 — Layout-parity requirement.** Is pixel-identical wrap across the browser editor and the native editor ever a hard product requirement? If yes, it reopens Blitz/Stylo (§4.9) despite its other costs. If no (the current lean), we accept reflow-not-corrupt divergence and own parley's line-breaking.
- **Q4 — IME ownership: raw winit vs borrowing GPUI's approach.** Accept the raw-winit IME burden (ownership, some platform gaps) or adopt GPUI *for the editing surface* to inherit its proven per-platform IME (at the cost of GPUI coupling on the most important surface)? The spike (§8) should stress CJK IME specifically to inform this.
- **Q5 — Any shared async at all?** §4.10's current answer is "no async in the core." Is there a genuine case where shared async is unavoidable (e.g. a streaming import the core must drive)? If one appears, the fallback is runtime-agnostic `futures` traits with no executor — but we should not adopt that speculatively. Settle by finding (or failing to find) a real case.
- **Q6 — Lossless format: full-snapshot vs delta embedding.** Ship shape-1 with the full snapshot embedded (simple, provably lossless, larger files, possible body/blob drift) and optimize to a delta later, or invest in the delta + re-anchoring up front? Lean: full snapshot first (§7.3).
- **Q7 — Repository and toolchain shape.** Where does `editor-desktop` live — a new crate in this monorepo with a Rust toolchain alongside the wasm core, a sibling repo, or a Cargo workspace shared with docs/031's `editor-native`? And how is the daisyUI token struct kept in sync with the web theme — generated from one source, or maintained twice with a parity test?
- **Q8 — Table and selection-geometry rewrite order.** Tables (`core/table` logic ports; the *view* is the hard part) and cross-block selection geometry are the two meatiest view rewrites (§5.3). Which lands first, and does the MVP include tables at all or defer them behind paragraph/heading/list/quote/code/callout?
- **Q9 — Distribution and updates.** Native desktop apps need code-signing, notarization (macOS), installers, and an update mechanism — none of which the browser editor needs. Out of scope for the spike, but a real cost to name before "ship a desktop app" is a commitment.
- **Q10 — Text engine: parley vs cosmic-text.** §4.4 leans parley — same linebender org as vello (shared glyph types, least integration friction) and an actively-maturing editing module — but cosmic-text (System76, shipping in the COSMIC desktop, the Iced/glyphon stack) is more battle-tested on *editing today*: a real `Buffer` with cursor, selection, and IME in a shipping product. At our block-leaf granularity the two are apples-to-apples (shape a rich run, break to a width, cursor rect for an offset, selection rects for a range, hit-test a point to an offset), so the move is to keep the leaf-layout seam engine-swappable and let the spike (§8) decide on cursor/selection-geometry quality, IME ergonomics, and vello-integration friction. Lean: parley for the vello alignment; genuinely open. This is the only live stack fork left once managed runtimes (§4.11) and non-Rust ownership stacks (Qt, §4.4) are closed.

## 11. Definition Of Done (For The Spike)

- The §8 spike is built and a go/no-go note is committed: the native canvas renders a real `EditorDocumentSnapshot`, edits and IME-composes into the shared core, paints our caret/selection, sets line-height per block, restyles a Masonry toolbar with daisyUI tokens, and positions one popover via floating-ui-core.
- The shared core compiles and links **both** to `wasm32-unknown-unknown` (the 031 browser target) and natively, with **no async runtime in its dependency tree** (D10), proven by a CI build of the core for both targets.
- A snapshot round-trips byte-identically between the native core and the TS core for the spike's input (the parity oracle, extending docs/028).
- The parley-in-Masonry hosting seam is proven sound, or its failure is documented with a redirect (e.g. fully-raw chrome, or GPUI for the surface).
- The lossless format (§7) ships independently in TypeScript with its round-trip tests green — it does not wait on the spike and is the near-term deliverable note.md §6 tracks.
- The §10 open questions are revisited against what the spike learned; the ones the spike answers are closed, the rest are carried into the full-editor plan (which is where the omitted backlog gets written).

## 12. Final Model

editor-desktop is a second view on a shared spine, not a second editor. The owned-model core — already framework-free, soon Rust under docs/031 — becomes the single source of truth for two front-ends: the browser editor that reads it over an FFI seam, and a native desktop editor that links it directly with no seam at all, which is why the desktop target *removes* docs/031's load-bearing FFI-read risk instead of inheriting it. The native view is built on the linebender primitives we own — winit, wgpu, vello, parley, taffy, accesskit — with Masonry as an ejectable convenience and floating-ui-core for positioning, deliberately not on a framework (GPUI, Blitz) or a webview, because the user's long-run criterion is to own the stack rather than fight a lib, and a thin stack of primitives is the only thing that honors it. Inside that view, the surprising truth is that most of the editor's hardest machinery is browser-fighting that the native target deletes: EditContext becomes the OS IME spoken directly, the focus-restore caret-loss and mobile-keyboard-flicker hazard classes cease to exist, the resting/living split collapses to one render path with an editable flag, and virtualization keeps its treap but trades an async ResizeObserver race for synchronous, known-before-paint layout. What we gain in exchange is ownership of exactly the things the browser hid: text layout we control (so line-height is ours, the way Zed denies), a caret and selection we already paint, and a theme struct that is daisyUI re-expressed. What we genuinely take on as new cost is honest and named — accessibility via accesskit, cross-engine layout parity, and the IME long-tail — none of it impossible, all of it more controllable than the browser-boundary walls we are leaving behind. The core stays runtime-agnostic and synchronous so one crate compiles to both wasm and native, with tokio confined to the desktop host and the browser's event loop to the wasm host, because the moment the core depends on a runtime it can no longer be shared. And the lossless document format — the snapshot as the native file, plus a markdown-with-embedded-snapshot export for portability — is the part that needs no Rust at all: it ships in TypeScript first, proves the model is the only real serialization and markdown only ever a projection, and the desktop app inherits it. The whole proposal reduces to one disciplined slice to build first: the smallest native canvas that can prove the one thing intuition gets wrong — that a parley editor surface, fed by the OS IME and driven by the shared core, feels like a real editor — and let that, not enthusiasm, decide whether the rest is built.
