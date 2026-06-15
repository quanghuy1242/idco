import { NavIcon, Tooltip } from "@quanghuy1242/idco-ui";
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isLinkNode } from "@lexical/link";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, type BaseSelection } from "lexical";
import { useState } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { useSelectionRestore } from "../hooks/use-selection-restore";

/**
 * Toolbar control for inline links: opens a small React Aria popover with a URL
 * field, prefilled from the current link if the caret is inside one. Submitting
 * applies `TOGGLE_LINK_COMMAND`; an empty value removes the link.
 */
export function LinkButton({
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
  const { onOpen, onClose, markHandled, restoreSelection } =
    useSelectionRestore({ getSelectionSnapshot });
  const [url, setUrl] = useState("");
  const [hasLink, setHasLink] = useState(false);

  function syncFromSelection() {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        setUrl("");
        setHasLink(false);
        return;
      }
      const node = selection.anchor.getNode();
      const parent = node.getParent();
      const link = $isLinkNode(parent)
        ? parent
        : $isLinkNode(node)
          ? node
          : null;
      setUrl(link ? link.getURL() : "");
      setHasLink(Boolean(link));
    });
  }

  function apply(close: () => void) {
    const value = url.trim();
    restoreSelection();
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, value === "" ? null : value);
    markHandled();
    close();
    onApplied?.();
    requestAnimationFrame(() => editor.focus());
  }

  function remove(close: () => void) {
    restoreSelection();
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
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
      <Tooltip content="Link">
        <AriaButton
          type="button"
          aria-label="Link"
          isDisabled={isDisabled}
          onMouseDown={(event) => event.preventDefault()}
          className="btn btn-sm btn-square btn-ghost"
        >
          <NavIcon name="Link" />
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
                Link URL
              </span>
              <input
                aria-label="Link URL"
                autoFocus
                value={url}
                placeholder="https://example.com"
                onChange={(event) => setUrl(event.target.value)}
                className="input input-sm input-bordered w-full"
              />
              <div className="flex items-center justify-end gap-2">
                {hasLink ? (
                  <AriaButton
                    type="button"
                    onPress={() => remove(close)}
                    className="btn btn-sm btn-ghost text-error"
                  >
                    Remove
                  </AriaButton>
                ) : null}
                <AriaButton type="submit" className="btn btn-sm btn-primary">
                  Apply
                </AriaButton>
              </div>
            </form>
          )}
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}
