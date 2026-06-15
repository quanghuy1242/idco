/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import {
  HeadingNode,
  type HeadingTagType,
  type SerializedHeadingNode,
} from "@lexical/rich-text";
import type { EditorConfig, LexicalUpdateJSON, NodeKey, Spread } from "lexical";
import { slugifyHeadingAnchor } from "@quanghuy1242/idco-lib";

export type SerializedEditorHeadingNode = Spread<
  {
    anchorId?: string;
  },
  SerializedHeadingNode
>;

/**
 * Heading with a persisted anchor id. The editor still emits canonical
 * `type: "heading"` documents via `normalizeDocument`, but Lexical needs a
 * unique runtime type for the replacement node.
 */
export class EditorHeadingNode extends HeadingNode {
  __anchorId: string | undefined;

  constructor(tag: HeadingTagType = "h2", anchorId?: string, key?: NodeKey) {
    super(tag, key);
    this.__anchorId = anchorId ? slugifyHeadingAnchor(anchorId) : undefined;
  }

  static getType(): string {
    return "editor-heading";
  }

  static clone(node: EditorHeadingNode): EditorHeadingNode {
    return new EditorHeadingNode(node.__tag, node.__anchorId, node.__key);
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__anchorId = prevNode.__anchorId;
  }

  static importJSON(serializedNode: SerializedEditorHeadingNode) {
    return new EditorHeadingNode().updateFromJSON(serializedNode);
  }

  updateFromJSON(
    serializedNode: LexicalUpdateJSON<SerializedEditorHeadingNode>,
  ): this {
    const self = super.updateFromJSON(serializedNode);
    return self.setAnchorId(
      typeof serializedNode.anchorId === "string"
        ? serializedNode.anchorId
        : undefined,
    );
  }

  exportJSON(): SerializedEditorHeadingNode {
    return {
      ...super.exportJSON(),
      ...(this.getAnchorId() ? { anchorId: this.getAnchorId() } : {}),
      type: this.getType(),
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    applyHeadingAnchorDom(dom, this.__anchorId);
    return dom;
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const recreate = super.updateDOM(prevNode, dom, config);
    if (!recreate) applyHeadingAnchorDom(dom, this.__anchorId);
    return recreate;
  }

  getAnchorId(): string | undefined {
    return this.getLatest().__anchorId;
  }

  setAnchorId(anchorId: string | undefined): this {
    const self = this.getWritable();
    self.__anchorId = anchorId ? slugifyHeadingAnchor(anchorId) : undefined;
    return self;
  }
}

export function $createEditorHeadingNode(
  tag: HeadingTagType = "h2",
  anchorId?: string,
): EditorHeadingNode {
  return new EditorHeadingNode(tag, anchorId);
}

export function $isEditorHeadingNode(node: unknown): node is EditorHeadingNode {
  return node instanceof EditorHeadingNode;
}

function applyHeadingAnchorDom(
  dom: HTMLElement,
  anchorId: string | undefined,
): void {
  if (!anchorId) {
    dom.removeAttribute("id");
    dom.removeAttribute("data-idco-heading-anchor");
    return;
  }
  dom.id = anchorId;
  dom.setAttribute("data-idco-heading-anchor", anchorId);
}
