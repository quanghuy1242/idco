# 033 - Consumer Integration Contract (CSS + SSR)

> Status: contract
>
> Date: 2026-06-28

## What this is

The setup a consumer repo (content-api, auth) must do to mount `@idco/editor` (and the sibling `@idco/ui` / `@idco/reader`) from the published package and get a correctly styled, non-crashing surface. It exists because the first real published-package consumer hit gaps that the in-repo Ladle never sees: Ladle builds against `packages` source with the full `.ladle/preview.css` and runs client-only, so it cannot reproduce a fresh consumer's build, CSS, or SSR path. This is the durable record of the contract; see `note.md` §5 for the originating bug/request analysis and `scripts/check-package-contract.mjs` for the gate that enforces the package side of it.

## 1. Tailwind: scan the installed package (`@source`)

`@idco/*` components are React Aria behavior + DaisyUI styling: their appearance is almost entirely DaisyUI/Tailwind utility classes baked into the component source (`btn`, `menu`, `modal`, `grid grid-cols-8`, and so on). Those classes only exist in the consumer's CSS if the consumer's Tailwind build scans the installed package for them. With Tailwind v4 and no scan, the classes are never generated and the UI renders structurally broken — the canonical symptom is the Insert table dimension picker collapsing into a single tall column because `grid-cols-8` was never emitted.

Add the installed packages to the consumer's Tailwind sources, next to the consumer's own `@source` lines:

```css
@import "tailwindcss";
@source "../node_modules/@quanghuy1242/idco-ui/dist/**/*.js";
@source "../node_modules/@quanghuy1242/idco-editor/dist/**/*.js";
@source "../node_modules/@quanghuy1242/idco-reader/dist/**/*.js";
```

The path is relative to the CSS file; adjust the depth to where `node_modules` sits. This is mandatory for any consumer — it is not editor-specific, it is how a Tailwind component library delivers its utilities.

## 2. Import the editor stylesheet (`styles.css`)

Some of the editor's appearance is NOT Tailwind utilities and NOT injected at runtime: the hand-written rules for tables (`.rt-table*`), check-lists (`.rt-checklist*`), and the Prism code-block palette (`.token.*`). The package ships them as a single stylesheet. Import it once at the app's CSS/JS entry:

```ts
import "@quanghuy1242/idco-editor/styles.css";
```

Without it, tables render unframed, check-lists show no box, and code blocks have no syntax colour. The stylesheet is theme-driven — every colour resolves to a DaisyUI `--color-*` custom property — so it inherits the host's active theme with no further configuration. The editor additionally self-injects its caret/selection and `.rt-*` prose typography at runtime, so those work without the import; the stylesheet covers the rest and is also what styles the server-rendered `@idco/reader` output (which cannot inject).

## 3. The editor is client-only: render with SSR disabled

`@idco/editor` is import-safe in a server / SSR module graph — a bare `import` of the barrel does not throw (guarded by `tests/ssr-import-safety.test.ts`). But the editor is an interactive client component: it must not be *rendered* on the server. In a framework that server-renders by default (Next.js, vinext), load the editor through a dynamic import with SSR disabled and behind an SSR-safe wrapper that imports the editor as a type only:

```ts
const RecordEditor = dynamic(() => import("./record-editor-impl"), {
  ssr: false,
});
```

`React.lazy` is insufficient — the bundler still evaluates the editor module during the SSR pass. The reader (`@idco/reader`) is the opposite: it is a true Server Component for static rendered content and is meant to run on the server.

## 4. Opening a new (empty) document

`createEditorStore` does not seed a block, and an empty `body.order: []` has no caret target, so seed a single empty paragraph for a brand-new document (via `makeTextNode({ type: "paragraph", content: { text: "", runs: [] } })`) until a first-class `emptyDocument()` factory ships (note.md §5.6, D3). An empty seeded paragraph paints a caret and is editable.

## What the package guarantees in return

Enforced by `pnpm check` so a regression fails the gate, not a consumer:

- The bake Web Worker URL in `dist` resolves to a file that actually ships (`check:package`, note.md §5.1 / B1).
- The `styles.css` contract ships and is reachable through `exports["./styles.css"]` with the table/check-list/token rules present (`check:package`, note.md §5.2 / B2).
- The package barrels import in a DOM-less module graph without throwing (`test:ssr`, note.md §5.4 / D1).
