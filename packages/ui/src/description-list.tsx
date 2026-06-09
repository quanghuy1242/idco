// DaisyUI 5: https://daisyui.com/components/list/
import type { ReactNode } from "react";

export type DescriptionItem = {
  readonly term: string;
  readonly description: ReactNode;
  readonly mono?: boolean;
};

export type DescriptionColumns = 1 | 2 | 3;

type DescriptionListProps = {
  readonly items: ReadonlyArray<DescriptionItem>;
  readonly columns?: DescriptionColumns;
  readonly dense?: boolean;
};

const columnsClass: Record<DescriptionColumns, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
};

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
