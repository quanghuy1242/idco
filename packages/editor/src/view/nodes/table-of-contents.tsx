/**
 * The built-in `table-of-contents` node view (docs/016 §10, docs/020 §7.2).
 *
 * The table-of-contents is a positional marker: its entries are derived from the
 * document's headings at publish time (the reader has the whole document; this
 * per-node view does not), so the editor renders its title + a hint while the real
 * list renders in the reader / the TOC rail (docs/018 §2.14). Its title is edited
 * through the dispatcher's default config popover (`configFields`).
 */
import { type NodeView } from "../spi";
import { asRecord, stringField } from "../object-data";

/** The card styling for the resting table-of-contents marker. */
const tocBoxStyle = {
  background:
    "color-mix(in oklab, var(--color-base-content, currentColor) 4%, transparent)",
  border:
    "1px solid color-mix(in oklab, var(--color-base-content, currentColor) 18%, transparent)",
  borderRadius: "var(--radius-box, 0.5rem)",
  padding: "8px 12px",
} as const;

export const tableOfContentsView: NodeView = {
  ariaLabel: "Table of contents",
  chromeMeta: { icon: "List", label: "Contents" },
  configFields: [{ key: "title", label: "Title" }],
  insert: {
    createData: () => ({
      maxLevel: 4,
      minLevel: 2,
      numbering: "none",
      placement: "inline",
      side: "right",
      style: "default",
      title: "On this page",
    }),
    group: "Blocks",
    icon: "List",
    keywords: ["toc", "contents", "outline", "headings"],
    label: "Table of contents",
  },
  renderResting: ({ baked }) => {
    const payload = asRecord(baked.payload);
    return (
      <div data-engine-object-baked="table-of-contents" style={tocBoxStyle}>
        <div style={{ fontWeight: 600 }}>
          {stringField(payload, "title") || "On this page"}
        </div>
        <div style={{ fontSize: "0.85em", opacity: 0.6 }}>
          Generated from this page's headings
        </div>
      </div>
    );
  },
  type: "table-of-contents",
};
