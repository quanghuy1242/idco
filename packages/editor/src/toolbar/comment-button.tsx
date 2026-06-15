import { NavIcon, TextArea, Tooltip } from "@quanghuy1242/idco-ui";
import { $wrapSelectionInMarkNode } from "@lexical/mark";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, type BaseSelection } from "lexical";
import { useContext, useRef, useState } from "react";
import {
  Button as AriaButton,
  DialogTrigger as AriaDialogTrigger,
} from "react-aria-components";
import { useSelectionRestore } from "../hooks/use-selection-restore";
import { FieldLabel } from "../nodes/base";
import { RichTextEditorBindingsContext } from "../nodes";
import { EditorPopover } from "./editor-popover";

function commentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cmt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Opens a popover to type a comment on the current selection. On submit it wraps
 * the selection in a `MarkNode` (the highlight) and notifies the host via the
 * `onComment` binding with the mark id, the quoted text, and the comment body.
 * Comment threads live outside the document — the doc only stores the mark id —
 * so the host owns thread storage and the thread UI.
 */
export function CommentButton({
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
  const { onComment } = useContext(RichTextEditorBindingsContext);
  const { onOpen, onClose, markHandled, restoreSelection } =
    useSelectionRestore({ getSelectionSnapshot });
  const [body, setBody] = useState("");
  // The selection collapses when focus moves to the popover input, so the quote
  // is captured up front when the popover opens.
  const quoteRef = useRef("");
  const [hasSelection, setHasSelection] = useState(false);

  function syncFromSelection() {
    setBody("");
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      const valid = $isRangeSelection(selection) && !selection.isCollapsed();
      quoteRef.current = valid ? selection.getTextContent() : "";
      setHasSelection(valid);
    });
  }

  function apply(close: () => void) {
    const id = commentId();
    let wrapped = false;
    restoreSelection();
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
      $wrapSelectionInMarkNode(selection, selection.isBackward(), id);
      wrapped = true;
    });
    if (wrapped) onComment?.(id, quoteRef.current, body.trim());
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
      <Tooltip content="Comment">
        <AriaButton
          type="button"
          aria-label="Comment"
          isDisabled={isDisabled}
          onMouseDown={(event) => event.preventDefault()}
          className="btn btn-sm btn-square btn-ghost"
        >
          <NavIcon name="MessageSquare" />
        </AriaButton>
      </Tooltip>
      <EditorPopover isSelectionAction width="sm">
        {({ close }) => (
          <form
            className="grid gap-2 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              apply(close);
            }}
          >
            {hasSelection ? (
              <>
                <FieldLabel>Comment on “{quoteRef.current}”</FieldLabel>
                <TextArea
                  ariaLabel="Comment text"
                  autoFocus
                  size="sm"
                  rows={3}
                  value={body}
                  placeholder="Add a comment…"
                  onChange={setBody}
                />
                <div className="flex justify-end">
                  <AriaButton
                    type="submit"
                    isDisabled={body.trim() === ""}
                    className="btn btn-sm btn-primary"
                  >
                    Comment
                  </AriaButton>
                </div>
              </>
            ) : (
              <span className="text-xs text-base-content/60">
                Select some text to comment on it.
              </span>
            )}
          </form>
        )}
      </EditorPopover>
    </AriaDialogTrigger>
  );
}
