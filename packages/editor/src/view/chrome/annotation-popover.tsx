/**
 * Click-to-read annotation popover (docs/027 §16 P6).
 *
 * The glossary `<abbr>` and the comment highlight are visible after P3/P4 but
 * passive. This makes them interactive on the live tier with the *same* delegated
 * click pattern the link mark uses (`useLinkInteraction` / `LinkPopover`): a click
 * that lands on an annotation mark opens a small *read* popover anchored at the word —
 * the glossary definition (from the one collection, no copy) or the comment thread
 * (from its snapshot, revalidated) — with a "Manage" action that routes to the dock
 * focused on that term/thread (`panelHost.open(paneId, focusId)`). Read-first keeps a
 * quick read from yanking the author into the dock, while the dock is one click away.
 *
 * Innermost wins (docs/027 §16 P6): a glossary mark (nesting rank 2) renders inside a
 * comment mark (rank 1) inside a link (rank 0), so `openAt` checks glossary, then
 * comment; the surface tries this before the link interaction, so the innermost
 * annotation claims the click.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { AnchoredPopover, Badge, Button } from "@quanghuy1242/idco-ui";
import type { EditorStore } from "../../core";
import type { PanelHost, Thread } from "../spi";
import { activeCommentSource } from "../spi";
import { asGlossaryTerm, GLOSSARY_COLLECTION } from "./panes";
import { commentMarkEntries } from "./panes";

export type AnnotationTarget = {
  readonly kind: "glossary" | "comment";
  /** The glossary term id or the comment thread id the mark references. */
  readonly refId: string;
};

export type AnnotationInteraction = {
  readonly target: AnnotationTarget | null;
  readonly anchorRef: RefObject<HTMLElement | null>;
  /** Open the annotation under `element`; returns true when one was found+claimed. */
  openAt(element: HTMLElement): boolean;
  close(): void;
};

/** Track which annotation (if any) the user clicked and the element to anchor against. */
export function useAnnotationInteraction(): AnnotationInteraction {
  const anchorRef = useRef<HTMLElement | null>(null);
  const [target, setTarget] = useState<AnnotationTarget | null>(null);

  const openAt = useCallback((element: HTMLElement): boolean => {
    // Innermost first: glossary is rendered inside comment (docs/027 §16 P6).
    const glossaryEl = element.closest<HTMLElement>(
      "[data-engine-mark='glossary']",
    );
    const term = glossaryEl?.getAttribute("data-engine-glossary-term");
    if (glossaryEl && term) {
      anchorRef.current = glossaryEl;
      setTarget({ kind: "glossary", refId: term });
      return true;
    }
    const commentEl = element.closest<HTMLElement>(
      "[data-engine-mark='comment']",
    );
    const thread = commentEl?.getAttribute("data-engine-comment-thread");
    if (commentEl && thread) {
      anchorRef.current = commentEl;
      setTarget({ kind: "comment", refId: thread });
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

/**
 * The comment read body: the snapshot (instant, no host call) revalidated against the
 * source when one is registered (SWR, docs/027 §7.3). Read-only — managing happens in
 * the dock.
 */
function CommentReadBody(props: {
  readonly store: EditorStore;
  readonly refId: string;
  readonly onManage: () => void;
}) {
  const { store, refId, onManage } = props;
  const snapshot = commentMarkEntries(store).find(
    (entry) => entry.threadId === refId,
  )?.snapshot;
  const source = activeCommentSource();
  const [thread, setThread] = useState<Thread | null>(null);
  useEffect(() => {
    if (!source?.resolve) return;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await source.resolve!(refId, controller.signal);
        if (!cancelled) setThread(resolved);
      } catch {
        /* keep the snapshot on failure (docs/027 §7.3) */
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [refId, source]);

  const author = thread?.author.name ?? snapshot?.author ?? "Comment";
  const excerpt = thread?.excerpt ?? snapshot?.excerpt ?? "";
  const resolved = thread?.resolved ?? snapshot?.resolved ?? false;
  return (
    <div className="grid w-72 gap-1" data-engine-annotation-popover="comment">
      {excerpt ? (
        <span className="border-l-2 border-warning/60 pl-2 text-xs italic text-base-content/70">
          “{excerpt}”
        </span>
      ) : null}
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{author}</span>
        {resolved ? (
          <Badge size="sm" tone="neutral">
            resolved
          </Badge>
        ) : null}
      </div>
      {thread?.body ? <p className="text-sm">{thread.body}</p> : null}
      <div className="flex justify-end">
        <Button
          iconName="MessageSquare"
          onClick={onManage}
          size="sm"
          variant="ghost"
        >
          Open in Comments
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
      ariaLabel="Annotation"
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      placement="bottom"
      triggerRef={anchorRef}
    >
      {target?.kind === "glossary" ? (
        <GlossaryReadBody
          onManage={() => {
            panelHost.open("glossary", target.refId);
            close();
          }}
          refId={target.refId}
          store={store}
        />
      ) : target?.kind === "comment" ? (
        <CommentReadBody
          onManage={() => {
            panelHost.open("comments", target.refId);
            close();
          }}
          refId={target.refId}
          store={store}
        />
      ) : null}
    </AnchoredPopover>
  );
}
