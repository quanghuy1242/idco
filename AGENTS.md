Before touching shared UI code, load the `idco-ui` skill from `.agents/skills/idco-ui/SKILL.md`.

**Non-negotiable UI philosophy:** every interactive primitive in `@idco/ui` is **React Aria behavior + DaisyUI styling**. Use React Aria (`react-aria` / `react-aria-components` / `react-stately`) for all behavior — focus, keyboard, ARIA, overlays, selection, dismissal — and DaisyUI 5 semantic classes for all appearance. Hand-rolling a dialog, dropdown, tooltip, tabs, toggle, listbox, date picker, etc. is forbidden, or a documented last resort only after confirming neither covers the need. Do not guess APIs: use the **`react-aria` MCP tool** (`list_react_aria_pages` / `get_react_aria_page`) for React Aria, and **context7** for DaisyUI class names and DOM structure. The skill carries the full hooks-vs-components rule, the DaisyUI convention rules, and the docs contract.

## Commands

- `pnpm check` — full gate: format check → lint → duplicate gate → typecheck → test → build
- `pnpm format` — oxfmt write across packages and tests
- `pnpm format:check` — oxfmt verify
- `pnpm lint` — oxlint plus local architecture/package-boundary rules
- `pnpm lint:fix` — auto-correct safe lint issues
- `pnpm check:dup` — duplicate-code gate with Fallow
- `pnpm typecheck` — `tsgo --noEmit`
- `pnpm typecheck:tsc` — classic `tsc --noEmit` fallback
- `pnpm test` — Vitest suite through `vitest.config.ts`
- `pnpm build` — package builds

## Architecture lint

The oxlint plugin at `scripts/oxlint-js-plugins/architecture.js` protects the shared-package boundary. Rules are wired in `.oxlintrc.json`. Fix code that violates the boundary; do not loosen the rules to pass lint.

Current invariants:

- `packages/ui` and `packages/lib` must stay product-neutral. They must not import product worker source, content-api framework modules, Better Auth, Drizzle, Hono, Cloudflare runtime types, or persistence/auth runtime dependencies.
- `packages/ui` source modules must remain side-effect-free. Consumers own app-global CSS, Tailwind setup, DaisyUI theme definitions, and portal theme placement.
- Consumers must not compensate for missing primitives by hand-rolling UI in product repos. When `content-api` or `auth` needs reusable admin layout, typography, modal, menu, table, action, or form behavior, add the product-neutral primitive here with tests, publish a tagged idco release, then have the consumer repin the registry alias.

## Code comments and architecture notes

JSDoc and file headers are required but they are not enough for new architecture, infrastructure, or compatibility layers. When adding or rewriting schedulers, transactions, model/store code, reconciliation, browser bridges, polyfills, compatibility adapters, performance queues, or other non-obvious control flow, add explanatory comments inside the actual code path.

- Comments must explain why the branch, queue, invariant, ordering rule, or fallback exists; how data moves through the flow; and what breaks if a future edit changes it.
- Put gotchas next to the code that carries the gotcha: browser quirks, race boundaries, coalescing rules, reference-implementation differences, transaction ordering, stale-state hazards, cleanup timing, and performance tradeoffs belong inline.
- For code derived from or replacing an older implementation, document the reference boundary and the intentional differences where they affect behavior. Say whether the old code was used only as a reference, whether it is imported, and why the new version diverges.
- Avoid comments that merely restate the next line of code. The goal is to preserve architecture reasoning and maintenance hazards that are not obvious from syntax.
- Before declaring an architecture slice done, scan every new or changed architecture file and confirm the explanation exists in the code flow, not only at the top of the file.

## Cross-repo release (do this, do not improvise)

Edit idco here → in the consumer run `pnpm dev:link` and prove `pnpm check` passes against your local idco → bump the version in EVERY publishable `packages/*/package.json` (and the root) to the same `X.Y.Z` so it matches the tag (the publish workflow verifies tag == every package version) → commit, `git tag vX.Y.Z && git push origin main vX.Y.Z` (the tag triggers publish) → back in the consumer run `pnpm dev:unlink` to repin the registry. Never hand-symlink `node_modules/@idco/*` and never delete the consumer lockfile for a full reinstall — `dev:link`/`dev:unlink` are the only supported paths and `dev:unlink` keeps the lockfile registry-clean with a minimal diff.

## UI package rules

`@idco/ui` is the shared React component package used by `auth` and `content-api`. Shared primitives, icon registration, DaisyUI/React Aria behavior, typed visual props, and theme-adjacent helpers belong here. Product routes, generated clients, OAuth/session flows, and content/auth-specific data fetching stay in the consuming product repos.

- Add new components under `packages/ui/src/`, export them from `packages/ui/src/index.ts`, and add or extend tests under `tests/ui/`.
- Keep component modules side-effect-free. Do not switch `packages/ui/package.json` from `"sideEffects": false` to `true`; if a file ever needs a side effect, list that file explicitly.
- Use typed props such as `variant`, `size`, `tone`, `density`, `placement`, and `iconName` instead of exposing raw visual `className` as the main API.
- Do not use native `<dialog>` for modal surfaces. Use React Aria `ModalOverlay`/`Modal`/`Dialog` with DaisyUI 5 `modal`/`modal-box` classes so focus management, dismissal, theme placement, and accessibility stay consistent.
- Do not hardcode `sm` as the default size for controls. Default to `md` and expose a typed size prop.
- Do not use `btn-neutral` for action variants. Use the existing typed secondary/outline mapping or add a deliberate typed tone.
- Register icons in `packages/ui/src/nav-icons.tsx` before using their `iconName` string.
- Prefer React Aria hooks plus native inputs for DaisyUI controls that rely on native selectors such as `:checked`; do not fake visible indicators around hidden inputs.
- Keep DaisyUI 5 citation comments at the top of component files when a DaisyUI primitive informs the styling.

## Package manager

`pnpm@11.1.2` via corepack.

## Consumer boundary audit

When changing shared UI for a consumer, run the consumer's boundary scans before declaring success. For content-api admin work, the expected clean scan is `rg -n '<(div|main|section|header|footer|aside|nav|h[1-6]|p|span|ul|ol|li|a|button|dialog|form|input|select|textarea)\b|className=' packages/ui/src/admin workers/ui/src || true` from `/home/quanghuy1242/pjs/content-api`; any hit should be fixed by using or adding an `@idco/ui` primitive, not by adding custom product-local markup.

## Markdown rule

In Markdown files (docs, README, planning trackers), do not hard-wrap prose. Write each paragraph and each list item (including blockquote lines) as a single line and let it soft-wrap; never insert manual mid-sentence line breaks to fit a column width. Match the existing one-line-per-paragraph style of the file you are editing. Use skill stop-slop when writing docs.
