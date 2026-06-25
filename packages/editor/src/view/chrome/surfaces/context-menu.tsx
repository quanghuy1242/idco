/**
 * Right-click context menu for the owned-model editor (docs/024 §7.1) — a pure
 * projection of `resolveCommandList("contextMenu", ctx)`, no literal item list.
 *
 * The *mechanism* is unchanged from docs/023: a React Aria `MenuTrigger` whose trigger
 * is a zero-size `fixed`-positioned button at the cursor. The *contents* are whatever the
 * resolver returns for the live scope — edit-ops, inline formats (on a selection), block
 * turn-into, the `annotate` group, and the scope's `structure`/`object` contributions (a
 * table cell's merge/fill/align) — merged into one menu (docs/024 §6.4), grouped in
 * `COMMAND_GROUP_ORDER`.
 *
 * Two robustness rules learned from real use:
 * - **Bounded height, single column.** A table-cell menu can be long (edit + blockStyle +
 *   list + indent + annotate + structure); the menu is `max-h` + `overflow-y-auto` so it
 *   never runs off the screen. DaisyUI's `.menu` is `flex-direction:column` *with
 *   `flex-wrap:wrap`*, which under a `max-height` wraps the overflow into a second column
 *   (the broken-width bug); `flex-nowrap` forces a single column that scrolls vertically.
 * - **No nested form-submenus.** A `popover`/`dropdown` command (link, fill color,
 *   vertical align, table layout) does NOT render its form inside a React Aria submenu:
 *   a submenu Dialog with an autoFocus field pulls focus out of the parent menu and
 *   collapses it. Instead the command renders as a normal `MenuItem` that, on click,
 *   closes the menu and opens its body in a *standalone* popover anchored at the cursor.
 *   The `more` commands stay a real menu-items submenu ("More").
 *
 * The controller (`useCommandSurfaces`) decides whether to open and yields to the native
 * menu only when nothing resolves (docs/024 §9). All commands dispatch the same store
 * commands the ribbon does.
 */
import { Fragment, useRef } from "react";
import {
  Button as AriaButton,
  Popover as AriaPopover,
  Separator,
  SubmenuTrigger,
} from "react-aria-components";
import { Menu, MenuItem, MenuTrigger, NavIcon } from "@quanghuy1242/idco-ui";
import type { EditorStore } from "../../../core";
import {
  resolveCommandList,
  useOverlayAuthorityRef,
  type CommandContext,
  type ResolvedCommand,
} from "../../spi";

// Positioning + animation only: the inner `Menu` (idco) already provides the bordered,
// padded, shadowed box, so the popover wrapper must NOT repeat border/bg/padding or it
// double-borders (the reported bug).
const SUBMENU_PANEL =
  "z-50 data-[entering]:animate-popover-in data-[exiting]:animate-popover-out";

