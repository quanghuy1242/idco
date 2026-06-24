"use client";

/**
 * The L3 client-island entry (docs/015 §6, §7.3). This is the package's `./islands`
 * surface — separate from the server-safe `.` entry — so a Server Component that imports
 * `@quanghuy1242/idco-reader` for static rendering never resolves this module graph or its
 * `@idco/ui` (Prism) dependency. Importing this module registers the built-in islands as a
 * side effect, mirroring the editor's `registerBuiltInNodeViews`.
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
export { liveCodeIsland } from "./live-code";
export { scrollSpyTocIsland } from "./scroll-spy-toc";
