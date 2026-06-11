// DaisyUI 5: https://daisyui.com/components/dropdown/
"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Autocomplete,
  Button as AriaButton,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
  SearchField,
  Tag,
  TagGroup,
  TagList,
  type Key,
} from "react-aria-components";
import { useFilter } from "react-aria";
import { useAsyncList } from "react-stately";
import { ChevronDown } from "lucide-react";
import { Avatar } from "./avatar";

export type ResourceKind =
  | "user"
  | "organization"
  | "team"
  | "member"
  | "media";

export type ResourceOption = {
  readonly id: string;
  readonly label: string;
  readonly sublabel?: string;
  readonly image?: string | null;
  readonly badge?: string;
};

export type ResourceSource =
  | {
      readonly mode: "async";
      readonly load: (
        query: string,
        signal: AbortSignal,
      ) => Promise<ResourceOption[]>;
    }
  | { readonly mode: "sync"; readonly items: ReadonlyArray<ResourceOption> };

type ResourceSelectorProps = {
  readonly kind: ResourceKind;
  readonly selectionMode?: "single" | "multiple";
  readonly value: string | ReadonlyArray<string>;
  readonly onChange: (next: string | string[]) => void;
  readonly source: ResourceSource;
  readonly placeholder?: string;
  readonly label?: string;
  readonly showLabel?: boolean;
  readonly name?: string;
  readonly excludeIds?: ReadonlyArray<string>;
  readonly renderOption?: (option: ResourceOption) => ReactNode;
  readonly size?: "sm" | "md";
  readonly variant?: "inline" | "menu";
  readonly width?: "full" | "compact";
};

function defaultRenderOption(
  kind: ResourceKind,
  option: ResourceOption,
): ReactNode {
  const withAvatar = kind === "user" || kind === "member";
  return (
    <div className="flex items-center gap-3">
      {withAvatar ? (
        <Avatar
          size="sm"
          image={option.image ?? undefined}
          initials={option.label}
        />
      ) : null}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-base-content">{option.label}</span>
        {option.sublabel ? (
          <span className="truncate text-xs text-base-content/50">
            {option.sublabel}
          </span>
        ) : null}
      </div>
      {option.badge ? (
        <span className="badge badge-outline badge-sm ml-auto">
          {option.badge}
        </span>
      ) : null}
    </div>
  );
}

