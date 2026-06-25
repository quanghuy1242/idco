/**
 * Barrel for the view-layer SPI — the host extension surface (note.md VP1).
 *
 * One folder, one purpose: everything a host registers to teach the editor a new
 * block, container, mark, or text-leaf type, paired by `type` with its
 * framework-free `core/` half. Four registries live here and nothing else:
 *
 * - `node-view.ts`        — object blocks (the React half of `NodeDefinition`)
 * - `data-source-registry.ts` — host data sources reference blocks project (docs/026 §6.1)
 * - `structural-view.ts`  — structural containers (the React half of `StructuralDefinition`)
 * - `mark-registry.ts`    — inline marks (render + toolbar metadata)
 * - `block-type-registry.ts` — text-leaf block types (chooser + aria role)
 * - `command-registry.ts` — surface-neutral command descriptors (docs/024 §5.2)
 * - `command-surface.ts`  — the flat-surface projector `resolveCommandList` (docs/024 §5.5)
 * - `anchor-target.ts`    — overlay contributor contracts + registry (docs/029 §4.6/§4.7)
 * - `overlay-positioning.ts` — pure central positioning solve (docs/029 §7.4)
 * - `overlay-authority.ts` — the overlay authority engine + `useOverlayAuthority` (docs/029 §4/§7)
 * - `toolbar-layout.ts`   — ribbon tabs/slots + the pure `computeToolbarLayout` (docs/023 §5.5)
 *
 * `node-view` depends on `structural-view` (an object block may host structure);
 * `command-surface` + `toolbar-layout` depend on the mark/node/structural registries
 * + the command registry; the others depend only on `core/`. Importers use
 * `from "./spi"` / `from "../spi"` so the folder is the unit, mirroring `nodes/` and
 * `controllers/`.
 */
export * from "./node-view";
export * from "./data-source-registry";
export * from "./structural-view";
export * from "./schema-profile";
export * from "./mark-registry";
export * from "./block-type-registry";
export * from "./command-registry";
export * from "./command-surface";
export * from "./anchor-target";
export * from "./overlay-positioning";
export * from "./overlay-authority";
export * from "./toolbar-layout";
export * from "./side-panel-registry";
export * from "./document-collection-registry";
export * from "./comment-source-registry";
