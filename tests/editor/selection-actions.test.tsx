// @vitest-environment jsdom

import { ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type ElementNode,
  type LexicalEditor,
  type TextNode,
} from "lexical";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ALLOWED_NODES } from "@idco/editor";
import {
  enabledTextSelectionActions,
  readTextSelectionContext,
} from "../../packages/editor/src/legacy/model/selection-actions";

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
        namespace: "selection-actions-test",
        nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
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

function installSelection(
  editor: LexicalEditor,
  createBlock: () => ElementNode,
  range: readonly [number, number] = [0, 7],
) {
  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const block = createBlock();
      const text = $createTextNode("Selected text") as TextNode;
      block.append(text);
      root.append(block);
      text.select(range[0], range[1]);
    },
    { discrete: true },
  );
}

function enabledIds(
  editor: LexicalEditor,
  options: {
    readonly allowedNodes?: readonly string[];
    readonly onComment?: boolean;
  } = {},
) {
  return editor.getEditorState().read(() =>
    enabledTextSelectionActions(
      readTextSelectionContext({
        allowedNodes: options.allowedNodes ?? DEFAULT_ALLOWED_NODES,
        bindings: options.onComment
          ? {
              onComment:
                vi.fn<(id: string, quote: string, body: string) => void>(),
            }
          : undefined,
      }),
    ).map((action) => action.id),
  );
}

describe("selection action model", () => {
  it("enables every selected-text action for paragraph text with comment binding", () => {
    const editor = mountEditor();
    installSelection(editor, () => $createParagraphNode());

    expect(enabledIds(editor, { onComment: true })).toEqual([
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
      "outdent",
      "indent",
      "link",
      "glossary",
      "comment",
    ]);
  });

  it("applies heading inline-format restrictions", () => {
    const editor = mountEditor();
    installSelection(editor, () => $createHeadingNode("h2"));

    expect(enabledIds(editor, { onComment: true })).toEqual([
      "bold",
      "italic",
      "code",
      "outdent",
      "indent",
      "link",
      "glossary",
      "comment",
    ]);
  });

  it("keeps quote text plain while still allowing inline insert actions", () => {
    const editor = mountEditor();
    installSelection(editor, () => $createQuoteNode());

    expect(enabledIds(editor, { onComment: true })).toEqual([
      "link",
      "glossary",
      "comment",
    ]);
  });

  it("honors allowlist and host comment binding gates", () => {
    const editor = mountEditor();
    installSelection(editor, () => $createParagraphNode());

    expect(
      enabledIds(editor, {
        allowedNodes: ["paragraph", "text"],
        onComment: true,
      }),
    ).toEqual([
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
      "outdent",
      "indent",
    ]);
    expect(enabledIds(editor)).toEqual([
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
      "outdent",
      "indent",
      "link",
      "glossary",
    ]);
  });

  it("returns no enabled actions for a collapsed range", () => {
    const editor = mountEditor();
    installSelection(editor, () => $createParagraphNode(), [0, 0]);

    expect(enabledIds(editor, { onComment: true })).toEqual([]);
  });
});
