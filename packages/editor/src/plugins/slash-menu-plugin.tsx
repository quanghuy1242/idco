import { NavIcon } from "@quanghuy1242/idco-ui";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { INSERT_TABLE_COMMAND } from "@lexical/table";
import type { LexicalEditor } from "lexical";
import { useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { canUse, type RichTextEditorNode } from "../model/schema";
import {
  INSERT_RICH_TEXT_NODE_COMMAND,
  RichTextEditorBindingsContext,
} from "../nodes";
import { canInsertStarterNode, starterNodes } from "./toolbar-plugin";

class SlashOption extends MenuOption {
  constructor(
    public readonly label: string,
    public readonly iconName: string,
    public readonly keywords: readonly string[],
    public readonly run: (editor: LexicalEditor) => void,
  ) {
    super(label);
  }
}

/**
 * Caret-anchored "/" command menu (Notion/Confluence style). Replaces the old
 * "/" → toolbar-menu hack with a real typeahead positioned at the caret, filtered
 * by `allowedNodes` and the configured bindings.
 */
export function SlashMenuPlugin({
  allowedNodes,
}: {
  readonly allowedNodes: readonly string[];
}) {
  const [editor] = useLexicalComposerContext();
  const bindings = useContext(RichTextEditorBindingsContext);
  const [query, setQuery] = useState<string | null>(null);
  const triggerFn = useBasicTypeaheadTriggerMatch("/", { minLength: 0 });

  const options = useMemo(() => {
    const nodeOptions = starterNodes
      .filter(
        (item) =>
          canUse(item.node.type, allowedNodes) &&
          canInsertStarterNode(item, bindings),
      )
      .map(
        (item) =>
          new SlashOption(item.label, item.icon, [item.id], (ed) =>
            ed.dispatchCommand(
              INSERT_RICH_TEXT_NODE_COMMAND,
              item.node as RichTextEditorNode,
            ),
          ),
      );

    const extras: SlashOption[] = [];
    if (canUse("list", allowedNodes)) {
      extras.push(
        new SlashOption("Bullet list", "List", ["ul", "bullet"], (ed) =>
          ed.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined),
        ),
        new SlashOption(
          "Numbered list",
          "ListOrdered",
          ["ol", "number"],
          (ed) => ed.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined),
        ),
        new SlashOption("Check list", "ListChecks", ["todo", "task"], (ed) =>
          ed.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined),
        ),
      );
    }
    if (canUse("table", allowedNodes)) {
      extras.push(
        new SlashOption("Table", "Table", ["grid", "rows"], (ed) =>
          ed.dispatchCommand(INSERT_TABLE_COMMAND, {
            columns: "3",
            includeHeaders: true,
            rows: "3",
          }),
        ),
      );
    }

    const all = [...nodeOptions, ...extras];
    const normalized = (query ?? "").toLowerCase();
    if (!normalized) return all;
    return all.filter(
      (option) =>
        option.label.toLowerCase().includes(normalized) ||
        option.keywords.some((keyword) => keyword.includes(normalized)),
    );
  }, [allowedNodes, bindings, query]);

  const onSelectOption = useCallback(
    (
      option: SlashOption,
      nodeToRemove: { remove: () => void } | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        nodeToRemove?.remove();
      });
      option.run(editor);
      closeMenu();
      requestAnimationFrame(() => editor.focus());
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<SlashOption>
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      options={options}
      menuRenderFn={(
        anchorRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) =>
        anchorRef.current && options.length > 0
          ? createPortal(
              <ul className="menu z-[70] w-60 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg">
                {options.map((option, index) => (
                  <li key={option.key}>
                    <button
                      type="button"
                      ref={option.setRefElement}
                      className={`flex items-center gap-2.5 ${index === selectedIndex ? "menu-active bg-base-200" : ""}`}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => selectOptionAndCleanUp(option)}
                    >
                      <NavIcon name={option.iconName} />
                      {option.label}
                    </button>
                  </li>
                ))}
              </ul>,
              anchorRef.current,
            )
          : null
      }
    />
  );
}
