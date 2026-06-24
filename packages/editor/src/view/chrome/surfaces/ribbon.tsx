/**
 * Editor chrome: the ribbon-lite formatting toolbar (docs/023, note.md toolbar SPI).
 *
 * Layer 3 of the toolbar SPI (docs/023 §5.1): the renderer. It holds **zero**
 * command or layout knowledge — all of it flows in as data from the descriptor
 * registries (Layer 1) through the pure `computeToolbarLayout` (Layer 2). This
 * component only: derives the live `CommandContext` (selection facts +
 * capabilities) under the toolbar's selection+commit subscription, computes the
 * resolved layout, owns the active-tab state, and renders tabs (React Aria `Tabs`,
 * DaisyUI `tabs-border` underline style) + the active tab's slots + each item by
 * `kind`.
 *
 * Presentation + responsive behavior (note.md "the knob lives on the slot"): each
 * resolved slot carries a `display` — `"icon"` (dense icon-only run, hover tooltips),
 * `"labelled"` (static icon + text), or `"auto"` (labelled, then collapse the
 * lowest-priority collapsible controls into a trailing overflow `Menu` under desktop
 * width pressure). The collapse engine is `useResponsiveCollapse` (`@idco/ui`),
 * measuring a hidden proxy layer; the renderer reads `display` blind. Mobile
 * (`max-width: 767px`) opts out of collapse and horizontally scrolls the row instead
 * (note.md "Mobile is horizontal scroll"): on touch there is no hover, so an overflow
 * menu of bare-glyph formatting controls is a worse affordance than a swipeable row.
 *
 * Accessibility (note.md §1): the active-tab command row is a React Aria `Toolbar`
 * (`role="toolbar"` + arrow-key roving focus), so a keyboard user reaches the row in
 * one Tab stop and arrows across it, instead of tabbing through every button. The
 * outer bar is a plain labelled container, not a second (nested) toolbar.
 *
 * Built with `@idco/ui` (React Aria behavior + DaisyUI styling + lucide icons): no
 * hand-rolled menus/popovers/tabs. Every control operates on the engine's *model*
 * selection through `store.command`/`store.query`, never the DOM (docs/010 §7.1).
 *
 * Focus integration (docs/017 §3.5/§3.6, docs/023 §8): the engine owns focus via
 * the EditContext host and the model selection survives focus loss (011 §8.6), so a
 * toolbar press does not blur the editing surface (a capture-phase `mousedown`
 * preventDefault on the bar), and after a command we return focus to the block the
 * selection now names via `focusEditor`. The overflow `Menu`'s collapsed items route
 * their action through the same `run(...)` wrapper, so a command fired from the
 * overflow refocuses the editor exactly like an inline press (note.md §"Focus
 * restoration"). A `popover` action needs no saved-selection machinery: the model
 * selection it reads on apply is the one alive across the overlay's focus, so an
 * "insert at cursor" / "apply to selection" lands correctly.
 *
 * Adding a control is registration, not an edit here: a host registers a
 * `Command`/tab/slot (docs/023 §5.8) and it appears; this file never grows a
 * branch for it.
 */
import { Fragment, useCallback, useState, type ReactNode } from "react";
import {
  Button as AriaButton,
  Toolbar as AriaToolbar,
} from "react-aria-components";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  NavIcon,
  PopoverTrigger,
  Tabs,
  useResponsiveCollapse,
  type CollapseItem,
} from "@quanghuy1242/idco-ui";
import type { EditorStore } from "../../../core";
import { useStoreVersion } from "./use-store-version";
import { useIsMobile } from "./use-is-mobile";
import {
  buildCommandContext,
  computeToolbarLayout,
  DEFAULT_TOOLBAR_LAYOUT,
  listBlockTypes,
  type CommandContext,
  type PanelHost,
  type ResolvedToolbarItem,
  type ResolvedToolbarSlot,
  type ResolvedToolbarTab,
  type ToolbarCapabilities,
  type ToolbarLayoutConfig,
} from "../../spi";

