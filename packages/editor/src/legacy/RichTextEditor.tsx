// DaisyUI 5: https://daisyui.com/components/textarea/
"use client";

import {
  RichTextTocLayout,
  RichTextTocRail,
  Stack,
  Text,
} from "@quanghuy1242/idco-ui";
import type { EditorState } from "lexical";
import { useEffect, useMemo, useRef, useState } from "react";
import { RichTextEditorComposer } from "./RichTextEditorComposer";
import { normalizeDocument } from "./model/normalize";
import {
  DEFAULT_ALLOWED_NODES,
  type RichTextEditorDocument,
} from "./model/schema";
import type { RichTextEditorBindings } from "./nodes";
import { useDebouncedEditorStatePublisher } from "./plugins/editor-performance";
import type { TocRailState } from "./plugins/toc-rail-plugin";

export type {
  RichTextEditorDocument,
  RichTextEditorNode,
  RichTextEditorMediaOption,
  RichTextEditorPostOption,
} from "./model/schema";

export type RichTextEditorProps = {
  readonly value: unknown;
  readonly onChange: (value: RichTextEditorDocument) => void;
  readonly label: string;
  readonly name?: string;
  readonly error?: string;
  readonly allowedNodes?: readonly string[];
  readonly allowedEmbedDomains?: readonly string[];
  readonly mediaLibrary?: RichTextEditorBindings["mediaLibrary"];
  readonly postLibrary?: RichTextEditorBindings["postLibrary"];
  readonly onUploadMedia?: RichTextEditorBindings["onUploadMedia"];
  readonly onComment?: RichTextEditorBindings["onComment"];
  readonly comments?: RichTextEditorBindings["comments"];
  readonly onCommentUpdate?: RichTextEditorBindings["onCommentUpdate"];
  readonly onCommentDelete?: RichTextEditorBindings["onCommentDelete"];
  /**
   * Phase 0 decorator-body virtualization (docs/009 §6.1.1). When `true`,
   * decorator block bodies that are offscreen collapse to measured placeholders
   * instead
   * of staying mounted, so a decorator-heavy document keeps the live React
   * subtree bounded. Off by default; selection, undo, and persisted JSON are
   * unchanged either way.
   */
  readonly decoratorVirtualization?: boolean;
};

export function RichTextEditor({
  value,
  onChange,
  label,
  name,
  error,
  allowedNodes = DEFAULT_ALLOWED_NODES,
  allowedEmbedDomains,
  mediaLibrary,
  postLibrary,
  onUploadMedia,
  onComment,
  comments,
  onCommentUpdate,
  onCommentDelete,
  decoratorVirtualization = false,
}: RichTextEditorProps) {
  // The value we last emitted via `onChange`. When the controlled `value` is
  // that same object (the common case — the change came from this editor), the
  // editor already holds it, so we skip the document round-trip and the sync
  // plugin's full re-serialize. Only a genuinely external value gets reapplied.
  const lastEmittedValue = useRef<RichTextEditorDocument | null>(null);
  const currentDocument = useRef<RichTextEditorDocument | null>(null);
  const onChangeRef = useRef(onChange);
  const isEcho = value === lastEmittedValue.current;
  const document = useMemo(
    () =>
      isEcho && lastEmittedValue.current
        ? lastEmittedValue.current
        : normalizeDocument(value),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `value`; isEcho is derived from it.
    [value],
  );
  const bindings = useMemo<RichTextEditorBindings>(
    () => ({
      allowedEmbedDomains,
      comments,
      mediaLibrary,
      onComment,
      onCommentDelete,
      onCommentUpdate,
      onUploadMedia,
      postLibrary,
    }),
    [
      allowedEmbedDomains,
      comments,
      mediaLibrary,
      onComment,
      onCommentDelete,
      onCommentUpdate,
      onUploadMedia,
      postLibrary,
    ],
  );
  // The first `placement: "aside"` TOC, published by TableOfContentsRailPlugin
  // from inside the composer and rendered as a sticky rail beside the frame.
  const [tocRail, setTocRail] = useState<TocRailState | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    currentDocument.current = document;
  }, [document]);

  const { schedule: scheduleEditorStatePublish } =
    useDebouncedEditorStatePublisher<RichTextEditorDocument>({
      budgetMs: 12,
      cost: "serializes Lexical state and normalizes the host document value",
      delayMs: 80,
      derive: (editorState) =>
        normalizeDocument(editorState.toJSON(), {
          previousDocument: currentDocument.current ?? undefined,
        }),
      label: "controlled rich-text document emission",
      publish: (next) => {
        lastEmittedValue.current = next;
        currentDocument.current = next;
        onChangeRef.current(next);
      },
    });

  function applyEditorState(editorState: EditorState) {
    scheduleEditorStatePublish(editorState);
  }

  return (
    <Stack gap="sm">
      <Text variant="h3">{label}</Text>
      <RichTextTocLayout
        side={tocRail?.side ?? "left"}
        rail={
          tocRail ? (
            <RichTextTocRail
              entries={tocRail.entries}
              style={tocRail.style}
              title={tocRail.title}
            />
          ) : undefined
        }
      >
        <div className="overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-sm">
          <RichTextEditorComposer
            allowedNodes={allowedNodes}
            bindings={bindings}
            decoratorVirtualization={decoratorVirtualization}
            document={document}
            isEcho={isEcho}
            label={label}
            name={name}
            onChange={applyEditorState}
            onTocRailChange={setTocRail}
          />
        </div>
      </RichTextTocLayout>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
    </Stack>
  );
}
