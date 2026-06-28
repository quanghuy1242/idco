/**
 * Barrel for the document render pipeline (note.md VP4).
 *
 * One folder, one purpose: turning the model into rendered document content —
 * both the live editable surface and the static resting reader. It reads the SPI
 * registries (`../spi`) to render registered blocks/marks and the overlays
 * (`../overlays`) for caret geometry; it never owns overlays or chrome.
 *
 * - `block-dispatch.tsx`   — routes a node to its block renderer (no per-type branch)
 * - `text-block.tsx`       — the live editable text-leaf surface (EditContext host)
 * - `object-block.tsx`     — object-node host chrome + body
 * - `object-config.tsx`    — object gear/config form
 * - `resting-document.tsx` — the static, non-editable reader render
 * - `mark-render.tsx`      — inline mark wrapping (delegates to the mark registry)
 *
 * `mark-render.tsx` self-registers the built-in marks at module load (note.md
 * W4/F3); re-exporting it through this barrel preserves that load-time
 * registration for the standalone resting reader. Importers use `from "./render"` /
 * `from "../render"` so the folder is the unit.
 */
export * from "./block-dispatch";
export * from "./text-block";
export * from "./object-block";
export * from "./object-config";
export * from "./resting-document";
export * from "./mark-render";
export * from "./placeholder";
