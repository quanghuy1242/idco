// Owned-model virtualized editor (docs/010) — the EditContext engine home.
//
// Layout: `core/` is the framework-agnostic engine core; `view/` is the thin
// React binding; `vendor/` holds the vendored EditContext polyfill. Phase 1
// scaffolds this tree and salvages the pure helpers; the engine runtime lands
// in later phases and is never wired as a default editor path (docs/010 G6).
export * from "./core";
