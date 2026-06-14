import { NavIcon } from "@quanghuy1242/idco-ui";
import { $isMarkNode, $unwrapMarkNode, type MarkNode } from "@lexical/mark";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNearestNodeFromDOMNode, $getNodeByKey } from "lexical";
import { useContext, useEffect, useState } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { RichTextEditorBindingsContext } from "../nodes";

type CommentTarget = {
  readonly key: string;
  /** The comment ids carried by the clicked mark (newest last). */
  readonly ids: readonly string[];
  readonly quote: string;
  readonly x: number;
  readonly y: number;
};

/**
 * Click a comment highlight to view its thread. The document only stores the
 * mark id, so the body is looked up from the host-provided `comments` binding;
 * editing calls `onCommentUpdate`, and removing unwraps the mark (dropping the
 * highlight) and calls `onCommentDelete`. Adding a comment from a selection
 * still lives in the toolbar's `CommentButton`.
 */
export function CommentEditorPlugin() {
  const [editor] = useLexicalComposerContext();
  const { comments, onCommentUpdate, onCommentDelete } = useContext(
    RichTextEditorBindingsContext,
  );
  const [target, setTarget] = useState<CommentTarget | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    function onClick(event: MouseEvent) {
      const markEl = (event.target as HTMLElement | null)?.closest("mark");
      if (!markEl) return;
      const found = editor.read<CommentTarget | null>(() => {
        const node = $getNearestNodeFromDOMNode(markEl);
        const mark: MarkNode | undefined = $isMarkNode(node)
          ? node
          : node?.getParents().find($isMarkNode);
        if (!mark) return null;
        const rect = markEl.getBoundingClientRect();
        return {
          ids: mark.getIDs(),
          key: mark.getKey(),
          quote: mark.getTextContent(),
          x: rect.left,
          y: rect.bottom,
        };
      });
      if (found) {
        event.preventDefault();
        setTarget(found);
      }
    }

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [editor]);

  // The newest id is the most recently added comment on this run of text.
  const activeId = target ? target.ids[target.ids.length - 1] : undefined;
  const thread = comments?.find((comment) => comment.id === activeId);

  // Seed the editable body when a highlight is opened (and once the host's
  // thread for it resolves). `isOpen` is controlled, so React Aria never fires
  // onOpenChange on open — this effect is what loads the body. `draft` is left
  // out of the deps so typing isn't clobbered.
  const threadBody = thread?.body;
  useEffect(() => {
    if (target) setDraft(threadBody ?? "");
  }, [target, threadBody]);

  function close() {
    setTarget(null);
  }

  function save() {
    if (activeId && draft.trim() !== "")
      onCommentUpdate?.(activeId, draft.trim());
    close();
  }

  function remove() {
    if (target) {
      editor.update(() => {
        const node = $getNodeByKey(target.key);
        if (!$isMarkNode(node)) return;
        if (activeId) node.deleteID(activeId);
        if (node.getIDs().length === 0) $unwrapMarkNode(node);
      });
    }
    if (activeId) onCommentDelete?.(activeId);
    close();
  }

  return (
    <AriaDialogTrigger
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <AriaButton
        aria-hidden="true"
        excludeFromTabOrder
        className="pointer-events-none fixed size-0 opacity-0"
        style={{ left: target?.x ?? 0, top: target?.y ?? 0 }}
      />
      <AriaPopover
        placement="bottom start"
        offset={6}
        className="popover-panel z-[60] w-72 data-[entering]:animate-popover-in data-[exiting]:animate-popover-out"
      >
        <AriaDialog className="outline-none">
          <div className="grid gap-2 p-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-base-content/70">
              <NavIcon name="MessageSquare" variant="timeline" />
              Comment on “{target?.quote}”
            </span>
            {onCommentUpdate ? (
              <textarea
                aria-label="Comment text"
                autoFocus
                value={draft}
                rows={3}
                placeholder="Add a comment…"
                onChange={(event) => setDraft(event.target.value)}
                className="textarea textarea-bordered textarea-sm w-full"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-base-content">
                {thread?.body || (
                  <span className="text-base-content/50">No comment text.</span>
                )}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <AriaButton
                type="button"
                aria-label="Delete comment"
                onPress={remove}
                className="btn btn-sm btn-ghost gap-1.5 text-error"
              >
                <NavIcon name="Trash2" variant="timeline" />
                Delete
              </AriaButton>
              {onCommentUpdate ? (
                <AriaButton
                  type="button"
                  onPress={save}
                  isDisabled={draft.trim() === ""}
                  className="btn btn-sm btn-primary"
                >
                  Save
                </AriaButton>
              ) : null}
            </div>
          </div>
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}