export function ResourceSelector({
  kind,
  selectionMode = "single",
  value,
  onChange,
  source,
  placeholder = "Search…",
  label,
  showLabel,
  name,
  excludeIds = [],
  renderOption,
  size = "md",
  variant = "inline",
  width = "full",
}: ResourceSelectorProps) {
  const { contains } = useFilter({ sensitivity: "base" });
  const [cache, setCache] = useState<Record<string, ResourceOption>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const fieldLabel = label ?? `Search ${kind}s`;

  const list = useAsyncList<ResourceOption>({
    async load({ signal, filterText }) {
      if (source.mode === "async") {
        const items = await source.load(filterText ?? "", signal);
        return { items };
      }
      return { items: [...source.items] };
    },
  });

  const selectedIds = Array.isArray(value) ? value : value ? [value] : [];
  const selectedSet = new Set(selectedIds);
  const hidden = new Set([
    ...excludeIds,
    ...(selectionMode === "multiple" ? selectedIds : []),
  ]);
  const sourceItems = source.mode === "sync" ? source.items : list.items;
  const query = list.filterText.trim();
  const filteredItems =
    source.mode === "sync" && query !== ""
      ? sourceItems.filter((o) =>
          [o.label, o.sublabel, o.badge].some((text) =>
            text ? contains(text, query) : false,
          ),
        )
      : sourceItems;
  const items = filteredItems.filter((o) => !hidden.has(o.id));

  useEffect(() => {
    if (sourceItems.length === 0) return;
    setCache((current) => {
      let changed = false;
      const next = { ...current };
      for (const option of sourceItems) {
        if (!next[option.id]) {
          next[option.id] = option;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [sourceItems]);

  function pick(id: string) {
    const option = sourceItems.find((o) => o.id === id) ?? cache[id];
    if (option) setCache((c) => ({ ...c, [id]: option }));
    if (selectionMode === "multiple") {
      const next = selectedSet.has(id)
        ? selectedIds.filter((v) => v !== id)
        : [...selectedIds, id];
      onChange(next);
    } else {
      onChange(id);
      list.setFilterText("");
      setMenuOpen(false);
    }
  }

  function removeKeys(keys: Set<Key>) {
    onChange(selectedIds.filter((v) => !keys.has(v)));
  }

  const inputSize = size === "sm" ? "input-sm" : "";
  const triggerSize = size === "sm" ? "select-sm" : "";
  const widthClass = width === "compact" ? "w-64 max-w-full" : "w-full";
  const labelFor = (id: string) => cache[id]?.label ?? id;
  const triggerLabel =
    selectionMode === "multiple"
      ? selectedIds.length > 0
        ? `${selectedIds.length} selected`
        : placeholder
      : selectedIds[0]
        ? labelFor(selectedIds[0])
        : placeholder;
  const renderedEmptyState = (
    <div className="px-3 py-2 text-sm text-base-content/50">
      {list.loadingState === "loading" ? "Searching…" : "No results"}
    </div>
  );

  const searchField = (
    <SearchField aria-label={fieldLabel} className="w-full">
      <Label className="sr-only">Search</Label>
      <Input
        placeholder={placeholder}
        className={`input input-bordered ${inputSize} w-full bg-base-100 text-base-content focus:input-primary`.trim()}
      />
    </SearchField>
  );

  return (
    <div className={`form-control ${widthClass}`}>
      {showLabel ? (
        <label className="label">
          <span className="label-text text-base font-medium text-base-content">
            {fieldLabel}
          </span>
        </label>
      ) : null}
      {selectionMode === "multiple" && selectedIds.length > 0 ? (
        <TagGroup
          aria-label={`Selected ${fieldLabel}`}
          onRemove={removeKeys}
          className="mb-2"
        >
          <TagList
            items={selectedIds.map((id) => ({ id }))}
            className="flex flex-wrap gap-2"
          >
            {(item) => (
              <Tag
                id={item.id}
                textValue={labelFor(String(item.id))}
                className="badge badge-outline badge-primary gap-1"
              >
                {labelFor(String(item.id))}
                <AriaButton
                  slot="remove"
                  aria-label={`Remove ${labelFor(String(item.id))}`}
                  className="cursor-pointer opacity-70 outline-none hover:opacity-100"
                >
                  ✕
                </AriaButton>
              </Tag>
            )}
          </TagList>
        </TagGroup>
      ) : null}

      {variant === "menu" ? (
        <MenuTrigger isOpen={menuOpen} onOpenChange={setMenuOpen}>
          <AriaButton
            aria-label={fieldLabel}
            className={`select select-bordered ${triggerSize} flex w-full items-center justify-between gap-2 bg-none text-left`.trim()}
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown
              className="h-3 w-3 shrink-0 text-base-content/50"
              aria-hidden="true"
            />
          </AriaButton>
          <Popover className="z-50 w-(--trigger-width) data-[entering]:animate-popover-in data-[exiting]:animate-popover-out">
            <div className="popover-panel flex max-h-80 w-full flex-col gap-2 p-2">
              <Autocomplete
                inputValue={list.filterText}
                onInputChange={list.setFilterText}
                filter={source.mode === "sync" ? contains : undefined}
              >
                {searchField}
                <Menu
                  aria-label={`${fieldLabel} results`}
                  items={items}
                  onAction={(key) => pick(String(key))}
                  renderEmptyState={() => renderedEmptyState}
                  className="menu menu-sm max-h-64 w-full overflow-auto p-1"
                >
                  {(option: ResourceOption) => (
                    <MenuItem
                      id={option.id}
                      textValue={option.label}
                      className="rounded-field px-3 py-2 text-sm outline-none data-[focused]:bg-base-200"
                    >
                      {renderOption
                        ? renderOption(option)
                        : defaultRenderOption(kind, option)}
                    </MenuItem>
                  )}
                </Menu>
              </Autocomplete>
            </div>
          </Popover>
        </MenuTrigger>
      ) : (
        <Autocomplete
          inputValue={list.filterText}
          onInputChange={list.setFilterText}
          filter={source.mode === "sync" ? contains : undefined}
        >
          {searchField}
          <ListBox
            aria-label={`${fieldLabel} results`}
            items={items}
            selectionMode="none"
            onAction={(key) => pick(String(key))}
            renderEmptyState={() => renderedEmptyState}
            className="menu mt-1 max-h-64 w-full overflow-auto rounded-box border border-base-300 bg-base-100 p-1"
          >
            {(option: ResourceOption) => (
              <ListBoxItem
                id={option.id}
                textValue={option.label}
                className="rounded-field px-3 py-2 text-sm data-[focused]:bg-base-200"
              >
                {renderOption
                  ? renderOption(option)
                  : defaultRenderOption(kind, option)}
              </ListBoxItem>
            )}
          </ListBox>
        </Autocomplete>
      )}

      {variant === "inline" && selectionMode === "single" && selectedIds[0] ? (
        <span className="mt-1 text-xs text-base-content/60">
          Selected: {labelFor(selectedIds[0])}
        </span>
      ) : null}
      {name ? (
        <input type="hidden" name={name} value={selectedIds.join(",")} />
      ) : null}
    </div>
  );
}
