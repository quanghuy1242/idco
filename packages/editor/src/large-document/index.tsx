"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ALLOWED_NODES,
  type RichTextEditorDocument,
} from "../model/schema";
import { normalizeDocument } from "../model/normalize";
import type { RichTextEditorBindings } from "../nodes";
import { VirtualRichTextDocumentShell } from "./VirtualRichTextDocumentShell";
import type { RichTextLargeDocumentPolicy } from "./policy";

export type VirtualRichTextEditorProps = {
  readonly value: unknown;
  readonly onChange: (value: RichTextEditorDocument) => void;
  readonly label: string;
  readonly name?: string;
  readonly allowedNodes?: readonly string[];
  readonly allowedEmbedDomains?: readonly string[];
  readonly mediaLibrary?: RichTextEditorBindings["mediaLibrary"];
  readonly postLibrary?: RichTextEditorBindings["postLibrary"];
  readonly onUploadMedia?: RichTextEditorBindings["onUploadMedia"];
  readonly onComment?: RichTextEditorBindings["onComment"];
  readonly comments?: RichTextEditorBindings["comments"];
  readonly onCommentUpdate?: RichTextEditorBindings["onCommentUpdate"];
  readonly onCommentDelete?: RichTextEditorBindings["onCommentDelete"];
  readonly largeDocument?: RichTextLargeDocumentPolicy;
  readonly readOnly?: boolean;
};

export function VirtualRichTextEditor({
  value,
  onChange,
  label,
  name,
  allowedNodes = DEFAULT_ALLOWED_NODES,
  allowedEmbedDomains,
  mediaLibrary,
  postLibrary,
  onUploadMedia,
  onComment,
  comments,
  onCommentUpdate,
  onCommentDelete,
  largeDocument,
  readOnly,
}: VirtualRichTextEditorProps) {
  const lastEmittedValue = useRef<RichTextEditorDocument | null>(null);
  const isEcho = value === lastEmittedValue.current;
  const normalized = useMemo(
    () =>
      isEcho && lastEmittedValue.current
        ? lastEmittedValue.current
        : normalizeDocument(value, {
            previousDocument: lastEmittedValue.current ?? undefined,
          }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on external value identity.
    [value],
  );
  const [document, setDocument] = useState(normalized);

  useEffect(() => {
    if (!isEcho) setDocument(normalized);
  }, [isEcho, normalized]);

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

  function publish(next: RichTextEditorDocument) {
    lastEmittedValue.current = next;
    setDocument(next);
    onChange(next);
  }

  return (
    <VirtualRichTextDocumentShell
      allowedNodes={allowedNodes}
      bindings={bindings}
      document={document}
      label={label}
      name={name}
      policy={largeDocument}
      readOnly={readOnly}
      onChange={publish}
    />
  );
}

export type { RichTextDocumentSection } from "./sectionize";
export type {
  RichTextDocumentIndexes,
  RichTextHeadingIndexEntry,
  RichTextSearchResult,
} from "./indexes";
export type {
  RichTextDocumentScale,
  RichTextEditorMode,
  RichTextLargeDocumentPolicy,
} from "./policy";
export { buildRichTextDocumentIndexes, searchRichTextIndexes } from "./indexes";
export { documentScale, selectEditorMode } from "./policy";
export { ensureDocumentNodeIds, type RichTextNodeId } from "./ids";
export {
  replaceDocumentSection,
  type ReplaceSectionResult,
} from "./merge-section";
export { sectionizeDocument } from "./sectionize";
export { calculateVirtualRange } from "./virtual-range";
