import { NavIcon } from "@quanghuy1242/idco-ui";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { DraggableBlockPlugin_EXPERIMENTAL } from "@lexical/react/LexicalDraggableBlockPlugin";
import { $createParagraphNode, $getNearestNodeFromDOMNode } from "lexical";
import { useEffect, useRef, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { blockHandleDropOffset } from "../model/layout";

const MENU_ATTR = "data-idco-block-menu";

/**
 * Notion/Confluence-style block handle in the left gutter: a grip to
 * drag-reorder blocks and a "+" to insert an empty paragraph right after the
 * block (caret dropped in). Lexical anchors the handle to the block's first
 * line; we nudge it down into the gap *below* the block — centred between this
 * block and the next — so the "+" sits exactly where "insert below" drops the
 * new block. No hover tooltip — it had no room in the gutter and flipped on top
 * of the content; the aria-label carries the accessible name.
 */
export function DraggableBlockPlugin() {
  const [editor] = useLexicalComposerContext();
  const [anchorElem, setAnchorElem] = useState<HTMLElement | null>(null);
  const [blockElem, setBlockElem] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const targetLineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAnchorElem(editor.getRootElement()?.parentElement ?? null);
  }, [editor]);

  function insertBelow() {
    if (!blockElem) return;
    editor.update(() => {
      const node = $getNearestNodeFromDOMNode(blockElem);
      const block = node?.getTopLevelElement() ?? node;
      if (!block) return;
      const paragraph = $createParagraphNode();
      block.insertAfter(paragraph);
      paragraph.select();
    });
    requestAnimationFrame(() => editor.focus());
  }

  if (!anchorElem) return null;

  // Lexical centres the handle on the block's first line; drop it into the gap
  // between this block and the next so "insert below" reads as adding a block
  // there (see `blockHandleDropOffset`).
  let dropOffset = 0;
  if (blockElem) {
    const style = getComputedStyle(blockElem);
    const lineHeight = parseFloat(style.lineHeight) || 24;
    const rect = blockElem.getBoundingClientRect();
    const next = blockElem.nextElementSibling;
    // Prefer the real gap to the next block; fall back to this block's bottom
    // margin for the last block.
    const rawGap = next
      ? next.getBoundingClientRect().top - rect.bottom
      : parseFloat(style.marginBottom) || 0;
    dropOffset = blockHandleDropOffset(rect.height, rawGap, lineHeight);
  }

  return (
    <DraggableBlockPlugin_EXPERIMENTAL
      anchorElem={anchorElem}
      menuRef={menuRef as React.RefObject<HTMLElement>}
      targetLineRef={targetLineRef as React.RefObject<HTMLElement>}
      isOnMenu={(element) => Boolean(element.closest(`[${MENU_ATTR}]`))}
      onElementChanged={setBlockElem}
      menuComponent={
        <div
          ref={menuRef}
          {...{ [MENU_ATTR]: "" }}
          className="absolute left-0 top-0"
        >
          <div
            className="flex items-center gap-0.5"
            style={{ transform: `translateY(${dropOffset}px)` }}
          >
            <AriaButton
              type="button"
              aria-label="Insert block below"
              onPress={insertBelow}
              className="grid size-5 place-items-center rounded text-base-content/40 transition hover:bg-base-200 hover:text-base-content"
            >
              <NavIcon name="Plus" variant="timeline" />
            </AriaButton>
            <span
              aria-hidden="true"
              className="grid size-5 cursor-grab place-items-center rounded text-base-content/40 transition hover:bg-base-200 hover:text-base-content active:cursor-grabbing"
            >
              <NavIcon name="GripVertical" variant="timeline" />
            </span>
          </div>
        </div>
      }
      targetLineComponent={
        <div
          ref={targetLineRef}
          className="pointer-events-none absolute left-0 top-0 h-0.5 w-full bg-primary opacity-0"
        />
      }
    />
  );
}
