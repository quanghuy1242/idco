import { NavIcon } from "@quanghuy1242/idco-ui";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { LexicalEditor } from "lexical";
import { useCallback, useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  EMPTY_SELECTION_STATE,
  slashCommands,
  type CommandContext,
} from "../model/commands";
import { RichTextEditorBindingsContext } from "../nodes";

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
    // Slash inserts are availability-gated by allowlist + bindings only, so a
    // bare context (no live selection) is enough to enumerate them.
    const ctx: CommandContext = {
      ...EMPTY_SELECTION_STATE,
      allowedNodes,
      bindings,
      canFormat: false,
      canRedo: false,
      canUndo: false,
      editor,
    };
    const all = slashCommands(ctx).map(
      (command) =>
        new SlashOption(
          command.label,
          command.icon,
          command.keywords ?? [],
          (runEditor) => command.run({ ...ctx, editor: runEditor }),
        ),
    );
    const normalized = (query ?? "").toLowerCase();
    if (!normalized) return all;
    return all.filter(
      (option) =>
        option.label.toLowerCase().includes(normalized) ||
        option.keywords.some((keyword) => keyword.includes(normalized)),
    );
  }, [allowedNodes, bindings, editor, query]);

  const onSelectOption = useCallback(
    (
      option: SlashOption,
      nodeToRemove: { remove: () => void } | null,
      closeMenu: () => void,
    ) => {
      editor.update(() => {
        nodeToRemove?.remove();
        option.run(editor);
      });
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
              <ul
                data-editor-slash-menu="true"
                className="menu z-[70] w-60 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
              >
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
