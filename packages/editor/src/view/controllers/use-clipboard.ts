/**
 * Clipboard controller (docs/020 §4.3, R3; docs/030 §7.1/§7.2 markdown I/O + native fragment).
 *
 * Owns copy/cut/paste on the surface root: reads the model (so a range across virtualized
 * gaps stays whole), writes the serializations, and routes paste through the priority chain.
 *
 * Copy/cut write three flavours (D2): `application/x-idco-snapshot` (the lossless native
 * fragment, for in-app editor→editor paste — marks and object data intact), `text/markdown`
 * (the lossy open format), and `text/plain` (the universal fallback). Paste reads them in
 * priority order — native fragment, then markdown, then HTML, then plain — so an in-app paste
 * is always lossless and an external markdown paste is structured.
 *
 * Caret/focus: every path ends by re-syncing DOM focus to the model selection
 * (`syncFocusToSelection`) and the insert commands land the caret at the end of the pasted
 * run (or node-select the last block), so focus reclaim behaves identically to HTML paste. A
 * clipboard event from a real native field (a live code editor / config input) keeps its
 * native clipboard untouched.
 */
import { useCallback } from "react";
import type React from "react";
import {
  collectSelectionText,
  compileInsertFragment,
  editorSnapshotFromCompat,
  type EditorStore,
} from "../../core";
import { sanitizeHtmlToCompat } from "../paste-html";
import { snapshotToMarkdown } from "../markdown/to-markdown";
// `looksLikeMarkdown` is parser-free (lives in `transformers`), so importing it here does NOT
// pull the lazy `markdown-it` parser into the initial bundle — only `from-markdown` does, and
// it is `import()`-ed on demand below.
import { looksLikeMarkdown } from "../markdown/transformers";
import {
  IDCO_SNAPSHOT_MIME,
  collectSelectionFragment,
  parseFragment,
  serializeFragment,
  type SnapshotFragment,
} from "../markdown/native-clipboard";

