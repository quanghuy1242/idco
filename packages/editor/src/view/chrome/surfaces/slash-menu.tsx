/**
 * Slash menu (docs/024 §7.3) — the keyboard-first insert / turn-into surface.
 *
 * Like every surface it is a *projection*: `resolveCommandList("slash", ctx)` returns
 * the `blockStyle` turn-into commands + the `insert` blocks; this host holds no list.
 * The trigger is detected by the coordinator from the *committed* model text (docs/024
 * §9 — never a raw keydown that would fight IME), passed in as `slash`.
 *
 * Focus model — the load-bearing detail. The slash menu must NOT take focus: the editor
 * keeps its EditContext focus and the painted caret so the author can keep typing to
 * filter, or press Backspace to delete the `/` and dismiss (docs/024 §8 non-modal). So
 * this is a plain positioned portal, NOT a React Aria `Popover`/`Dialog` (whose focus
 * trap stole editor focus — the bug that broke typing/backspace). The list still renders
 * as a React Aria `ListBox`/`ListBoxItem` for roles, but it is never auto-focused; a
 * document **capture**-phase key handler drives up/down/enter/escape before the text
 * block sees them, and an `onMouseDown`-preventDefault keeps a click from blurring the
 * editor (so the executed insert lands on the live model selection). This is the one
 * sanctioned hand-driven-keyboard spot — the non-modal-over-live-caret requirement
 * leaves no React-Aria-focus path (docs/024 §7.3).
 *
 * Geometry: anchored at the caret rect (`caretClientRect`); flips *above* the caret near
 * the viewport bottom so the list is never clipped off-screen (the "can't click items
 * near the end of the document" bug). The highlighted row is scrolled into view as the
 * query/selection changes.
 *
 * Execute + cleanup: an insert selects the `/query` range first so the insert command
 * *collapses it* — the `/query` removal and the insert land in one transaction and one
 * undo (docs/024 §7.3). A turn-into removes the `/query` then sets the block type (a
 * turn-into does not consume a range), the one slash path that is two undo steps.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ListBox, ListBoxItem } from "react-aria-components";
import { NavIcon } from "@quanghuy1242/idco-ui";
import { pointAtOffset, type EditorStore } from "../../../core";
import { caretClientRect } from "../../overlays";
import {
  resolveCommandList,
  type CommandContext,
  type ResolvedCommand,
} from "../../spi";
import type { SlashTrigger } from "./use-command-surfaces";

/** Estimated max panel height, used to decide the above/below flip near the viewport edge. */
const PANEL_MAX_HEIGHT = 296;

/**
 * Filter the resolved slash commands by the query (docs/024 §7.3). Pure: an empty
 * query returns the full list; otherwise an item matches when its label or any keyword
 * contains the query. `more`-placement items sort after `primary`. Exported for the
 * slash-filter unit tests.
 */
export function filterSlashItems(
  items: readonly ResolvedCommand[],
  query: string,
): readonly ResolvedCommand[] {
  const q = query.trim().toLowerCase();
  const matched =
    q.length === 0
      ? [...items]
      : items.filter(
          (item) =>
            item.command.label.toLowerCase().includes(q) ||
            (item.command.keywords ?? []).some((keyword) =>
              keyword.toLowerCase().includes(q),
            ),
        );
  return matched.sort(
    (a, b) =>
      (a.placement === "more" ? 1 : 0) - (b.placement === "more" ? 1 : 0),
  );
}

/** The viewport rect of the caret at the slash query end, or null when unmounted. */
function caretRectFor(store: EditorStore, slash: SlashTrigger): DOMRect | null {
  const el = document.querySelector<HTMLElement>(
    `[data-engine-block-id="${slash.leafId}"]`,
  );
  return el ? caretClientRect(el, slash.caret) : null;
}

