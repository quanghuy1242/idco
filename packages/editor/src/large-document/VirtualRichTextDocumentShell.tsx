"use client";

import type { RichTextRenderOptions } from "@quanghuy1242/idco-content-renderer";
import { Stack, Text } from "@quanghuy1242/idco-ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RichTextEditorDocument } from "../model/schema";
import type { RichTextEditorBindings } from "../nodes";
import {
  estimatedSectionHeight,
  RichTextSectionHeightCache,
} from "./height-cache";
import {
  buildRichTextDocumentIndexes,
  searchRichTextIndexes,
  type RichTextHeadingIndexEntry,
  type RichTextSearchResult,
} from "./indexes";
import { LargeDocumentToolbar } from "./LargeDocumentToolbar";
import type { RichTextLargeDocumentPolicy } from "./policy";
import { calculateVirtualRange } from "./virtual-range";
import { FocusedSectionEditor } from "./FocusedSectionEditor";
import { SectionReadChunk } from "./SectionReadChunk";
import { useLargeDocumentController } from "./use-large-document-controller";

export type VirtualRichTextDocumentShellProps = {
  readonly allowedNodes: readonly string[];
  readonly bindings: RichTextEditorBindings;
  readonly document: RichTextEditorDocument;
  readonly label: string;
  readonly name?: string;
  readonly onChange: (document: RichTextEditorDocument) => void;
  readonly policy?: RichTextLargeDocumentPolicy;
  readonly readOnly?: boolean;
  readonly rendererOptions?: RichTextRenderOptions;
};

declare global {
  interface Window {
    __IDCO_LARGE_DOC__?: {
      readonly activeSectionId: string | null;
      readonly blockCount: number;
      readonly measuredHeightCount: number;
      readonly renderedSectionCount: number;
      readonly sectionCount: number;
      readonly totalHeight: number;
    };
  }
}

