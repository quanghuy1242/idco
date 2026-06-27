/**
 * Production/development invariant gate for the owned-model core (docs/030 §7.5 D5, SLP-2).
 *
 * Why this file exists
 * --------------------
 * The engine carries two whole-document tripwires that exist only to catch *engine*
 * bugs, never to serve a user-visible feature:
 *
 * - `freezeNode` (`model.ts`) deep-freezes every node's attrs/runs/marks/baked so an
 *   accidental in-place mutation of a retained node fails loudly.
 * - `assertParentInvariant` (`editor-store.ts`) re-walks the whole tree to re-verify the
 *   already-authoritative reverse parent index after a load and after every structural edit.
 *
 * Both are O(n) over the document. On open they run across every node *before first
 * paint* — for a large chapter that is the dominant open-time main-thread stall (docs/030
 * §3.4). In production they buy nothing: node *identity* (a fresh object per change), not
 * frozenness, is what per-node subscribers compare against, and `#rebuildParentIndex` is
 * already correct without a second pass to confirm it. So this module is one global flag
 * that the load and edit paths consult to skip the dev-only walks in production while
 * keeping them firing in dev/test where they catch regressions.
 *
 * Default detection: `NODE_ENV === "production"` disables the tripwires; everything else
 * (dev servers, the Vitest runner which sets `NODE_ENV=test`, an unbundled context with no
 * `process` shim) keeps them on. Read through `globalThis` so this stays framework- and
 * Node-typing-free per the architecture lint (no `@types/node` dependency in `core/**`).
 * The explicit setter lets a host force the behavior and lets tests prove both paths.
 */

function detectDefault(): boolean {
  const env = (
    globalThis as {
      readonly process?: { readonly env?: Record<string, string | undefined> };
    }
  ).process?.env;
  // Treat *only* an explicit "production" as production; an unknown environment
  // defaults to enabled (safe — a stray dev build keeps its tripwires, it just
  // does not get the perf win until the bundler defines NODE_ENV).
  return env?.NODE_ENV !== "production";
}

let devInvariantsEnabled = detectDefault();

/**
 * @categoryDefault Snapshot & Performance
 */

/**
 * Whether the dev-only invariants (`freezeNode` deep-walk, `assertParentInvariant`
 * tree walk) should run. False in a production build, so the load and structural-edit
 * paths skip the O(n) tripwires (docs/030 SLP-2).
 */
export function isDevInvariantsEnabled(): boolean {
  return devInvariantsEnabled;
}

/**
 * Force the dev-invariant gate on or off. A host calls this to opt a production
 * deployment back into the tripwires (or out, if its bundler does not set NODE_ENV);
 * tests call it to exercise the production load path and assert the walks are gated.
 */
export function setDevInvariants(enabled: boolean): void {
  devInvariantsEnabled = enabled;
}

/** Restore the environment-derived default (tests reset this in teardown). */
export function resetDevInvariants(): void {
  devInvariantsEnabled = detectDefault();
}
