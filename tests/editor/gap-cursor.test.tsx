// @vitest-environment jsdom

import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CalloutNode,
  CodeBlockNode,
  RICH_TEXT_DECORATOR_NODES,
  RichTextNodePlugin,
} from "../../packages/editor-legacy/src/nodes";
import { BlockControlsPlugin } from "../../packages/editor-legacy/src/plugins/block-controls-plugin";
import { BlockNavigationPlugin } from "../../packages/editor-legacy/src/plugins/block-navigation-plugin";
import {
  GapCursorPlugin,
  SET_GAP_CURSOR_COMMAND,
} from "../../packages/editor-legacy/src/plugins/gap-cursor-plugin";

function Capture({ onReady }: { onReady: (editor: LexicalEditor) => void }) {
  const [editor] = useLexicalComposerContext();
  onReady(editor);
  return null;
}

function mountEditor({
  clickControls = false,
  navigation = false,
}: {
  readonly clickControls?: boolean;
  readonly navigation?: boolean;
} = {}): LexicalEditor {
  let editor!: LexicalEditor;
  render(
    <LexicalComposer
      initialConfig={{
        namespace: "gap-cursor-test",
        nodes: [
          TableCellNode,
          TableNode,
          TableRowNode,
          ...RICH_TEXT_DECORATOR_NODES,
        ],
        onError(error) {
          throw error;
        },
      }}
    >
      <RichTextPlugin
        contentEditable={<ContentEditable aria-label="Body" />}
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <GapCursorPlugin />
      {navigation ? <BlockNavigationPlugin /> : null}
      {clickControls ? <BlockControlsPlugin /> : null}
      <RichTextNodePlugin />
      <Capture onReady={(value) => (editor = value)} />
    </LexicalComposer>,
  );
  return editor;
}

function code(text: string) {
  return new CodeBlockNode({
    language: "ts",
    text,
    type: "code-block",
  });
}

function callout(text: string) {
  return new CalloutNode({
    children: [{ text, type: "text" }],
    tone: "info",
    type: "callout",
  });
}

