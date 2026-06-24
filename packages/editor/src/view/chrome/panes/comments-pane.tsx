/**
 * The Comments dock pane + the selection-flyout "Comment" popover (docs/027 §7.4/§7.1).
 *
 * The management surface legacy lacked (docs/027 §2.3): threads grouped by
 * Unresolved / Resolved with reply, resolve/reopen, delete, and jump-to-anchor — not a
 * single inline popover. It is host-backed through the registered `CommentSource`
 * (§7.1): `load` hydrates the threads, the ops call back to the host, and a failed load
 * falls back to the per-mark snapshots so the editor still paints (the §7.3 discipline).
 * No comment body, author, or resolved flag is ever read from the document — only the
 * anchor mark and its snapshot are.
 */
import { useEffect, useState } from "react";
import { Badge, Button, Input, NavIcon } from "@quanghuy1242/idco-ui";
import type { CommandRenderContext, CommentSource, Thread } from "../../spi";
import { activeCommentSource } from "../../spi";
import { useDocumentReveal } from "../../document-index";
import type { EditorStore, NodeId } from "../../../core";
import {
  addCommentOverSelection,
  commentMarkEntries,
  nodeForThread,
  unanchorThread,
} from "./comments";

/** Load threads from the host source with SWR semantics + a manual refresh (docs/027 §7.3). */
function useCommentThreads(source: CommentSource): {
  readonly threads: readonly Thread[];
  readonly error: boolean;
  readonly refresh: () => void;
} {
  const [threads, setThreads] = useState<readonly Thread[]>([]);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await source.load(controller.signal);
        if (!cancelled) {
          setThreads(loaded);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [source, tick]);
  return { error, refresh: () => setTick((n) => n + 1), threads };
}

