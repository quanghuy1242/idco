"use client";

import type { EditorState } from "lexical";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import {
  RichTextEditorComposer,
  type RichTextEditorInitialSelection,
} from "../RichTextEditorComposer";
import { normalizeDocument } from "../model/normalize";
import type { RichTextEditorDocument } from "../model/schema";
import type { RichTextEditorBindings } from "../nodes";
import { useDebouncedEditorStatePublisher } from "../plugins/editor-performance";
import type { RichTextDocumentSection } from "./sectionize";

export type FocusedSectionEditorHandle = {
  readonly flush: () => RichTextEditorDocument;
};

export type FocusedSectionEditorProps = {
  readonly allowedNodes: readonly string[];
  readonly bindings: RichTextEditorBindings;
  readonly label: string;
  readonly name?: string;
  readonly onCancel: () => void;
  readonly onChange: (document: RichTextEditorDocument) => void;
  readonly onCommit: (document: RichTextEditorDocument) => void;
  readonly onInitialSelectionApplied?: () => void;
  readonly ref?: Ref<FocusedSectionEditorHandle>;
  readonly initialSelection?: RichTextEditorInitialSelection;
  readonly section: RichTextDocumentSection;
};

export function FocusedSectionEditor({
  allowedNodes,
  bindings,
  label,
  name,
  onCancel,
  onChange,
  onCommit,
  onInitialSelectionApplied,
  ref,
  initialSelection,
  section,
}: FocusedSectionEditorProps) {
  const cancelledRef = useRef(false);
  const committedRef = useRef(false);
  const dirtyRef = useRef(false);
  const latestDocument = useRef(section.document);
  const onCommitRef = useRef(onCommit);
  const previousDocument = useRef(section.document);

  useEffect(() => {
    latestDocument.current = section.document;
    previousDocument.current = section.document;
  }, [section.document]);

  const { flush, schedule } =
    useDebouncedEditorStatePublisher<RichTextEditorDocument>({
      budgetMs: 10,
      cost: "serializes a focused rich-text section",
      delayMs: 50,
      derive: (editorState) =>
        normalizeDocument(editorState.toJSON(), {
          previousDocument: previousDocument.current,
        }),
      label: "focused section document emission",
      publish: (next) => {
        previousDocument.current = next;
        latestDocument.current = next;
        onChange(next);
      },
    });

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useImperativeHandle(
    ref,
    () => ({
      flush: () => {
        flush();
        return latestDocument.current;
      },
    }),
    [flush],
  );

  function applyEditorState(editorState: EditorState) {
    dirtyRef.current = true;
    schedule(editorState);
  }

  function commit() {
    committedRef.current = true;
    flush();
    onCommitRef.current(latestDocument.current);
    dirtyRef.current = false;
  }

  useEffect(
    () => () => {
      if (cancelledRef.current || committedRef.current || !dirtyRef.current) {
        return;
      }
      flush();
      onCommitRef.current(latestDocument.current);
    },
    [flush],
  );

  return (
    <section
      data-active-section-id={section.id}
      className="rounded-box border border-primary bg-base-100 shadow-sm"
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget) &&
          !isEditorOwnedOverlayTarget(event.relatedTarget)
        ) {
          commit();
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelledRef.current = true;
          onCancel();
          return;
        }
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          commit();
        }
      }}
    >
      <RichTextEditorComposer
        allowedNodes={allowedNodes}
        bindings={bindings}
        document={section.document}
        initialSelection={initialSelection}
        isEcho={false}
        label={label}
        name={`${name ?? "large-document"}-${section.id}`}
        onChange={applyEditorState}
        onInitialSelectionApplied={onInitialSelectionApplied}
        placeholder="Edit this section"
        showDocumentTocRail={false}
      />
    </section>
  );
}

const editorOwnedOverlaySelector = [
  "[data-editor-selection-flyout]",
  "[data-editor-selection-action-popover]",
  "[data-editor-context-menu]",
  "[data-editor-slash-menu]",
].join(",");

function isEditorOwnedOverlayTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest(editorOwnedOverlaySelector))
  );
}
