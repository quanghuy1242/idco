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
 * - `overlay-anchor.ts`     — `AnchorRef` → viewport rect for the overlay authority (docs/029 §7.4)
 * - `gap-cursor.ts`         — gap-cursor geometry (self-contained helpers)
 * - `review-change-indicator.tsx` — the live per-block change indicator (docs/036 §6.2.1, R6-I)
 *
 * Importers use `from "./overlays"` / `from "../overlays"` so the folder is the unit.
 *
 * `review-change-indicator.tsx` is the one member that is not a caret/selection geometry layer: it
 * decorates changed blocks' existing DOM elements during review (the human-edit half of R6-I),
 * placed here as an overlay in the review sense, not the DOM-rect sense.
 */
export * from "./selection-overlay";
export * from "./touch-selection";
export * from "./navigation";
export * from "./geometry";
export * from "./overlay-anchor";
export * from "./gap-cursor";
export * from "./review-change-indicator";
