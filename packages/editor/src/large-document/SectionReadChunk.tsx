"use client";

import { renderRichTextDocument } from "@quanghuy1242/idco-content-renderer";
import { useRef } from "react";
import { usePress } from "react-aria";
import type { RichTextRenderOptions } from "@quanghuy1242/idco-content-renderer";
import type { RichTextDocumentSection } from "./sectionize";

export function SectionReadChunk({
  onActivate,
  options,
  section,
}: {
  readonly onActivate: () => void;
  readonly options?: RichTextRenderOptions;
  readonly section: RichTextDocumentSection;
}) {
  const ref = useRef<HTMLElement>(null);
  const { pressProps, isPressed } = usePress({
    onPress(event) {
      const target = event.target as Element | null;
      if (target?.closest(interactiveSelector)) return;
      onActivate();
    },
  });
  return (
    <section
      {...pressProps}
      ref={ref}
      aria-label={`Edit section: ${section.title}`}
      data-section-id={section.id}
      role="button"
      tabIndex={0}
      className={`group rounded-box border border-transparent bg-base-100 p-3 text-left outline-none transition hover:border-base-300 focus:border-primary focus:outline-2 focus:-outline-offset-2 focus:outline-primary${isPressed ? " border-primary" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-normal text-base-content/50">
          Section {section.ordinal + 1}
        </span>
        <span className="text-xs font-medium text-primary opacity-0 transition group-hover:opacity-100 group-focus:opacity-100">
          Edit section
        </span>
      </div>
      {renderRichTextDocument(section.document, options)}
    </section>
  );
}

const interactiveSelector = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
].join(",");
