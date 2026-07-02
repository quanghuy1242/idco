/**
 * `ChangeDetail` — the read-only change-detail rows (docs/039 §6.2 Atom 2, from docs/036 §6.4).
 *
 * The invisible part of a change — a node attr (align, indent, a cell's fill), a mark added/removed
 * (an unstyled bold, a dropped link), an object's fields (code `language`, image `alt`) — carries no
 * text-run glyph, so it is shown as one row per change: `key base → target`, a mark tag, a field
 * transition. Lifted out of the diff view's private `renderChangeDetail` so BOTH surfaces render it
 * from one component: the diff view appends it inside a changed block's shell, and the woven
 * overlay's floating chip renders it for the element under the review cursor, so `Fill: red → green`
 * reads the same in the chip as in the card (docs/039 §7.6, P4). Pure and RSC-safe: no hooks, no
 * state, rendered as an inline `display:block` span so it is valid inside a `<p>`, `<li>`, or `<td>`.
 *
 * @categoryDefault Diff View
 */
import type { ReactNode } from "react";
import type {
  ReaderBlockNode,
  ReaderSnapshot,
  ReaderTextNode,
} from "../reader";
import type { ReaderBlockDiff, ReaderTextLeafDiff } from "./types";

/**
 * @categoryDefault Diff View
 */

/** The text leaf for a block, or undefined for a non-text node. */
function asText(node: ReaderBlockNode | undefined): ReaderTextNode | undefined {
  return node && node.kind === "text" ? node : undefined;
}

/** Format an attr/field value for a change summary: string as-is, else JSON, truncated; `—` for absent. */
function fmtVal(value: unknown): string {
  if (value === undefined) return "—";
  const raw = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return raw.length > 48 ? `${raw.slice(0, 48)}…` : raw;
}

/** A friendly label for a mark kind in the mark-change summary (§6.4). */
const MARK_LABEL: Readonly<Record<string, string>> = {
  bold: "Bold",
  code: "Code",
  comment: "Comment",
  glossary: "Glossary",
  highlight: "Highlight",
  italic: "Italic",
  link: "Link",
  strikethrough: "Strikethrough",
  subscript: "Subscript",
  superscript: "Superscript",
  underline: "Underline",
};

function markLabel(kind: string): string {
  return MARK_LABEL[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** The affected text of a mark change: base-side for a removed mark, target-side otherwise (§6.4). */
function markSnippet(
  block: ReaderBlockDiff,
  base: ReaderSnapshot,
  target: ReaderSnapshot,
  change: ReaderTextLeafDiff["markChanges"][number],
): string {
  const leaf =
    change.op === "removed"
      ? asText(base.body.blocks[block.id])
      : asText(target.body.blocks[block.id]);
  if (!leaf) return "";
  const s = leaf.content.text.slice(change.from, change.to);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
}

const markTagClass = (op: "added" | "removed" | "changed"): string =>
  op === "removed"
    ? "rt-diff-tag-removed"
    : op === "added"
      ? "rt-diff-tag-added"
      : "rt-diff-tag-changed";

/** Build the detail rows for a changed block (attrs, mark changes, object fields); empty when none. */
function detailRows(
  block: ReaderBlockDiff,
  base: ReaderSnapshot,
  target: ReaderSnapshot,
): ReactNode[] {
  const rows: ReactNode[] = [];
  const attrs = block.attrs;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs.added)) {
      rows.push(
        <span className="rt-diff-detail-row" key={`aa.${key}`}>
          <span className="rt-diff-field-key">{key}</span> —{" → "}
          <span className="rt-diff-ins">{fmtVal(value)}</span>
        </span>,
      );
    }
    for (const [key, pair] of Object.entries(attrs.changed)) {
      rows.push(
        <span className="rt-diff-detail-row" key={`ac.${key}`}>
          <span className="rt-diff-field-key">{key}</span>{" "}
          <span className="rt-diff-del">{fmtVal(pair.base)}</span>
          {" → "}
          <span className="rt-diff-ins">{fmtVal(pair.target)}</span>
        </span>,
      );
    }
    for (const [key, value] of Object.entries(attrs.removed)) {
      rows.push(
        <span className="rt-diff-detail-row" key={`ar.${key}`}>
          <span className="rt-diff-field-key">{key}</span>{" "}
          <span className="rt-diff-del">{fmtVal(value)}</span>
          {" → —"}
        </span>,
      );
    }
  }
  const markChanges = block.text?.markChanges ?? [];
  markChanges.forEach((change, index) => {
    const snippet = markSnippet(block, base, target, change);
    const href =
      change.op !== "removed" &&
      change.attrs &&
      typeof change.attrs.href === "string"
        ? change.attrs.href
        : undefined;
    rows.push(
      <span className="rt-diff-detail-row" key={`m.${index}`}>
        <span className={`rt-diff-marktag ${markTagClass(change.op)}`}>
          {markLabel(change.kind)} {change.op}
        </span>
        {snippet ? (
          <>
            {" on “"}
            <span className="rt-diff-mark-snip">{snippet}</span>
            {"”"}
          </>
        ) : null}
        {href ? <> · {href}</> : null}
      </span>,
    );
  });
  for (const field of block.object?.fields ?? []) {
    rows.push(
      <span className="rt-diff-detail-row" key={`f.${field.path}`}>
        <span className="rt-diff-field-key">{field.path}</span>{" "}
        <span className="rt-diff-del">{fmtVal(field.base)}</span>
        {" → "}
        <span className="rt-diff-ins">{fmtVal(field.target)}</span>
      </span>,
    );
  }
  return rows;
}

/**
 * Render one changed block's detail rows (docs/039 §6.2) — the attr diffs, mark changes (including
 * removals), and object fields that carry no text-run glyph. Returns `null` when the block has no
 * such detail (a pure text edit), so a caller can gate on it. Reads only the block diff and the two
 * snapshots, so it is pure and reusable by the diff view card and the woven review chip alike.
 *
 * @category Diff View
 */
export function ChangeDetail(props: {
  readonly block: ReaderBlockDiff;
  readonly base: ReaderSnapshot;
  readonly target: ReaderSnapshot;
}): ReactNode {
  const rows = detailRows(props.block, props.base, props.target);
  if (rows.length === 0) return null;
  // `rows` already carry stable keys (`aa.<key>`, `m.<i>`, `f.<path>`), so render them directly —
  // the same `<span class="rt-diff-detail">` the diff view emitted, byte-for-byte (docs/039 P2).
  return <span className="rt-diff-detail">{rows}</span>;
}
