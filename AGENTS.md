Before touching shared UI code, load the `idco-ui` skill from `.agents/skills/idco-ui/SKILL.md`.

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

## UI package rules

`@idco/ui` is the shared React component package used by `auth` and `content-api`. Shared primitives, icon registration, DaisyUI/React Aria behavior, typed visual props, and theme-adjacent helpers belong here. Product routes, generated clients, OAuth/session flows, and content/auth-specific data fetching stay in the consuming product repos.

- Add new components under `packages/ui/src/`, export them from `packages/ui/src/index.ts`, and add or extend tests under `tests/ui/`.
- Keep component modules side-effect-free. Do not switch `packages/ui/package.json` from `"sideEffects": false` to `true`; if a file ever needs a side effect, list that file explicitly.
- Use typed props such as `variant`, `size`, `tone`, `density`, `placement`, and `iconName` instead of exposing raw visual `className` as the main API.
- Do not hardcode `sm` as the default size for controls. Default to `md` and expose a typed size prop.
- Do not use `btn-neutral` for action variants. Use the existing typed secondary/outline mapping or add a deliberate typed tone.
- Register icons in `packages/ui/src/nav-icons.tsx` before using their `iconName` string.
- Prefer React Aria hooks plus native inputs for DaisyUI controls that rely on native selectors such as `:checked`; do not fake visible indicators around hidden inputs.
- Keep DaisyUI 5 citation comments at the top of component files when a DaisyUI primitive informs the styling.

## Package manager

`pnpm@11.1.2` via corepack.