// The format marks, block-type chooser, and insert affordances project from the
// W4/W5/SPI registries; every other control is a registered `Command`
// (docs/023). The renderer reads only the resolved layout, so the toolbar and the
// context menu (which reads the same registries) cannot drift.

// First-release capability defaults (docs/023 §5.6): the standard product ships
// Insert→Table; media/review/ai are off so those tabs resolve empty and are dropped.
const DEFAULT_CAPABILITIES: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: false,
  review: false,
};

/** A thin divider between toolbar slots. */
function Sep() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-base-300" />;
}

/** A label + its optional shortcut hint, e.g. "Bold (Ctrl/Cmd+B)". */
function withShortcut(label: string, shortcut?: string): string {
  return shortcut ? `${label} (${shortcut})` : label;
}

/** One entry in the active tab's command row: a resolved item + its slot presentation. */
type RowEntry = {
  readonly slotId: string;
  readonly item: ResolvedToolbarItem;
  /** Slot renders icon + text (display "labelled"/"auto"), not a bare icon. */
  readonly labelled: boolean;
  /** Eligible to collapse into the overflow menu (auto slot + a menu-item kind). */
  readonly collapsible: boolean;
};

/** Icon + label + optional shortcut for a collapsible item's overflow MenuItem. */
function collapsedMeta(item: ResolvedToolbarItem): {
  icon: string;
  label: string;
  shortcut?: string;
  disabled: boolean;
} {
  switch (item.kind) {
    case "mark": {
      const meta = item.mark.toolbar!;
      return {
        disabled: item.disabled,
        icon: meta.icon,
        label: meta.label,
        shortcut: meta.shortcut,
      };
    }
    case "insert":
      return { disabled: item.disabled, icon: item.icon, label: item.label };
    case "action":
      return {
        disabled: item.disabled,
        icon: item.action.icon,
        label: item.action.label,
        shortcut: item.action.shortcut,
      };
    default:
      return { disabled: false, icon: "Plus", label: "" };
  }
}

// A fixed-width, non-interactive proxy of an inline control for the hidden measure
// layer (note.md §"hidden measurement layer"): we measure the width an item *wants*,
// never the live row (whose collapsed items are removed). Interactive kinds render a
// disabled `Button` matching the inline shape; the wide block-type chooser and an
// opaque host `component` render a same-width placeholder.
function renderProxy(entry: RowEntry): ReactNode {
  const { item, labelled } = entry;
  let inner: ReactNode;
  switch (item.kind) {
    case "mark": {
      const meta = item.mark.toolbar!;
      inner = (
        <Button
          disabled
          iconName={meta.icon}
          size="sm"
          square={!labelled}
          variant="ghost"
        >
          {labelled ? meta.label : undefined}
        </Button>
      );
      break;
    }
    case "insert":
      inner = (
        <Button
          disabled
          iconName={item.icon}
          size="sm"
          square={!labelled}
          variant="ghost"
        >
          {labelled ? item.label : undefined}
        </Button>
      );
      break;
    case "action":
      inner = (
        <Button
          disabled
          iconName={item.action.icon}
          size="sm"
          square={!labelled}
          variant="ghost"
        >
          {labelled ? item.action.label : undefined}
        </Button>
      );
      break;
    case "blockType":
      inner = <span aria-hidden="true" className="btn btn-sm btn-ghost w-40" />;
      break;
    case "component":
      inner = (
        <span aria-hidden="true" className="btn btn-sm btn-square btn-ghost" />
      );
      break;
  }
  return (
    <span
      className="shrink-0 whitespace-nowrap"
      data-collapse-id={item.id}
      key={item.id}
    >
      {inner}
    </span>
  );
}

