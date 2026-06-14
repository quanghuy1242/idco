import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $setSelection, type BaseSelection } from "lexical";
import { useCallback, useRef } from "react";

/**
 * Keeps the editor's caret/selection alive across a popover or dialog. React
 * Aria returns focus to the (often off-editor) trigger when an overlay closes,
 * which drops the editor's selection. Call `onOpen` when the overlay opens to
 * snapshot the selection, and `onClose` when it closes to refocus the editor at
 * that selection — unless an action already handled focus (`markHandled`), e.g.
 * an apply that mutated the document and set its own selection.
 */
export function useSelectionRestore() {
  const [editor] = useLexicalComposerContext();
  const saved = useRef<BaseSelection | null>(null);
  const handled = useRef(false);

  const onOpen = useCallback(() => {
    handled.current = false;
    saved.current = editor
      .getEditorState()
      .read(() => $getSelection()?.clone() ?? null);
  }, [editor]);

  const markHandled = useCallback(() => {
    handled.current = true;
  }, []);

  const onClose = useCallback(() => {
    if (handled.current) return;
    const selection = saved.current;
    // Run after React Aria has restored focus to the trigger so we win the race.
    requestAnimationFrame(() => {
      editor.update(() => {
        try {
          if (selection) $setSelection(selection.clone());
        } catch {
          // The snapshot can reference nodes that no longer exist; ignore.
        }
      });
      editor.focus();
    });
  }, [editor]);

  return { markHandled, onClose, onOpen };
}
