// DaisyUI 5: https://daisyui.com/components/card/
/* eslint-disable no-underscore-dangle -- Lexical node subclasses use __ fields by convention. */

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import {
  $getNodeByKey,
  createCommand,
  type ElementFormatType,
  type LexicalCommand,
  type NodeKey,
} from "lexical";
import { createContext, useCallback, type ReactNode } from "react";
import type {
  RichTextEditorMediaOption,
  RichTextEditorNode,
  RichTextEditorPostOption,
} from "../model/schema";
import { BlockChrome, ChromeButton } from "./chrome";

export const INSERT_RICH_TEXT_NODE_COMMAND: LexicalCommand<RichTextEditorNode> =
  createCommand("INSERT_RICH_TEXT_NODE_COMMAND");

export type RichTextEditorBindings = {
  readonly allowedEmbedDomains?: readonly string[];
  readonly mediaLibrary?: {
    readonly load: (
      query: string,
      signal?: AbortSignal,
    ) => Promise<readonly RichTextEditorMediaOption[]>;
    readonly resolve?: (
      mediaId: string,
      signal?: AbortSignal,
    ) => Promise<RichTextEditorMediaOption | null>;
  };
  readonly postLibrary?: {
    readonly load: (
      query: string,
      signal?: AbortSignal,
    ) => Promise<readonly RichTextEditorPostOption[]>;
  };
  readonly onUploadMedia?: (
    files: File[],
  ) =>
    | void
    | readonly RichTextEditorNode[]
    | Promise<readonly RichTextEditorNode[] | void>;
  /**
   * Notified when a comment is added: the generated mark id, the quoted text the
   * mark wraps, and the comment body the author typed. The host owns thread
   * storage/UI — the document only stores the mark id.
   */
  readonly onComment?: (commentId: string, quote: string, body: string) => void;
  /**
   * Existing comment threads, keyed by the mark id stored in the document. The
   * editor reads these to render the body when a highlight is clicked; the host
   * stays the source of truth.
   */
  readonly comments?: readonly RichTextEditorComment[];
  /** Notified when the body of an existing comment is edited in the popover. */
  readonly onCommentUpdate?: (commentId: string, body: string) => void;
  /**
   * Notified when a comment is removed (the highlight is unwrapped from the
   * document and the host should drop the thread).
   */
  readonly onCommentDelete?: (commentId: string) => void;
};

export type RichTextEditorComment = {
  readonly id: string;
  readonly quote: string;
  readonly body: string;
};

export const RichTextEditorBindingsContext =
  createContext<RichTextEditorBindings>({});

export type SerializedRichTextDecoratorNode = SerializedDecoratorBlockNode &
  Omit<RichTextEditorNode, "format">;

/**
 * Base for atomic block widgets (callout/code/embed/media/post-ref). Extends
 * Lexical's `DecoratorBlockNode` so the block is keyboard-selectable and the
 * caret can move past it; data is carried in `__data` and serialized verbatim.
 */
export abstract class RichTextDecoratorBlockNode extends DecoratorBlockNode {
  __data: RichTextEditorNode;

  constructor(
    data: RichTextEditorNode,
    format: ElementFormatType = "",
    key?: NodeKey,
  ) {
    super(format, key);
    this.__data = data;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__data = prevNode.__data;
  }

  createDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "my-3";
    // A block's nested inputs (callout textarea, code editor) are real form
    // controls. Lexical's key/clipboard listeners sit on the editor root *above*
    // this node and otherwise hijack the inputs' native keys: every keystroke
    // lands in two places. e.g. Tab indents the block *and* the textarea; Enter
    // splits the document paragraph *and* (because Lexical preventDefaults it)
    // never reaches the textarea as a newline; Ctrl/⌘+A selects the whole doc
    // instead of the input. Any keydown from a nested form control belongs to
    // that control, so stop it here before it bubbles to the root.
    element.addEventListener("keydown", (event) => {
      if (isFromFormControl(event)) event.stopPropagation();
    });
    for (const type of ["copy", "cut", "paste"] as const) {
      element.addEventListener(type, (event) => {
        if (isFromFormControl(event)) event.stopPropagation();
      });
    }
    return element;
  }

  getData(): RichTextEditorNode {
    return this.getLatest().__data;
  }

  setData(patch: Partial<RichTextEditorNode>): void {
    const writable = this.getWritable();
    writable.__data = { ...writable.__data, ...patch };
  }

  exportJSON(): SerializedRichTextDecoratorNode {
    // Alignment lives on the block's Lexical format (from super); strip any
    // stray `format` off the carried data so it cannot shadow it.
    const { format: _ignoredFormat, ...data } = this.__data;
    return {
      ...super.exportJSON(),
      ...data,
      type: this.getType(),
      version: 1,
    };
  }
}

export function useDecoratorNodeUpdater(key: NodeKey) {
  const [editor] = useLexicalComposerContext();
  return useCallback(
    (patch: Partial<RichTextEditorNode>) => {
      editor.update(() => {
        const node = $getNodeByKey(key);
        if (node instanceof RichTextDecoratorBlockNode) {
          node.setData(patch);
        }
      });
    },
    [editor, key],
  );
}

export function useRemoveNode(key: NodeKey) {
  const [editor] = useLexicalComposerContext();
  return useCallback(() => {
    editor.update(() => {
      $getNodeByKey(key)?.remove();
    });
  }, [editor, key]);
}

export function BlockShell({
  actions,
  children,
  icon,
  label,
  nodeKey,
  padded = true,
  persistentActions,
}: {
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly icon: string;
  readonly label: string;
  readonly nodeKey: NodeKey;
  readonly padded?: boolean;
  /** Chrome shown at all times (not only on hover), e.g. the code-block language. */
  readonly persistentActions?: ReactNode;
}) {
  const remove = useRemoveNode(nodeKey);
  return (
    <div className="group/block relative rounded-box border border-base-300 bg-base-100">
      <BlockChrome
        actions={actions}
        icon={icon}
        label={label}
        onRemove={remove}
        persistentActions={persistentActions}
      />
      <div className={padded ? "p-3" : ""}>{children}</div>
    </div>
  );
}

/** @deprecated Use `ChromeButton` from `./chrome` directly. */
export const BlockChromeButton = ChromeButton;

export function FieldLabel({ children }: { readonly children: ReactNode }) {
  return (
    <span className="text-xs font-medium text-base-content/70">{children}</span>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-base-content/40">
      <span className="h-px flex-1 bg-base-300" />
      or
      <span className="h-px flex-1 bg-base-300" />
    </div>
  );
}

/** True when an event originated from a real form control (a block's nested input). */
function isFromFormControl(event: Event): boolean {
  const target = event.target as HTMLElement | null;
  return (
    target !== null &&
    (target.tagName === "TEXTAREA" || target.tagName === "INPUT")
  );
}

export function embedAllowed(
  url: string,
  allowedEmbedDomains: readonly string[] | undefined,
): boolean {
  if (!url || !allowedEmbedDomains?.length) {
    return true;
  }
  try {
    return allowedEmbedDomains.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
