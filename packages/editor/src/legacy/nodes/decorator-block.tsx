/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import type { ElementFormatType, Klass } from "lexical";
import type { ComponentType } from "react";
import type { RichTextEditorNode } from "../model/schema";
import {
  RichTextDecoratorBlockNode,
  useDecoratorNodeUpdater,
  useRemoveNode,
  type SerializedRichTextDecoratorNode,
} from "./base";
import { VirtualizedDecoratorBody } from "./decorator-virtualization";
import { richTextNodeSignature } from "../model/signatures";

/**
 * A decorator-block class as produced by `defineDecoratorBlock`: a Lexical
 * `Klass` plus the static `normalizeData` the registry reads to enumerate
 * blocks without restating their normalizer.
 */
export type DecoratorBlockNodeClass = Klass<RichTextDecoratorBlockNode> & {
  normalizeData(node: RichTextEditorNode): RichTextEditorNode;
};

/**
 * Props every decorator-block editor receives — the contract the chrome system
 * standardizes on. A block is its data (`node`) plus two state operations:
 * `update` patches the data (persisted into the Lexical state as JSON), `remove`
 * deletes the block. Editors render their own `BlockShell`/chrome because a
 * block's icon and actions can be data-derived (e.g. the callout tone icon).
 */
export type DecoratorBlockProps = {
  readonly node: RichTextEditorNode;
  readonly nodeKey: string;
  readonly update: (patch: Partial<RichTextEditorNode>) => void;
  readonly remove: () => void;
};

type DecoratorBlockSpec = {
  /** Canonical node type — the persisted `type` and the registry key. */
  readonly type: string;
  /** Coerce stored/legacy JSON into this block's data shape. */
  readonly normalize: (node: RichTextEditorNode) => RichTextEditorNode;
  /** The block body + chrome, given the wired state operations. */
  readonly Editor: ComponentType<DecoratorBlockProps>;
};

/** Wires the per-key state operations once, then renders the block's editor. */
function DecoratorBlockHost({
  Editor,
  node,
  nodeKey,
}: {
  readonly Editor: ComponentType<DecoratorBlockProps>;
  readonly node: RichTextEditorNode;
  readonly nodeKey: string;
}) {
  const update = useDecoratorNodeUpdater(nodeKey);
  const remove = useRemoveNode(nodeKey);
  return (
    <Editor node={node} nodeKey={nodeKey} update={update} remove={remove} />
  );
}

/**
 * Build a Lexical decorator-block node class from a small spec. Captures the
 * boilerplate every block shares — `DecoratorBlockNode` extension, JSON
 * import (data normalized in) and export (carried verbatim by the base), clone,
 * and the editor's state wiring — so a new block (see docs/006 mermaid / data
 * grid) is a spec plus an editor, not a hand-copied class. `getType` and
 * `normalizeData` are exposed statically so the registry can enumerate blocks
 * without restating their type or normalizer.
 */
export function defineDecoratorBlock(
  spec: DecoratorBlockSpec,
): DecoratorBlockNodeClass {
  class DecoratorBlock extends RichTextDecoratorBlockNode {
    static normalizeData = spec.normalize;

    static getType(): string {
      return spec.type;
    }

    static clone(node: DecoratorBlock): DecoratorBlock {
      return new DecoratorBlock(node.__data, node.__format, node.__key);
    }

    static importJSON(serializedNode: SerializedRichTextDecoratorNode) {
      return new DecoratorBlock(
        spec.normalize(serializedNode),
        (serializedNode.format as ElementFormatType) || "",
      );
    }

    decorate() {
      const data = this.getData();
      // Phase 0 (docs/009 §6.1.1): an offscreen body collapses to a placeholder
      // when the host editor enables virtualization. The Lexical node, its data,
      // and serialization are unchanged — only the rendered body is gated.
      return (
        <VirtualizedDecoratorBody
          cacheKey={decoratorHeightCacheKey(this.__key, data)}
        >
          <DecoratorBlockHost
            Editor={spec.Editor}
            node={data}
            nodeKey={this.__key}
          />
        </VirtualizedDecoratorBody>
      );
    }
  }
  // A readable class name for stack traces/devtools; Lexical keys off getType().
  Object.defineProperty(DecoratorBlock, "name", {
    value: classNameFromType(spec.type),
  });
  return DecoratorBlock;
}

function decoratorHeightCacheKey(
  nodeKey: string,
  node: RichTextEditorNode,
): string {
  const id = typeof node.id === "string" && node.id.trim() ? node.id : nodeKey;
  return `${id}:${richTextNodeSignature(node)}`;
}

function classNameFromType(type: string): string {
  const pascal = type
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `${pascal}Node`;
}
