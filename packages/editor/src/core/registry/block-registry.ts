/**
 * The generic runtime block registry for the owned-model editor.
 *
 * Why this file is separate from the object SPI (note.md CP1)
 * ----------------------------------------------------------
 * `object-registry.ts` is the SPI: the `NodeDefinition` contract a node author
 * implements, plus the built-in and global custom definitions. This file is the
 * runtime that *holds* those definitions and resolves them during compat
 * import/export and baking. The two were welded into one generically-named
 * `core/registry.ts`, which buried the SPI behind the runtime. They split so the
 * SPI half mirrors `structural-registry.ts` and the runtime half is named for
 * what it is.
 *
 * `BlockRegistry` is not object-specific by accident of history — every
 * `createDefaultBlockRegistry()` instance is the single registry threaded through
 * the store, bake service, compat, and editor handle. It depends *up* on the SPI
 * (`object-registry`) for its seed definitions and the default compat shape; the
 * SPI never depends back on it, so the layering stays one-directional.
 */
import type { ObjectNormalizationResult } from "./object-registry";
import {
  BUILT_IN_OBJECT_DEFINITIONS,
  compatObjectFromValue,
  globalNodeDefinitions,
  type NodeDefinition,
} from "./object-registry";
import type { RichTextCompatNode } from "../model";

/**
 * @categoryDefault Engine Core — Model
 */

/** Registry of object-block definitions used by compat import/export. */
export class BlockRegistry {
  readonly #definitions = new Map<string, NodeDefinition>();

  constructor(definitions: readonly NodeDefinition[] = []) {
    definitions.forEach((definition) => this.register(definition));
  }

  register(definition: NodeDefinition): void {
    /*
     * Duplicate registrations are rejected instead of "last write wins" because
     * object parsing is part of the persistence contract. Two definitions for
     * the same type would make import/export nondeterministic.
     */
    if (this.#definitions.has(definition.type)) {
      throw new Error(`Duplicate block definition: ${definition.type}`);
    }
    this.#definitions.set(definition.type, definition);
  }

  get(type: string): NodeDefinition | undefined {
    return this.#definitions.get(type);
  }

  require(type: string): NodeDefinition {
    const definition = this.get(type);
    if (!definition) throw new Error(`Unknown object block: ${type}`);
    return definition;
  }

  normalizeSnapshotObject(
    type: string,
    value: unknown,
  ): ObjectNormalizationResult {
    return this.require(type).normalizeData(value);
  }

  normalizeCompatObject(node: RichTextCompatNode): ObjectNormalizationResult {
    const definition = this.require(node.type);
    return definition.fromCompatNode?.(node) ?? definition.normalizeData(node);
  }

  toCompatObject(
    type: string,
    value: ObjectNormalizationResult,
  ): Omit<RichTextCompatNode, "id" | "type"> {
    const definition = this.require(type);
    return definition.toCompatNode?.(value) ?? compatObjectFromValue(value);
  }
}

/** Built-ins, globally-registered custom nodes, plus caller-provided definitions. */
export function createDefaultBlockRegistry(
  definitions: readonly NodeDefinition[] = [],
): BlockRegistry {
  return new BlockRegistry([
    ...BUILT_IN_OBJECT_DEFINITIONS,
    ...globalNodeDefinitions(),
    ...definitions,
  ]);
}
