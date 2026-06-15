/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import {
  ListItemNode,
  ListNode,
  type ListType,
  type SerializedListItemNode,
  type SerializedListNode,
} from "@lexical/list";
import { QuoteNode, type SerializedQuoteNode } from "@lexical/rich-text";
import {
  ParagraphNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedParagraphNode,
  type Spread,
} from "lexical";

type SerializedIdcoNode = {
  id?: string;
};

export type SerializedEditorParagraphNode = Spread<
  SerializedIdcoNode,
  SerializedParagraphNode
>;

export type SerializedEditorQuoteNode = Spread<
  SerializedIdcoNode,
  SerializedQuoteNode
>;

export type SerializedEditorListNode = Spread<
  SerializedIdcoNode,
  SerializedListNode
>;

export type SerializedEditorListItemNode = Spread<
  SerializedIdcoNode,
  SerializedListItemNode
>;

export class EditorParagraphNode extends ParagraphNode {
  __idcoId: string | undefined;

  constructor(id?: string, key?: NodeKey) {
    super(key);
    this.__idcoId = cleanNodeId(id);
  }

  static getType(): string {
    return "editor-paragraph";
  }

  static clone(node: EditorParagraphNode): EditorParagraphNode {
    return new EditorParagraphNode(node.__idcoId, node.__key);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__idcoId = prevNode.__idcoId;
  }

  static importJSON(
    serializedNode: SerializedEditorParagraphNode,
  ): EditorParagraphNode {
    return new EditorParagraphNode().updateFromJSON(serializedNode);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedEditorParagraphNode>,
  ): this {
    const self = super.updateFromJSON(serializedNode);
    return self.setId(serializedNode.id);
  }

  exportJSON(): SerializedEditorParagraphNode {
    return {
      ...super.exportJSON(),
      ...(this.getId() ? { id: this.getId() } : {}),
      type: this.getType(),
    };
  }

  getId(): string | undefined {
    return this.getLatest().__idcoId;
  }

  setId(id: string | undefined): this {
    const self = this.getWritable();
    self.__idcoId = cleanNodeId(id);
    return self;
  }
}

export class EditorQuoteNode extends QuoteNode {
  __idcoId: string | undefined;

  constructor(id?: string, key?: NodeKey) {
    super(key);
    this.__idcoId = cleanNodeId(id);
  }

  static getType(): string {
    return "editor-quote";
  }

  static clone(node: EditorQuoteNode): EditorQuoteNode {
    return new EditorQuoteNode(node.__idcoId, node.__key);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__idcoId = prevNode.__idcoId;
  }

  static importJSON(
    serializedNode: SerializedEditorQuoteNode,
  ): EditorQuoteNode {
    return new EditorQuoteNode().updateFromJSON(serializedNode);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedEditorQuoteNode>,
  ): this {
    const self = super.updateFromJSON(serializedNode);
    return self.setId(serializedNode.id);
  }

  exportJSON(): SerializedEditorQuoteNode {
    return {
      ...super.exportJSON(),
      ...(this.getId() ? { id: this.getId() } : {}),
      type: this.getType(),
    };
  }

  getId(): string | undefined {
    return this.getLatest().__idcoId;
  }

  setId(id: string | undefined): this {
    const self = this.getWritable();
    self.__idcoId = cleanNodeId(id);
    return self;
  }
}

export class EditorListNode extends ListNode {
  __idcoId: string | undefined;

  constructor(
    listType: ListType = "number",
    start = 1,
    id?: string,
    key?: NodeKey,
  ) {
    super(listType, start, key);
    this.__idcoId = cleanNodeId(id);
  }

  static getType(): string {
    return "editor-list";
  }

  static clone(node: EditorListNode): EditorListNode {
    return new EditorListNode(
      node.__listType,
      node.__start,
      node.__idcoId,
      node.__key,
    );
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__idcoId = prevNode.__idcoId;
  }

  static importJSON(serializedNode: SerializedEditorListNode): EditorListNode {
    return new EditorListNode().updateFromJSON(serializedNode);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedEditorListNode>,
  ): this {
    const self = super.updateFromJSON(serializedNode);
    return self.setId(serializedNode.id);
  }

  exportJSON(): SerializedEditorListNode {
    return {
      ...super.exportJSON(),
      ...(this.getId() ? { id: this.getId() } : {}),
      type: this.getType(),
    };
  }

  getId(): string | undefined {
    return this.getLatest().__idcoId;
  }

  setId(id: string | undefined): this {
    const self = this.getWritable();
    self.__idcoId = cleanNodeId(id);
    return self;
  }
}

export class EditorListItemNode extends ListItemNode {
  __idcoId: string | undefined;

  constructor(
    value = 1,
    checked: boolean | undefined = undefined,
    id?: string,
    key?: NodeKey,
  ) {
    super(value, checked, key);
    this.__idcoId = cleanNodeId(id);
  }

  static getType(): string {
    return "editor-listitem";
  }

  static clone(node: EditorListItemNode): EditorListItemNode {
    return new EditorListItemNode(
      node.__value,
      node.__checked,
      node.__idcoId,
      node.__key,
    );
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__idcoId = prevNode.__idcoId;
  }

  static importJSON(
    serializedNode: SerializedEditorListItemNode,
  ): EditorListItemNode {
    return new EditorListItemNode().updateFromJSON(serializedNode);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedEditorListItemNode>,
  ): this {
    const self = super.updateFromJSON(serializedNode);
    return self.setId(serializedNode.id);
  }

  exportJSON(): SerializedEditorListItemNode {
    return {
      ...super.exportJSON(),
      ...(this.getId() ? { id: this.getId() } : {}),
      type: this.getType(),
    };
  }

  getId(): string | undefined {
    return this.getLatest().__idcoId;
  }

  setId(id: string | undefined): this {
    const self = this.getWritable();
    self.__idcoId = cleanNodeId(id);
    return self;
  }
}

export function $createEditorParagraphNode(id?: string): EditorParagraphNode {
  return new EditorParagraphNode(id);
}

export function $createEditorListNode({
  id,
  listType,
  start,
}: {
  readonly id?: string;
  readonly listType: ListType;
  readonly start: number;
}): EditorListNode {
  return new EditorListNode(listType, start, id);
}

function cleanNodeId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
