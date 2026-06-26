/**
 * Barrel for the bake cluster (note.md CP4).
 *
 * Baking turns the live model into the static published/reader representation and
 * the search/TOC index: `bake.ts` (the pure `bakeObjectData` / `buildDocumentIndex`
 * compute + the worker job contract) and `bake-service.ts` (the loopback vs real
 * `Worker` service wrappers). The worker entry `bake.worker.ts` is NOT re-exported
 * here — it is loaded only by a runtime `new URL(".../core/bake/bake.worker.ts")`
 * in the view, never imported as a module. Importers use `from "./bake"` /
 * `from "../bake"` so the folder is the unit.
 */
export * from "./bake";
export * from "./bake-service";
export * from "./bake-cache";
