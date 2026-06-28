#!/usr/bin/env node
/**
 * Published-package consumer contract check (note.md §5, B1 + B2).
 *
 * Why this exists: Ladle validates the editor against `packages` source with the
 * full `.ladle/preview.css` and a client-only runtime, so it structurally cannot
 * catch the ways a *published tarball* breaks for a fresh consumer — an
 * unresolvable worker URL (B1) or a missing CSS contract (B2) are both invisible
 * to every story. This runs against the built `dist` (the bytes that ship) and
 * asserts the consumer-facing contract holds, so a regression fails the gate
 * instead of reaching a consumer. It is the durable complement to the docs/032
 * api-map work: that made the surface discoverable, this keeps the artifact sound.
 *
 * Run after `pnpm build` (it reads `dist`). Wired into `pnpm check` as
 * `check:package`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const editorDir = join(repoRoot, "packages", "editor");
const editorDist = join(editorDir, "dist");

const failures = [];
const fail = (msg) => failures.push(msg);

function walkJs(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkJs(full));
    else if (full.endsWith(".js")) out.push(full);
  }
  return out;
}

// --- B1: every `new Worker(new URL("…", import.meta.url))` must resolve to a
// file that actually ships in dist. The bug was the source `.ts` specifier
// surviving into dist where only `.js` exists.
const WORKER_URL = /new URL\((["'`])([^"'`]+?)\1,\s*import\.meta\.url\)/g;
let workerRefs = 0;
for (const file of walkJs(editorDist)) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(WORKER_URL)) {
    const spec = match[2];
    if (!spec.includes("worker")) continue; // only assert on worker assets
    workerRefs += 1;
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) {
      fail(
        `B1: worker URL "${spec}" in ${file.replace(repoRoot + "/", "")} resolves to a file that is not in dist (${target.replace(repoRoot + "/", "")})`,
      );
    }
  }
}
if (workerRefs === 0) {
  fail(
    "B1: found no `new Worker(new URL(...))` reference in editor dist — the check is no longer exercising anything (did the worker move?)",
  );
}

// --- B2: a real CSS contract must ship and be reachable through `exports`. The
// bug was the editor shipping no `.css` while its rendered content depends on
// hand-written `.rt-table`/`.rt-checklist`/`.token.*` rules.
const cssPath = join(editorDist, "styles.css");
if (!existsSync(cssPath)) {
  fail("B2: packages/editor/dist/styles.css is missing (the CSS contract is not shipped)");
} else {
  const css = readFileSync(cssPath, "utf8");
  for (const rule of [".rt-table", ".rt-checklist", ".token."]) {
    if (!css.includes(rule)) {
      fail(`B2: dist/styles.css is missing the required \`${rule}\` rules`);
    }
  }
}
const pkg = JSON.parse(readFileSync(join(editorDir, "package.json"), "utf8"));
const cssExport = pkg.exports?.["./styles.css"];
if (!cssExport) {
  fail('B2: package.json exports is missing the "./styles.css" entry');
} else if (!existsSync(join(editorDir, cssExport))) {
  fail(`B2: exports["./styles.css"] points at ${cssExport}, which does not exist`);
}

if (failures.length > 0) {
  process.stderr.write("x package contract check failed:\n");
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.exit(1);
}
process.stdout.write(
  `package contract OK: ${workerRefs} worker URL(s) resolve in dist; CSS contract shipped + exported\n`,
);
