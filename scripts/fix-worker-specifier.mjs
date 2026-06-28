#!/usr/bin/env node
/**
 * Rewrite `new URL("….ts", import.meta.url)` worker specifiers to `.js` in a
 * package's built `dist` (note.md §5.1, B1).
 *
 * Why this exists: the bake Web Worker is loaded by the view with
 * `new Worker(new URL("../core/bake/bake.worker.ts", import.meta.url), …)`. The
 * source keeps the `.ts` extension so Vite/Ladle dev resolves the worker against
 * `src` during development. The package, though, builds with plain `tsc` (no
 * bundler), which transpiles `bake.worker.ts` → `bake.worker.js` but copies the
 * `new URL("…bake.worker.ts")` *string* verbatim into the emitted JS. A consumer
 * bundling the published package then tries to resolve `bake.worker.ts`, which is
 * not in the tarball (only `.js` is), and aborts with UNRESOLVED_ENTRY. This step
 * runs after `tsc` and rewrites the emitted specifiers to the extension that
 * actually ships, so `new Worker(new URL(...))` resolves against `dist` with no
 * consumer-side transform. It is the upstream home of the shim every consumer
 * would otherwise need in its own bundler config.
 *
 * Usage: node scripts/fix-worker-specifier.mjs <packageDir>   (default: cwd)
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const packageDir = resolve(process.argv[2] ?? process.cwd());
const distDir = join(packageDir, "dist");

// Match a `new URL("<path>.ts", import.meta.url)` worker specifier and swap the
// `.ts` for `.js`. Scoped to `import.meta.url` URLs so it only touches runtime
// asset references (the worker), never an unrelated string that ends in `.ts`.
const WORKER_URL = /(new URL\((["'`])[^"'`]+?)\.ts(\2,\s*import\.meta\.url\))/g;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (full.endsWith(".js")) files.push(full);
  }
  return files;
}

let rewritten = 0;
for (const file of walk(distDir)) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(WORKER_URL, "$1.js$3");
  if (after !== before) {
    writeFileSync(file, after);
    rewritten += 1;
  }
}

process.stdout.write(
  `[fix-worker-specifier] ${packageDir}: rewrote .ts->.js worker URLs in ${rewritten} file(s)\n`,
);
