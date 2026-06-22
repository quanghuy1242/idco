/**
 * Barrel for the document-model cluster (note.md CP2).
 *
 * The framework-free document spine and its transaction/position primitives:
 * `model.ts` (node graph, text content, selections), `steps.ts` (invertible
 * transaction steps), `mapping.ts` (position mapping across steps), and
 * `marks.ts` (mark resolution/segmentation over a leaf). The cluster is
 * internally closed — these four import only each other and nothing else in
 * `core/` — which is why it moves as one unit. Importers use `from "./model"` /
 * `from "../model"` so the folder is the unit, mirroring `commands/`/`store/`.
 */
export * from "./model";
export * from "./steps";
export * from "./mapping";
export * from "./marks";
