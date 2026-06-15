import { NavIcon, Tooltip } from "@quanghuy1242/idco-ui";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type BaseSelection,
} from "lexical";
import { useState } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { useSelectionRestore } from "../hooks/use-selection-restore";
import { $createGlossaryNode } from "../nodes/glossary-node";

/**
 * Inserts an inline glossary term (definition shown in a tooltip on hover). The
 * term is prefilled from the current selection so authors can "define" a word
 * in place.
 */
export function GlossaryButton({
  getSelectionSnapshot,
  isDisabled,
  onApplied,
  onDialogOpenChange,
}: {
  readonly getSelectionSnapshot?: () => BaseSelection | null;
  readonly isDisabled?: boolean;
  readonly onApplied?: () => void;
  readonly onDialogOpenChange?: (open: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [term, setTerm] = useState("");
  const [definition, setDefinition] = useState("");
  const { onOpen, onClose, markHandled, restoreSelection } =
    useSelectionRestore({ getSelectionSnapshot });

  function syncFromSelection() {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      setTerm($isRangeSelection(selection) ? selection.getTextContent() : "");
      setDefinition("");
    });
  }

  function apply(close: () => void) {
    const label = term.trim();
    if (label === "") {
      close();
      return;
    }
    restoreSelection();
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      // Preserve any whitespace the selection swept up (e.g. a trailing space
      // after the word) by re-inserting it around the glossary node, so wrapping
      // a term never glues it to the next word.
      const raw = selection.getTextContent();
      const leading = raw.slice(0, raw.length - raw.trimStart().length);
      const trailing = raw.slice(raw.trimEnd().length);
      const nodes = [
        ...(leading ? [$createTextNode(leading)] : []),
        $createGlossaryNode(label, definition.trim()),
        ...(trailing ? [$createTextNode(trailing)] : []),
      ];
      selection.insertNodes(nodes);
    });
    markHandled();
    close();
    onApplied?.();
    requestAnimationFrame(() => editor.focus());
  }

  return (
    <AriaDialogTrigger
      onOpenChange={(open) => {
        onDialogOpenChange?.(open);
        if (open) {
          onOpen();
          restoreSelection();
          syncFromSelection();
        } else {
          onClose();
        }
      }}
    >
      <Tooltip content="Glossary term">
        <AriaButton
          type="button"
          aria-label="Glossary term"
          isDisabled={isDisabled}
          className="btn btn-sm btn-square btn-ghost"
        >
          <NavIcon name="BookA" />
        </AriaButton>
      </Tooltip>
      <AriaPopover
        data-editor-selection-action-popover="true"
        placement="bottom"
        offset={8}
        className="popover-panel z-[60] w-72 data-[entering]:animate-popover-in data-[exiting]:animate-popover-out"
      >
        <AriaDialog className="outline-none">
          {({ close }) => (
            <form
              className="grid gap-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                apply(close);
              }}
            >
              <span className="text-xs font-medium text-base-content/70">
                Term
              </span>
              <input
                aria-label="Glossary term"
                autoFocus
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                className="input input-sm input-bordered w-full"
              />
              <span className="text-xs font-medium text-base-content/70">
                Definition
              </span>
              <textarea
                aria-label="Glossary definition"
                value={definition}
                rows={3}
                onChange={(event) => setDefinition(event.target.value)}
                className="textarea textarea-bordered textarea-sm w-full"
              />
              <div className="flex justify-end">
                <AriaButton type="submit" className="btn btn-sm btn-primary">
                  Insert
                </AriaButton>
              </div>
            </form>
          )}
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}
