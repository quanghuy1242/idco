/**
 * Barrel for the view-layer SPI — the host extension surface (note.md VP1).
 *
 * One folder, one purpose: everything a host registers to teach the editor a new
 * block, container, mark, or text-leaf type, paired by `type` with its
 * framework-free `core/` half. Four registries live here and nothing else:
 *
 * - `node-view.ts`        — object blocks (the React half of `NodeDefinition`)
 * - `structural-view.ts`  — structural containers (the React half of `StructuralDefinition`)
 * - `mark-registry.ts`    — inline marks (render + toolbar metadata)
 * - `block-type-registry.ts` — text-leaf block types (chooser + aria role)
 * - `toolbar-action-registry.ts` — toolbar action descriptors (docs/023 §5.2)
 * - `toolbar-layout.ts`   — toolbar tabs/slots + the pure `computeToolbarLayout` (docs/023 §5.5)
 *
 * `node-view` depends on `structural-view` (an object block may host structure);
 * `toolbar-layout` depends on the mark/node/structural registries + the action
 * registry; the others depend only on `core/`. Importers use `from "./spi"` /
 * `from "../spi"` so the folder is the unit, mirroring `nodes/` and `controllers/`.
 */
export * from "./node-view";
export * from "./structural-view";
export * from "./mark-registry";
export * from "./block-type-registry";
export * from "./toolbar-action-registry";
export * from "./toolbar-layout";
