import { fileURLToPath } from "node:url";

/**
 * Workspace src aliases shared by `vitest.config.ts` (the jsdom suite) and
 * `vitest.ssr.config.ts` (the node/DOM-less import-safety probe, note.md §5.4).
 *
 * Both configs resolve the `@idco/*` / `@quanghuy1242/idco-*` package names to
 * their `src` entry so tests run against source, not the built `dist`. Keeping the
 * list in one place stops the two configs from drifting apart. `import.meta.url`
 * resolves relative to this file at the repo root, so the paths match the original
 * inline list verbatim. More specific subpath aliases precede their barrels — vite
 * matches by prefix and would otherwise rewrite a subpath to the barrel.
 */
export const aliases = [
  {
    find: "@idco/ui",
    replacement: fileURLToPath(
      new URL("./packages/ui/src/index.ts", import.meta.url),
    ),
  },
  {
    // The `@idco/ui` subpath the live-code island imports (Prism-only `CodeEditor`,
    // never the react-aria barrel). More specific, so it precedes the barrel alias below.
    find: "@quanghuy1242/idco-ui/code-editor",
    replacement: fileURLToPath(
      new URL("./packages/ui/src/code-editor.tsx", import.meta.url),
    ),
  },
  {
    find: "@quanghuy1242/idco-ui",
    replacement: fileURLToPath(
      new URL("./packages/ui/src/index.ts", import.meta.url),
    ),
  },
  {
    find: "@idco/lib",
    replacement: fileURLToPath(
      new URL("./packages/lib/src/index.ts", import.meta.url),
    ),
  },
  {
    find: "@quanghuy1242/idco-lib",
    replacement: fileURLToPath(
      new URL("./packages/lib/src/index.ts", import.meta.url),
    ),
  },
  {
    // More specific than the `/islands` barrel below, so it must come first — vite
    // matches string aliases by prefix and would otherwise rewrite this to the barrel.
    find: "@quanghuy1242/idco-reader/islands/live-code",
    replacement: fileURLToPath(
      new URL("./packages/reader/src/islands/live-code.tsx", import.meta.url),
    ),
  },
  {
    find: "@quanghuy1242/idco-reader/islands",
    replacement: fileURLToPath(
      new URL("./packages/reader/src/islands/index.ts", import.meta.url),
    ),
  },
  {
    find: "@quanghuy1242/idco-reader",
    replacement: fileURLToPath(
      new URL("./packages/reader/src/index.ts", import.meta.url),
    ),
  },
  {
    find: "@idco/reader",
    replacement: fileURLToPath(
      new URL("./packages/reader/src/index.ts", import.meta.url),
    ),
  },
  {
    find: "@idco/editor",
    replacement: fileURLToPath(
      new URL("./packages/editor/src/index.ts", import.meta.url),
    ),
  },
  {
    find: "@quanghuy1242/idco-editor",
    replacement: fileURLToPath(
      new URL("./packages/editor/src/index.ts", import.meta.url),
    ),
  },
  {
    find: "@quanghuy1242/idco-editor-legacy",
    replacement: fileURLToPath(
      new URL("./packages/editor-legacy/src/index.ts", import.meta.url),
    ),
  },
  {
    find: "next/link",
    replacement: fileURLToPath(
      new URL("./.ladle/mocks/next-link.tsx", import.meta.url),
    ),
  },
];
