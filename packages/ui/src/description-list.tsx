// DaisyUI 5: https://daisyui.com/components/list/
/**
 * Renders term/description pairs in a responsive grid for showing record metadata.
 *
 * @categoryDefault Data Display
 */
import type { ReactNode } from "react";

/** A single term/description pair, optionally rendered with monospace value styling. */
export type DescriptionItem = {
  readonly term: string;
  readonly description: ReactNode;
  /** Renders the description in a monospace, break-all style for IDs and code-like values. */
  readonly mono?: boolean;
};

/** Number of columns the description grid lays out at larger breakpoints. */
export type DescriptionColumns = 1 | 2 | 3;

/** Props for {@link DescriptionList}. */
type DescriptionListProps = {
  readonly items: ReadonlyArray<DescriptionItem>;
  /** Column count at larger breakpoints; defaults to 2. */
  readonly columns?: DescriptionColumns;
  /** Tightens the row/column spacing for compact layouts. */
  readonly dense?: boolean;
};

const columnsClass: Record<DescriptionColumns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
};

/** A responsive term/description grid for displaying labeled record metadata. */
export function DescriptionList({
  items,
  columns = 2,
  dense,
}: DescriptionListProps) {
  const gap = dense ? "gap-x-6 gap-y-2" : "gap-x-8 gap-y-4";
  return (
    <dl className={`grid w-full ${columnsClass[columns]} ${gap}`}>
      {items.map((item) => (
        <div key={item.term} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium uppercase tracking-wide text-base-content/50">
            {item.term}
          </dt>
          <dd
            className={`text-sm text-base-content ${item.mono ? "font-mono break-all" : ""}`.trim()}
          >
            {item.description}
          </dd>
        </div>
      ))}
    </dl>
  );
}