export function SlashMenu(props: {
  readonly store: EditorStore;
  readonly ctx: CommandContext;
  readonly slash: SlashTrigger | null;
  readonly close: () => void;
  readonly focusEditor: () => void;
}) {
  const { store, ctx, slash, close, focusEditor } = props;
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const rect = slash ? caretRectFor(store, slash) : null;
  const items = slash
    ? filterSlashItems(
        resolveCommandList("slash", ctx).flatMap((group) => group.items),
        slash.query,
      )
    : [];
  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1);

  /** Select the `/query` text range so an insert collapses it (docs/024 §7.3). */
  const selectQueryRange = (trigger: SlashTrigger) => {
    const leaf = store.getNode(trigger.leafId);
    if (leaf?.kind !== "text") return;
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(trigger.leafId, leaf.content, trigger.slashPos),
        focus: pointAtOffset(trigger.leafId, leaf.content, trigger.caret),
        type: "text",
      },
      steps: [],
    });
  };

  const execute = (item: ResolvedCommand | undefined) => {
    if (!item || !slash) return;
    selectQueryRange(slash);
    if (item.command.group === "insert") {
      // The insert command collapses the selected `/query` and inserts — one
      // transaction, one undo (docs/024 §7.3).
      item.command.run?.(ctx);
    } else {
      // Turn-into does not consume a range, so the `/query` is removed first.
      store.command({ type: "delete-selection" });
      item.command.run?.(ctx);
    }
    close();
    focusEditor();
  };

  // Document capture handler so up/down/enter/escape reach the menu before the text
  // block (the editor keeps focus). Reads the latest list/index/execute through refs,
  // so it subscribes once per open and never goes stale.
  const itemsRef = useRef(items);
  const indexRef = useRef(safeIndex);
  const executeRef = useRef(execute);
  const dismissRef = useRef(() => {});
  itemsRef.current = items;
  indexRef.current = safeIndex;
  executeRef.current = execute;
  dismissRef.current = () => {
    close();
    focusEditor();
  };
  useEffect(() => {
    if (!slash) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const list = itemsRef.current;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setIndex((i) => Math.min(i + 1, Math.max(0, list.length - 1)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        executeRef.current(list[indexRef.current]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [slash]);

  // Reset the highlight when the trigger opens or the query changes.
  useEffect(() => {
    setIndex(0);
  }, [slash?.leafId, slash?.query]);

  // Keep the highlighted row visible as the selection/query moves (the arrow-scroll
  // fix): scroll the selected option into the nearest edge of the scroll container.
  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    selected?.scrollIntoView({ block: "nearest" });
  }, [safeIndex, slash?.query]);

  if (!slash || !rect || items.length === 0) return null;

  // Flip above the caret near the viewport bottom so the list is never clipped (the
  // "can't reach items near the end of the document" fix).
  const viewportH =
    typeof window !== "undefined"
      ? window.innerHeight
      : Number.MAX_SAFE_INTEGER;
  const flipAbove = rect.bottom + PANEL_MAX_HEIGHT + 8 > viewportH;
  const position = flipAbove
    ? { bottom: viewportH - rect.top + 4, left: rect.left }
    : { left: rect.left, top: rect.bottom + 4 };

  return createPortal(
    <div
      className="fixed z-50 rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
      data-engine-slash=""
      // Keep the editor focused: a click must not blur the EditContext host, so the
      // executed insert lands on the live model selection (docs/024 §7.3).
      onMouseDown={(event) => event.preventDefault()}
      ref={listRef}
      style={position}
    >
      <ListBox
        aria-label="Insert block"
        className="flex max-h-72 w-60 flex-col gap-0.5 overflow-y-auto outline-none"
        selectedKeys={items[safeIndex] ? [items[safeIndex]!.id] : []}
        selectionMode="single"
      >
        {items.map((item) => (
          <ListBoxItem
            className={({ isSelected }) =>
              `flex cursor-pointer items-center gap-2.5 rounded-field px-3 py-2 text-sm outline-none ${
                isSelected ? "bg-base-200" : "hover:bg-base-200"
              }`
            }
            id={item.id}
            key={item.id}
            onAction={() => execute(item)}
            textValue={item.command.label}
          >
            <NavIcon name={item.command.icon} />
            {item.command.label}
          </ListBoxItem>
        ))}
      </ListBox>
    </div>,
    document.body,
  );
}