export function VirtualRichTextDocumentShell({
  allowedNodes,
  bindings,
  document,
  label,
  name,
  onChange,
  policy,
  readOnly = false,
  rendererOptions,
}: VirtualRichTextDocumentShellProps) {
  const controller = useLargeDocumentController({
    document,
    onDocumentChange: onChange,
    policy,
  });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const heightCache = useRef(new RichTextSectionHeightCache());
  const [scrollState, setScrollState] = useState({
    scrollOffset: 0,
    viewportSize: 640,
  });
  const [measuredHeights, setMeasuredHeights] = useState<
    Readonly<Record<string, number>>
  >({});
  const [pendingInitialSelection, setPendingInitialSelection] = useState<{
    readonly endOffset: number;
    readonly path: string;
    readonly sectionId: string;
    readonly startOffset: number;
  } | null>(null);
  const [query, setQuery] = useState("");
  const indexes = useMemo(
    () => buildRichTextDocumentIndexes(document, policy),
    [document, policy],
  );
  const results = useMemo(
    () => searchRichTextIndexes(indexes, query, 20),
    [indexes, query],
  );

  const sizeForIndex = useCallback(
    (index: number) => {
      const section = controller.sections[index];
      if (!section) return 1;
      return (
        measuredHeights[section.id] ??
        heightCache.current.get({
          sectionId: section.id,
          signature: section.signature,
        }) ??
        estimatedSectionHeight(section)
      );
    },
    [controller.sections, measuredHeights],
  );

  const range = useMemo(
    () =>
      calculateVirtualRange({
        getItemSize: sizeForIndex,
        itemCount: controller.sections.length,
        overscan: policy?.overscanSections ?? 2,
        scrollOffset: scrollState.scrollOffset,
        viewportSize: scrollState.viewportSize,
      }),
    [
      controller.sections.length,
      policy?.overscanSections,
      scrollState.scrollOffset,
      scrollState.viewportSize,
      sizeForIndex,
    ],
  );

  const visibleSections = controller.sections.slice(
    range.startIndex,
    range.endIndex,
  );

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const sync = () => {
      setScrollState({
        scrollOffset: scroller.scrollTop,
        viewportSize: scroller.clientHeight,
      });
    };
    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(scroller);
    scroller.addEventListener("scroll", sync, { passive: true });
    return () => {
      resizeObserver.disconnect();
      scroller.removeEventListener("scroll", sync);
    };
  }, []);

  const measureSection = useCallback(
    (sectionId: string, signature: string, element: HTMLElement | null) => {
      if (!element) return () => {};
      const record = () => {
        const height = element.getBoundingClientRect().height;
        if (height <= 0) return;
        heightCache.current.set({ sectionId, signature }, height);
        setMeasuredHeights((current) =>
          current[sectionId] === Math.ceil(height)
            ? current
            : { ...current, [sectionId]: Math.ceil(height) },
        );
      };
      record();
      const resizeObserver = new ResizeObserver(record);
      resizeObserver.observe(element);
      return () => resizeObserver.disconnect();
    },
    [],
  );

  const scrollToSection = useCallback(
    (sectionId: string, activate = false) => {
      const index = controller.sections.findIndex(
        (section) => section.id === sectionId,
      );
      const scroller = scrollerRef.current;
      if (!scroller || index < 0) return;
      let offset = 0;
      for (let item = 0; item < index; item += 1) offset += sizeForIndex(item);
      scroller.scrollTo({ behavior: "auto", top: offset });
      window.setTimeout(() => correctScrollToSection(scroller, sectionId), 40);
      window.setTimeout(() => {
        if (activate && !readOnly) controller.activateSection(sectionId);
        window.setTimeout(
          () => correctScrollToSection(scroller, sectionId),
          40,
        );
      }, 80);
    },
    [controller, readOnly, sizeForIndex],
  );

  const diagnostics = {
    activeSectionId: controller.activeSectionId,
    blockCount: document.root.children.length,
    measuredHeightCount: Object.keys(measuredHeights).length,
    renderedSectionCount: visibleSections.length,
    sectionCount: controller.sections.length,
  };

  useEffect(() => {
    window["__IDCO_LARGE_DOC__"] = {
      ...diagnostics,
      totalHeight: range.totalHeight,
    };
  }, [diagnostics, range.totalHeight]);

  return (
    <Stack gap="sm">
      <Text variant="h3">{label}</Text>
      <LargeDocumentToolbar
        diagnostics={diagnostics}
        headings={indexes.headings}
        query={query}
        results={results}
        onHeadingSelect={(heading: RichTextHeadingIndexEntry) =>
          scrollToSection(heading.sectionId, false)
        }
        onQueryChange={setQuery}
        onResultSelect={(result: RichTextSearchResult) => {
          setPendingInitialSelection({
            endOffset: result.endOffset,
            path: result.path,
            sectionId: result.sectionId,
            startOffset: result.startOffset,
          });
          scrollToSection(result.sectionId, true);
        }}
      />
      {controller.lastConflict ? (
        <p role="alert" className="text-sm text-error">
          Section commit failed: {controller.lastConflict}
        </p>
      ) : null}
      <div
        ref={scrollerRef}
        className="overflow-auto rounded-box border border-base-300 bg-base-200 p-3"
        data-large-document-shell=""
        style={{ height: "72vh", minHeight: 480 }}
      >
        <div style={{ height: range.beforeHeight }} aria-hidden="true" />
        <div className="flex flex-col gap-3">
          {visibleSections.map((section) => {
            const active = controller.activeSectionId === section.id;
            return (
              <MeasuredSection
                key={section.id}
                measure={measureSection}
                sectionId={section.id}
                signature={section.signature}
              >
                {active && controller.activeSection && !readOnly ? (
                  <FocusedSectionEditor
                    allowedNodes={allowedNodes}
                    bindings={bindings}
                    initialSelection={
                      pendingInitialSelection?.sectionId === section.id
                        ? pendingInitialSelection
                        : undefined
                    }
                    label={`${label}: ${section.title}`}
                    name={name}
                    section={controller.activeSection}
                    onCancel={controller.cancelActiveSection}
                    onChange={controller.updateActiveDraft}
                    onCommit={(next) =>
                      controller.commitActiveSection("blur", next, {
                        deactivate: true,
                      })
                    }
                    onInitialSelectionApplied={() =>
                      setPendingInitialSelection((current) =>
                        current?.sectionId === section.id ? null : current,
                      )
                    }
                  />
                ) : (
                  <SectionReadChunk
                    options={rendererOptions}
                    section={section}
                    onActivate={() => {
                      if (!readOnly) controller.activateSection(section.id);
                    }}
                  />
                )}
              </MeasuredSection>
            );
          })}
        </div>
        <div style={{ height: range.afterHeight }} aria-hidden="true" />
      </div>
    </Stack>
  );
}

function MeasuredSection({
  children,
  measure,
  sectionId,
  signature,
}: {
  readonly children: ReactNode;
  readonly measure: (
    sectionId: string,
    signature: string,
    element: HTMLElement | null,
  ) => () => void;
  readonly sectionId: string;
  readonly signature: string;
}) {
  const cleanup = useRef<(() => void) | null>(null);
  return (
    <div
      data-large-document-section={sectionId}
      ref={(element) => {
        cleanup.current?.();
        cleanup.current = measure(sectionId, signature, element);
      }}
    >
      {children}
    </div>
  );
}

function correctScrollToSection(
  scroller: HTMLElement,
  sectionId: string,
): void {
  const frame = Array.from(
    scroller.querySelectorAll<HTMLElement>("[data-large-document-section]"),
  ).find((element) => element.dataset.largeDocumentSection === sectionId);
  if (!frame) return;
  const delta =
    frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  scroller.scrollTop += delta;
}
