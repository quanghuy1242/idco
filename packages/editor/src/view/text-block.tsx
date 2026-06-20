/**
 * The text-leaf block and its EditContext controller (docs/017 §3.1).
 *
 * This is the editing hot path: the active leaf binds an EditContext (native or
 * the vendored hidden-textarea polyfill), feeds `textupdate`/composition through
 * the navigation diff into the store, owns its caret/selection movement, and
 * drives pointer selection. The document never enters React state — the leaf
 * subscribes to its one node and the model stays the source of truth.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from "react";
import {
  detectMarkdownShortcut,
  orderedTextLeaves,
  pointAtOffset,
  type EditorCommand,
  type EditorSelection,
  type EditorStore,
  type NodeId,
  type TextLeafNode,
  type TextPoint,
} from "../core";
import {
  install,
  releaseForcedInstall,
  syncPolyfillSelection,
} from "../core/vendor/editcontext-polyfill";
import {
  caretClientRect,
  characterClientRects,
  clampOffset,
  offsetFromClientPoint,
} from "./geometry";
import {
  applyEditContextText,
  isCollapsedSelection,
  lineRangeAt,
  patchHostText,
  samePoint,
  selectionForNavigation,
  verticalNavigation,
  wordRangeAt,
} from "./navigation";
import { requestFrame } from "./raf";
import { leafHasMarks, renderLeafMarks } from "./mark-render";
import { ariaLabelForLeaf } from "./selection-overlay";
import { blockStyleFor } from "./styles";
import type {
  CharacterBoundsUpdateEventLike,
  EditContextConstructor,
  EditContextLike,
  MaybePolyfilledEditContextConstructor,
  TextBlockController,
  TextFormatUpdateEventLike,
  TextUpdateEventLike,
} from "./types";

export function EngineTextBlock(props: {
  readonly node: TextLeafNode;
  readonly store: EditorStore;
  readonly forcePolyfill: boolean;
  readonly registerBlock: (id: NodeId, element: HTMLElement | null) => void;
  readonly registerInputBackend: (
    id: NodeId,
    backend: "native" | "polyfill" | null,
  ) => void;
  readonly requestFocus: (id: NodeId) => boolean;
  readonly revealBlock: (id: NodeId) => void;
  readonly beginDrag: (anchor: TextPoint) => void;
  readonly goalColumnRef: RefObject<number | null>;
  readonly pageCaret: (direction: -1 | 1, extend: boolean) => boolean;
}) {
  const {
    node,
    store,
    forcePolyfill,
    registerBlock,
    registerInputBackend,
    requestFocus,
    revealBlock,
    beginDrag,
    goalColumnRef,
    pageCaret,
  } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<TextBlockController | null>(null);

  const syncSelectionIntoEditContext = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const selection = store.selection;
    if (selection?.type === "text" && selection.focus.node === node.id) {
      controller.editContext.updateSelection(
        Math.min(selection.anchor.offset, selection.focus.offset),
        Math.max(selection.anchor.offset, selection.focus.offset),
      );
      if (controller.backend === "polyfill" && hostRef.current) {
        syncPolyfillSelection(hostRef.current);
      }
    }
  }, [node.id, store]);

  const onTextUpdate = useCallback(
    (event: Event) => {
      const controller = controllerRef.current;
      if (!controller) return;
      // Typing is a horizontal change; drop any remembered vertical goal column.
      goalColumnRef.current = null;
      const editContext = controller.editContext;
      // The event already reports the exact replaced span (`updateRangeStart`/`End`
      // in pre-update coordinates). Forward it so `applyEditContextText` recovers
      // the edit by index math instead of re-diffing the whole buffer — the input
      // backend already scanned once to produce this event (docs/011 §9.4).
      const update = event as TextUpdateEventLike;
      const editRange =
        typeof update.updateRangeStart === "number" &&
        typeof update.updateRangeEnd === "number"
          ? { end: update.updateRangeEnd, start: update.updateRangeStart }
          : undefined;
      // The typing fast path patches the single rendered text node and authorizes
      // the commit to skip re-rendering this leaf. A leaf with marks renders as
      // nested mark elements (many text nodes), so a `textContent` patch would wipe
      // the formatting — those leaves re-render from the model instead (AC3). The
      // unformatted common case keeps the fast path.
      const current = store.getNode(node.id);
      const hasMarks = current?.kind === "text" && leafHasMarks(current);
      const onBeforeDispatch = hasMarks
        ? undefined
        : () => {
            patchHostText(hostRef.current, editContext.text);
            store.markActiveLeafDomSynced();
          };
      applyEditContextText(
        store,
        node.id,
        editContext.text,
        editContext.selectionStart,
        editContext.selectionEnd,
        onBeforeDispatch,
        editRange,
      );
      // After the text lands, fire any markdown / typing affordance at the caret
      // (AC8 + docs/018 §2.1). The detector is cheap and returns null for ordinary
      // typing; block prefixes retype the block, inline code wraps a `code` mark,
      // smart quotes substitute, brackets auto-pair. It is gated on the inserted
      // text (`update.text`), so an IME composition (multi-char) or a deletion
      // never auto-pairs. This is a second transaction after the insert (separately
      // undoable; the typing run breaks at the format/structure change anyway).
      const updated = store.getNode(node.id);
      const selection = store.selection;
      if (
        updated?.kind === "text" &&
        selection?.type === "text" &&
        selection.focus.node === node.id
      ) {
        const shortcut = detectMarkdownShortcut(
          updated.content.text,
          selection.focus.offset,
          updated.type,
          update.text,
        );
        if (shortcut) store.command({ shortcut, type: "apply-markdown" });
      }
    },
    [goalColumnRef, node.id, store],
  );

  // IME preedit: a fully owned view gets no browser-drawn composition underline,
  // so the engine paints it (docs/010 §7.4, Phase 7 AC5). `textformatupdate`
  // carries the preedit range + underline style on both backends; we record the
  // range on the store and the overlay paints the underline.
  const onTextFormatUpdate = useCallback(
    (event: Event) => {
      const formats =
        (event as TextFormatUpdateEventLike).getTextFormats?.() ?? [];
      const underlined = formats.find((f) => f.rangeEnd > f.rangeStart);
      if (underlined) {
        store.setComposition({
          from: underlined.rangeStart,
          node: node.id,
          to: underlined.rangeEnd,
        });
      } else {
        store.clearComposition();
      }
    },
    [node.id, store],
  );

  const onCompositionEnd = useCallback(() => {
    store.clearComposition();
  }, [store]);

  // The IME asks for per-character geometry to place its candidate window
  // (docs/010 §7.4, Phase 7 AC4/AC5); answer with viewport rects for the
  // requested range so the candidate box sits at the composing text.
  const onCharacterBoundsUpdate = useCallback((event: Event) => {
    const controller = controllerRef.current;
    const host = hostRef.current;
    if (!controller || !host) return;
    const { rangeStart, rangeEnd } = event as CharacterBoundsUpdateEventLike;
    const rects = characterClientRects(host, rangeStart, rangeEnd);
    controller.editContext.updateCharacterBounds?.(rangeStart, rects);
  }, []);

  const ensureController = useCallback((): TextBlockController | null => {
    if (controllerRef.current) return controllerRef.current;
    const host = hostRef.current;
    if (!host) return null;
    const view = host.ownerDocument.defaultView ?? window;
    const existing = (view as { EditContext?: unknown }).EditContext as
      | MaybePolyfilledEditContextConstructor
      | undefined;
    const hasNative =
      typeof existing === "function" && existing.isIdcoPolyfill !== true;
    const backend = forcePolyfill || !hasNative ? "polyfill" : "native";
    if (backend === "polyfill") {
      install({
        force: forcePolyfill,
        target: view as unknown as Record<string, unknown>,
      });
    }
    const Ctor = (view as unknown as { EditContext: EditContextConstructor })
      .EditContext;
    const current = store.requireTextNode(node.id);
    const length = current.content.text.length;
    const editContext = new Ctor({
      selectionEnd: length,
      selectionStart: length,
      text: current.content.text,
    });
    editContext.addEventListener("textupdate", onTextUpdate);
    editContext.addEventListener("compositionend", onCompositionEnd);
    editContext.addEventListener("textformatupdate", onTextFormatUpdate);
    editContext.addEventListener(
      "characterboundsupdate",
      onCharacterBoundsUpdate,
    );
    (host as unknown as { editContext: EditContextLike }).editContext =
      editContext;
    const destroy = () => {
      editContext.removeEventListener("textupdate", onTextUpdate);
      editContext.removeEventListener("compositionend", onCompositionEnd);
      editContext.removeEventListener("textformatupdate", onTextFormatUpdate);
      editContext.removeEventListener(
        "characterboundsupdate",
        onCharacterBoundsUpdate,
      );
      store.clearComposition();
      (host as unknown as { editContext: EditContextLike | null }).editContext =
        null;
      registerInputBackend(node.id, null);
      if (forcePolyfill) releaseForcedInstall();
    };
    registerInputBackend(node.id, backend);
    controllerRef.current = { backend, destroy, editContext };
    return controllerRef.current;
  }, [
    forcePolyfill,
    node.id,
    onCharacterBoundsUpdate,
    onCompositionEnd,
    onTextFormatUpdate,
    onTextUpdate,
    registerInputBackend,
    store,
  ]);

  useLayoutEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const current = node.content.text;
    if (controller.editContext.text !== current) {
      controller.editContext.updateText(
        0,
        controller.editContext.text.length,
        current,
      );
    }
    syncSelectionIntoEditContext();
  }, [node, syncSelectionIntoEditContext]);

  useEffect(
    () => () => {
      controllerRef.current?.destroy();
      controllerRef.current = null;
      store.deactivateTextLeaf(node.id);
    },
    [node.id, store],
  );

  const bindRef = useCallback(
    (element: HTMLDivElement | null) => {
      hostRef.current = element;
      registerBlock(node.id, element);
    },
    [node.id, registerBlock],
  );

  const applyCaret = useCallback(
    (offset: number, extendFrom?: TextPoint) => {
      const current = store.getNode(node.id);
      if (!current || current.kind !== "text") return;
      const clamped = clampOffset(offset, current.content.text.length);
      store.activateTextLeaf(node.id);
      const controller = ensureController();
      const focus = pointAtOffset(node.id, current.content, clamped);
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor: extendFrom ?? focus, focus, type: "text" },
        steps: [],
      });
      controller?.editContext.updateSelection(clamped, clamped);
      if (controller?.backend === "polyfill" && hostRef.current) {
        syncPolyfillSelection(hostRef.current);
      }
    },
    [ensureController, node.id, store],
  );

  const focusAtEnd = useCallback(() => {
    const current = store.requireTextNode(node.id);
    const existing = store.selection;
    // When focus follows the caret into this block (e.g. shift+arrow extending a
    // range across a boundary), keep the existing anchor so the selection is not
    // collapsed by the programmatic focus. Only a fresh focus drops a caret.
    if (existing?.type === "text" && existing.focus.node === node.id) {
      applyCaret(existing.focus.offset, existing.anchor);
      return;
    }
    applyCaret(current.content.text.length);
  }, [applyCaret, node.id, store]);

  const selectRangeInBlock = useCallback(
    (from: number, to: number) => {
      const current = store.requireTextNode(node.id);
      const anchor = pointAtOffset(node.id, current.content, from);
      const focus = pointAtOffset(node.id, current.content, to);
      store.activateTextLeaf(node.id);
      const controller = ensureController();
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor, focus, type: "text" },
        steps: [],
      });
      controller?.editContext.updateSelection(
        Math.min(from, to),
        Math.max(from, to),
      );
      if (controller?.backend === "polyfill" && hostRef.current) {
        syncPolyfillSelection(hostRef.current);
      }
      beginDrag(anchor);
    },
    [beginDrag, ensureController, node.id, store],
  );

  const focusAtClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // Only the primary (left) button drives caret placement and drag. A
      // right/middle press must leave the model selection untouched so a
      // right-click can open the context menu over an existing selection without
      // collapsing it (the native-editor behavior); the caret-collapsing
      // mousedown would otherwise wipe the selection before `contextmenu` fires.
      if (event.button !== 0) return;
      // A pointer click sets a fresh caret X; drop any remembered goal column.
      goalColumnRef.current = null;
      // Map the click to a model offset (docs/011 \u00a78.3 click-to-position), not
      // the end of the block. Fall back to the end only if the point misses the
      // text (e.g. a click in the block padding).
      const host = hostRef.current;
      const current = store.requireTextNode(node.id);
      const offset = clampOffset(
        (host
          ? offsetFromClientPoint(host, event.clientX, event.clientY)
          : null) ?? current.content.text.length,
        current.content.text.length,
      );
      // Double-click selects the word under the pointer; triple-click selects
      // the line (the run between soft `\n` breaks) at the pointer, matching a
      // native editor \u2014 for a single-line block the line is the whole block
      // (docs/010 Phase 7 AC8; docs/011 \u00a78.3 gesture-to-range via Intl.Segmenter).
      if (event.detail === 2) {
        const [from, to] = wordRangeAt(current.content.text, offset);
        selectRangeInBlock(from, to);
        return;
      }
      if (event.detail >= 3) {
        const [from, to] = lineRangeAt(current.content.text, offset);
        selectRangeInBlock(from, to);
        return;
      }
      const focus = pointAtOffset(node.id, current.content, offset);
      // Shift-click extends from the existing anchor; a plain click collapses.
      // Either way the anchor becomes the drag anchor so a press-move-release
      // paints a range (docs/010 Phase 5 AC4 selection).
      const existing = store.selection;
      const anchor =
        event.shiftKey && existing?.type === "text" ? existing.anchor : focus;
      store.activateTextLeaf(node.id);
      const controller = ensureController();
      store.dispatch({
        origin: "local",
        selectionAfter: { anchor, focus, type: "text" },
        steps: [],
      });
      controller?.editContext.updateSelection(offset, offset);
      if (controller?.backend === "polyfill" && hostRef.current) {
        syncPolyfillSelection(hostRef.current);
      }
      beginDrag(anchor);
    },
    [beginDrag, ensureController, node.id, selectRangeInBlock, store],
  );

  const moveSelection = useCallback(
    (next: EditorSelection) => {
      store.dispatch({ origin: "local", selectionAfter: next, steps: [] });
      // Keep DOM focus on the block the caret now lives in, or the next
      // keystroke (typing or another arrow) lands on the stale block. This is
      // the focus-follows-caret rule a model-owned selection needs.
      const focusNode = next.type === "text" ? next.focus.node : node.id;
      if (focusNode !== node.id) requestFocus(focusNode);
      else syncSelectionIntoEditContext();
      // Follow the caret: scroll the focus into view on every keyboard move,
      // including same-block moves down a tall block, so it never slides off.
      revealBlock(focusNode);
    },
    [node.id, requestFocus, revealBlock, store, syncSelectionIntoEditContext],
  );

  // After a command/undo/redo moves the caret to a *different* block, focus and
  // reveal it. We try synchronously first (B1): focusing the destination now — in
  // this same gesture, before React commits any unmount — closes the focusless
  // gap a deferred focus would leave, so on the polyfill path the OS keyboard's
  // hidden textarea hands off without a re-tap, and any focus-switching command
  // (the non-adjacent backward-merge fallback, cut/delete-selection, undo) keeps
  // editing live. When the destination does not exist yet — a split's freshly-
  // created block, not mounted until React commits — the synchronous attempt
  // finds no element and we fall back to the next frame, the original behaviour.
  //
  // B1 does NOT by itself stop the native (non-polyfill) keyboard flicker on a
  // cross-block merge: that flicker comes from *removing* the EditContext host
  // the keyboard is bound to, which a synchronous focus elsewhere cannot prevent.
  // The cross-block Backspace case is handled upstream in the merge command
  // (`mergeWithNeighbor`/`mergeHeadInto`), which keeps the focused leaf alive so
  // nothing the keyboard is bound to is destroyed — there the caret stays in this
  // same node and the `focusNode === node.id` branch below just re-syncs it.
  const focusSelectionSoon = useCallback(() => {
    const apply = (): boolean => {
      const sel = store.selection;
      const focusNode = sel?.type === "text" ? sel.focus.node : null;
      if (!focusNode) return false;
      if (focusNode === node.id) {
        syncSelectionIntoEditContext();
        revealBlock(focusNode);
        return true;
      }
      if (!requestFocus(focusNode)) return false;
      revealBlock(focusNode);
      return true;
    };
    if (!apply()) requestFrame(apply);
  }, [node.id, requestFocus, revealBlock, store, syncSelectionIntoEditContext]);

  const runEditCommand = useCallback(
    (command: EditorCommand) => {
      if (store.command(command)) focusSelectionSoon();
    },
    [focusSelectionSoon, store],
  );

  const selectAll = useCallback(() => {
    // Select the whole virtualized document, end to end, in document order.
    const leaves = orderedTextLeaves(store);
    if (leaves.length === 0) return;
    const first = leaves[0]!.node;
    const last = leaves.at(-1)!.node;
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(first.id, first.content, 0),
        focus: pointAtOffset(last.id, last.content, last.content.text.length),
        type: "text",
      },
      steps: [],
    });
    focusSelectionSoon();
  }, [focusSelectionSoon, store]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const selection = store.selection;
      if (selection?.type !== "text" || selection.focus.node !== node.id) {
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) store.redo();
          else store.undo();
          focusSelectionSoon();
        } else if (key === "y") {
          event.preventDefault();
          store.redo();
          focusSelectionSoon();
        } else if (key === "a") {
          event.preventDefault();
          selectAll();
        } else if (key === "b" || key === "i" || key === "u") {
          // Format shortcuts. Over a selection they toggle the mark; at a
          // collapsed caret `store.command` records the pending format (docs/018
          // §2.0), so Ctrl/Cmd+B then typing is bold — same as the toolbar button.
          event.preventDefault();
          const mark =
            key === "b" ? "bold" : key === "i" ? "italic" : "underline";
          runEditCommand({ mark, type: "toggle-mark" });
        }
        // copy/cut/paste flow through the root clipboard events, not here.
        return;
      }
      // Structural editing keys compile to commands (docs/010 §6.12, AC3/AC5).
      if (event.key === "Enter") {
        event.preventDefault();
        // Shift+Enter inserts a soft line break inside the current block (blocks
        // render `\n` as pre-wrap); plain Enter splits into a new block.
        runEditCommand(
          event.shiftKey
            ? { text: "\n", type: "insert-text" }
            : { type: "split-block" },
        );
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        runEditCommand({ type: event.shiftKey ? "outdent" : "indent" });
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        const current = store.requireTextNode(node.id);
        const collapsed = isCollapsedSelection(selection);
        const atStart = selection.focus.offset === 0;
        const atEnd = selection.focus.offset === current.content.text.length;
        if (!collapsed) {
          event.preventDefault();
          runEditCommand({ type: "delete-selection" });
        } else if (event.key === "Backspace" && atStart) {
          event.preventDefault();
          runEditCommand({ type: "delete-backward" });
        } else if (event.key === "Delete" && atEnd) {
          event.preventDefault();
          runEditCommand({ type: "delete-forward" });
        }
        // A mid-leaf collapsed delete falls through to the input controller,
        // which already mutates this leaf's text on the fast path.
        return;
      }
      if (event.key === "PageUp" || event.key === "PageDown") {
        // Viewport paging (docs/018 §2.4): the engine owns it so the caret never
        // pages out of the mounted window. Seed the goal column from the live
        // caret on the first vertical-ish press, like Arrow Up/Down.
        if (goalColumnRef.current === null && hostRef.current) {
          const rect = caretClientRect(hostRef.current, selection.focus.offset);
          goalColumnRef.current = rect ? rect.left : null;
        }
        if (pageCaret(event.key === "PageUp" ? -1 : 1, event.shiftKey)) {
          event.preventDefault();
        }
        return;
      }
      event.stopPropagation();
      const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      // Goal column (docs/010 Phase 7 AC7): consecutive ArrowUp/ArrowDown track a
      // remembered caret X through ragged-width lines. Seed it from the live
      // caret on the first vertical press; any non-vertical move resets it below.
      if (vertical && goalColumnRef.current === null && hostRef.current) {
        const rect = caretClientRect(hostRef.current, selection.focus.offset);
        goalColumnRef.current = rect ? rect.left : null;
      }
      // Vertical nav uses browser line geometry inside a wrapped block; at the
      // first/last line the probe lands in the inter-block gap and returns
      // nothing or the same spot, so fall back to a block-level jump.
      const lineMove = vertical
        ? verticalNavigation(
            store,
            selection,
            hostRef.current,
            event.key === "ArrowUp" ? -1 : 1,
            event.shiftKey,
            goalColumnRef.current,
          )
        : null;
      const next =
        lineMove && !samePoint(lineMove, selection)
          ? lineMove
          : selectionForNavigation(store, selection, event.key, event.shiftKey);
      // A horizontal move (or a vertical fall-through to a block jump that the
      // browser geometry could not satisfy) resets the goal column so the next
      // vertical run re-seeds from the live caret.
      if (!vertical) goalColumnRef.current = null;
      if (!next || samePoint(next, selection)) return;
      event.preventDefault();
      moveSelection(next);
    },
    [goalColumnRef, moveSelection, node.id, pageCaret, store],
  );

  return (
    <div
      aria-label={ariaLabelForLeaf(node)}
      aria-multiline="true"
      data-engine-block-id={node.id}
      data-engine-block-type={node.type}
      data-engine-callout-tone={
        node.type === "callout" && typeof node.attrs?.tone === "string"
          ? node.attrs.tone
          : undefined
      }
      data-engine-heading={
        node.type === "heading" && typeof node.attrs?.tag === "string"
          ? node.attrs.tag
          : undefined
      }
      data-engine-text-id={node.id}
      id={node.id}
      onFocus={focusAtEnd}
      onKeyDown={handleKeyDown}
      onMouseDown={focusAtClick}
      ref={bindRef}
      role="textbox"
      style={blockStyleFor(node)}
      tabIndex={0}
    >
      {renderLeafMarks(node)}
    </div>
  );
}
