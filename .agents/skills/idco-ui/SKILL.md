---
name: idco-ui
description: Maintain the `@idco/ui` shared component package in `/home/quanghuy1242/pjs/idco`. Use when creating, modifying, or reviewing components under `packages/ui/src/**`, package tests under `tests/ui/**`, theme helpers, package exports, React Aria behavior, DaisyUI styling, or consumer-facing UI package contracts.
---

# idco UI

## Purpose

`@idco/ui` is the shared React component system used by the local `id` and `content-api` products. It was extracted from auth's former `@id/ui` package and must stay product-neutral: no Better Auth imports, no content-api imports, no worker source imports, and no route-specific data fetching.

## Core philosophy (read first)

Every interactive primitive in this package is **React Aria behavior + DaisyUI styling**. Hold this line:

- **React Aria owns behavior.** Focus management, keyboard navigation, ARIA wiring, overlay/portal lifecycle, selection, and dismissal come from `react-aria` / `react-aria-components` / `react-stately`. Do not reimplement any of it by hand.
- **DaisyUI owns appearance.** Visual styling comes from DaisyUI 5 semantic classes (`btn`, `modal`, `menu`, `input`, `badge`, `table`, …) plus the theme tokens. Do not invent bespoke CSS where a DaisyUI primitive exists.
- **Hand-rolling is forbidden — or a genuine last resort.** Before writing a custom dropdown, dialog, tooltip, toggle, tabs, listbox, date picker, etc., assume React Aria already provides the behavior and DaisyUI already provides the look. Reach for a hand-rolled component only when you have confirmed (via the docs tools below) that neither covers the need, and say so explicitly when you do.
- **The one sanctioned exception is the hooks-vs-components split:** when a DaisyUI class depends on a native element selector (`:checked`, file-input state, etc.), use a React Aria **hook** with a native input rather than the React Aria **component** wrapper. That is still React Aria behavior — it is not hand-rolling. See "DaisyUI And React Aria Rules" below.

## Documentation & tooling contract

Do not guess React Aria or DaisyUI APIs from memory — both move faster than training data. Before adding or changing a primitive:

- **React Aria → use the `react-aria` MCP tool.** Call `list_react_aria_pages` to find the relevant component/hook, then `get_react_aria_page` for its current props, state hooks, and render-prop contract. Use this for every new interactive primitive and whenever you are unsure which hook or wrapper to use.
- **DaisyUI → use context7.** Resolve the DaisyUI library and query the component you are styling to confirm the current class names, modifiers, and required DOM structure before applying classes. Prefer this over recalling class names.
- **llms.txt fallbacks (authoritative contracts):** DaisyUI 5 — https://daisyui.com/llms.txt (components: https://daisyui.com/components/). React Aria — https://react-aria.adobe.com/llms.txt (components: https://react-spectrum.adobe.com/react-aria/components.html).
- Keep the DaisyUI 5 citation comment at the top of a component file when a DaisyUI primitive informs its styling, so the source of a class choice stays traceable.

## Workflow

