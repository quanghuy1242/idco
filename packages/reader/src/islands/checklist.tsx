"use client";

/**
 * The checklist island (docs/015 §6). Enhances the static checklist (read-only checkboxes,
 * L1 `RichTextCheckListItem`) into a togglable list with local state. Hydrates on
 * `interaction` — there is nothing to do until the reader actually clicks an item — and
 * the static list is fully readable before that. State is reader-local: toggling a box is
 * a UI affordance for the reader, never a write back to the document.
 */
import { isRecord } from "@quanghuy1242/idco-lib";
import { useState, type ReactNode } from "react";
import { registerReaderIsland } from "./registry";

export type ChecklistItemData = {
  readonly text: string;
  readonly checked: boolean;
};

export type ChecklistData = {
  readonly items: readonly ChecklistItemData[];
};

function isChecklistData(value: unknown): value is ChecklistData {
  return isRecord(value) && Array.isArray(value.items);
}

function ChecklistInteractive({
  data,
  children,
}: {
  readonly data: unknown;
  readonly children: ReactNode;
}): ReactNode {
  // Defensive: if the Reader could not normalize items, keep the static markup.
  const initial = isChecklistData(data) ? data.items : null;
  const [checked, setChecked] = useState<readonly boolean[]>(
    () => initial?.map((item) => item.checked) ?? [],
  );
  if (!initial) return <>{children}</>;
  return (
    <ul className="rt-block m-0 ml-1 list-none space-y-1" data-rt-checklist="">
      {initial.map((item, index) => (
        <li className="flex items-start gap-2" key={index}>
          <input
            checked={checked[index] ?? false}
            className="checkbox checkbox-sm mt-0.5"
            onChange={() =>
              setChecked((prev) =>
                prev.map((value, i) => (i === index ? !value : value)),
              )
            }
            type="checkbox"
          />
          <span
            className={
              checked[index] ? "text-base-content/60 line-through" : ""
            }
          >
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const checklistIsland = {
  Interactive: ChecklistInteractive,
  hydrate: "interaction" as const,
  kind: "checklist",
};

registerReaderIsland(checklistIsland);
