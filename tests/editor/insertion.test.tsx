// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";
import {
  INSERT_RICH_TEXT_NODE_COMMAND,
  RICH_TEXT_DECORATOR_NODES,
  RichTextNodePlugin,
} from "../../packages/editor/src/nodes";

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
      <RichTextNodePlugin />
      <Capture onReady={(value) => (editor = value)} />
    </LexicalComposer>,
  );
  return editor;
}

const codeBlock = {
  language: "ts",
  text: "const value = true;",
  type: "code-block",
} as const;

// dispatchCommand commits on the next microtask in this headless setup.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("rich-text node insertion", () => {
  it("replaces the empty caret paragraph instead of wrapping in blank lines", async () => {
    const editor = mountEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        root.append(paragraph);
        paragraph.select();
      },
      { discrete: true },
    );

    editor.dispatchCommand(INSERT_RICH_TEXT_NODE_COMMAND, codeBlock);
    await flush();

    editor.getEditorState().read(() => {
      const types = $getRoot()
        .getChildren()
        .map((node) => node.getType());
      // Old behavior left a blank paragraph before AND after (3 children).
      // The block now replaces the empty paragraph; one trailing paragraph
      // remains as the caret home for the trailing decorator block.
      expect(types).toEqual(["code-block", "paragraph"]);
    });
  });

  it("does not add a trailing paragraph when a block already follows", async () => {
    const editor = mountEditor();
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const empty = $createParagraphNode();
        const after = $createParagraphNode();
        after.append($createTextNode("after"));
        root.append(empty);
        root.append(after);
        empty.select();
      },
      { discrete: true },
    );

    editor.dispatchCommand(INSERT_RICH_TEXT_NODE_COMMAND, codeBlock);
    await flush();

    editor.getEditorState().read(() => {
      const types = $getRoot()
        .getChildren()
        .map((node) => node.getType());
      expect(types).toEqual(["code-block", "paragraph"]);
    });
  });
});
