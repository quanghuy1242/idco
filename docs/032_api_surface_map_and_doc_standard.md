# 032 — API surface map and doc-comment standard

## Why this exists

Consumer repos (`content-api`, `auth`, and any future product) use `@quanghuy1242/idco-*` heavily, and until now an agent or a human working in those repos had to `ls` and `grep` idco source to learn what a package exposes. That is slow, it goes stale, and it leaks idco internals into product reasoning. This doc defines two things that replace the grep: a **doc-comment standard** every public export follows, and a **generated API map** built from those comments and shipped inside each package. A consumer reads the map; it never reads idco source.

The standard plays the role Google-style docstrings play in Python: one agreed shape for a doc-comment so a tool can read it and a human can skim it. We do not invent a format. We use TSDoc tags (`@param`, `@example`, `@see`, `@deprecated`, `@internal`) plus a small set of category tags the generator groups on.

## The map (what gets generated)

`scripts/gen-api-map.mjs` parses a package's emitted `.d.ts` files and writes a small, cross-linked `api/` folder into the package, bundled in the published tarball:

- `api/README.md` — the directory: package tagline, the list of categories (each linking to its file), the package conventions, and a pointer to the flat index. Small on purpose; this is the always-read entry.
- `api/<category>.md` — one file per category: the category narrative, then each export with its signature, summary, field/prop table, and example. These stay small because the category taxonomy is granular (see below).
- `api/all-exports.md` — a flat A–Z lookup, every export linking to its category file. For "where does `X` live".

The generator reads `.d.ts`, not source and not a doc tool, on purpose. This monorepo runs TypeScript 7 (native preview); TypeDoc and API Extractor peer on the classic TS compiler API and cannot load here. The emitted `.d.ts` is the published surface and preserves every doc-comment, so parsing it yields a map that matches exactly what a consumer can import, with zero extra dependency and no exposure to TS-version churn. Run it for one package with `node scripts/gen-api-map.mjs packages/<pkg>`; it prints a coverage report (percent summarized, percent categorized) and the list of gaps.

## The doc-comment standard

Scope: the standard is enforced on the **public surface only** — every symbol re-exported from a package's entry barrel (`packages/<pkg>/src/index.ts` and any subpath entry). Internal helpers need nothing, or carry `@internal` to stay off the map even when a barrel re-exports them.

A public export carries a doc-comment shaped like this:

```ts
/**
 * One full sentence, present tense, stating what the export is or does. This first
 * sentence becomes the map summary, so it must stand alone without the name.
 *
 * Any further paragraphs add the why, the gotcha, the ordering rule. They show in the
 * category file, not the index.
 *
 * @category Node SPI
 * @param view  The node's React half; idempotent by type.
 * @example
 * registerNode({ view, definition })
 * @see registerMark
 */
export function registerNode(args: RegisterNodeArgs): void {}
```

Rules, in priority order:

1. **First sentence is a standalone summary.** Present tense, no leading "This function". It must read correctly without the symbol name in front of it, because the index renders `name — summary`. Good: "Register a custom node end to end." Bad: "Used for registration."
2. **Category.** Every public export resolves to exactly one category. Set it the cheap way with a file-level `@categoryDefault <Name>` in the module header so every export in that file inherits it; override a single export with its own `@category <Name>`. Pick categories at a granularity where each holds roughly five to twenty exports, so its file stays small. The taxonomy per package is fixed below.
3. **Category narrative.** Each category gets a short prose intro through `@categoryDescription <Name>` followed by the prose, written in a module header. For the editor this lives in the barrel (`packages/editor/src/index.ts`), which already carried the section prose; the generator merges `@categoryDescription` from any file it parses, so author it wherever it reads best. The narrative is where a consumer learns the usage shape of an SPI — "to add a block, call `registerNode` with a `NodeView`" — not just the per-symbol signature.
4. **Props and params.** A component's props interface and a function's params each get a one-line doc per field. This is the part a consumer reads most, and the generator renders it as a table. Document the non-obvious fields first; a field whose name and type are self-evident can stay bare.
5. **Example.** Give one `@example` of the canonical use on the headline exports of a category (the `register*` call, the main component). The generator shows the first example and truncates long ones.
6. **Stability.** Default is public. Tag `@internal` on anything that is exported for cross-module use but is not a consumer API; the generator drops it from the map. Tag `@deprecated` with the replacement; it stays on the map with the notice.

