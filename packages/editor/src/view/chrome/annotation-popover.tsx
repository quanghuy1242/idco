/**
 * Click-to-read glossary popover (docs/027 §16 P6).
 *
 * Glossary marks are *word-sized*, so click-to-read is natural — a dictionary tooltip
 * over the word — and it does not fight ordinary caret placement. Comment marks are
 * *large ranges* (a sentence, a paragraph), so making the range a click target would
 * hijack normal editing; comments therefore use a caret-in-range affordance
 * (`comment-affordance.tsx`) that routes to the dock instead. This module handles only
 * the glossary (word) case, mirroring the link-click pattern
 * (`useLinkInteraction`/`LinkPopover`): a click on the `<abbr>` opens a read popover
 * with the single-source definition and an "Open in Glossary" route to the dock,
 * focused on that term.
 */
import { useCallback, useRef, useState, type RefObject } from "react";
import { AnchoredPopover, Button } from "@quanghuy1242/idco-ui";
import type { EditorStore } from "../../core";
import type { PanelHost } from "../spi";
import { asGlossaryTerm, GLOSSARY_COLLECTION } from "./panes";

/** The glossary term id the clicked `<abbr>` references. */
export type AnnotationTarget = {
  readonly refId: string;
};

export type AnnotationInteraction = {
  readonly target: AnnotationTarget | null;
  readonly anchorRef: RefObject<HTMLElement | null>;
  /** Open the glossary term under `element`; returns true when one was found+claimed. */
  openAt(element: HTMLElement): boolean;
  close(): void;
};

/** Track which glossary mark (if any) the user clicked and the element to anchor against. */
export function useAnnotationInteraction(): AnnotationInteraction {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState<AnnotationTarget | null>(null);

  const openAt = useCallback((element: HTMLElement): boolean => {
    const glossaryEl = element.closest<HTMLElement>(
      "[data-engine-mark='glossary']",
    );
    const term = glossaryEl?.getAttribute("data-engine-glossary-term");
    if (glossaryEl && term) {
      anchorRef.current = glossaryEl;
      setTarget({ refId: term });
      return true;
    }
    return false;
  }, []);

  const close = useCallback(() => setTarget(null), []);
  return { anchorRef, close, openAt, target };
}

/** The glossary read body: the term + its single-source definition. */
function GlossaryReadBody(props: {
  readonly store: EditorStore;
  readonly refId: string;
  readonly onManage: () => void;
}) {
  const { store, refId, onManage } = props;
  const term = store
    .getCollection(GLOSSARY_COLLECTION)
    .map(asGlossaryTerm)
    .find((candidate) => candidate.id === refId);
  return (
    <div className="grid w-72 gap-1" data-engine-annotation-popover="glossary">
      <span className="text-sm font-semibold">{term?.term ?? "Term"}</span>
      <p className="text-sm text-base-content/80">
        {term?.definition || "No definition yet."}
      </p>
      <div className="flex justify-end">
        <Button iconName="BookA" onClick={onManage} size="sm" variant="ghost">
          Open in Glossary
        </Button>
      </div>
    </div>
  );
}

export function AnnotationPopover(props: {
  readonly store: EditorStore;
  readonly interaction: AnnotationInteraction;
  readonly panelHost: PanelHost;
}) {
  const { store, interaction, panelHost } = props;
  const { target, anchorRef, close } = interaction;
  return (
    <AnchoredPopover
      ariaLabel="Glossary term"
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      placement="bottom"
      triggerRef={anchorRef}
    >
      {target ? (
        <GlossaryReadBody
          onManage={() => {
            panelHost.open("glossary", target.refId);
            close();
          }}
          refId={target.refId}
          store={store}
        />
      ) : null}
    </AnchoredPopover>
  );
}
