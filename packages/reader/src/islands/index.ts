"use client";

/**
 * The L3 client-island entry (docs/015 §6, §7.3). This is the package's core `./islands`
 * surface — separate from the server-safe `.` entry — so a Server Component that imports
 * `@quanghuy1242/idco-reader` for static rendering never resolves this module graph.
 * Importing this module registers the built-in islands as a side effect, mirroring the
 * editor's `registerBuiltInNodeViews`.
 *
 * This barrel carries ONLY the pure-React islands (checklist, scroll-spy-toc) plus the
 * infra (boundary, renderer, registry) — no Prism, no `@idco/ui`, no react-aria. The
 * live-code island, the one island that reaches into `@idco/ui` (Prism), is deliberately
 * NOT re-exported here; it lives behind its own `./islands/live-code` entry so a public
 * reader can register checklist + scroll-spy without ever pulling Prism / `@idco/ui` into
 * its graph. A host that wants live code highlighting imports `./islands/live-code` too.
 *
 * The directive is preserved through the build so the bundler treats every export here as
 * a client reference (docs/015 §13 "use client stripped by the build").
 */
export { IslandBoundary } from "./boundary";
export { createIslandRenderer } from "./create-renderer";
export {
  getReaderIsland,
  listReaderIslands,
  registerReaderIsland,
  type ReaderIsland,
  type ReaderIslandHydrate,
  type ReaderIslandProps,
} from "./registry";
export { checklistIsland } from "./checklist";
export { scrollSpyTocIsland } from "./scroll-spy-toc";
// `liveCodeIsland` is intentionally NOT re-exported here — it pulls Prism / `@idco/ui`.
// Import `@quanghuy1242/idco-reader/islands/live-code` to opt into it (see that file).