## Category taxonomy

These are the fixed category names per package. Granularity is chosen so no category file grows large.

### `@quanghuy1242/idco-ui`

`Layout`, `App Shell`, `Typography`, `Forms`, `Overlays`, `Navigation`, `Feedback`, `Data Display`, `Pickers`, `Editor Bridge`, `Theme`, `Icons`.

### `@quanghuy1242/idco-editor`

The editor is an engine you extend through SPIs, so its categories are usage-shapes, not symbol kinds: `Node SPI`, `Mark SPI`, `Block Types`, `Commands & Toolbar SPI`, `Side Panel SPI`, `Comments SPI`, `Document Collections SPI`, `Host Data Source SPI`, `Schema Profile`, `Editor Components`, `Resting Render`, `Document Index`, `Autosave`, `Markdown I/O`, `Engine Core — Store`, `Engine Core — Model`, `Engine Core — Commands`, `Text Segmentation`, `Snapshot & Performance`, `Virtual Geometry`, `Compat (import-only)`, `Editing Helpers`.

`registerNode` is the headline; the Node SPI narrative is the front door. The `Compat (import-only)` narrative must state that compat is a one-time migration importer, never the save/load path — that boundary gets re-broken otherwise.

### `@quanghuy1242/idco-reader`

Organized by the server/client boundary, which is the consumer's first decision: `Server Reader`, `L1 Blocks`, `L1 Marks`, `L1 Objects`, `L1 Table`, `Typography`, `Islands`.

### `@quanghuy1242/idco-lib`

`Styling`, `Guards`, `Auth Fetch`, `Rich Text`, `Constants`.

## Authoring gotchas (how tsc emits the doc-comments we parse)

The generator parses the emitted `.d.ts`, so two tsc behaviors shape where you put a tag. Both bit the first backfill.

1. **A clean `dist` is mandatory before generating.** A renamed or moved module leaves its old `.d.ts` behind (for example a flat `core/model.d.ts` left over after the split into `core/model/index.d.ts`). The resolver finds the stale flat file first and reads dead content, which silently undercounts the surface. The build scripts run `rm -rf dist` first for this reason; never run the generator against a `dist` that tsc did not just rebuild from clean.
2. **`@categoryDefault` must attach to a statement tsc keeps.** tsc drops a file-leading doc-comment when the next statement is an import it elides from the `.d.ts` (common in JSX-only React component files, where every value import is elided). The tag then vanishes and every export in the file lands uncategorized. Put `@categoryDefault` in its own block placed immediately before the first exported declaration, after the imports: `/** @categoryDefault Forms */`. That block survives every time. The same holds for a `@categoryDescription` you want to co-locate with a leaf module rather than the barrel.

## How a consumer uses the map

A global Claude Code skill (`idco-consumer`) tells an agent in a product repo to read `node_modules/@quanghuy1242/idco-<pkg>/api/README.md` first, then drill into the one category it needs, and never grep idco source. The map ships inside each package, so its version always matches the installed code, including under `pnpm dev:link`.

## Keeping it honest

The generator prints a coverage report (percent summarized, percent categorized) and the exact gap list on every run. `pnpm check:docs` runs the generator with `--check` for each package after the build; it exits non-zero if any public export is missing a summary or a category, so a new undocumented export fails CI. The whole surface sits at 100 percent today, so the gate is live in error mode. `pnpm build` regenerates the maps; `api/` is generated and gitignored, so never hand-edit a file under it and never commit one.
