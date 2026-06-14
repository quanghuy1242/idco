import { $isTableCellNode } from "@lexical/table";
import { $createHeadingNode } from "@lexical/rich-text";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  COMMAND_PRIORITY_EDITOR,
  type BaseSelection,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import { useEffect } from "react";
import {
  normalizeCalloutNode,
  normalizeCodeBlockNode,
  normalizeEmbedNode,
  normalizeMediaNode,
  normalizePostRefNode,
  textFromChildren,
} from "../model/normalize";
import {
  headingTag,
  stringValue,
  type RichTextEditorNode,
} from "../model/schema";
import { INSERT_RICH_TEXT_NODE_COMMAND } from "./base";
import { CalloutNode } from "./callout-node";
import { CodeBlockNode } from "./code-block-node";
import { EmbedNode } from "./embed-node";
import { MediaNode } from "./media-node";
import { PostRefNode } from "./post-ref-node";

export {
  INSERT_RICH_TEXT_NODE_COMMAND,
  RichTextEditorBindingsContext,
  type RichTextEditorBindings,
  type RichTextEditorComment,
} from "./base";
export { CalloutNode, CodeBlockNode, EmbedNode, MediaNode, PostRefNode };

/** Lexical node classes registered with the composer. */
export const RICH_TEXT_DECORATOR_NODES = [
  CalloutNode,
  CodeBlockNode,
  EmbedNode,
  MediaNode,
  PostRefNode,
] as const;

export function richTextNodeToLexicalNode(
  node: RichTextEditorNode,
): LexicalNode | null {
  if (node.type === "paragraph") {
    const paragraph = $createParagraphNode();
    paragraph.append(
      ...textFromChildren(node.children, stringValue(node.text)).map((text) =>
        $createTextNode(text),
      ),
    );
    return paragraph;
  }
  if (node.type === "heading") {
    const heading = $createHeadingNode(headingTag(node.tag));
    heading.append(
      ...textFromChildren(node.children, stringValue(node.text)).map((text) =>
        $createTextNode(text),
      ),
    );
    return heading;
  }
  if (node.type === "callout") {
    return new CalloutNode(normalizeCalloutNode(node));
  }
  if (node.type === "code-block") {
    return new CodeBlockNode(normalizeCodeBlockNode(node));
  }
  if (node.type === "embed") {
    return new EmbedNode(normalizeEmbedNode(node));
  }
  if (node.type === "media") {
    return new MediaNode(normalizeMediaNode(node));
  }
  if (node.type === "post-ref") {
    return new PostRefNode(normalizePostRefNode(node));
  }
  return null;
}

export function RichTextNodePlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        INSERT_RICH_TEXT_NODE_COMMAND,
        (node) => {
          const lexicalNode = richTextNodeToLexicalNode(node);
          if (!lexicalNode) {
            return false;
          }
          const selection = $getSelection();
          const anchorBlock = $insertionBlockFromSelection(selection);
          const emptyParagraph =
            anchorBlock && $isEmptyParagraph(anchorBlock)
              ? anchorBlock
              : $singleEmptyRootParagraph();
          if (emptyParagraph) {
            // The caret sits on an empty paragraph (e.g. the line where "/" was
            // typed). Replace it in place rather than splitting it, which would
            // leave an empty line before and after the inserted block.
            emptyParagraph.replace(lexicalNode);
          } else if (anchorBlock) {
            anchorBlock.insertAfter(lexicalNode);
          } else {
            $getRoot().append(lexicalNode);
          }
          // Decorator blocks can't hold a caret; drop one into the next block so
          // typing continues. Add a trailing paragraph only if none exists.
          if ($isDecoratorNode(lexicalNode)) {
            const next = lexicalNode.getNextSibling();
            if ($isElementNode(next)) {
              next.selectStart();
            } else {
              const paragraph = $createParagraphNode();
              lexicalNode.insertAfter(paragraph);
              paragraph.select();
            }
          } else if ($isElementNode(lexicalNode)) {
            lexicalNode.selectEnd();
          }
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  );

  return null;
}

function $insertionBlockFromSelection(
  selection: BaseSelection | null,
): LexicalNode | null {
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const anchorNode = selection.anchor.getNode();
  if ($isInsertionContainer(anchorNode)) {
    return (
      anchorNode.getChildAtIndex(selection.anchor.offset - 1) ??
      anchorNode.getChildAtIndex(selection.anchor.offset)
    );
  }
  return $nearestInsertionContainerChild(anchorNode);
}

function $nearestInsertionContainerChild(
  node: LexicalNode,
): LexicalNode | null {
  let current: LexicalNode | null = node;
  while (current) {
    const parent: LexicalNode | null = current.getParent();
    if ($isInsertionContainer(parent)) return current;
    current = parent;
  }
  return null;
}

function $singleEmptyRootParagraph(): ElementNode | null {
  const root = $getRoot();
  if (root.getChildrenSize() !== 1) return null;
  const first = root.getFirstChild();
  return $isEmptyParagraph(first) ? first : null;
}

function $isEmptyParagraph(
  node: LexicalNode | null | undefined,
): node is ElementNode {
  return $isParagraphNode(node) && node.getTextContent() === "";
}

function $isInsertionContainer(
  node: LexicalNode | null | undefined,
): node is ElementNode {
  return $isRootNode(node) || $isTableCellNode(node);
}
