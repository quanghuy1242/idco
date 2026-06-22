/**
 * The table block — its full view feature (note.md VP5).
 *
 * One folder, one block: the table's structural node views plus the floating
 * chrome they own, co-located so the block is a self-contained unit instead of a
 * node view in `nodes/` reaching up into flat `view/` files (the VF2 smell).
 *
 * - `table.tsx`              — the structural node views (live + resting render, caretInk)
 * - `table-controls.tsx`     — hover overlay: insert/delete/resize + table chrome
 * - `table-interactions.tsx` — cell-range selection + cell-action button
 *
 * The two overlays register through the view `renderOverlay` SPI slot (note.md W1),
 * so nothing outside this folder imports them. `nodes/index.ts` imports the
 * structural views from this barrel.
 */
export * from "./table";
