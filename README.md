# idco

`idco` is the shared package workspace for the local `id` and `content-api` products. Local imports use the `@idco/*` namespace.

## Packages

- `@idco/ui` locally, published as `@quanghuy1242/idco-ui` — shared React admin/component system extracted from the auth product's local UI package.
- `@idco/lib` locally, published as `@quanghuy1242/idco-lib` — framework-free shared contracts and browser helpers extracted from the auth product's local library package.
- `@idco/content-renderer` locally, published as `@quanghuy1242/idco-content-renderer` — lightweight public rich-text renderer for serialized content documents.
- `@idco/editor` locally, published as `@quanghuy1242/idco-editor` — reserved package for editor-specific APIs; current shared rich-text primitives live in `@idco/ui`.

GitHub Packages requires the npm scope to match the account or organization namespace. The source and local workspace keep `@idco/*` import names; CI consumers install the GitHub Packages artifacts through npm aliases such as `@idco/ui -> npm:@quanghuy1242/idco-ui@0.1.0`.

## Commands

- `pnpm check` — format check, lint, duplicate-code gate, typecheck, tests, and package builds.
- `pnpm format` — write oxfmt formatting across packages and tests.
- `pnpm lint` — oxlint without product-specific architecture plugins.
- `pnpm check:dup` — Fallow duplicate-code threshold gate.
- `pnpm typecheck` — `tsc --noEmit`.
- `pnpm test` — Vitest UI/lib suite.
- `pnpm build` — package build outputs under `packages/*/dist`.
- `pnpm build:ladle` — static Ladle component gallery output under `.ladle/build`.

## Component gallery

The `pages` workflow publishes the static Ladle build to GitHub Pages on every push to `main` and on manual dispatch. The workflow runs `pnpm build:ladle` with `LADLE_BASE=/idco/` so asset URLs work from the repository Pages path:

```
https://quanghuy1242.github.io/idco/
```

## Publishing

Releases are explicit and git-tag-driven. Bump the package versions, commit, then push a `v*` tag:

```
git tag v0.1.1 && git push origin v0.1.1
```

Pushing the tag runs the `publish` workflow, which checks the repo and publishes every workspace package at its `package.json` version to GitHub Packages. The workflow verifies the tag matches the package versions (`v0.1.1` must equal each package's `version`), then publishes with the workflow `GITHUB_TOKEN` (`packages: write`). `workflow_dispatch` is kept for manual re-runs. There is no auto-versioning: the version you bump and tag is exactly what ships.

## How consumers use these packages

Consumers (`content-api`, `auth`) keep `@idco/*` import names and depend on the published artifacts through npm aliases, e.g. `"@idco/ui": "npm:@quanghuy1242/idco-ui@^0.1.0"`. This registry shape is the committed source of truth: CI and fresh clones resolve it from GitHub Packages with no local-path assumptions, frozen against the lockfile.

For the local inner loop, a consumer runs its `pnpm dev:link` (an env-gated `.pnpmfile.cjs` that rewrites the `@idco/*` keys to `link:` against this sibling checkout) so edits here show up immediately without publishing. The link is `node_modules`-only and opt-in; it never changes the committed dependency graph and needs no GitHub Packages token. Build this repo (`pnpm build`, or `tsc -w` per package) so the linked `dist` types stay current.

Shipping a cross-repo change is ordered: publish idco first (tag), then in the consumer run `pnpm update @idco/ui@latest` (or pin the new version) to re-pin and re-lock, commit, and deploy. If a consumer's CI cannot read GitHub Packages with its `GITHUB_TOKEN`, add an `IDCO_PACKAGES_TOKEN` secret with `read:packages`.
