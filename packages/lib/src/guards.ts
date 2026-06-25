/**
 * Shared runtime type guards — product-neutral, framework-free, RSC-safe.
 *
 * `isRecord` is the single canonical "is this a plain object record" guard for the
 * whole monorepo. It lived in three places (lib auth-fetch, editor object-registry,
 * editor-legacy schema) and was re-inlined as a bare `typeof x === "object"` check in
 * ~13 more files across editor/reader/lib. Those guards are each ~6 tokens — below any
 * token-based duplicate detector's floor — so the drift was invisible to `check:dup`.
 * The `architecture/no-inline-record-guard` lint rule now bans the inline form and points
 * every call site here, so there is exactly one definition to reason about.
 *
 * Semantics: a record is a non-null object that is NOT an array. Excluding arrays is the
 * deliberate, more-correct choice — callers narrow to `Record<string, unknown>` and then
 * read string keys, which an array never meaningfully carries. The two former definitions
 * that omitted the `!Array.isArray` check were the looser, less-correct variants; folding
 * everything onto the array-excluding form is the intended convergence, not a regression.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
