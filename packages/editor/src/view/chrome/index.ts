/**
 * Barrel for the editor chrome — the contextual UI around the document (note.md VP2).
 *
 * One folder, one purpose: the surfaces a user drives the editor *through*, as
 * opposed to the document render itself. All read the SPI registries (`../spi`)
 * and dispatch store commands; none own document rendering or DOM geometry.
 *
 * - `editor-chrome.tsx`   — the main toolbar (`EditorToolbar`)
 * - `toolbar-builtins.tsx`— the built-in Home/Insert tabs+slots+actions (docs/023 §7)
 * - `context-menu.tsx`    — the right-click block/format menu
 * - `link-popover.tsx`    — click-to-edit link editing popover
 * - `find-bar.tsx`        — find-in-page bar + controller
 * - `chrome-commands.ts`  — store commands shared by toolbar + context menu (the
 *                           single source for list-toggle etc., note.md W6)
 *
 * Importers use `from "./chrome"` / `from "../chrome"` so the folder is the unit.
 * Per-block floating chrome (callout, table) is NOT here — it co-locates with its
 * node view under `nodes/` (note.md VP5).
 */
export * from "./editor-chrome";
export * from "./toolbar-builtins";
export * from "./context-menu";
export * from "./link-popover";
export * from "./find-bar";
export * from "./chrome-commands";
