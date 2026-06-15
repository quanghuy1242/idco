import type { Klass } from "lexical";
import type { RichTextEditorNode } from "../model/schema";
import type { RichTextDecoratorBlockNode } from "./base";
import type { DecoratorBlockNodeClass } from "./decorator-block";
import { CalloutNode } from "./callout-node";
import { CodeBlockNode } from "./code-block-node";
import { EmbedNode } from "./embed-node";
import { MediaNode } from "./media-node";
import { PostRefNode } from "./post-ref-node";
import { TableOfContentsNode } from "./table-of-contents-node";

/**
 * The decorator-block family. Each class is produced by `defineDecoratorBlock`
 * and carries its canonical `getType()` and `normalizeData` statically, so this
 * list is the single enumeration: the composer registration list and
 * `richTextNodeToLexicalNode` both derive from it. Adding a block (see docs/006
 * mermaid / data grid) is one entry here plus its node module.
 *
 * `normalize.ts` and `serialize.ts` keep their own explicit dispatch on purpose:
 * they also handle element nodes (paragraph/heading/list) and legacy type
 * aliases (`code` -> `code-block`), and importing this registry there would
 * create a cycle.
 */
const DECORATOR_NODE_CLASSES: readonly DecoratorBlockNodeClass[] = [
  CalloutNode,
  CodeBlockNode,
  EmbedNode,
  MediaNode,
  PostRefNode,
  TableOfContentsNode,
];

export type DecoratorNodeDefinition = {
  readonly type: string;
  readonly NodeClass: Klass<RichTextDecoratorBlockNode>;
  readonly normalize: (node: RichTextEditorNode) => RichTextEditorNode;
};

export const DECORATOR_NODE_DEFINITIONS: readonly DecoratorNodeDefinition[] =
  DECORATOR_NODE_CLASSES.map((NodeClass) => ({
    NodeClass,
    normalize: NodeClass.normalizeData,
    type: NodeClass.getType(),
  }));

const DEFINITION_BY_TYPE = new Map(
  DECORATOR_NODE_DEFINITIONS.map((definition) => [definition.type, definition]),
);

/** The decorator definition for a node type, or `undefined` if not one. */
export function decoratorNodeDefinition(
  type: string,
): DecoratorNodeDefinition | undefined {
  return DEFINITION_BY_TYPE.get(type);
}

/** Lexical node classes registered with the composer. */
export const RICH_TEXT_DECORATOR_NODES: readonly Klass<RichTextDecoratorBlockNode>[] =
  DECORATOR_NODE_CLASSES;
