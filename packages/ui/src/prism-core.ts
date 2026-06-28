/**
 * The shared Prism instance, pinned as the global BEFORE any grammar pack loads
 * (note.md §5.5, D2).
 *
 * PrismJS grammar packs (`prismjs/components/prism-*`) register their language onto
 * a global `Prism` and reference it as a free variable: each pack ends with
 * `(function (Prism) { … })(Prism)` where the trailing `Prism` is the global. Prism
 * core tries to set that global itself, but only on whatever its `_self` detection
 * resolves to — `window` in a browser, else a `WorkerGlobalScope` `self`, else a
 * throwaway `{}`. In a runtime where neither matches (Cloudflare Workers / workerd,
 * where `window` is absent and `self` is not a `WorkerGlobalScope`) the global is
 * never set on `globalThis`, so the first pack throws `ReferenceError: Prism is not
 * defined`. content-api hit exactly this and worked around it with a host-side
 * `prism-setup` module.
 *
 * This module is that bootstrap, owned by the package: it imports Prism and pins it
 * on `globalThis`, and `code-editor.tsx` imports its default export *before* the
 * grammar packs. ESM evaluates a module's dependencies in source order, so this
 * runs (and the pin lands) before any `prismjs/components/*` pack reads the global —
 * and the packs register onto the very instance `CodeEditor` highlights with, so a
 * consumer never has to bootstrap Prism. Assigning `globalThis.Prism` directly
 * (not prismjs's `_self`) is the load-bearing line; everything else is prismjs's.
 */
import Prism from "prismjs";

(globalThis as typeof globalThis & { Prism?: typeof Prism }).Prism = Prism;

export default Prism;