function paragraph(text: string) {
  const node = $createParagraphNode();
  node.append($createTextNode(text));
  return node;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function nodeTypes(editor: LexicalEditor): string[] {
  let types: string[] = [];
  editor.getEditorState().read(() => {
    types = $getRoot()
      .getChildren()
      .map((node) => node.getType());
  });
  return types;
}

function paragraphTexts(editor: LexicalEditor): string[] {
  let texts: string[] = [];
  editor.getEditorState().read(() => {
    texts = $getRoot()
      .getChildren()
      .filter((node) => node.getType() === "paragraph")
      .map((node) => node.getTextContent());
  });
  return texts;
}

function firstTableCellNodeTypes(editor: LexicalEditor): string[] {
  let types: string[] = [];
  editor.getEditorState().read(() => {
    const table = $getRoot().getFirstChild();
    if (!$isElementNode(table)) return;
    const row = table?.getFirstChild();
    if (!$isElementNode(row)) return;
    const cell = row?.getFirstChild();
    if (!$isTableCellNode(cell)) return;
    types = cell.getChildren().map((node) => node.getType());
  });
  return types;
}

function firstTableCellParagraphTexts(editor: LexicalEditor): string[] {
  let texts: string[] = [];
  editor.getEditorState().read(() => {
    const table = $getRoot().getFirstChild();
    if (!$isElementNode(table)) return;
    const row = table?.getFirstChild();
    if (!$isElementNode(row)) return;
    const cell = row?.getFirstChild();
    if (!$isTableCellNode(cell)) return;
    texts = cell
      .getChildren()
      .filter((node) => node.getType() === "paragraph")
      .map((node) => node.getTextContent());
  });
  return texts;
}

function installTableCellBlocks(
  editor: LexicalEditor,
  children: () => readonly LexicalNode[],
): {
  readonly cellKey: string;
  readonly childKeys: readonly string[];
} {
  let cellKey = "";
  let childKeys: string[] = [];
  editor.update(
    () => {
      const root = $getRoot();
      const table = $createTableNodeWithDimensions(1, 1, false);
      const row = table.getFirstChild();
      if (!$isElementNode(row)) throw new Error("Expected table row");
      const cell = row?.getFirstChild();
      if (!$isTableCellNode(cell)) throw new Error("Expected table cell");
      const nodes = children();
      root.clear();
      cell.clear();
      cell.append(...nodes);
      root.append(table);
      cellKey = cell.getKey();
      childKeys = nodes.map((node) => node.getKey());
    },
    { discrete: true },
  );
  return { cellKey, childKeys };
}

function box(top: number, bottom: number): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 640,
    top,
    width: 640,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function installRects(
  root: HTMLElement,
  rects: readonly { readonly bottom: number; readonly top: number }[],
) {
  root.getBoundingClientRect = () => box(20, 160);
  Array.from(root.children).forEach((child, index) => {
    const rect = rects[index]!;
    (child as HTMLElement).getBoundingClientRect = () =>
      box(rect.top, rect.bottom);
  });
}

function installScopeRects(
  editor: LexicalEditor,
  scopeKey: string,
  childKeys: readonly string[],
  rects: readonly { readonly bottom: number; readonly top: number }[],
) {
  const scope = editor.getElementByKey(scopeKey);
  if (!(scope instanceof HTMLElement)) {
    throw new Error("Expected scope element");
  }
  scope.getBoundingClientRect = () => box(20, 160);
  childKeys.forEach((key, index) => {
    const element = editor.getElementByKey(key);
    if (!(element instanceof HTMLElement)) {
      throw new Error("Expected child element");
    }
    const rect = rects[index]!;
    element.getBoundingClientRect = () => box(rect.top, rect.bottom);
  });
  return scope;
}

describe("gap cursor", () => {
  it("typing at a gap between two atomic blocks inserts exactly one paragraph there", async () => {
    const editor = mountEditor();
    let firstKey = "";
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const first = code("one");
        root.append(first, code("two"));
        firstKey = first.getKey();
      },
      { discrete: true },
    );

    editor.dispatchCommand(SET_GAP_CURSOR_COMMAND, {
      anchorKey: firstKey,
      side: "after",
    });
    editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "x");
    await flush();

    expect(nodeTypes(editor)).toEqual([
      "code-block",
      "paragraph",
      "code-block",
    ]);
    expect(paragraphTexts(editor)).toEqual(["x"]);
  });

  it("Enter at a gap materialises an empty paragraph without persisting abandoned gaps", async () => {
    const editor = mountEditor();
    let firstKey = "";
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const first = code("one");
        root.append(first, code("two"));
        firstKey = first.getKey();
      },
      { discrete: true },
    );

    const before = JSON.stringify(editor.getEditorState().toJSON());
    editor.dispatchCommand(SET_GAP_CURSOR_COMMAND, {
      anchorKey: firstKey,
      side: "after",
    });
    await flush();
    expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(before);

    editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    expect(nodeTypes(editor)).toEqual([
      "code-block",
      "paragraph",
      "code-block",
    ]);
    expect(paragraphTexts(editor)).toEqual([""]);
  });

  it("arrow navigation into an atomic-to-atomic boundary can materialise content", async () => {
    const editor = mountEditor({ navigation: true });
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append(code("one"), code("two"));
        root.select(1, 1);
      },
      { discrete: true },
    );
    await flush();
    await flush();

    editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    expect(nodeTypes(editor)).toEqual([
      "code-block",
      "paragraph",
      "code-block",
    ]);
  });

  it("treats table outer boundaries as gap-cursor boundaries", async () => {
    const editor = mountEditor({ navigation: true });
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append(code("one"), $createTableNodeWithDimensions(1, 1, true));
        root.select(1, 1);
      },
      { discrete: true },
    );
    await flush();
    await flush();

    editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    expect(nodeTypes(editor)).toEqual(["code-block", "paragraph", "table"]);
  });

  it("arrow keys move an active gap cursor to the next boundary", async () => {
    const editor = mountEditor();
    let firstKey = "";
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        const first = code("one");
        root.append(first, code("two"));
        firstKey = first.getKey();
      },
      { discrete: true },
    );

    editor.dispatchCommand(SET_GAP_CURSOR_COMMAND, {
      anchorKey: firstKey,
      side: "after",
    });
    editor.dispatchCommand(
      KEY_ARROW_DOWN_COMMAND,
      new KeyboardEvent("keydown", { key: "ArrowDown" }),
    );
    editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    expect(nodeTypes(editor)).toEqual([
      "code-block",
      "code-block",
      "paragraph",
    ]);
  });

  it("clicking above the first atomic block places a gap cursor that inserts before it", async () => {
    const editor = mountEditor({ clickControls: true });
    editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append(code("one"), code("two"));
      },
      { discrete: true },
    );
    await flush();
    await flush();

    const rootElement = screen.getByRole("textbox", { name: /body/i });
    installRects(rootElement, [
      { bottom: 80, top: 50 },
      { bottom: 130, top: 100 },
    ]);

    await act(async () => {
      fireEvent.click(rootElement, { clientY: 35 });
    });
    editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    expect(nodeTypes(editor)).toEqual([
      "paragraph",
      "code-block",
      "code-block",
    ]);
  });

  it("typing at a gap between atomic blocks inside a table cell inserts in that cell only", async () => {
    const editor = mountEditor();
    let firstKey = "";
    installTableCellBlocks(editor, () => {
      const first = code("one");
      firstKey = first.getKey();
      return [first, callout("two")];
    });

    const before = JSON.stringify(editor.getEditorState().toJSON());
    editor.dispatchCommand(SET_GAP_CURSOR_COMMAND, {
      anchorKey: firstKey,
      side: "after",
    });
    await flush();
    expect(JSON.stringify(editor.getEditorState().toJSON())).toBe(before);

    editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "x");
    await flush();

    expect(nodeTypes(editor)).toEqual(["table"]);
    expect(firstTableCellNodeTypes(editor)).toEqual([
      "code-block",
      "paragraph",
      "callout",
    ]);
    expect(firstTableCellParagraphTexts(editor)).toEqual(["x"]);
  });

  it("clicking between code and callout inside a table cell inserts between them", async () => {
    const editor = mountEditor({ clickControls: true });
    const { cellKey, childKeys } = installTableCellBlocks(editor, () => [
      code("one"),
      callout("two"),
    ]);
    await flush();
    await flush();

    const cell = installScopeRects(editor, cellKey, childKeys, [
      { bottom: 80, top: 50 },
      { bottom: 130, top: 100 },
    ]);

    await act(async () => {
      fireEvent.click(cell, { clientX: 20, clientY: 90 });
    });
    editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    expect(nodeTypes(editor)).toEqual(["table"]);
    expect(firstTableCellNodeTypes(editor)).toEqual([
      "code-block",
      "paragraph",
      "callout",
    ]);
  });

  it("clicking before and after atomic blocks inside a table cell stays inside that cell", async () => {
    const beforeEditor = mountEditor({ clickControls: true });
    const beforeScope = installTableCellBlocks(beforeEditor, () => [
      code("one"),
      callout("two"),
    ]);
    await flush();
    await flush();
    const beforeCell = installScopeRects(
      beforeEditor,
      beforeScope.cellKey,
      beforeScope.childKeys,
      [
        { bottom: 80, top: 50 },
        { bottom: 130, top: 100 },
      ],
    );

    await act(async () => {
      fireEvent.click(beforeCell, { clientX: 20, clientY: 35 });
    });
    beforeEditor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    expect(nodeTypes(beforeEditor)).toEqual(["table"]);
    expect(firstTableCellNodeTypes(beforeEditor)).toEqual([
      "paragraph",
      "code-block",
      "callout",
    ]);

    const afterEditor = mountEditor({ clickControls: true });
    const afterScope = installTableCellBlocks(afterEditor, () => [
      code("one"),
      callout("two"),
    ]);
    await flush();
    await flush();
    const afterCell = installScopeRects(
      afterEditor,
      afterScope.cellKey,
      afterScope.childKeys,
      [
        { bottom: 80, top: 50 },
        { bottom: 130, top: 100 },
      ],
    );

    await act(async () => {
      fireEvent.click(afterCell, { clientX: 20, clientY: 145 });
    });
    afterEditor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    expect(nodeTypes(afterEditor)).toEqual(["table"]);
    expect(firstTableCellNodeTypes(afterEditor)).toEqual([
      "code-block",
      "callout",
      "paragraph",
    ]);
  });

  it("arrow navigation can materialise the code-callout gap inside a table cell", async () => {
    const editor = mountEditor({ navigation: true });
    let introKey = "";
    installTableCellBlocks(editor, () => {
      const intro = paragraph("Intro");
      introKey = intro.getKey();
      return [intro, code("one"), callout("two")];
    });
    editor.update(
      () => {
        const intro = $getNodeByKey(introKey);
        if ($isElementNode(intro)) intro.selectEnd();
      },
      { discrete: true },
    );
    await flush();
    await flush();

    editor.dispatchCommand(
      KEY_ARROW_DOWN_COMMAND,
      new KeyboardEvent("keydown", { key: "ArrowDown" }),
    );
    editor.dispatchCommand(KEY_ENTER_COMMAND, null);
    await flush();

    expect(nodeTypes(editor)).toEqual(["table"]);
    expect(firstTableCellNodeTypes(editor)).toEqual([
      "paragraph",
      "code-block",
      "paragraph",
      "callout",
    ]);
  });
});
