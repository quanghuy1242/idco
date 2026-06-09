---
name: idco-ui
description: Maintain the `@idco/ui` shared component package in `/home/quanghuy1242/pjs/idco`. Use when creating, modifying, or reviewing components under `packages/ui/src/**`, package tests under `tests/ui/**`, theme helpers, package exports, or consumer-facing UI package contracts.
---

# idco UI

## Purpose

`@idco/ui` is the shared React component system used by the local `id` and `content-api` products. It was extracted from auth's former `@id/ui` package and must stay product-neutral: no Better Auth imports, no content-api imports, no worker source imports, and no route-specific data fetching.

## Workflow

1. Work in `/home/quanghuy1242/pjs/idco`.
2. For a new component, add it under `packages/ui/src/`, keep the module side-effect-free, export it from `packages/ui/src/index.ts`, and add/extend a matching test under `tests/ui/`.
3. Every component file should keep its DaisyUI 5 citation comment where a DaisyUI primitive informs the styling.
4. Use typed props such as `variant`, `size`, `tone`, and `iconName` instead of exposing raw visual `className` as the main styling API.
5. Keep route and product code out of `@idco/ui`; products compose these primitives in their own workers.
6. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` after package changes; `pnpm check` is the full gate.

## Theme Contract

The package uses the `idco` theme identity:

- storage key: `idco-theme`
- light theme: `idco-light`
- dark theme: `idco-dark`

Consumers provide matching DaisyUI theme definitions in their app CSS. Components should use DaisyUI semantic classes (`bg-base-100`, `text-primary`, `border-base-300`) and should not hardcode color hex values.

## Hard Rules

- Do not import worker source from `packages/ui`.
- Do not import Better Auth, Drizzle, Hono, Cloudflare runtime types, or content-api framework modules from `packages/ui`.
- Do not import `lucide-react` directly in product route files; expose icons through `NavIcon` and `iconName` props where possible.
- Do not create fake indicators for DaisyUI controls that depend on native selectors such as `:checked`; use React Aria hooks with native inputs.
- Do not switch `packages/ui/package.json` from `"sideEffects": false` to `true`. If one file ever needs a side effect, list that file explicitly.

## Package Map

- `packages/ui/src/` — component implementation source.
- `tests/ui/` — package-level component tests.
- `.ladle/mocks/next-link.tsx` — test mock for components that use `next/link`.
- `packages/lib/src/` — framework-free shared helpers and contracts used by product UI code.