/** A reply box: local state, sends on Enter (form submit). */
function ReplyBox(props: { readonly onSend: (body: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="mt-1"
      onSubmit={(event) => {
        event.preventDefault();
        const body = value.trim();
        if (body.length === 0) return;
        props.onSend(body);
        setValue("");
      }}
    >
      <Input
        ariaLabel="Reply"
        onChange={setValue}
        placeholder="Reply… (Enter)"
        size="sm"
        value={value}
      />
    </form>
  );
}

function ThreadCard(props: {
  readonly thread: Thread;
  readonly onReply: (body: string) => void;
  readonly onToggleResolved: () => void;
  readonly onDelete: () => void;
  readonly onJump: () => void;
}) {
  const { thread, onReply, onToggleResolved, onDelete, onJump } = props;
  return (
    <div
      className="grid gap-1 rounded-box border border-base-200 p-2"
      data-engine-comment-thread-card={thread.id}
    >
      <button
        className="truncate border-l-2 border-warning/60 pl-2 text-left text-xs italic text-base-content/70 outline-none hover:text-base-content"
        onClick={onJump}
        title="Jump to the commented text"
        type="button"
      >
        “{thread.excerpt || "(anchor lost)"}”
      </button>
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium">{thread.author.name}</span>
        <span className="opacity-50">{thread.createdAt}</span>
        <span className="ml-auto" />
        <Button
          ariaLabel={thread.resolved ? "Reopen" : "Resolve"}
          iconName={thread.resolved ? "RefreshCw" : "Check"}
          onClick={onToggleResolved}
          size="sm"
          square
          tooltip={thread.resolved ? "Reopen" : "Resolve"}
          variant="ghost"
        />
        <Button
          ariaLabel="Delete thread"
          iconName="Trash2"
          onClick={onDelete}
          size="sm"
          square
          tooltip="Delete"
          variant="ghost"
        />
      </div>
      <p className="text-sm">{thread.body}</p>
      {thread.replies.map((reply) => (
        <div className="border-l border-base-300 pl-2 text-sm" key={reply.id}>
          <span className="text-xs font-medium">{reply.author.name}: </span>
          {reply.body}
        </div>
      ))}
      <ReplyBox onSend={onReply} />
    </div>
  );
}

export function CommentsPane(props: {
  readonly store: EditorStore;
  readonly reveal: (id: NodeId) => void;
}) {
  const { store, reveal } = props;
  const source = activeCommentSource();
  // Gated to a registered source (docs/027 §7.7); the null guard is belt-and-braces.
  if (!source) {
    return (
      <p className="p-6 text-center text-sm text-base-content/60">
        No comment source is connected.
      </p>
    );
  }
  return <CommentsPaneBody reveal={reveal} source={source} store={store} />;
}

function CommentsPaneBody(props: {
  readonly store: EditorStore;
  readonly source: CommentSource;
  readonly reveal: (id: NodeId) => void;
}) {
  const { store, source, reveal } = props;
  const { threads, error, refresh } = useCommentThreads(source);

  const jump = (threadId: string) => {
    const node = nodeForThread(store, threadId);
    if (node) reveal(node);
  };

  // Snapshot fallback (docs/027 §7.3): with the host unreachable, paint each thread
  // from its mark's persisted snapshot so the surface degrades to last-good, not blank.
  if (error) {
    const entries = commentMarkEntries(store);
    return (
      <div className="grid gap-2 p-3" data-engine-comments="">
        <p className="rounded-box bg-warning/10 p-2 text-xs text-base-content/70">
          Couldn’t reach the comment host — showing saved snapshots.
        </p>
        {entries.map((entry) => (
          <button
            className="truncate rounded-box border border-base-200 p-2 text-left text-sm outline-none hover:border-primary"
            key={entry.markId}
            onClick={() => reveal(entry.node)}
            type="button"
          >
            <span className="text-xs font-medium">
              {entry.snapshot?.author || "Comment"}:{" "}
            </span>
            “{entry.snapshot?.excerpt || "(anchor)"}”
          </button>
        ))}
      </div>
    );
  }

  const unresolved = threads.filter((thread) => !thread.resolved);
  const resolved = threads.filter((thread) => thread.resolved);

  const card = (thread: Thread) => (
    <ThreadCard
      key={thread.id}
      onDelete={() => {
        void (async () => {
          await source.remove(thread.id);
          unanchorThread(store, thread.id);
          refresh();
        })();
      }}
      onJump={() => jump(thread.id)}
      onReply={(body) => {
        void (async () => {
          await source.reply(thread.id, body);
          refresh();
        })();
      }}
      onToggleResolved={() => {
        void (async () => {
          await source.setResolved(thread.id, !thread.resolved);
          refresh();
        })();
      }}
      thread={thread}
    />
  );

  return (
    <div className="grid gap-3 p-3" data-engine-comments="">
      <section className="grid gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-base-content/50">
          Unresolved
          {unresolved.length > 0 ? (
            <Badge size="sm" tone="warning">
              {unresolved.length}
            </Badge>
          ) : null}
        </h3>
        {unresolved.length === 0 ? (
          <p className="text-xs text-base-content/50">No open threads.</p>
        ) : (
          unresolved.map(card)
        )}
      </section>
      {resolved.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
            Resolved
          </h3>
          {resolved.map(card)}
        </section>
      ) : null}
    </div>
  );
}

/**
 * The selection-flyout "Comment" popover (docs/027 §7.1): create a thread on the
 * selection. Host-first — the thread is created in the host, then the comment mark
 * anchors it — so the document never holds a ref to a thread the host rejected (§7.3).
 */
export function CommentAddPopover(props: {
  readonly ctx: CommandRenderContext;
}) {
  const { ctx } = props;
  const reveal = useDocumentReveal();
  const source = activeCommentSource();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  if (!source) return null;
  const submit = () => {
    const text = body.trim();
    if (text.length === 0 || busy) return;
    setBusy(true);
    void (async () => {
      await addCommentOverSelection(ctx.store, source, text);
      setBusy(false);
      ctx.close();
      // Nudge the caret's block into view so the new highlight is visible.
      const sel = ctx.store.selection;
      if (reveal && sel?.type === "text") reveal(sel.focus.node);
    })();
  };
  return (
    <form
      className="grid w-64 gap-2"
      data-engine-comment-add=""
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <span className="text-xs font-medium opacity-70">
        Comment on “{ctx.selection.selectedText.trim() || "selection"}”
      </span>
      <Input
        ariaLabel="Comment"
        autoFocus
        onChange={setBody}
        placeholder="Write a comment…"
        size="sm"
        value={body}
      />
      <div className="flex items-center justify-end gap-2">
        <NavIcon name="MessageSquare" />
        <Button disabled={busy} size="sm" type="submit" variant="primary">
          Comment
        </Button>
      </div>
    </form>
  );
}
