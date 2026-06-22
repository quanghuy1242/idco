/**
 * Barrel for the node-type registry family (note.md CP1).
 *
 * Three concerns sit here as sibling files: the object SPI
 * (`object-registry.ts`), the generic runtime registry that holds and resolves
 * object definitions (`block-registry.ts`), and the structural-container SPI
 * (`structural-registry.ts`). `flat-blocks.ts` (the intrinsic flat-block import
 * table, note.md W3) is deep-imported by `compat` and intentionally not surfaced
 * here. Importers use `from "./registry"` / `from "../registry"` so the folder
 * is the unit, mirroring `commands/` and `store/`.
 */
export * from "./object-registry";
export * from "./block-registry";
export * from "./structural-registry";
