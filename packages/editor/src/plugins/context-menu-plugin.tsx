import { Menu, MenuItem, MenuTrigger, NavIcon } from "@quanghuy1242/idco-ui";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
} from "lexical";
import { useEffect, useState } from "react";
import { Button as AriaButton } from "react-aria-components";

type MenuState = {
  readonly x: number;
  readonly y: number;
  readonly key: string;
};

/**
 * Right-click block context menu, built on the shared React Aria `Menu` (not the
 * Floating-UI-based Lexical plugin) to stay within the `@idco/ui` behavior
 * contract. A 0-size trigger is positioned at the cursor and the menu anchors to
 * it. Acts on the right-clicked top-level block.
 */
export function ContextMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    function onContextMenu(event: MouseEvent) {
      let key = "";
      editor.read(() => {
        const node = $getNearestNodeFromDOMNode(event.target as HTMLElement);
        key = (node?.getTopLevelElement() ?? node)?.getKey() ?? "";
      });
      if (!key) return;
      event.preventDefault();
      setMenu({ key, x: event.clientX, y: event.clientY });
    }
    root.addEventListener("contextmenu", onContextMenu);
    return () => root.removeEventListener("contextmenu", onContextMenu);
  }, [editor]);

  function insertBelow() {
    if (!menu) return;
    editor.update(() => {
      const block = $getNodeByKey(menu.key);
      if (!block) return;
      const paragraph = $createParagraphNode();
      block.insertAfter(paragraph);
      paragraph.select();
    });
  }

  function remove() {
    if (!menu) return;
    editor.update(() => {
      $getNodeByKey(menu.key)?.remove();
    });
  }

  return (
    <MenuTrigger
      isOpen={menu !== null}
      onOpenChange={(open) => {
        if (!open) setMenu(null);
      }}
      placement="bottom start"
    >
      <AriaButton
        aria-hidden="true"
        excludeFromTabOrder
        className="pointer-events-none fixed size-0 opacity-0"
        style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
      />
      <Menu aria-label="Block actions" className="w-48">
        <MenuItem id="insert" textValue="Insert below" onAction={insertBelow}>
          <span className="flex items-center gap-2.5">
            <NavIcon name="Plus" />
            Insert below
          </span>
        </MenuItem>
        <MenuItem id="delete" textValue="Delete block" onAction={remove}>
          <span className="flex items-center gap-2.5 text-error">
            <NavIcon name="Trash2" />
            Delete block
          </span>
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
