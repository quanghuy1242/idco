/**
 * Clipboard controller (docs/020 §4.3, R3).
 *
 * Owns copy/cut/paste on the surface root: reads the model (so a range across
 * virtualized gaps stays whole), writes the model serialization, and routes rich
 * HTML paste through the single sanitization boundary. A clipboard event from a
 * real native field (a live code editor / config-popover input) keeps its native
 * clipboard. Lifted verbatim from `react-view.tsx`.
 */
import { useCallback } from "react";
import type React from "react";
import {
  collectSelectionText,
  editorSnapshotFromCompat,
  type EditorStore,
} from "../../core";
import { sanitizeHtmlToCompat } from "../paste-html";

/**
 * Whether a (synthetic) clipboard event came from a real native editable field —
 * a live object editor's `<textarea>` or a config-popover `<input>`. React portals
 * bubble synthetic events through the React tree, so such events reach the editor
 * root even when their DOM lives elsewhere; this guard keeps native fields native.
 */
function isNativeEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  );
}

export type ClipboardController = {
  readonly onClipboardCopy: (
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => void;
  readonly onClipboardCut: (
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => void;
  readonly onClipboardPaste: (
    event: React.ClipboardEvent<HTMLDivElement>,
  ) => void;
};

export function useClipboard(args: {
  readonly store: EditorStore;
  readonly syncFocusToSelection: () => void;
}): ClipboardController {
  const { store, syncFocusToSelection } = args;

  const onClipboardCopy = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // A clipboard event from a real native field — a live object editor (the
      // code <textarea>) or a config-popover <input> — must keep its native
      // clipboard. React portals bubble synthetic events through the React tree,
      // so the popover's paste reaches this root handler even though its DOM lives
      // elsewhere; without this guard the root would preventDefault and route the
      // paste into the document model instead of the focused field.
      if (isNativeEditableTarget(event.target)) return;
      // Clipboard reads the model, not the DOM, so a range spanning virtualized
      // gaps copies the full text including the offscreen middle (docs/011 §13.9).
      const text = collectSelectionText(store, store.selection);
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    },
    [store],
  );

  const onClipboardCut = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // A native field (code editor / config-popover input) keeps native cut.
      if (isNativeEditableTarget(event.target)) return;
      // Cut writes the model serialization, then deletes the selection through
      // the command layer so the delete is one invertible transaction (AC5).
      const text = collectSelectionText(store, store.selection);
      if (!text) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
      // Cut is a hard undo boundary (docs/011 §7.5): never fold into a typing run.
      store.breakUndoCoalescing();
      store.command({ type: "delete-selection" });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  const onClipboardPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // A native field (code editor / config-popover input) keeps native paste —
      // otherwise the root would swallow the paste and insert it into the document
      // instead of the focused field (the popover Ctrl+V bug).
      if (isNativeEditableTarget(event.target)) return;
      // Rich HTML paste parses through the single sanitization boundary into
      // model blocks (AC8); plain text falls back to an inline insert (AC5).
      // Either way paste is a hard undo boundary (docs/011 §7.5).
      store.breakUndoCoalescing();
      const html = event.clipboardData?.getData("text/html");
      if (html) {
        const compat = sanitizeHtmlToCompat(html);
        if (compat.length > 0) {
          event.preventDefault();
          const snapshot = editorSnapshotFromCompat(
            { root: { children: compat } },
            {
              allocator: store.allocator,
              registry: store.registry,
              unknownObjectPolicy: "drop",
            },
          );
          const nodes = snapshot.body.order.map(
            (id) => snapshot.body.blocks[id]!,
          );
          store.command({ nodes, type: "insert-blocks" });
          syncFocusToSelection();
          return;
        }
      }
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      store.command({ type: "insert-text", text });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  return { onClipboardCopy, onClipboardCut, onClipboardPaste };
}
