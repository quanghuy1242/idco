/**
 * Slash menu (docs/024 §7.3, docs/029 R1-F) — the keyboard-first insert / turn-into surface,
 * now a **`caret`-target overlay contributor** instead of a hand-rolled `createPortal` with a
 * bespoke document-capture keyboard handler. It is content-kind `menu`, focus-mode
 * `transparent`: the editor keeps EditContext focus + the painted caret so the author can
 * keep typing to filter or press Backspace to delete the `/` and dismiss. The authority owns
 * the envelope (caret anchor, positioning/flip, ownership), and the **focus-transparent
 * keyboard routing** (`useTransparentKeyboardRouting`, docs/029 §7.5) drives up/down/enter/
 * escape while focus stays in the editor — the one sanctioned hand-driven-keyboard spot, now
 * a reusable capability rather than this file's private handler.
 *
 * Like every surface it is a *projection*: `resolveCommandList("slash", ctx)` returns the
 * `blockStyle` turn-into commands + the `insert` blocks. The trigger is detected from the
 * *committed* model text (`detectSlashTrigger`, never a raw keydown that would fight IME),
 * so the contributor's `when` raises it and the body re-derives it each render.
 *
 * Execute + cleanup: an insert selects the `/query` range first so the insert command
 * *collapses it* — the removal and the insert land in one transaction and one undo. A
 * turn-into removes the `/query` then sets the block type (two undo steps).
 */
import { useEffect, useRef, useState } from "react";
import { ListBox, ListBoxItem } from "react-aria-components";
import { NavIcon } from "@quanghuy1242/idco-ui";
import { pointAtOffset } from "../../../core";
import {
  registerOverlay,
  resolveCommandList,
  useTransparentKeyboardRouting,
  type OverlaySurfaceContext,
  type ResolvedCommand,
} from "../../spi";
import { detectSlashTrigger, type SlashTrigger } from "./use-command-surfaces";

/**
 * Filter the resolved slash commands by the query (docs/024 §7.3). Pure: an empty query
 * returns the full list; otherwise an item matches when its label or any keyword contains the
 * query. `more`-placement items sort after `primary`. Exported for the slash-filter tests.
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

/** The filtered slash items for the live context + trigger query. */
function slashItems(
  ctx: OverlaySurfaceContext,
  trigger: SlashTrigger,
): readonly ResolvedCommand[] {
  return filterSlashItems(
    resolveCommandList("slash", ctx).flatMap((group) => group.items),
    trigger.query,
  );
}

/** The slash menu body, rendered by the authority's `caret` envelope (docs/029 R1-F). */
export function SlashMenuContent(props: {
  readonly ctx: OverlaySurfaceContext;
}) {
  const { ctx } = props;
  const { store } = ctx;
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const trigger = detectSlashTrigger(store);
  const items = trigger ? slashItems(ctx, trigger) : [];
  const safeIndex = items.length === 0 ? 0 : Math.min(index, items.length - 1);

  /** Select the `/query` text range so an insert collapses it (docs/024 §7.3). */
  const selectQueryRange = (t: SlashTrigger) => {
    const leaf = store.getNode(t.leafId);
    if (leaf?.kind !== "text") return;
    store.dispatch({
      origin: "local",
      selectionAfter: {
        anchor: pointAtOffset(t.leafId, leaf.content, t.slashPos),
        focus: pointAtOffset(t.leafId, leaf.content, t.caret),
        type: "text",
      },
      steps: [],
    });
  };

  const execute = (item: ResolvedCommand | undefined) => {
    if (!item || !trigger) return;
    selectQueryRange(trigger);
    if (item.command.group === "insert") {
      // The insert command collapses the selected `/query` and inserts — one undo.
      item.command.run?.(ctx);
    } else {
      // Turn-into does not consume a range, so the `/query` is removed first.
      store.command({ type: "delete-selection" });
      item.command.run?.(ctx);
    }
    ctx.dismiss();
    ctx.focusEditor();
  };

  // Focus-transparent keyboard routing (docs/029 §7.5): drive the list while the editor keeps
  // focus. Replaces this file's old bespoke document-capture handler.
  useTransparentKeyboardRouting(items.length > 0, {
    onArrow: (delta) =>
      setIndex((i) =>
        Math.min(Math.max(i + delta, 0), Math.max(0, items.length - 1)),
      ),
    onEnter: () => execute(items[safeIndex]),
    onEscape: () => {
      ctx.dismiss();
      ctx.focusEditor();
    },
  });

  // Reset the highlight when the query changes.
  useEffect(() => {
    setIndex(0);
  }, [trigger?.leafId, trigger?.query]);

  // Keep the highlighted row visible as the selection/query moves.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [safeIndex, trigger?.query]);

  if (items.length === 0) return null;

  return (
    <div
      data-engine-slash=""
      // Keep the editor focused: a click must not blur the EditContext host, so the executed
      // insert lands on the live model selection (docs/024 §7.3).
      onMouseDown={(event) => event.preventDefault()}
      ref={listRef}
    >
      <ListBox
        aria-label="Insert block"
        className="flex max-h-72 w-60 flex-col gap-0.5 overflow-y-auto outline-none"
        // `selectionMode="none"` + the collection-level `onAction` makes a single press
        // activate an item (the reliable click path); the highlight is driven by the §7.5
        // keyboard index, not RA selection, since the list never holds focus.
        onAction={(key) => execute(items.find((item) => item.id === key))}
        selectionMode="none"
      >
        {items.map((item, position) => (
          <ListBoxItem
            aria-selected={position === safeIndex}
            className={`flex cursor-pointer items-center gap-2.5 rounded-field px-3 py-2 text-sm outline-none ${
              position === safeIndex ? "bg-base-200" : "hover:bg-base-200"
            }`}
            id={item.id}
            key={item.id}
            textValue={item.command.label}
          >
            <NavIcon name={item.command.icon} />
            {item.command.label}
          </ListBoxItem>
        ))}
      </ListBox>
    </div>
  );
}

/** Register the slash menu as a `caret` overlay contributor (docs/029 R1-F). */
export function registerSlashOverlay(): void {
  registerOverlay({
    contentKind: "menu",
    focusMode: "transparent",
    id: "caret.slash",
    render: (ctx) => <SlashMenuContent ctx={ctx} />,
    target: "caret",
    // Raise only when a slash trigger exists AND it matches at least one command, so an
    // empty query (no matches) shows no empty box (docs/024 §7.3).
    when: (ctx) => {
      const trigger = detectSlashTrigger(ctx.store);
      if (!trigger) return false;
      return (
        filterSlashItems(
          resolveCommandList("slash", ctx).flatMap((group) => group.items),
          trigger.query,
        ).length > 0
      );
    },
  });
}
