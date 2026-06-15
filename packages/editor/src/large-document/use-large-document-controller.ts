"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RichTextEditorDocument } from "../model/schema";
import type { RichTextLargeDocumentPolicy } from "./policy";
import { replaceDocumentSection } from "./merge-section";
import { sectionizeDocument, type RichTextDocumentSection } from "./sectionize";

export type LargeDocumentCommitReason =
  | "blur"
  | "cancel"
  | "save"
  | "section-switch"
  | "unmount";

export type LargeDocumentController = {
  readonly activeSection?: RichTextDocumentSection;
  readonly activeSectionId: string | null;
  readonly dirty: boolean;
  readonly draftDocument: RichTextEditorDocument | null;
  readonly lastConflict: "missing-section" | "stale-section" | null;
  readonly sections: readonly RichTextDocumentSection[];
  readonly activateSection: (sectionId: string) => void;
  readonly cancelActiveSection: () => void;
  readonly commitActiveSection: (
    reason: LargeDocumentCommitReason,
    nextDraft?: RichTextEditorDocument,
    options?: { readonly deactivate?: boolean },
  ) => boolean;
  readonly updateActiveDraft: (document: RichTextEditorDocument) => void;
};

export function useLargeDocumentController({
  document,
  onDocumentChange,
  policy,
}: {
  readonly document: RichTextEditorDocument;
  readonly onDocumentChange: (document: RichTextEditorDocument) => void;
  readonly policy?: RichTextLargeDocumentPolicy;
}): LargeDocumentController {
  const sections = useMemo(
    () => sectionizeDocument(document, policy),
    [document, policy],
  );
  const documentRef = useRef(document);
  const sectionsRef = useRef(sections);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [draftDocument, setDraftDocument] =
    useState<RichTextEditorDocument | null>(null);
  const [expectedBlockIds, setExpectedBlockIds] = useState<
    readonly string[] | null
  >(null);
  const [dirty, setDirty] = useState(false);
  const [lastConflict, setLastConflict] = useState<
    "missing-section" | "stale-section" | null
  >(null);

  useEffect(() => {
    documentRef.current = document;
    sectionsRef.current = sections;
  }, [document, sections]);

  const commitActiveSection = useCallback(
    (
      _reason: LargeDocumentCommitReason,
      nextDraft?: RichTextEditorDocument,
      options?: { readonly deactivate?: boolean },
    ) => {
      if (!activeSectionId || (!draftDocument && !nextDraft)) {
        if (options?.deactivate) setActiveSectionId(null);
        return true;
      }
      const draft = nextDraft ?? draftDocument;
      if (!draft) return true;
      const result = replaceDocumentSection(
        documentRef.current,
        activeSectionId,
        draft,
        {
          expectedBlockIds: expectedBlockIds ?? undefined,
          policy,
        },
      );
      if (!result.ok) {
        setLastConflict(result.reason);
        return false;
      }
      documentRef.current = result.document;
      setLastConflict(null);
      setDirty(false);
      setDraftDocument(result.document);
      onDocumentChange(result.document);
      if (options?.deactivate) {
        setActiveSectionId(null);
        setDraftDocument(null);
        setExpectedBlockIds(null);
      }
      return true;
    },
    [
      activeSectionId,
      draftDocument,
      expectedBlockIds,
      onDocumentChange,
      policy,
    ],
  );

  const activateSection = useCallback(
    (sectionId: string) => {
      if (activeSectionId === sectionId) return;
      if (activeSectionId && dirty) {
        const committed = commitActiveSection("section-switch");
        if (!committed) return;
      }
      const section = sectionsRef.current.find(
        (candidate) => candidate.id === sectionId,
      );
      if (!section) return;
      setActiveSectionId(section.id);
      setDraftDocument(section.document);
      setExpectedBlockIds(section.blockIds);
      setDirty(false);
      setLastConflict(null);
    },
    [activeSectionId, commitActiveSection, dirty],
  );

  const updateActiveDraft = useCallback(
    (nextDocument: RichTextEditorDocument) => {
      setDraftDocument(nextDocument);
      setDirty(true);
    },
    [],
  );

  const cancelActiveSection = useCallback(() => {
    setActiveSectionId(null);
    setDraftDocument(null);
    setExpectedBlockIds(null);
    setDirty(false);
    setLastConflict(null);
  }, []);

  const activeSection = activeSectionId
    ? sections.find((section) => section.id === activeSectionId)
    : undefined;

  return {
    activateSection,
    activeSection,
    activeSectionId,
    cancelActiveSection,
    commitActiveSection,
    dirty,
    draftDocument,
    lastConflict,
    sections,
    updateActiveDraft,
  };
}
