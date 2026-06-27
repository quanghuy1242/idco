/**
 * In-editor find (docs/010 Phase 8 AC1, §10.5 find-in-page).
 *
 * Virtualization removes offscreen text from the DOM, so the browser's native
 * Ctrl/Cmd+F is broken by construction — it would only find mounted blocks. The
 * engine therefore owns find: it searches the *model* (every block, mounted or
 * not), and object internals through the node SPI `plainText` adapter (docs/016
 * §6.1), so search never silently skips an object's contents. Navigating to a
 * match scrolls it into view under virtualization and selects it on the model.
 *
 * The bar UI is `@idco/ui` (React Aria + DaisyUI) plus a DaisyUI-classed input.
 */
import { useCallback, useMemo, useState } from "react";
import { Button, Input } from "@quanghuy1242/idco-ui";
import { pointAtOffset, type EditorStore, type NodeId } from "../../core";

/**
 * @categoryDefault Editor Components
 */

/** One find match: a text-leaf range, or a whole object block. */
export type FindMatch =
  | {
      readonly kind: "text";
      readonly node: NodeId;
      readonly from: number;
      readonly to: number;
    }
  | { readonly kind: "object"; readonly node: NodeId };

/** The find state and navigation surface: the query, the resolved matches, the current index, and open/close/next/previous controls. */
export type FindController = {
  readonly isOpen: boolean;
  readonly query: string;
  readonly matches: readonly FindMatch[];
  readonly current: number;
  open(): void;
  close(): void;
  setQuery(value: string): void;
  next(): void;
  previous(): void;
};

/**
 * Search the model for every occurrence of `query` (case-insensitive). Text
 * leaves yield one match per substring offset; object blocks yield a single match
 * when their SPI plain text contains the query (internals searched, not skipped).
 */
export function findMatches(
  store: EditorStore,
  query: string,
): readonly FindMatch[] {
  const needle = query.toLowerCase();
  if (needle.length === 0) return [];
  const matches: FindMatch[] = [];
  for (const id of store.order) {
    const node = store.getNode(id);
    if (!node) continue;
    if (node.kind === "text") {
      const haystack = node.content.text.toLowerCase();
      let from = haystack.indexOf(needle);
      while (from !== -1) {
        matches.push({
          from,
          kind: "text",
          node: id,
          to: from + needle.length,
        });
        from = haystack.indexOf(needle, from + Math.max(1, needle.length));
      }
    } else if (node.kind === "object") {
      const definition = store.registry.get(node.type);
      const text = definition?.plainText?.(node.data) ?? "";
      if (text.toLowerCase().includes(needle)) {
        matches.push({ kind: "object", node: id });
      }
    }
  }
  return matches;
}

/** Drive find state and navigation; selection/scroll go through the store + scroll. */
export function useFindController(
  store: EditorStore,
  scrollTo: (id: NodeId) => void,
): FindController {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [current, setCurrent] = useState(0);

  const matches = useMemo(() => findMatches(store, query), [store, query]);

  // Reveal and select one match: scroll it into view (works under virtualization
  // since the model holds every block) and set the model selection to it.
  const applyMatch = useCallback(
    (list: readonly FindMatch[], index: number) => {
      if (list.length === 0) return;
      const wrapped = ((index % list.length) + list.length) % list.length;
      setCurrent(wrapped);
      const match = list[wrapped]!;
      scrollTo(match.node);
      if (match.kind === "text") {
        const node = store.getNode(match.node);
        if (node?.kind === "text") {
          store.dispatch({
            origin: "local",
            selectionAfter: {
              anchor: pointAtOffset(match.node, node.content, match.from),
              focus: pointAtOffset(match.node, node.content, match.to),
              type: "text",
            },
            steps: [],
          });
        }
      } else {
        store.dispatch({
          origin: "local",
          selectionAfter: { node: match.node, type: "node" },
          steps: [],
        });
      }
    },
    [scrollTo, store],
  );

  const goTo = useCallback(
    (index: number) => applyMatch(matches, index),
    [applyMatch, matches],
  );

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value);
      setCurrent(0);
      // Select the first match for the new query immediately (live find).
      applyMatch(findMatches(store, value), 0);
    },
    [applyMatch, store],
  );

  return {
    close: () => setIsOpen(false),
    current,
    isOpen,
    matches,
    next: () => goTo(current + 1),
    open: () => setIsOpen(true),
    previous: () => goTo(current - 1),
    query,
    setQuery,
  };
}

/**
 * The find bar body, rendered *inside* the overlay authority's sticky-form envelope
 * (docs/029 R1-G). It owns its own search state (so typing re-renders it without touching
 * the authority host), and renders only the row — the {@link OverlayLayer} owns the box
 * chrome, the central positioning, and the focus policy (it autofocuses this field after
 * layout, replacing the old `autoFocus`). Dismissal is the authority's: Escape, the close
 * button (`onClose`), or an explicit `dismiss`.
 *
 * The bar's defining requirement — keep the field focused *and* survive a click into the
 * document while reading a match — is the `sticky` focus-mode (docs/029 §4.2). That replaces
 * the hand-rolled `shouldCloseOnInteractOutside` predicate that used to fight React Aria's
 * blur-within dismissal here; no surface-level dismissal guard remains.
 */
export function FindBar(props: {
  readonly store: EditorStore;
  readonly scrollTo: (id: NodeId) => void;
  readonly onClose: () => void;
}) {
  const { store, scrollTo, onClose } = props;
  const controller = useFindController(store, scrollTo);
  const total = controller.matches.length;
  return (
    <div
      className="flex items-center gap-1"
      data-engine-find=""
      onKeyDown={(event) => {
        // Keydown bubbles from the @idco/ui Input, which renders the field via React Aria and
        // does not expose its own key handler. Escape is the authority's (it dismisses the
        // top surface), so only Enter/Shift+Enter navigation is handled here.
        if (event.key === "Enter") {
          event.preventDefault();
          if (event.shiftKey) controller.previous();
          else controller.next();
        }
      }}
      role="search"
    >
      <div className="w-52">
        <Input
          ariaLabel="Find"
          onChange={(value) => controller.setQuery(value)}
          placeholder="Find in document…"
          size="sm"
          value={controller.query}
        />
      </div>
      <span
        aria-live="polite"
        className="text-sm opacity-70"
        data-engine-find-count=""
      >
        {total === 0
          ? controller.query
            ? "No results"
            : ""
          : `${controller.current + 1} / ${total}`}
      </span>
      <Button
        ariaLabel="Previous match"
        iconName="ChevronLeft"
        onClick={() => controller.previous()}
        size="sm"
        square
        tooltip="Previous match"
        variant="ghost"
      />
      <Button
        ariaLabel="Next match"
        iconName="ChevronRight"
        onClick={() => controller.next()}
        size="sm"
        square
        tooltip="Next match"
        variant="ghost"
      />
      <Button
        ariaLabel="Close find"
        iconName="X"
        onClick={onClose}
        size="sm"
        square
        tooltip="Close"
        variant="ghost"
      />
    </div>
  );
}
