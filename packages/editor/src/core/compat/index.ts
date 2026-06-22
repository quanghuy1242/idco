/**
 * Barrel for the compat / dialect-adapter cluster (note.md CP3).
 *
 * The import/export boundary between the owned model and foreign document
 * dialects: `compat.ts` (the rich-text compat document — import from / export to
 * the legacy node JSON the corpus stores) and `payload-import.ts` (the Payload
 * Lexical dialect adapter). Both translate an outside shape into the owned model
 * and back; neither is part of the live editing engine. Importers use
 * `from "./compat"` / `from "../compat"` so the folder is the unit.
 */
export * from "./compat";
export * from "./payload-import";
