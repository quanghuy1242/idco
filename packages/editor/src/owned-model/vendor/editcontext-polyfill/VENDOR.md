# Vendored EditContext polyfill

Per docs/010 §5.5 / §6.7, the owned-model engine binds to the **EditContext API
surface only**. On Chromium it is native; on Firefox/Safari it is provided by a
vendored polyfill so we own its correctness, can pin and audit it, and patch IME
edge cases without depending on an external release cadence. When native
EditContext reaches Firefox/Safari, this directory is deleted with no engine
change.

## Provenance

Upstream candidate: [`@neftaly/editcontext-polyfill`](https://www.npmjs.com/package/@neftaly/editcontext-polyfill)
— a hidden-`<textarea>`-in-shadow-root bridge that translates keystrokes/IME into
EditContext `textupdate`/composition events, fuzz-tested against Chrome's native
implementation with WPT ports (Firefox 125+, Safari 15.4+).

## Phase 1 status (docs/010 P1, this file)

Phase 1 is groundwork only ("Out of scope: any EditContext wiring"). What lives
here now is a small, repo-clean implementation of the **API surface** the engine
will bind to (`install`, `EditContext`), so the vendored home, exports, and the
loads/exposes contract (AC5) are established and unit-tested. It deliberately
does **not** yet contain the upstream hidden-textarea input bridge or the
selection renderer.

## Phase 2 plan

Phase 2 (input + caret + selection spike) is where the polyfill is actually
exercised and proven cross-browser. At that point the upstream
`@neftaly/editcontext-polyfill` source — its hidden-textarea bridge, input
translator, and `selection-renderer.ts` (the `Selection.prototype.addRange`/
`removeAllRanges` monkey-patch described in docs/010 §7.4) — is vendored in here,
adapted to pass the repo's `format:check`/`lint`/`typecheck` gates, and bound
behind the same `install`/`EditContext` surface this file already exposes.