/**
 * Whether a (synthetic) clipboard event came from a real native editable field — a live
 * object editor's `<textarea>` or a config-popover `<input>`. React portals bubble synthetic
 * events through the React tree, so such events reach the editor root even when their DOM
 * lives elsewhere; this guard keeps native fields native.
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
  /**
   * Parse a `text/plain` payload that *looks* like markdown as markdown (docs/030 §7.1
   * heuristic). Default on, so markdown copied from external apps (which lands as plain text,
   * not `text/markdown`) pastes structured; a host can disable it to keep plain paste literal.
   */
  readonly markdownPastePlainText?: boolean;
}): ClipboardController {
  const { store, syncFocusToSelection, markdownPastePlainText = true } = args;

  /** Write the three copy flavours for the current selection onto the event clipboard. */
  const writeClipboard = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>): boolean => {
      const text = collectSelectionText(store, store.selection);
      const fragment = collectSelectionFragment(store);
      if (!text && !fragment) return false;
      const data = event.clipboardData;
      if (!data) return false;
      if (text) data.setData("text/plain", text);
      // A block-level selection also writes the lossless native fragment + the lossy markdown.
      if (fragment) {
        data.setData(IDCO_SNAPSHOT_MIME, serializeFragment(fragment));
        data.setData(
          "text/markdown",
          // Pass the store registry so unbaked / custom objects bake on demand for the lossy
          // markdown flavour (the lossless native fragment above already carries them).
          snapshotToMarkdown(fragmentSnapshot(fragment), {
            registry: store.registry,
          }),
        );
      }
      return true;
    },
    [store],
  );

  const onClipboardCopy = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // A native field (live object editor / config input) keeps its native clipboard.
      if (isNativeEditableTarget(event.target)) return;
      // Clipboard reads the model, not the DOM, so a range spanning virtualized gaps copies
      // the full content including the offscreen middle (docs/011 §13.9).
      if (writeClipboard(event)) event.preventDefault();
    },
    [writeClipboard],
  );

  const onClipboardCut = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      if (isNativeEditableTarget(event.target)) return;
      if (!writeClipboard(event)) return;
      event.preventDefault();
      // Cut is a hard undo boundary (docs/011 §7.5): never fold into a typing run. Delete
      // through the command layer so the delete is one invertible transaction (AC5).
      store.breakUndoCoalescing();
      store.command({ type: "delete-selection" });
      syncFocusToSelection();
    },
    [store, syncFocusToSelection, writeClipboard],
  );

  /** Insert a native fragment as one transaction, landing the caret per the insert contract. */
  const insertFragment = useCallback(
    (fragment: SnapshotFragment): void => {
      const tr = compileInsertFragment(store, fragment);
      if (tr) store.dispatch(tr);
      syncFocusToSelection();
    },
    [store, syncFocusToSelection],
  );

  const onClipboardPaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      // A native field keeps native paste — otherwise the root would swallow it and insert
      // into the document instead of the focused field (the popover Ctrl+V bug).
      if (isNativeEditableTarget(event.target)) return;
      const data = event.clipboardData;
      if (!data) return;
      // Read every flavour synchronously: clipboardData is only valid during the event, so a
      // later async markdown parse must not re-read it.
      const native = data.getData(IDCO_SNAPSHOT_MIME);
      const markdown = data.getData("text/markdown");
      const html = data.getData("text/html");
      const plain = data.getData("text/plain");
      // Paste is a hard undo boundary (docs/011 §7.5).
      store.breakUndoCoalescing();

      // 1) Native fragment — lossless in-app paste (marks + object data + nesting intact).
      if (native) {
        const fragment = parseFragment(native);
        if (fragment) {
          event.preventDefault();
          insertFragment(fragment);
          return;
        }
      }

      // 2) Explicit markdown, or 4) a plain payload that *looks* like markdown (the opt-in
      // heuristic). Plain prose with no structural markers is NOT parsed — it falls through to
      // the literal plain-text insert below, so an ordinary paste stays literal.
      const markdownSource =
        markdown && markdown.length > 0
          ? markdown
          : !html && markdownPastePlainText && plain && looksLikeMarkdown(plain)
            ? plain
            : "";
      if (markdownSource) {
        // preventDefault now (sync), then lazy-load the parser and insert. The ~100 KB
        // markdown-it stays out of the initial bundle until the first markdown paste.
        event.preventDefault();
        void pasteMarkdown(markdownSource);
        return;
      }

      // 3) Rich HTML through the single sanitization boundary (AC8). Pre-existing compat
      // detour (a §7.1 follow-on migrates it onto the native builder).
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

      // 5) Plain text (literal): an inline insert (AC5).
      if (!plain) return;
      event.preventDefault();
      store.command({ type: "insert-text", text: plain });
      syncFocusToSelection();

      async function pasteMarkdown(source: string): Promise<void> {
        // Lazy import keeps markdown-it out of the initial editor bundle (docs/030 §7.1).
        const { markdownToNodes } = await import("../markdown/from-markdown");
        const fragment = markdownToNodes(
          source,
          store.allocator,
          store.registry,
        );
        // Surface dropped/lossy constructs (a markdown table on paste, §7.1/§9) rather than
        // dropping them silently — the doc's "dropped with a logged note" contract.
        if (fragment.dropped.length > 0) {
          // eslint-disable-next-line no-console
          console.info(
            `idco: dropped unsupported markdown on paste: ${fragment.dropped.join(", ")}`,
          );
        }
        if (fragment.order.length === 0) {
          syncFocusToSelection();
          return;
        }
        insertFragment(fragment);
      }
    },
    [store, syncFocusToSelection, insertFragment, markdownPastePlainText],
  );

  return { onClipboardCopy, onClipboardCut, onClipboardPaste };
}

/** Wrap a fragment as a minimal snapshot for `snapshotToMarkdown` (it reads `body` only). */
function fragmentSnapshot(fragment: SnapshotFragment) {
  return {
    body: { blocks: fragment.blocks, order: fragment.order },
    settings: {},
    version: 1 as const,
  };
}
