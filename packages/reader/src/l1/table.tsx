/**
 * L1 table primitives (docs/015 §4.2). Pure, RSC-safe. The table chrome (rounded frame,
 * grid borders, the numbered-column gutter) is the same Tailwind/DaisyUI markup the
 * editor's resting render already shares, moved verbatim from `@idco/ui`. The numbered
 * gutter ships its own scoped `<style>` because L1 ships no global stylesheet for it.
 */
import type { ReactNode } from "react";
import { readableTextColor, verticalAlignClass } from "./types";

type RichTextChildrenProps = { readonly children?: ReactNode };

/** Scoped CSS for the numbered-column gutter — mirrors the editor's counter technique. */
const NUMBERED_TABLE_CSS = `
.rt-table-numbered{counter-reset:rt-row}
.rt-table-numbered tr{counter-increment:rt-row}
.rt-table-numbered tr>*:first-child{padding-left:3rem}
.rt-table-numbered tr>*:first-child::before{content:counter(rt-row);position:absolute;left:0;top:0;bottom:0;width:2.25rem;display:grid;place-items:center;font-size:0.7rem;font-variant-numeric:tabular-nums;color:var(--color-base-content);opacity:0.45;background:var(--color-base-200);border-right:1px solid var(--color-base-300)}
`;

export function RichTextTable({
  children,
  colWidths,
  layout = "fixed",
  numbered = false,
}: RichTextChildrenProps & {
  readonly colWidths?: readonly number[];
  readonly layout?: string;
  readonly numbered?: boolean;
}) {
  const responsive = layout === "responsive" || layout === "full-width";
  const total = colWidths?.reduce((sum, width) => sum + width, 0) ?? 0;
  const colGroup =
    colWidths && colWidths.length > 0 ? (
      <colgroup>
        {colWidths.map((width, index) => (
          <col
            // eslint-disable-next-line react/no-array-index-key -- columns are positional
            key={index}
            style={{
              width:
                responsive && total > 0
                  ? `${((width / total) * 100).toFixed(4)}%`
                  : `${width}px`,
            }}
          />
        ))}
      </colgroup>
    ) : null;
  return (
    <div className="my-3 overflow-x-auto overflow-y-hidden rounded-box border border-base-300">
      {numbered ? <style>{NUMBERED_TABLE_CSS}</style> : null}
      <table
        className={`border-separate border-spacing-0 text-sm [&_tr:last-child>*]:border-b-0 [&_tr>*:last-child]:border-r-0 ${
          responsive || !colGroup ? "w-full" : ""
        } ${colGroup ? "table-fixed" : ""} ${
          numbered ? "rt-table-numbered [&_td]:relative [&_th]:relative" : ""
        }`.trim()}
        data-table-layout={layout}
      >
        {colGroup}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function RichTextTableRow({ children }: RichTextChildrenProps) {
  return <tr>{children}</tr>;
}

export function RichTextTableCell({
  header,
  children,
  colSpan,
  rowSpan,
  backgroundColor,
  verticalAlign,
}: RichTextChildrenProps & {
  readonly header?: boolean;
  readonly colSpan?: number;
  readonly rowSpan?: number;
  readonly backgroundColor?: string;
  readonly verticalAlign?: string;
}) {
  const className = `border-b border-r border-base-300 px-5 py-2.5 ${verticalAlignClass(
    verticalAlign,
  )} text-base-content`;
  const span = {
    ...(colSpan && colSpan > 1 ? { colSpan } : {}),
    ...(rowSpan && rowSpan > 1 ? { rowSpan } : {}),
    ...(backgroundColor
      ? {
          style: {
            background: backgroundColor,
            color: readableTextColor(backgroundColor),
          },
        }
      : {}),
  };
  if (header) {
    return (
      <th
        {...span}
        className={`${className} bg-base-200 text-left font-semibold`}
      >
        {children}
      </th>
    );
  }
  return (
    <td {...span} className={className}>
      {children}
    </td>
  );
}
