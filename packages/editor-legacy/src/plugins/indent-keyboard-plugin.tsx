import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  COMMAND_PRIORITY_EDITOR,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from "lexical";
import { useEffect } from "react";

export function IndentKeyboardPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        KEY_TAB_COMMAND,
        (event) => {
          event.preventDefault();
          editor.dispatchCommand(
            event.shiftKey ? OUTDENT_CONTENT_COMMAND : INDENT_CONTENT_COMMAND,
            undefined,
          );
          return true;
        },
        COMMAND_PRIORITY_EDITOR,
      ),
    [editor],
  );

  return null;
}
