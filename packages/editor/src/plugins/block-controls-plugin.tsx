import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createParagraphNode, $getRoot, $isElementNode } from "lexical";
import { useEffect } from "react";
import { RichTextDecoratorBlockNode } from "../nodes/base";

/**
 * Word/Confluence "click after the block and type" behavior: clicking the empty
 * area below the last block, when that block is atomic (code/media/etc.),
 * creates a trailing paragraph on demand and drops the caret in it — so Enter /
 * typing just works without any persistent empty paragraph. Inserting between or
 * reordering blocks is handled by the gutter handle (`DraggableBlockPlugin`).
 */
export function BlockControlsPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    function onClick(event: MouseEvent) {
      const blocks = Array.from(root!.children) as HTMLElement[];
      const last = blocks[blocks.length - 1];
      if (!last || event.clientY <= last.getBoundingClientRect().bottom) return;
      editor.update(() => {
        const lastChild = $getRoot().getLastChild();
        if (lastChild instanceof RichTextDecoratorBlockNode) {
          const paragraph = $createParagraphNode();
          lastChild.insertAfter(paragraph);
          paragraph.select();
        } else if ($isElementNode(lastChild)) {
          lastChild.selectEnd();
        }
      });
    }

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [editor]);

  return null;
}
