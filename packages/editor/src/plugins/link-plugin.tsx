import { NavIcon } from "@quanghuy1242/idco-ui";
import { $isLinkNode, type LinkNode } from "@lexical/link";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNearestNodeFromDOMNode, $getNodeByKey } from "lexical";
import { useEffect, useState } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { useSelectionRestore } from "../hooks/use-selection-restore";

type LinkTarget = {
  readonly key: string;
  readonly url: string;
  readonly x: number;
  readonly y: number;
};

/**
 * Link behavior in the editor. `LinkPlugin` enables `TOGGLE_LINK_COMMAND` and
 * serializes `LinkNode`s. There is deliberately no `ClickableLinkPlugin`: in the
 * editor a click should not navigate. Instead `LinkEditorPlugin` opens a popover
 * anchored to the clicked link to edit the URL, open it in a new tab, or unwrap
 * it. (The toolbar `LinkButton` still creates links from a selection.)
 */
export function RichTextLinkPlugin() {
  return (
    <>
      <LinkPlugin />
      <LinkEditorPlugin />
    </>
  );
}

function LinkEditorPlugin() {
  const [editor] = useLexicalComposerContext();
  const [target, setTarget] = useState<LinkTarget | null>(null);
  const [draft, setDraft] = useState("");
  const { onOpen, onClose, markHandled } = useSelectionRestore();

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    function onClick(event: MouseEvent) {
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      // Cmd/Ctrl-click is reserved for ClickableLinkPlugin's "open in tab".
      if (!anchor || event.metaKey || event.ctrlKey) return;
      const found = editor.read<LinkTarget | null>(() => {
        const node = $getNearestNodeFromDOMNode(anchor);
        const link = $isLinkNode(node) ? node : node?.getParent();
        if (!$isLinkNode(link)) return null;
        const rect = anchor.getBoundingClientRect();
        return {
          key: link.getKey(),
          url: link.getURL(),
          x: rect.left,
          y: rect.bottom,
        };
      });
      if (found) {
        event.preventDefault();
        onOpen();
        setTarget(found);
        setDraft(found.url);
      }
    }

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [editor]);

  function withLink(run: (link: LinkNode) => void, close: () => void) {
    if (target) {
      editor.update(() => {
        const node = $getNodeByKey(target.key);
        if ($isLinkNode(node)) run(node);
      });
    }
    markHandled();
    close();
    requestAnimationFrame(() => editor.focus());
  }

  function save(close: () => void) {
    const value = draft.trim();
    if (value === "") {
      unwrap(close);
      return;
    }
    withLink((link) => link.setURL(value), close);
  }

  function unwrap(close: () => void) {
    withLink((link) => {
      for (const child of link.getChildren()) link.insertBefore(child);
      link.remove();
    }, close);
  }

  return (
    <AriaDialogTrigger
      isOpen={target !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setTarget(null);
        }
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
        className="popover-panel z-[60] w-80 data-[entering]:animate-popover-in data-[exiting]:animate-popover-out"
      >
        <AriaDialog className="outline-none">
          {({ close }) => (
            <form
              className="grid gap-2 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                save(close);
              }}
            >
              <span className="text-xs font-medium text-base-content/70">
                Link URL
              </span>
              <input
                aria-label="Link URL"
                autoFocus
                value={draft}
                placeholder="https://example.com"
                onChange={(event) => setDraft(event.target.value)}
                className="input input-sm input-bordered w-full"
              />
              <div className="flex items-center justify-between gap-2">
                <a
                  href={draft || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-sm btn-ghost gap-1.5"
                >
                  <NavIcon name="ExternalLink" />
                  Open
                </a>
                <div className="flex items-center gap-2">
                  <AriaButton
                    type="button"
                    onPress={() => unwrap(close)}
                    className="btn btn-sm btn-ghost gap-1.5 text-error"
                  >
                    <NavIcon name="Unlink" />
                    Clear
                  </AriaButton>
                  <AriaButton type="submit" className="btn btn-sm btn-primary">
                    Save
                  </AriaButton>
                </div>
              </div>
            </form>
          )}
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}
