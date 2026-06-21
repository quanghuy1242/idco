/**
 * The built-in `table` node view (docs/016 §10, docs/020 §7.2).
 *
 * The owned `table` is an opaque object that round-trips and renders read-only
 * (docs/018 §2.13/§2.14): cell-by-cell editing is the deferred structural-table
 * workstream (docs/020 §11). It still renders its real grid (not a placeholder)
 * and is insertable. New tables serialize as `editor-table`; both render the same.
 */
import {
  RichTextTable,
  RichTextTableCell,
  RichTextTableRow,
} from "@quanghuy1242/idco-ui";
import { type JsonValue } from "../../core";
import { type NodeView } from "../node-view";
import { asRecord, stringField } from "../object-data";

/** Flatten a baked node's nested text into a plain string (cell/inline content). */
function inlineText(node: JsonValue): string {
  const record = asRecord(node);
  const text = stringField(record, "text");
  if (text) return text;
  const children = Array.isArray(record.children) ? record.children : [];
  return children.map(inlineText).join("");
}

/** Render a baked table read-only via the shared reader table primitives. */
function renderBakedTable(payload: Record<string, JsonValue>) {
  const rows = Array.isArray(payload.children) ? payload.children : [];
  const colWidths = Array.isArray(payload.colWidths)
    ? payload.colWidths.filter((w): w is number => typeof w === "number")
    : undefined;
  return (
    <div data-engine-object-baked="table">
      <RichTextTable
        colWidths={colWidths}
        layout={stringField(payload, "layout") || undefined}
        numbered={payload.showRowNumbers === true}
      >
        {rows.map((row, ri) => {
          const cells = Array.isArray(asRecord(row).children)
            ? (asRecord(row).children as JsonValue[])
            : [];
          return (
            <RichTextTableRow key={`r${ri}`}>
              {cells.map((cell, ci) => {
                const cellRecord = asRecord(cell);
                const header =
                  (typeof cellRecord.headerState === "number"
                    ? cellRecord.headerState
                    : 0) > 0;
                return (
                  <RichTextTableCell header={header} key={`c${ri}-${ci}`}>
                    {inlineText(cell)}
                  </RichTextTableCell>
                );
              })}
            </RichTextTableRow>
          );
        })}
      </RichTextTable>
    </div>
  );
}

/** A default table row of text cells (the Insert-menu seed). */
function defaultTableRow(texts: readonly string[], header: boolean): JsonValue {
  return {
    children: texts.map((text) => ({
      children: text ? [{ text, type: "text" }] : [],
      headerState: header ? 3 : 0,
      type: "tablecell",
    })),
    type: "tablerow",
  };
}

const renderRestingTable = ({ baked }: { baked: { payload: JsonValue } }) =>
  renderBakedTable(asRecord(baked.payload));

export const tableView: NodeView = {
  ariaLabel: "Table",
  chromeMeta: { icon: "Table", label: "Table" },
  // Cell-by-cell editing is the deferred structural-table workstream, so the table
  // has no inline config (docs/018 §2.13/§2.14, docs/020 §11).
  configurable: false,
  insert: {
    createData: () => ({
      children: [
        defaultTableRow(["Column 1", "Column 2"], true),
        defaultTableRow(["", ""], false),
      ],
    }),
    group: "Blocks",
    icon: "Table",
    keywords: ["table", "grid", "rows", "columns"],
    label: "Table",
  },
  renderResting: renderRestingTable,
  type: "table",
};

// New tables serialize as `editor-table`; render it identically. It carries no
// ariaLabel/chromeMeta so it falls back to the generic labels (parity with the
// pre-split behavior), and is not configurable.
export const editorTableView: NodeView = {
  configurable: false,
  renderResting: renderRestingTable,
  type: "editor-table",
};
