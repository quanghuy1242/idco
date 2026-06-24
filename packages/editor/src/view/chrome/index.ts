/**
 * Barrel for the editor chrome — the contextual UI around the document (note.md VP2).
 *
 * One folder, one purpose: the surfaces a user drives the editor *through*, as
 * opposed to the document render itself. All read the SPI registries (`../spi`)
 * and dispatch store commands; none own document rendering or DOM geometry.
 *
 * - `surfaces/`           — the command-surface hosts + coordinator (docs/024 §5.8):
 *                           ribbon, context menu, selection flyout, slash menu, the
 *                           §8 coordinator, and the built-in command declarations
 * - `link-popover.tsx`    — click-to-edit link editing popover (a child overlay)
 * - `find-bar.tsx`        — find-in-page bar + controller (backs the ribbon's find)
 * - `chrome-commands.ts`  — store commands shared by surfaces (the single source for
 *                           list-toggle etc., note.md W6)
 *
 * Importers use `from "./chrome"` / `from "../chrome"` so the folder is the unit.
 * Per-block floating chrome (callout, table) is NOT here — it co-locates with its
 * node view under `nodes/` (note.md VP5).
 */
export * from "./surfaces";
export * from "./panes";
export * from "./link-popover";
export * from "./find-bar";
export * from "./chrome-commands";
