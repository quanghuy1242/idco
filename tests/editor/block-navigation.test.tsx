// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";
import {
  CodeBlockNode,
  RICH_TEXT_DECORATOR_NODES,
} from "../../packages/editor/src/legacy/nodes";
import { BlockNavigationPlugin } from "../../packages/editor/src/legacy/plugins/block-navigation-plugin";
import { GapCursorPlugin } from "../../packages/editor/src/legacy/plugins/gap-cursor-plugin";

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
        nodes: [...RICH_TEXT_DECORATOR_NODES],
        onError(error) {
          throw error;
        },
      }}
    >
      <GapCursorPlugin />
      <BlockNavigationPlugin />
      <Capture onReady={(value) => (editor = value)} />
    </LexicalComposer>,
  );
  return editor;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("block navigation (caret never invisible)", () => {
  it("redirects a root-anchored caret to the end of the previous block", async () => {
    const editor = mountEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("Hello"));
        root.append(paragraph);
        // Simulate arrowing past the last block: a collapsed selection anchored
        // on the root (the invisible boundary slot).
        root.select(1);
      },
      { discrete: true },
    );
    await flush();
    await flush();

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      const anchor = selection.anchor.getNode();
      // No longer stranded on the root — it sits in the paragraph's text.
      expect($isRootNode(anchor)).toBe(false);
      expect(anchor.getTextContent()).toBe("Hello");
    });
  });

  it("uses the gap cursor when no adjacent block can hold a real caret", async () => {
    const editor = mountEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        paragraph.append($createTextNode("Body"));
        root.append(paragraph);
        root.append(
          new CodeBlockNode({
            language: "ts",
            text: "x",
            type: "code-block",
          }),
        );
        paragraph.selectEnd();
      },
      { discrete: true },
    );
    await flush();

    // Now strand the caret on the root past the trailing (decorator) code block.
    editor.update(
      () => {
        $getRoot().select(2);
      },
      { discrete: true },
    );
    await flush();
    await flush();

    editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    editor.getEditorState().read(() => {
      expect(
        $getRoot()
          .getChildren()
          .map((node) => node.getType()),
      ).toEqual(["paragraph", "code-block", "paragraph"]);
    });
  });
});
