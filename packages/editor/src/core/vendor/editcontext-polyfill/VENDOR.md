# Vendored EditContext polyfill

Per docs/010 §5.5 / §6.7, the engine binds to the **EditContext API surface only**. On Chromium it is native; on Firefox/Safari it is provided by this vendored polyfill so we own its correctness, can pin and audit it, and patch IME / focus / a11y edge cases without waiting on an external release. When native EditContext reaches Firefox/Safari, this directory is deleted with no engine change.

## This is a fork, not a thin wrapper

Treat the files here as **our source**. They started from upstream but have diverged heavily — every vendored module carries local patches, several upstream modules were dropped, and one was absorbed into another. Do **not** "update from upstream" by overwriting; reconcile by hand against the diff (recipe below). There is no per-line "LOCAL PATCH" marker — assume any line may be ours.

## Provenance

- Upstream: [`@neftaly/editcontext-polyfill`](https://www.npmjs.com/package/@neftaly/editcontext-polyfill), pinned at **0.1.1** — a hidden-`<textarea>`-in-shadow-root bridge that translates keystrokes/IME into EditContext `textupdate`/composition events. Itself LLM-written (TDD + fuzzing) against Chrome's native EditContext, with WPT ports for the editing tests.
- Upstream ships only bundled `dist/` (no `.ts`); the readable sources we diff against come from the bundle's sourcemap `sourcesContent` (see recipe).

## How we use it

`index.ts` is our adapter and the **only** public surface — the rest of the engine never imports the internal modules directly. It exports:

- `install(options)` / `uninstall(...)` — install/remove the `HTMLElement.prototype.editContext` property + focus manager.
- `releaseForcedInstall()` — drop a test/forced install.
- `syncPolyfillSelection(host)` — push the model selection into the hidden textarea (keeps IME bounds + caret in sync).
- `EditContext` — the polyfill class, aliased to the spec name.

The view (`text-block.tsx`, `selection-overlay.tsx`) talks to the standard EditContext API on the host block element; on Chromium that's native, here it's this polyfill. The two paths are interchangeable by construction.

## What we deliberately do NOT vendor

The engine already owns pointer selection, caret/selection painting, shortcut handling, and browser-selection suppression, so the upstream layers that would double-render or fight that are left out:

- `selection-renderer.ts`, `mouse-handler.ts`, `exec-command-interceptor.ts` — engine owns these.
- `install.ts` — replaced by our `index.ts` adapter (our install/release contract).
- `constants.ts` — folded into the modules that used it.
- `editability.ts` — folded into `context-registry.ts` (our shadow-DOM-aware `findEditContextHost`).

## Local modifications (snapshot 2026-06-21, vs upstream 0.1.1)

Line deltas are normalized for the `.js` import-suffix difference, so they reflect real behavioral patches, not extension noise. Every file diverges:

| Vendored file          | +added | −removed | Main local changes |
| ---------------------- | -----: | -------: | ------------------ |
| `index.ts`             |   ~128 |       ~9 | Our adapter: `install`/`releaseForcedInstall`/`uninstall`/`syncPolyfillSelection` contract. |
| `input-translator.ts`  |   ~180 |      ~35 | Microsoft-Telex / IME regression handling, Ctrl+Backspace·Delete remap, shadow-DOM event containment, reconcile-from-`textarea.value` on `input`. |
| `focus-manager.ts`     |    ~86 |      ~98 | Window/tab-switch blur guard, Tab→EditContext deactivate, `document.activeElement` patched to the host, MutationObserver teardown on host removal, refocus guards (mobile-keyboard B1/B′ fixes). |
| `edit-context.ts`      |    ~66 |      ~94 | `_onStateChange` / `_onSelectionBoundsChange` hooks the view drives; selection-renderer coupling stripped. |
| `edit-context-state.ts`|    ~84 |      ~21 | State-machine patches for the above. |
| `context-registry.ts`  |    ~37 |       ~2 | Absorbed `editability.ts`: `findEditContextHost` (shadow-DOM-aware) + `FORM_CONTROL_TAGS`. |
| `element-binding.ts`   |    ~36 |       ~9 | Focus capture across detach/reattach. |
| `hidden-textarea.ts`   |    ~24 |       ~1 | `wrap="off"` (Firefox line-delete boundaries), shadow `:focus` outline, **no `aria-hidden` on the focus sink** (Chrome 124+ blocks it on focused elements). |
| `event-types.ts`       |     ~5 |       ~1 | Minor. |

The numbers drift as we patch; regenerate them with the recipe rather than trusting this table after further edits.

## Comparing against upstream (audit recipe)

Upstream has no published `.ts`, so reconstruct it from the bundle sourcemap:

```bash
cd /tmp && rm -rf ectx && mkdir ectx && cd ectx
npm pack @neftaly/editcontext-polyfill          # pinned: add @0.1.1 to match
tar xzf neftaly-editcontext-polyfill-*.tgz
python3 - <<'PY'
import json, os
m = json.load(open("package/dist/index.mjs.map"))
os.makedirs("src", exist_ok=True)
for s, c in zip(m["sources"], m["sourcesContent"]):
    if c is not None:
        open(os.path.join("src", os.path.basename(s)), "w").write(c)
PY
# diff a file (normalize the .js import suffix our copies use):
VEN=<repo>/packages/editor/src/core/vendor/editcontext-polyfill
diff <(sed 's/\.js"/"/g' src/focus-manager.ts) <(sed 's/\.js"/"/g' "$VEN/focus-manager.ts")
```
