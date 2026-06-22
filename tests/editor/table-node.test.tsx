// @vitest-environment jsdom

import {
  $createTableNodeWithDimensions,
  $isTableCellNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $getRoot,
  createEditor,
  type LexicalEditor,
  type SerializedEditorState,
} from "lexical";
import { describe, expect, it } from "vitest";
import {
  $readTableMeta,
  $setHeaderColumn,
  $setHeaderRow,
  EditorTableNode,
} from "../../packages/editor-legacy/src/nodes/table-node";

function makeEditor(): LexicalEditor {
  return createEditor({
    namespace: "table-node-test",
    nodes: [
      EditorTableNode,
      {
        replace: TableNode,
        with: () => new EditorTableNode(),
        withKlass: EditorTableNode,
      },
      TableRowNode,
      TableCellNode,
    ],
    onError(error) {
      throw error;
    },
  });
}

/** First table object in the serialized editor state. */
function serializedTable(editor: LexicalEditor): Record<string, unknown> {
  const json = editor.getEditorState().toJSON() as {
    root: { children: Record<string, unknown>[] };
  };
  const table = json.root.children.find(
    (node) => node.type === "table" || node.type === "editor-table",
  );
  if (!table) throw new Error("no table in serialized state");
  return table;
}

function withNewTable(
  editor: LexicalEditor,
  mutate?: (node: EditorTableNode) => void,
) {
  editor.update(
    () => {
      const table = $createTableNodeWithDimensions(2, 3, true);
      $getRoot().clear().append(table);
      if (table instanceof EditorTableNode && mutate) mutate(table);
    },
    { discrete: true },
  );
}

describe("EditorTableNode serialization", () => {
  it("creates EditorTableNode via node replacement", () => {
    const editor = makeEditor();
    let isEditorTable = false;
    withNewTable(editor);
    editor.getEditorState().read(() => {
      isEditorTable = $getRoot().getFirstChild() instanceof EditorTableNode;
    });
    expect(isEditorTable).toBe(true);
  });

  it("defaults new tables to responsive and serializes as type 'table'-compatible 'editor-table'", () => {
    const editor = makeEditor();
    withNewTable(editor);
    const table = serializedTable(editor);
    expect(table.type).toBe("editor-table");
    expect(table.layout).toBe("responsive");
    // No numbered column by default → the flag is omitted.
    expect(table.showRowNumbers).toBeUndefined();
  });

  it("round-trips an explicit layout and the numbered-column flag", () => {
    const editor = makeEditor();
    withNewTable(editor, (table) => {
      table.setLayout("fixed");
      table.setShowRowNumbers(true);
    });
    const exported = serializedTable(editor);
    expect(exported.layout).toBe("fixed");
    expect(exported.showRowNumbers).toBe(true);

    // Re-import the exported state into a fresh editor and confirm it survives.
    const reloaded = makeEditor();
    reloaded.setEditorState(
      reloaded.parseEditorState({
        root: {
          children: [exported],
          direction: null,
          format: "",
          indent: 0,
          type: "root",
          version: 1,
        },
      } as unknown as SerializedEditorState),
    );
    reloaded.getEditorState().read(() => {
      const node = $getRoot().getFirstChild();
      expect(node).toBeInstanceOf(EditorTableNode);
      const reloadedTable = node as EditorTableNode;
      expect(reloadedTable.getLayout()).toBe("fixed");
      expect(reloadedTable.getShowRowNumbers()).toBe(true);
    });
  });

  it("treats a legacy 'table' node (no layout) as fixed", () => {
    const editor = makeEditor();
    const legacy = {
      root: {
        children: [
          {
            type: "table",
            direction: null,
            format: "",
            indent: 0,
            version: 1,
            children: [
              {
                type: "tablerow",
                direction: null,
                format: "",
                indent: 0,
                version: 1,
                children: [
                  {
                    type: "tablecell",
                    headerState: 0,
                    direction: null,
                    format: "",
                    indent: 0,
                    version: 1,
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
        direction: null,
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    };
    editor.setEditorState(
      editor.parseEditorState(legacy as unknown as SerializedEditorState),
    );
    editor.getEditorState().read(() => {
      const node = $getRoot().getFirstChild();
      expect(node).toBeInstanceOf(EditorTableNode);
      expect((node as EditorTableNode).getLayout()).toBe("fixed");
    });
  });
});

describe("table header toggles", () => {
  it("sets the ROW header bit across the first row without touching COLUMN", () => {
    const editor = makeEditor();
    withNewTable(editor, (table) => {
      $setHeaderColumn(table, true); // column header on first
      $setHeaderRow(table, true); // adding row header must keep column header
    });
    editor.getEditorState().read(() => {
      const table = $getRoot().getFirstChild();
      if (!(table instanceof EditorTableNode)) throw new Error("no table");
      const meta = $readTableMeta(table);
      expect(meta.headerRow).toBe(true);
      expect(meta.headerColumn).toBe(true);
      // The corner cell carries BOTH bits.
      const row = table.getChildAtIndex(0);
      const corner = $isTableRowNode(row) ? row.getChildAtIndex(0) : null;
      const state = $isTableCellNode(corner)
        ? corner.getHeaderStyles()
        : TableCellHeaderStates.NO_STATUS;
      expect(state & TableCellHeaderStates.ROW).not.toBe(0);
      expect(state & TableCellHeaderStates.COLUMN).not.toBe(0);
    });
  });

  it("clears only the toggled axis when turning a header off", () => {
    const editor = makeEditor();
    withNewTable(editor, (table) => {
      $setHeaderRow(table, true);
      $setHeaderColumn(table, true);
      $setHeaderRow(table, false); // remove row header, keep column header
    });
    editor.getEditorState().read(() => {
      const table = $getRoot().getFirstChild();
      if (!(table instanceof EditorTableNode)) throw new Error("no table");
      const meta = $readTableMeta(table);
      expect(meta.headerRow).toBe(false);
      expect(meta.headerColumn).toBe(true);
    });
  });
});
