// DaisyUI 5: https://daisyui.com/components/modal/
// DaisyUI 5: https://daisyui.com/components/menu/
// React Aria: https://react-spectrum.adobe.com/react-aria/Dialog.html
// React Aria: https://react-spectrum.adobe.com/react-aria/ListBox.html
"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import {
  Dialog,
  Heading as DialogHeading,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import { Button } from "./button";
import { SearchInput } from "./search-input";
import { getActiveThemeName } from "./theme";

/**
 * A searchable command palette modal that groups selectable actions, built on
 * React Aria overlays and DaisyUI modal/menu styling.
 *
 * @categoryDefault Overlays
 */

/** A single selectable command row, keyed by `id` and rendered as `label`. */
export type CommandPaletteItem = {
  readonly id: string;
  readonly label: string;
  /** Trailing hint shown right-aligned, e.g. a keyboard shortcut. */
  readonly meta?: string;
  /** When true, the row is shown but cannot be activated. */
  readonly disabled?: boolean;
};

/** A labeled section of related command items within the palette. */
export type CommandPaletteGroup = {
  readonly id: string;
  /** Optional section heading; omit to render the items without a title. */
  readonly label?: string;
  readonly items: readonly CommandPaletteItem[];
};

/** Props for {@link CommandPalette}. */
type CommandPaletteProps = {
  /** Whether the palette modal is currently open (controlled). */
  readonly open: boolean;
  /** Called when the palette requests to open or close (e.g. dismissal). */
  readonly onOpenChange: (open: boolean) => void;
  readonly title?: string;
  /** Current search query (controlled). */
  readonly searchValue: string;
  /** Called when the user edits the search query. */
  readonly onSearchChange: (value: string) => void;
  readonly searchPlaceholder?: string;
  /** Grouped command items to display; filtering is owned by the consumer. */
  readonly groups: readonly CommandPaletteGroup[];
  /** Text shown when no groups contain items. */
  readonly emptyMessage?: string;
  readonly closeLabel?: string;
  /** Called with the `id` of the item the user activated. */
  readonly onAction: (id: string) => void;
};

/**
 * A searchable, grouped command launcher modal that calls `onAction` with the
 * selected item id. Search and filtering are controlled by the consumer.
 *
 * @example
 * ```tsx
 * <CommandPalette
 *   open={open}
 *   onOpenChange={setOpen}
 *   searchValue={query}
 *   onSearchChange={setQuery}
 *   groups={[{ id: "nav", label: "Navigate", items: [{ id: "home", label: "Go home" }] }]}
 *   onAction={(id) => run(id)}
 * />
 * ```
 */
export function CommandPalette({
  open,
  onOpenChange,
  title = "Command Palette",
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search commands",
  groups,
  emptyMessage = "No commands found",
  closeLabel = "Close",
  onAction,
}: CommandPaletteProps) {
  const [themeName, setThemeName] = useState("idco-light");
  const hasItems = groups.some((group) => group.items.length > 0);
  const actionById = useMemo(() => {
    const map = new Set<string>();
    for (const group of groups) {
      for (const item of group.items) {
        map.add(item.id);
      }
    }
    return map;
  }, [groups]);

  useLayoutEffect(() => {
    setThemeName(getActiveThemeName());
  }, [open]);

  return (
    <ModalOverlay
      isOpen={open}
      onOpenChange={onOpenChange}
      isDismissable
      className="modal modal-open bg-black/40 data-[entering]:animate-modal-overlay-in data-[exiting]:animate-modal-overlay-out"
    >
      <Modal
        data-theme={themeName}
        className="modal-box max-w-2xl p-0 data-[entering]:animate-modal-panel-in data-[exiting]:animate-modal-panel-out"
      >
        <Dialog className="outline-none">
          {({ close }) => (
            <div className="flex max-h-[min(38rem,calc(100vh-4rem))] flex-col">
              <div className="border-b border-base-300 p-4">
                <DialogHeading slot="title" className="sr-only">
                  {title}
                </DialogHeading>
                <SearchInput
                  value={searchValue}
                  onChange={onSearchChange}
                  placeholder={searchPlaceholder}
                />
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {hasItems ? (
                  groups.map((group) =>
                    group.items.length > 0 ? (
                      <section key={group.id}>
                        {group.label ? (
                          <p className="menu-title px-3 py-2 text-xs uppercase tracking-wide text-base-content/50">
                            {group.label}
                          </p>
                        ) : null}
                        <ListBox
                          aria-label={group.label ?? title}
                          items={group.items}
                          onAction={(key) => {
                            const id = String(key);
                            if (!actionById.has(id)) return;
                            onAction(id);
                          }}
                          className="menu menu-sm w-full gap-1"
                        >
                          {(item) => (
                            <ListBoxItem
                              id={item.id}
                              textValue={item.label}
                              isDisabled={item.disabled}
                              className="rounded-field cursor-pointer px-3 py-2 text-base-content outline-none hover:bg-base-200 focus:bg-base-200 data-[focused]:bg-base-200 data-[selected]:bg-primary data-[selected]:text-primary-content data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                            >
                              <span className="flex min-w-0 items-center justify-between gap-3">
                                <span className="truncate">{item.label}</span>
                                {item.meta ? (
                                  <span className="shrink-0 text-xs text-base-content/50 group-data-[selected]:text-primary-content/80">
                                    {item.meta}
                                  </span>
                                ) : null}
                              </span>
                            </ListBoxItem>
                          )}
                        </ListBox>
                      </section>
                    ) : null,
                  )
                ) : (
                  <p className="px-3 py-8 text-center text-sm text-base-content/60">
                    {emptyMessage}
                  </p>
                )}
              </div>
              <div className="flex justify-end border-t border-base-300 p-3">
                <Button variant="ghost" size="sm" onClick={close}>
                  {closeLabel}
                </Button>
              </div>
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
