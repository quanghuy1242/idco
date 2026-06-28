import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { aliases } from "./vitest.shared";

/**
 * SSR / DOM-less import-safety config (note.md §5.4, D1).
 *
 * Runs `tests/ssr-import-safety.test.ts` in a NODE environment (no `window`, no
 * `document`) so it proves the published packages can be pulled into a server /
 * SSR module graph without throwing at module-load. It is a separate config from
 * `vitest.config.ts` because that suite is one aggregated jsdom file; this one
 * needs a real DOM-less environment and must NOT load the jsdom setup file.
 * Reuses the same react plugin (for tsx) and workspace src aliases.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: aliases,
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/ssr-import-safety.test.ts"],
  },
});
