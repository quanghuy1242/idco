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

## Current status

Phase 2 vendors the upstream hidden-textarea input bridge, input translator,
pure `EditContext` state machine, event types, focus binding, and element
binding. The local `index.ts` is a thin adapter that preserves this repo's
`install` / `releaseForcedInstall` / `syncPolyfillSelection` contract.

The upstream `selection-renderer.ts`, `mouse-handler.ts`, and
`exec-command-interceptor.ts` are intentionally not installed here. The
owned-model engine already owns pointer selection, caret painting, selection
overlays, shortcut handling, and browser-selection suppression. Keeping those
layers out of the vendor adapter prevents double-rendered carets/selections and
keeps the polyfill scoped to input + `EditContext` state.
