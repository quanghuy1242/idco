# 008 - Editor Performance Contract

> Status: implemented
>
> Date: 2026-06-15
>
> Scope:
>
> - `packages/editor/src/RichTextEditor.tsx`
> - `packages/editor/src/plugins/editor-performance.ts`
> - `packages/editor/src/plugins/toc-entries.ts`
> - `packages/editor/src/plugins/**`
> - `packages/editor/src/nodes/table-of-contents-node.tsx`
> - `tests/e2e/editor-*.perf.spec.ts`
> - `.github/workflows/check.yml`
> - `scripts/oxlint-js-plugins/architecture.js`

## 1. Goal

The Lexical editor must stay responsive during repeated character edits on lower-end devices. The concrete regression this protects is held Backspace becoming slow because every keypress triggered whole-document serialization, normalization, derived-state recompute, and React host rerenders.

This contract makes editor performance an architecture rule, not a one-off patch.

## 2. Performance Boundary

Lexical owns the immediate edit. Anything outside that critical path must be scheduled deliberately:

- host `onChange` document emission
- read-only JSON preview updates
- table-of-contents entry collection
- side rail publication
- toolbar active-state refresh
- selected-text flyout refresh
- context-menu selected-text command cache
- table-control metadata refresh

Do not serialize the entire editor state, normalize the full document, measure DOM ranges, or write React state directly from a raw update listener unless it is correctness-critical and explicitly declared as such.

## 3. Scheduler Runtime

Every editor update listener must declare one lane through `registerEditorUpdateListener` or `registerCoalescedEditorUpdateListener` in `packages/editor/src/plugins/editor-performance.ts`.

The wrapper now feeds a global editor scheduler queue, not isolated per-listener timers.

- `sync`: correctness-critical work that must run inside the update notification. Keep it tiny. Examples: gap-cursor reconciliation, block-boundary navigation repair, heading-anchor repair.
- `frame`: visual derived state that should update once per animation frame. Examples: toolbar active state, selected-text flyout position, context-menu selection cache, table-control metadata.
- `idle`: noncritical derived state that can trail live typing. Examples: inline and side table-of-contents entries.
- `debounced`: host-facing or expensive derived outputs that should publish after the author pauses briefly. Examples: `onChange` document emission, JSON source preview, and TOC invalidation snapshots.

The contract object must include:

- `label`: human-readable subscriber name.
- `lane`: scheduling lane.
- `frequency`: when it runs.
- `cost`: what it reads/writes.
- `budgetMs`: expected local budget before dev slow-listener logging and perf-test failure.
- `priority`: queue ordering. Use `critical`, `high`, `normal`, `low`, or a number.
- `coalesce`: pending-update policy. Default is `latest`.
- `merge`: optional merge function when `coalesce: "merge"` is used.
- `debounceMs`: only when overriding the default debounce delay.

## 4. Priority And Frame Budgets

The scheduler owns one pending queue across editor subscribers. Non-sync work is sorted by priority and sequence, then executed inside lane budgets:

- `frame`: default global budget `6ms` per animation frame.
- `idle`: default global budget `10ms` per idle callback, capped by `deadline.timeRemaining()`.
- `debounced`: default global budget `10ms` after the debounce timer fires.

If a lane has more pending work than the current budget allows, the remaining tasks are carried to the next frame, idle callback, or debounced flush. This prevents a group of individually reasonable listeners from monopolizing a frame together.

Current priority split:

- `critical`: sync structural correctness.
- `high`: toolbar and selection flyout refresh.
- `normal`: context menu and table controls.
- `low`: TOC invalidation, TOC entry building, JSON source preview.

## 5. Coalescing Policy

Non-sync subscribers do not queue every Lexical update. Each scheduled task has one pending payload slot.

Supported policies:

- `latest`: replace the pending payload with the newest payload. This is the default for editor UI and TOC work.
- `drop-if-pending`: ignore newer payloads while a task is already pending.
- `merge`: merge the old and new payloads through the contract's `merge` callback.

This is stronger than debounce alone: held Backspace can produce many Lexical updates, but frame/idle/debounced listeners keep one pending task and process the newest coherent state.

## 6. Chunked Derived Work

Large document-derived work must avoid doing all computation in one update listener.

TOC work follows this pipeline:

1. The debounced invalidation listener checks dirty Lexical nodes after the edit burst settles.
2. If no dirty node is a heading, inside a heading, or a table-of-contents node, the TOC path does nothing.
3. If relevant, the listener snapshots only heading metadata from `editorState.read()`.
4. A chunked idle task builds TOC entries from that heading snapshot under a `4ms` per-run budget.
5. If the task yields, the scheduler requeues it.
6. If a newer heading snapshot arrives before completion, the older pending job is replaced.
7. Stale side-rail completions are ignored through a version guard.

Lexical reads are synchronous, so chunking happens after the minimal heading snapshot is taken. That is the practical boundary: keep the synchronous read narrow, skip it for irrelevant edits, and chunk the derived entry construction outside the edit path.

## 7. Required Helpers

Use these helpers instead of ad hoc scheduling:

- `registerEditorUpdateListener(...)`: required wrapper around Lexical update listeners; sync listeners are measured immediately and non-sync listeners enter the global scheduler.
- `registerCoalescedEditorUpdateListener(...)`: compatibility wrapper that schedules through the same global queue.
- `createEditorSchedulerTask(...)`: generic budgeted task API for derived work that is not a raw Lexical update listener.
- `setStateIfChanged(...)`: prevents fresh derived objects from forcing React rerenders when semantic state is unchanged.
- `hasNonCollapsedDomSelection(...)` and `$hasCollapsedRangeSelection()`: fast paths for selection surfaces before expensive command-context reads.
- `useDerivedStatePublisher(...)`: idle/debounced derived-state publishing for non-Lexical outputs.
- `useDebouncedEditorStatePublisher(...)`: debounced editor-state derivation for controlled `onChange` emission.

## 8. Review And Lint Rule

Direct `editor.registerUpdateListener(...)` calls are forbidden outside `editor-performance.ts`.

The custom oxlint rule `architecture/editor-no-direct-update-listener` enforces this. A new subscriber must go through the scheduler helper, which forces the reviewer to see the listener's frequency, cost, lane, priority, coalescing policy, and budget.

If a listener truly must be `sync`, the PR should explain why delaying it by one frame would break editor correctness. Most UI-only updates should be `frame`, `idle`, or `debounced`.

## 9. Perf Dashboard And CI Trend

Development and test builds expose:

```ts
window.__IDCO_EDITOR_PERF__?.snapshot();
window.__IDCO_EDITOR_PERF__?.reset();
```

The snapshot contains:

- global frame and idle budgets
- total runs
- total coalesced and dropped updates
- total over-budget runs
- per-task label, lane, priority, run count, max duration, average duration, over-budget count, coalesced count, dropped count, and continued chunk count

The Playwright editor perf suite writes:

- `test-results/editor-perf/<scenario>.json`
- `test-results/editor-perf/history.ndjson`
- per-test `editor-perf-report.json` under Playwright output

The `editor-perf` GitHub Actions job runs `pnpm test:e2e:editor` and uploads `test-results/editor-perf` plus Playwright output as an artifact. The NDJSON file is the CI trend input; each run records scenario metrics, scheduler metrics, commit, ref, and run id.

## 10. Hard Perf Failure Rules

Playwright performance tests use same-run plain `contenteditable` baselines so the suite is resilient to machine and CI noise.

Default guardrails:

- editor `p50` should stay within `EDITOR_PERF_P50_HEADROOM_MS` of the same-run baseline, default `12ms`.
- editor `p95` should stay below `EDITOR_PERF_P95_BUDGET_MS`, default `120ms`.
- scheduler over-budget runs must stay at or below `EDITOR_PERF_MAX_OVER_BUDGET_RUNS`, default `0`.
- slow scheduler warnings matching `[idco-editor] slow update listener` fail the measured scenario.

These are still guardrails, not proof of universal performance. When adding expensive editor features, add a scenario that stresses that feature.

## 11. Playwright Coverage

The editor perf suite must include repeated interactions that match real author behavior:

- held Backspace in the full editor
- rapid text insertion in the full editor
- held Backspace with the side TOC rail mounted
- rapid text insertion with the side TOC rail mounted
- rapid text insertion inside a table cell

Run:

```sh
pnpm test:e2e:editor
```

The suite reuses a running Ladle server at `http://127.0.0.1:61000` or starts `pnpm dev:ladle` through Playwright when needed.

## 12. Adding A New Editor Feature

Before merging a feature that hooks into editor updates:

1. Decide whether the work is `sync`, `frame`, `idle`, or `debounced`.
2. Register through `editor-performance.ts`.
3. Declare `label`, `frequency`, `cost`, `budgetMs`, `priority`, and any non-default coalescing.
4. Add a same-value state guard if the listener publishes React state.
5. Add a collapsed-selection, dirty-node, or narrowed-scope fast path when applicable.
6. Use `createEditorSchedulerTask(...)` for derived work that can be chunked.
7. Add or extend a Playwright perf scenario if the feature adds a new editing surface or document-wide derivation.
8. Run `pnpm test:e2e:editor` and `pnpm check`.

## 13. Current As-Built Notes

- `RichTextEditor` emits controlled `onChange` through `useDebouncedEditorStatePublisher` so full `editorState.toJSON()` plus `normalizeDocument()` work no longer runs on every keypress.
- The read-only JSON mirror uses `useDerivedStatePublisher` and trails the live document.
- Toolbar, flyout, context menu, and table controls enter the shared frame queue instead of scheduling independent frame callbacks from update listeners.
- Inline and side TOC listeners debounce invalidation, only rebuild on heading or TOC-setting changes, then build entries in chunked idle tasks.
- Selection flyout and context-menu caches use the non-collapsed DOM-selection fast path before command-context reads.
- Development builds log slow editor update subscribers with their contract metadata.
- Playwright tests fail on slow scheduler warnings and over-budget run counts, then write JSON artifacts for CI trend review.