export function EngineContextMenu(props: {
  readonly store: EditorStore;
  readonly ctx: CommandContext;
  /** The cursor point while the menu is open, or null when closed. */
  readonly pos: { readonly x: number; readonly y: number } | null;
  readonly close: () => void;
  readonly focusEditor: () => void;
}) {
  const { ctx, pos, close, focusEditor } = props;
  const authorityRef = useOverlayAuthorityRef();
  // Set true while a form-command is opening its body through the authority, so the menu's
  // own close does not bounce focus back to the editor and steal it from the form.
  const openingFormRef = useRef(false);

  // Resolve only while open. Partition each group into inline (`primary`) and the
  // single "More" overflow (`more`) the menu collects across groups (docs/024 §7.1).
  const groups = pos ? resolveCommandList("contextMenu", ctx) : [];
  const primaryGroups = groups
    .map((group) => ({
      group: group.group,
      items: group.items.filter((item) => item.placement === "primary"),
    }))
    .filter((group) => group.items.length > 0);
  const moreItems = groups.flatMap((group) =>
    group.items.filter((item) => item.placement === "more"),
  );

  /** Render one resolved command as a menu entry (button/toggle item, or a form-opener). */
  const renderCommand = (item: ResolvedCommand) => {
    const { command } = item;
    // A `popover`/`dropdown` command: a plain item that opens its body at the cursor through
    // the overlay authority (docs/029 R1-F) — `authority.openForm`, not a hand-rolled
    // standalone popover. The menu closes on action; the form takes focus next.
    if (command.render) {
      const render = command.render;
      return (
        <MenuItem
          id={item.id}
          isDisabled={item.disabled}
          key={item.id}
          onAction={() => {
            if (!pos) return;
            openingFormRef.current = true;
            authorityRef?.current?.openForm(pos.x, pos.y, (surface) =>
              render({ ...surface, close: surface.dismiss }),
            );
          }}
          textValue={command.label}
        >
          <span className="flex flex-1 items-center gap-2.5">
            <NavIcon name={command.icon} />
            {command.label}
          </span>
          <NavIcon name="ChevronRight" />
        </MenuItem>
      );
    }
    const danger = command.id === "edit.delete";
    return (
      <MenuItem
        id={item.id}
        isDisabled={item.disabled}
        key={item.id}
        onAction={() => {
          // Fire-and-forget: the menu closes itself on action (onOpenChange →
          // close + focusEditor). `run` may be async (paste); the model selection
          // survives the menu's focus so a late dispatch lands correctly (docs/024 §7.1).
          void command.run?.(ctx);
        }}
        textValue={command.label}
      >
        <span
          className={`flex items-center gap-2.5 ${
            item.active ? "text-primary" : ""
          } ${danger ? "text-error" : ""}`}
        >
          <NavIcon name={command.icon} />
          {command.label}
        </span>
      </MenuItem>
    );
  };

  const sections = primaryGroups.map((group, index) => (
    <Fragment key={group.group}>
      {index > 0 ? <Separator className="my-1 h-px bg-base-300" /> : null}
      {group.items.map(renderCommand)}
    </Fragment>
  ));

  return (
    <MenuTrigger
      isOpen={pos !== null}
      onOpenChange={(open) => {
        if (!open) {
          close();
          // React Aria restores focus to the trigger on close; bounce it back to the editing
          // surface so typing continues (docs/023 §8). Skipped when a form-command is opening
          // through the authority — that form owns focus next (docs/029 R1-F).
          const opening = openingFormRef.current;
          openingFormRef.current = false;
          requestAnimationFrame(() => {
            if (!opening) focusEditor();
          });
        }
      }}
      placement="bottom start"
    >
      {/* A zero-size, focus-excluded anchor at the cursor — the menu opens against it. */}
      <AriaButton
        aria-hidden="true"
        className="pointer-events-none fixed size-0 opacity-0"
        excludeFromTabOrder
        style={{ left: pos?.x ?? 0, top: pos?.y ?? 0 }}
      />
      <Menu
        aria-label="Editor actions"
        className="max-h-[70vh] w-56 flex-nowrap overflow-x-clip overflow-y-auto"
        data-engine-context-menu=""
      >
        {sections}
        {moreItems.length > 0 ? (
          <Fragment key="more">
            {sections.length > 0 ? (
              <Separator className="my-1 h-px bg-base-300" />
            ) : null}
            <SubmenuTrigger>
              <MenuItem id="__more" textValue="More">
                <span className="flex flex-1 items-center gap-2.5">
                  <NavIcon name="Plus" />
                  More
                </span>
                <NavIcon name="ChevronRight" />
              </MenuItem>
              <AriaPopover className={SUBMENU_PANEL} placement="right top">
                <Menu
                  aria-label="More actions"
                  className="max-h-[70vh] w-56 flex-nowrap overflow-x-clip overflow-y-auto"
                  data-engine-context-more=""
                >
                  {moreItems.map(renderCommand)}
                </Menu>
              </AriaPopover>
            </SubmenuTrigger>
          </Fragment>
        ) : null}
      </Menu>
    </MenuTrigger>
  );
}