export function EditorToolbar(props: {
  readonly store: EditorStore;
  readonly focusEditor: () => void;
  /** Open the find card (wired to the same Ctrl/Cmd+F controller). */
  readonly onFind?: () => void;
  readonly className?: string;
  /** Replace/patch the built-in tab→slot→item arrangement (docs/023 §6.3). */
  readonly layout?: ToolbarLayoutConfig;
  /** Per-deployment capability flags (docs/023 §5.6); merged over the defaults. */
  readonly capabilities?: Partial<ToolbarCapabilities>;
  /** The dock seam so a tab command (View → Outline, Review → …) can open a pane. */
  readonly panelHost?: PanelHost;
}) {
  const { store, focusEditor, onFind } = props;
  // Re-read query state whenever selection or content changes.
  useStoreVersion(store);

  const run = useCallback(
    (action: () => void) => {
      action();
      focusEditor();
    },
    [focusEditor],
  );

  // Build the live context and resolve the layout. computeToolbarLayout is pure, so
  // the whole surface is a function of model state — the unit-testable heart.
  // `as` reconciles the spread of an optional `Partial` (whose values are
  // `boolean | undefined`) with the capability map's `[key: string]: boolean`
  // index signature; every concrete key is still a boolean after the merge.
  const capabilities = {
    ...DEFAULT_CAPABILITIES,
    ...props.capabilities,
  } as ToolbarCapabilities;
  const ctx: CommandContext = buildCommandContext(
    store,
    capabilities,
    props.panelHost,
  );
  // Find is a document-global utility, so it lives in the persistent `end` zone like
  // any other global control — but its handler is a host prop (`onFind`), not a store
  // command, so it can't be a self-registered action. Inject it as a `component` item
  // into the persistent `global.utilities` slot when the host wires find; this keeps
  // its placement SPI-driven (ordered in the zone, hideable by id) while the find
  // controller stays in the host (docs/023 §7.1). Omitted when `onFind` is absent, so
  // the slot resolves empty and is dropped.
  const baseConfig = props.layout ?? DEFAULT_TOOLBAR_LAYOUT;
  const config: ToolbarLayoutConfig = onFind
    ? {
        ...baseConfig,
        items: [
          ...baseConfig.items,
          {
            id: "find",
            kind: "component",
            render: () => (
              <Button
                ariaKeyShortcuts="Ctrl/Cmd+F"
                ariaLabel="Find in document"
                iconName="Search"
                onClick={onFind}
                size="sm"
                square
                tooltip="Find (Ctrl/Cmd+F)"
                variant="ghost"
              />
            ),
            slot: "global.utilities",
          },
        ],
      }
    : baseConfig;
  const layout = computeToolbarLayout(ctx, config);

  // Active tab is local UI state; if the resolved tab set no longer contains it
  // (capabilities/layout changed), fall back to the layout's default so the row is
  // never blank (docs/023 §6.4 "responsive preserves the active tab").
  const [selectedTab, setSelectedTab] = useState(layout.defaultTab);
  const activeTabId = layout.tabs.some((tab) => tab.id === selectedTab)
    ? selectedTab
    : layout.defaultTab;
  const activeTab = layout.tabs.find((tab) => tab.id === activeTabId);

  // The block-type chooser shows the *current* style by name. Heading level rides on
  // the `tag` attr, so match on both type and tag to tell Heading 1/2/3 apart.
  const blockTypes = listBlockTypes().filter((entry) => entry.chooser);
  const sel = store.selection;
  const currentBlockType = store.query({ type: "current-block-type" });
  const listActive = currentBlockType === "listitem";
  const focusNode = sel?.type === "text" ? store.getNode(sel.focus.node) : null;
  const currentTag =
    focusNode?.kind === "text" && typeof focusNode.attrs?.tag === "string"
      ? focusNode.attrs.tag
      : undefined;
  const currentBlock =
    blockTypes.find(
      (choice) =>
        choice.blockType === currentBlockType &&
        (choice.tag ?? undefined) === currentTag,
    ) ??
    (listActive
      ? { icon: "List", label: "List item" }
      : { icon: "Pilcrow", label: "Paragraph" });

  // --- Responsive collapse wiring (note.md auto → overflow menu) ----------------
  // Flatten the active tab's slots into one ordered run, tagging each item with how
  // its slot presents (`labelled`) and whether it may collapse (`auto` slot + a
  // menu-item kind). The collapse engine measures a hidden proxy layer and returns
  // which ids to push into the overflow menu; the rest scroll on mobile or when no
  // slot is `auto`.
  const rowEntries: readonly RowEntry[] = activeTab
    ? activeTab.slots.flatMap((slot) => {
        const labelled = slot.display === "labelled" || slot.display === "auto";
        return slot.items.map((item) => ({
          collapsible:
            slot.display === "auto" && item.collapsible === "menu-item",
          item,
          labelled,
          slotId: slot.id,
        }));
      })
    : [];

  const isMobile = useIsMobile();
  const collapseEnabled = !isMobile && rowEntries.some((e) => e.collapsible);
  const collapseItems: readonly CollapseItem[] = rowEntries.map((e) => ({
    collapsible: e.collapsible,
    id: e.item.id,
    priority: e.item.priority,
  }));
  // Re-measure when the row's item set or its labels change (widths move). Active/
  // disabled state does not change a control's width, so it is not in the signature.
  const signature = `${activeTabId}|${rowEntries
    .map((e) => `${e.item.id}:${e.labelled ? 1 : 0}:${e.collapsible ? 1 : 0}`)
    .join(",")}`;
  const { collapsedIds, containerRef, measureRef, listRef } =
    useResponsiveCollapse({
      enabled: collapseEnabled,
      items: collapseItems,
      signature,
    });

  /** The store mutation a collapsed item runs from the overflow menu (or null). */
  const collapsedRun = (item: ResolvedToolbarItem): (() => void) | null => {
    switch (item.kind) {
      case "mark":
        return () =>
          store.command({ mark: item.mark.kind, type: "toggle-mark" });
      case "insert":
        return () => item.run(store);
      case "action":
        return item.action.run ? () => item.action.run!(ctx) : null;
      default:
        // blockType/component never carry `collapsible: "menu-item"`, so they do not
        // reach the overflow menu; satisfy the switch exhaustively.
        return null;
    }
  };

  const renderItem = (
    item: ResolvedToolbarItem,
    labelled: boolean,
  ): ReactNode => {
    switch (item.kind) {
      case "mark": {
        const meta = item.mark.toolbar!;
        return (
          <span
            data-engine-format={item.mark.kind}
            data-engine-format-active={item.active ? "true" : "false"}
            key={item.id}
          >
            <Button
              ariaKeyShortcuts={meta.shortcut}
              ariaLabel={meta.label}
              disabled={item.disabled}
              iconName={meta.icon}
              onClick={() =>
                run(() =>
                  store.command({ mark: item.mark.kind, type: "toggle-mark" }),
                )
              }
              size="sm"
              square={!labelled}
              tooltip={
                labelled
                  ? meta.shortcut
                  : withShortcut(meta.label, meta.shortcut)
              }
              variant={item.active ? "primary" : "ghost"}
            >
              {labelled ? meta.label : undefined}
            </Button>
          </span>
        );
      }
      case "blockType":
        return (
          <span data-engine-block-type-menu="" key={item.id}>
            <MenuTrigger placement="bottom start">
              {/* Labeled dropdown (icon + current style name + chevron). */}
              <AriaButton
                aria-label="Text style"
                className="btn btn-sm btn-ghost w-40 justify-start gap-2"
                data-engine-block-type-trigger=""
                isDisabled={item.disabled}
                onMouseDown={(event) => event.preventDefault()}
              >
                <NavIcon name={currentBlock.icon} />
                <span className="flex-1 truncate text-left">
                  {currentBlock.label}
                </span>
                <NavIcon name="ChevronDown" />
              </AriaButton>
              <Menu
                className="w-56"
                onAction={(key) => {
                  const choice = blockTypes.find((c) => c.id === key);
                  if (choice) {
                    run(() =>
                      store.command({
                        blockType: choice.blockType,
                        ...(choice.tag ? { tag: choice.tag } : {}),
                        type: "set-block-type",
                      }),
                    );
                  }
                }}
              >
                {blockTypes.map((choice) => (
                  <MenuItem
                    id={choice.id}
                    key={choice.id}
                    textValue={choice.label}
                  >
                    <span className="flex items-center gap-3">
                      <NavIcon name={choice.icon} />
                      <span className={`leading-tight ${choice.preview ?? ""}`}>
                        {choice.label}
                      </span>
                    </span>
                  </MenuItem>
                ))}
              </Menu>
            </MenuTrigger>
          </span>
        );
      case "insert":
        return (
          <Button
            ariaLabel={item.label}
            disabled={item.disabled}
            iconName={item.icon}
            key={item.id}
            onClick={() => run(() => item.run(store))}
            size="sm"
            square={!labelled}
            tooltip={labelled ? undefined : item.label}
            variant="ghost"
          >
            {labelled ? item.label : undefined}
          </Button>
        );
      case "action": {
        const { action } = item;
        if (action.kind === "popover" || action.kind === "dropdown") {
          return (
            <span data-engine-toolbar-action={action.id} key={item.id}>
              <PopoverTrigger
                ariaLabel={action.label}
                onOpenChange={(open) => {
                  // React Aria restores focus to the trigger on close; bounce it
                  // back to the editing surface instead (docs/017 §3.5).
                  if (!open) requestAnimationFrame(() => focusEditor());
                }}
                trigger={
                  <Button
                    ariaKeyShortcuts={action.shortcut}
                    ariaLabel={action.label}
                    disabled={item.disabled}
                    iconName={action.icon}
                    size="sm"
                    square={!labelled}
                    tooltip={
                      labelled
                        ? action.shortcut
                        : withShortcut(action.label, action.shortcut)
                    }
                    variant={item.active ? "primary" : "ghost"}
                  >
                    {labelled ? action.label : undefined}
                  </Button>
                }
              >
                {(close) => action.render?.({ ...ctx, close }) ?? null}
              </PopoverTrigger>
            </span>
          );
        }
        return (
          <span data-engine-toolbar-action={action.id} key={item.id}>
            <Button
              ariaKeyShortcuts={action.shortcut}
              ariaLabel={action.label}
              disabled={item.disabled}
              iconName={action.icon}
              onClick={() => run(() => action.run?.(ctx))}
              size="sm"
              square={!labelled}
              tooltip={
                labelled
                  ? action.shortcut
                  : withShortcut(action.label, action.shortcut)
              }
              variant={item.active ? "primary" : "ghost"}
            >
              {labelled ? action.label : undefined}
            </Button>
          </span>
        );
      }
      case "component":
        return <Fragment key={item.id}>{item.render(ctx)}</Fragment>;
    }
  };

  const tabItems = layout.tabs.map((tab: ResolvedToolbarTab) => ({
    id: tab.id,
    label: tab.label,
  }));
  const hasStart = layout.persistentStart.length > 0;
  const hasEnd = layout.persistentEnd.length > 0;

  // Split the row into the inline groups (kept in slot order, separated) and the
  // collapsed tail. Only `auto`-slot menu-item kinds ever land in `collapsedIds`.
  const inlineGroups = (activeTab?.slots ?? [])
    .map((slot) => ({
      entries: rowEntries.filter(
        (e) => e.slotId === slot.id && !collapsedIds.has(e.item.id),
      ),
      slot,
    }))
    .filter((group) => group.entries.length > 0);
  const collapsedEntries = rowEntries.filter((e) =>
    collapsedIds.has(e.item.id),
  );

  // Render a run of persistent slots (separated by dividers) for the quick-access zones.
  const renderZone = (slots: readonly ResolvedToolbarSlot[]): ReactNode =>
    slots.map((slot, index) => (
      <Fragment key={slot.id}>
        {index > 0 ? <Sep /> : null}
        {slot.items.map((item) => renderItem(item, false))}
      </Fragment>
    ));

  return (
    <div
      aria-label="Editor toolbar"
      className={`border-b border-base-300 bg-base-100 ${props.className ?? ""}`}
      data-engine-toolbar=""
      // Pressing a toolbar control must not blur the editing host; model selection
      // survives focus loss, and we restore focus after the command.
      onMouseDownCapture={(event) => event.preventDefault()}
      role="group"
    >
      {/* Tab strip + the persistent quick-access zones: undo/redo (start) sit left of
          the tabs in the QAT position, find (end) is pushed to the right. These show
          on every tab (docs/023 §7.1). */}
      <div className="flex items-center gap-1 px-1">
        {hasStart ? (
          <div className="flex items-center gap-0.5">
            {renderZone(layout.persistentStart)}
          </div>
        ) : null}
        {hasStart && tabItems.length > 0 ? <Sep /> : null}
        {tabItems.length > 0 ? (
          <Tabs
            ariaLabel="Toolbar tabs"
            items={tabItems}
            onSelectionChange={setSelectedTab}
            selectedKey={activeTabId}
            size="sm"
            variant="border"
          />
        ) : null}
        {hasEnd ? (
          <div className="ml-auto flex items-center gap-0.5">
            {renderZone(layout.persistentEnd)}
          </div>
        ) : null}
      </div>

      {/* The active tab's command row — a React Aria `Toolbar` (roving arrow-key focus,
          note.md §1). The hidden measure layer sits beside it (collapse mode only); the
          row collapses its overflow tail into a trailing `Menu` on desktop and
          horizontal-scrolls on mobile / when no slot is `auto`. */}
      {activeTab ? (
        <div
          className="relative min-w-0 overflow-hidden p-1"
          ref={containerRef}
        >
          {collapseEnabled ? (
            <div
              aria-hidden="true"
              className="invisible pointer-events-none absolute left-0 top-0 flex h-0 items-center gap-0.5 overflow-hidden whitespace-nowrap"
              ref={measureRef}
            >
              {rowEntries.map(renderProxy)}
              <span className="shrink-0" data-collapse-menu="">
                <Button
                  disabled
                  iconName="Ellipsis"
                  size="sm"
                  square
                  variant="ghost"
                />
              </span>
            </div>
          ) : null}
          <AriaToolbar
            aria-label="Formatting toolbar"
            className={`flex flex-nowrap items-center gap-0.5 ${
              collapseEnabled ? "" : "overflow-x-auto"
            }`}
            ref={listRef}
          >
            {inlineGroups.map((group, index) => (
              <Fragment key={group.slot.id}>
                {index > 0 ? <Sep /> : null}
                {group.entries.map((entry) =>
                  renderItem(entry.item, entry.labelled),
                )}
              </Fragment>
            ))}
            {collapsedEntries.length > 0 ? (
              <Fragment>
                {inlineGroups.length > 0 ? <Sep /> : null}
                <MenuTrigger>
                  <Button
                    ariaLabel="More controls"
                    iconName="Ellipsis"
                    size="sm"
                    square
                    tooltip="More controls"
                    variant="ghost"
                  />
                  <Menu
                    aria-label="More controls"
                    onAction={(key) => {
                      const entry = collapsedEntries.find(
                        (e) => e.item.id === String(key),
                      );
                      if (!entry) return;
                      const action = collapsedRun(entry.item);
                      if (action) run(action);
                    }}
                  >
                    {collapsedEntries.map((entry) => {
                      const meta = collapsedMeta(entry.item);
                      return (
                        <MenuItem
                          id={entry.item.id}
                          isDisabled={meta.disabled}
                          key={entry.item.id}
                          textValue={meta.label}
                        >
                          <span className="flex w-full items-center gap-3">
                            <NavIcon name={meta.icon} />
                            <span className="flex-1">{meta.label}</span>
                            {meta.shortcut ? (
                              <span className="text-xs opacity-60">
                                {meta.shortcut}
                              </span>
                            ) : null}
                          </span>
                        </MenuItem>
                      );
                    })}
                  </Menu>
                </MenuTrigger>
              </Fragment>
            ) : null}
          </AriaToolbar>
        </div>
      ) : null}
    </div>
  );
}
