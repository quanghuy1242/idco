import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useRef } from "react";
import { lexicalEditorState } from "../model/serialize";
import type { RichTextEditorDocument } from "../model/schema";

/**
 * Pushes controlled `value` changes into the editor without clobbering local
 * edits. `isEcho` is true when the incoming `document` is the value this editor
 * just emitted — the editor already holds it, so we skip the (per-keystroke,
 * whole-document) serialize-and-compare entirely. Only a genuinely external
 * value is reapplied, and only when it actually differs from the editor state.
 */
export function EditorDocumentSyncPlugin({
  document,
  isEcho,
}: {
  readonly document: RichTextEditorDocument;
  readonly isEcho: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    // Our own change is already in the editor — nothing to reapply.
    if (isEcho) return;
    const editorStateJson = JSON.stringify(lexicalEditorState(document));
    const currentStateJson = JSON.stringify(editor.getEditorState().toJSON());
    if (currentStateJson !== editorStateJson) {
      editor.setEditorState(editor.parseEditorState(editorStateJson));
    }
  }, [editor, document, isEcho]);

  return null;
}
