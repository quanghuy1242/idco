/**
 * Barrel for the command-surface hosts (docs/024 §5.8).
 *
 * The four command surfaces + the coordinator + the built-in command declarations are
 * a cohesive cluster (all consume `resolveCommandList`/`computeToolbarLayout`), so they
 * live in `chrome/surfaces/` the way the registries earned `spi/`. The shared chrome
 * helpers (`link-popover`, `find-bar`, `chrome-commands`) stay at the chrome root.
 *
 * - `ribbon.tsx`            — the persistent toolbar (`EditorToolbar`)
 * - `context-menu.tsx`      — right-click menu (`EngineContextMenu`)
 * - `slash-menu.tsx`        — caret-anchored insert/turn-into list (`SlashMenu`)
 * - `use-command-surfaces.ts` — the §8 coordinator (`useCommandSurfaces`)
 * - `command-builtins.tsx`  — built-in tabs/slots/commands (`registerBuiltInCommands`)
 * - `use-store-version.ts`  — shared selection+commit subscription hook
 * - `overlay-layer.tsx`     — the overlay authority render layer (`OverlayLayer`, docs/029 §4.7D)
 */
export * from "./ribbon";
export * from "./context-menu";
export * from "./slash-menu";
export * from "./overlay-layer";
export * from "./overlay-content";
export * from "./overlay-builtins";
export * from "./use-command-surfaces";
export * from "./command-builtins";
export * from "./use-store-version";
export * from "./use-is-mobile";
export * from "./side-panel-dock";
