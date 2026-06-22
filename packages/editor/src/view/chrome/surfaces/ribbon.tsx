/**
 * Editor chrome: the ribbon-lite formatting toolbar (docs/023).
 *
 * Layer 3 of the toolbar SPI (docs/023 §5.1): the renderer. It holds **zero**
 * command or layout knowledge — all of it flows in as data from the descriptor
 * registries (Layer 1) through the pure `computeToolbarLayout` (Layer 2). This
 * component only: derives the live `CommandContext` (selection facts +
 * capabilities) under the toolbar's selection+commit subscription, computes the
 * resolved layout, owns the active-tab state, and renders tabs (React Aria `Tabs`,
 * DaisyUI `tabs-border` underline style) + the active tab's slots + each item by
 * `kind`. It owns responsive collapse (no-wrap horizontal scroll so the row never
 * wraps into a second line, docs/023 §6.4) and overlay focus, nothing else.
 *
 * Built with `@idco/ui` (React Aria behavior + DaisyUI styling + lucide icons): no
 * hand-rolled menus/popovers/tabs. Every control operates on the engine's *model*
 * selection through `store.command`/`store.query`, never the DOM (docs/010 §7.1).
 *
 * Focus integration (docs/017 §3.5/§3.6, docs/023 §8): the engine owns focus via
 * the EditContext host and the model selection survives focus loss (011 §8.6), so a
 * toolbar press does not blur the editing surface (a capture-phase `mousedown`
 * preventDefault on the bar), and after a command we return focus to the block the
 * selection now names via `focusEditor`. A `popover` action needs no saved-selection
 * machinery: the model selection it reads on apply is the one alive across the
 * overlay's focus, so an "insert at cursor" / "apply to selection" lands correctly.
 * docs/023 §8 anticipated a control-surface allowlist so a toolbar overlay would not
 * disable the editor; the owned engine gates only the *painted caret* on focus-within
 * (cosmetic — `selection-overlay`), never command dispatch or the model, so the caret
 * simply hides while a modal React Aria popover holds focus (identical to the
 * pre-existing link popover) and no allowlist is needed.
 *
 * Adding a control is registration, not an edit here: a host registers a
 * `Command`/tab/slot (docs/023 §5.8) and it appears; this file never grows a
 * branch for it.
 */
import { Fragment, useCallback, useState, type ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  NavIcon,
  PopoverTrigger,
  Tabs,
} from "@quanghuy1242/idco-ui";
import type { EditorStore } from "../../../core";
import { useStoreVersion } from "./use-store-version";
import {
  buildCommandContext,
  computeToolbarLayout,
  DEFAULT_TOOLBAR_LAYOUT,
  listBlockTypes,
  type CommandContext,
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
  const ctx: CommandContext = buildCommandContext(store, capabilities);
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

  const renderItem = (item: ResolvedToolbarItem): ReactNode => {
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
              ariaLabel={meta.label}
              iconName={meta.icon}
              onClick={() =>
                run(() =>
                  store.command({ mark: item.mark.kind, type: "toggle-mark" }),
                )
              }
              size="sm"
              square
              tooltip={meta.label}
              variant={item.active ? "primary" : "ghost"}
            />
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
            iconName={item.icon}
            key={item.id}
            onClick={() => run(() => item.run(store))}
            size="sm"
            square
            tooltip={item.label}
            variant="ghost"
          />
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
                    ariaLabel={action.label}
                    disabled={item.disabled}
                    iconName={action.icon}
                    size="sm"
                    square
                    tooltip={action.label}
                    variant={item.active ? "primary" : "ghost"}
                  />
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
              ariaLabel={action.label}
              disabled={item.disabled}
              iconName={action.icon}
              onClick={() => run(() => action.run?.(ctx))}
              size="sm"
              square
              tooltip={action.label}
              variant={item.active ? "primary" : "ghost"}
            />
          </span>
        );
      }
      case "component":
        return <Fragment key={item.id}>{item.render(ctx)}</Fragment>;
    }
  };

  // Render a run of slots (separated by dividers) — used for both the active tab's
  // command row and the persistent quick-access zones.
  const renderZone = (slots: readonly ResolvedToolbarSlot[]): ReactNode =>
    slots.map((slot, index) => (
      <Fragment key={slot.id}>
        {index > 0 ? <Sep /> : null}
        {slot.items.map((item) => renderItem(item))}
      </Fragment>
    ));

  const tabItems = layout.tabs.map((tab: ResolvedToolbarTab) => ({
    id: tab.id,
    label: tab.label,
  }));
  const hasStart = layout.persistentStart.length > 0;
  const hasEnd = layout.persistentEnd.length > 0;

  return (
    <div
      aria-label="Formatting toolbar"
      className={`border-b border-base-300 bg-base-100 ${props.className ?? ""}`}
      data-engine-toolbar=""
      // Pressing a toolbar control must not blur the editing host; model selection
      // survives focus loss, and we restore focus after the command.
      onMouseDownCapture={(event) => event.preventDefault()}
      role="toolbar"
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

      {/* The active tab's command row. `flex-nowrap` + `overflow-x-auto` is the
          responsive guarantee (docs/023 §6.4): the row scrolls under width pressure
          rather than wrapping into a noisy second line. */}
      {activeTab ? (
        <div
          aria-label={`${activeTab.label} controls`}
          className="flex flex-nowrap items-center gap-0.5 overflow-x-auto p-1"
          role="group"
        >
          {activeTab.slots.map((slot, index) => (
            <Fragment key={slot.id}>
              {index > 0 ? <Sep /> : null}
              {slot.items.map((item) => renderItem(item))}
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
