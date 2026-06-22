/**
 * Barrel for the selection/caret overlay + DOM geometry cluster (note.md VP3).
 *
 * One folder, one purpose: turning store selection into on-screen overlays and
 * turning pointer/caret coordinates back into model positions. This is the only
 * part of the view that reads live DOM rects and draws absolutely-positioned
 * overlay layers; the render pipeline (`../render`) draws document content, never
 * overlays.
 *
 * - `selection-overlay.tsx` — the selection/caret/gap overlay layer + caretInk slot
 * - `touch-selection.tsx`   — touch range-handle interaction over the overlay
 * - `navigation.ts`         — caret/grapheme/word/line navigation over the DOM
 * - `geometry.ts`           — DOM rect / point math shared by the above
 * - `gap-cursor.ts`         — gap-cursor geometry (self-contained helpers)
 *
 * Importers use `from "./overlays"` / `from "../overlays"` so the folder is the unit.
 */
export * from "./selection-overlay";
export * from "./touch-selection";
export * from "./navigation";
export * from "./geometry";
export * from "./gap-cursor";
