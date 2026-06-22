// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  type LexicalEditor,
} from "lexical";
import {
  $createGlossaryNode,
  GlossaryNode,
} from "../../packages/editor-legacy/src/nodes/glossary-node";

function Capture({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  onReady(editor);
  return null;
}

function mountEditor(): LexicalEditor {
  let editor!: LexicalEditor;
  render(
    <LexicalComposer
      initialConfig={{
        namespace: "test",
        nodes: [GlossaryNode],
        onError(error) {
          throw error;
        },
      }}
    >
      <Capture onReady={(value) => (editor = value)} />
    </LexicalComposer>,
  );
  return editor;
}

describe("glossary node", () => {
  it("keeps the word when the glossary is unwrapped", () => {
    const editor = mountEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode("see "),
          $createGlossaryNode("API", "interface"),
          $createTextNode(" docs"),
        );
        $getRoot().clear().append(paragraph);
      },
      { discrete: true },
    );

    // Unwrap: replace the glossary node with a text node of its term — the same
    // operation the inline editor's "Remove" performs.
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) return;
        for (const child of paragraph.getChildren()) {
          if (child instanceof GlossaryNode) {
            child.replace($createTextNode(child.getTerm()));
          }
        }
      },
      { discrete: true },
    );

    editor.getEditorState().read(() => {
      // The term "API" survives, glued correctly inside its surrounding text.
      expect($getRoot().getTextContent()).toBe("see API docs");
    });
  });
});
