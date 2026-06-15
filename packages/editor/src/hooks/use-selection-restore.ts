import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $setSelection, type BaseSelection } from "lexical";
import { useCallback, useRef } from "react";

type SelectionRestoreOptions = {
  readonly getSelectionSnapshot?: () => BaseSelection | null;
};

/**
 * Keeps the editor's caret/selection alive across a popover or dialog. React
 * Aria returns focus to the (often off-editor) trigger when an overlay closes,
 * which drops the editor's selection. Call `onOpen` when the overlay opens to
 * snapshot the selection, and `onClose` when it closes to refocus the editor at
 * that selection — unless an action already handled focus (`markHandled`), e.g.
 * an apply that mutated the document and set its own selection.
 */
export function useSelectionRestore({
  getSelectionSnapshot,
}: SelectionRestoreOptions = {}) {
  const [editor] = useLexicalComposerContext();
  const saved = useRef<BaseSelection | null>(null);
  const handled = useRef(false);

  const snapshotSelection = useCallback(() => {
    const provided = getSelectionSnapshot?.();
    if (provided) return provided.clone();
    return editor.getEditorState().read(() => $getSelection()?.clone() ?? null);
  }, [editor, getSelectionSnapshot]);

  const restoreSelection = useCallback(
    (selection: BaseSelection | null = saved.current) => {
      let restored = false;
      editor.update(
        () => {
          try {
            if (selection) {
              $setSelection(selection.clone());
              restored = true;
            }
          } catch {
            // The snapshot can reference nodes that no longer exist; ignore.
          }
        },
        { discrete: true },
      );
      return restored;
    },
    [editor],
  );

  const onOpen = useCallback(() => {
    handled.current = false;
    saved.current = snapshotSelection();
  }, [snapshotSelection]);

  const markHandled = useCallback(() => {
    handled.current = true;
  }, []);

  const onClose = useCallback(() => {
    if (handled.current) return;
    const selection = saved.current;
    // Run after React Aria has restored focus to the trigger so we win the race.
    requestAnimationFrame(() => {
      restoreSelection(selection);
      editor.focus();
    });
  }, [editor, restoreSelection]);

  return { markHandled, onClose, onOpen, restoreSelection };
}