1. Work in `/home/quanghuy1242/pjs/idco`.
2. For a new component, add it under `packages/ui/src/`, keep the module side-effect-free, export it from `packages/ui/src/index.ts`, and add/extend a matching test under `tests/ui/`.
3. Every component file should keep its DaisyUI 5 citation comment where a DaisyUI primitive informs the styling.
4. Use typed props such as `variant`, `size`, `tone`, and `iconName` instead of exposing raw visual `className` as the main styling API.
5. Keep route and product code out of `@idco/ui`; products compose these primitives in their own workers. If a product needs reusable admin layout, typography, modal, menu, table, action, or form behavior, add a product-neutral primitive here instead of allowing product-local custom UI.
6. Register any new `iconName` string in `packages/ui/src/nav-icons.tsx` before exposing it through `Button`, `NavLink`, `DockLink`, or navigation-related props.
7. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` after package changes; `pnpm check` is the full gate.

## Theme Contract

The package uses the `idco` theme identity:

- storage key: `idco-theme`
- light theme: `idco-light`
- dark theme: `idco-dark`

Consumers provide matching DaisyUI theme definitions in their app CSS. Components should use DaisyUI semantic classes (`bg-base-100`, `text-primary`, `border-base-300`) and should not hardcode color hex values.

## Hard Rules

- Do not import worker source from `packages/ui`.
- Do not import Better Auth, Drizzle, Hono, Cloudflare runtime types, or content-api framework modules from `packages/ui`.
- Do not import product source, worker source, content-api framework modules, Better Auth, Drizzle, Hono, Cloudflare runtime types, or persistence/signing runtime dependencies from `packages/ui` or `packages/lib`.
- Do not import `lucide-react` directly in product route files; expose icons through `NavIcon` and `iconName` props where possible.
- Do not expose raw `className` as the primary API on new components. Route consumers should select typed props such as `variant`, `size`, `tone`, `density`, `placement`, and `iconName`.
- Do not use native `<dialog>` for modal surfaces. Use React Aria `ModalOverlay`/`Modal`/`Dialog` with DaisyUI 5 `modal`/`modal-box` classes.
- Do not hardcode `sm` as a default size in controls; default to `md` and expose a typed `"sm" | "md"` prop when smaller controls are needed.
- Do not use `btn-neutral` for button variants; neutral is not a portable product action tone. Use the typed `secondary`/outline mapping or add a deliberate typed tone.
- Do not create fake indicators for DaisyUI controls that depend on native selectors such as `:checked`; use React Aria hooks with native inputs.
- Do not switch `packages/ui/package.json` from `"sideEffects": false` to `true`. If one file ever needs a side effect, list that file explicitly.
- Do not import app-global CSS from `packages/ui/src/**`. Consumers own global CSS, Tailwind setup, and DaisyUI theme definitions.

## DaisyUI And React Aria Rules

- **Hooks vs. components for native-selector styling:** When a DaisyUI class depends on a native element selector (`:checked`, `:is([type="radio"])`, toggle/checkbox/switch state, file-input state), prefer a `react-aria` **hook** paired with a native `<input>` over the `react-aria-components` **wrapper**. RAC wraps the native input in a clipped `HiddenInput` and renders custom indicator elements, so DaisyUI classes on those indicators cannot produce `:checked` styles, size variants, or animations. Use the hook (`useRadioGroup`/`useRadio`, `useCheckbox`/`useToggleState`, `useSwitch`, …): it returns `inputProps` (type, checked, onChange, keyboard handlers, ARIA) to spread onto a native input that carries the DaisyUI class directly. You keep full React Aria keyboard + ARIA behavior while DaisyUI's native pseudo-classes work. Reference implementation: `packages/ui/src/form.tsx`. Dependencies `react-aria` and `react-stately` are declared in `packages/ui/package.json`.
- **Never fake an indicator.** Do not create a `<span>`/`<div>` with DaisyUI classes as a stand-in for RAC's hidden input — that loses `:checked`/`:focus-visible` behavior and DaisyUI animations. Use hooks + native inputs instead.
- React Aria portals render on `body`, outside consumer-local wrappers. Consumers must put theme attributes where portals can see them; component code should not assume a nested provider wrapper is enough.

## DaisyUI Convention Rules

These encode mistakes that are easy to repeat. Confirm class names against context7 / the DaisyUI llms.txt before applying, but follow these conventions:

1. **Collapsible menu:** Use `<details open>` with a bare `<summary>` — no extra classes on `<summary>`; the parent `menu` class handles styling. Do NOT use `menu-title` on `<summary>`; `menu-title` is for static, non-collapsible section headers only.
2. **Dock icon sizing:** `size-[1.2em]` IS the DaisyUI-native pattern (it appears in every dock example). It is em-relative and scales with the dock font size. Map it inside the component variant; never second-guess it or pass it as a raw string from a consumer route.
3. **Dock size default:** `dock-md` is the DaisyUI default (no modifier needed). `dock-sm`/`dock-xs`/`dock-lg`/`dock-xl` add the respective class.
4. **Menu active item:** Use DaisyUI's `menu-active` class on the `<a>`. Do not use custom font/text classes for active state.
5. **DaisyUI-shown inner classes are native:** When DaisyUI docs show a class on an element inside a component (e.g. `size-[1.2em]` on the SVG inside dock), that class IS the native approach. Map it to a typed prop inside the component; never pass it as a raw string from a consumer route.
6. **`FilterDropdown` trigger:** Use `select select-bordered` (not `btn btn-neutral`). Add `bg-none` to suppress DaisyUI's built-in CSS background-image arrow — without it you get two arrows (the `select` arrow plus the custom chevron icon).
7. **`FilterDropdown` popover width:** React Aria's `Popover` sets `--trigger-width`. Use `w-(--trigger-width)` on `Popover` and `w-full` on `ListBox`. Do NOT read `ref.current?.offsetWidth` during render — refs are not reactive and the value is stale on first open.
8. **`FilterDropdown` popover animation:** React Aria sets `data-entering`/`data-exiting` on `Popover`. Apply `data-[entering]:animate-popover-in data-[exiting]:animate-popover-out` so Select popovers keep the native expand/collapse feel.
9. **`ConfirmDialog` classes:** Use `modal modal-open bg-black/40` on `ModalOverlay`, `modal-box` on `Modal`, `modal-action` on the button row. Always keep `bg-black/40` — `div.modal` has no backdrop color (`dialog::backdrop` only exists on native `<dialog>`, not React Aria's div overlay). `modal-open` is required because DaisyUI hides `div.modal` by default. Do not put `data-theme` on the overlay (the global `[data-theme]` background rule can override the dimmed backdrop); put the theme attribute on the `modal-box` panel instead.
10. **Modal enter/exit animations:** React Aria sets `data-entering`/`data-exiting` on `ModalOverlay` and `Modal` and holds elements in the DOM until the exit animation finishes. Define `@keyframes` and `@theme` animation variables in consumer `globals.css`; apply as `data-[entering]:animate-modal-overlay-in data-[exiting]:animate-modal-overlay-out` etc. No plugin needed — native Tailwind v4 + React Aria.
11. **Portal theme scope (Ladle/consumers):** React Aria portals (ConfirmDialog, FilterDropdown popover) render on `<body>`, outside any local `data-theme` wrapper. The effect that stamps `data-theme` onto `document.documentElement` and `document.body` is essential — without it, portalled stories get no theme tokens and show wrong colors. Do not remove or simplify it.
12. **Register icons before use:** Before exposing any `iconName` string through `Button`, `NavLink`, `DockLink`, etc., add the lucide-react export to both the import list and the `iconMap` in `packages/ui/src/nav-icons.tsx`. Icon names are PascalCase (`"Plus"`, `"Users"`, `"KeyRound"`, `"RefreshCw"`, `"Copy"`, …). Unknown names render nothing.

## References

- `packages/ui/src/` — component implementation source (source of truth for prop shapes).
- `packages/ui/src/form.tsx` — reference for the react-aria-hooks + native-input pattern.
- `packages/ui/src/nav-icons.tsx` — `iconMap` registry; register icons here before use.
- `tests/ui/` — package-level component tests.
- React Aria MCP tool — `list_react_aria_pages` / `get_react_aria_page` for current component & hook APIs.
- context7 — DaisyUI 5 class names, modifiers, and required DOM structure.
- DaisyUI 5: https://daisyui.com/components/ · contract: https://daisyui.com/llms.txt
- React Aria: https://react-spectrum.adobe.com/react-aria/components.html · contract: https://react-aria.adobe.com/llms.txt

## Consumer Audit

- For content-api admin work, run `rg -n '<(div|main|section|header|footer|aside|nav|h[1-6]|p|span|ul|ol|li|a|button|dialog|form|input|select|textarea)\b|className=' packages/ui/src/admin workers/ui/src || true` from `/home/quanghuy1242/pjs/content-api` before declaring success. The expected result is empty; if it is not empty, add/use an idco primitive rather than leaving product-local custom UI.

## Package Map

- `packages/ui/src/` — component implementation source.
- `tests/ui/` — package-level component tests.
- `.ladle/mocks/next-link.tsx` — test mock for components that use `next/link`.
- `packages/lib/src/` — framework-free shared helpers and contracts used by product UI code.
