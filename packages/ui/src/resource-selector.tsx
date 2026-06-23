// DaisyUI 5: https://daisyui.com/components/input/
// React Aria: https://react-spectrum.adobe.com/react-aria/ComboBox.html
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Button as AriaButton,
  Collection,
  ComboBox,
  Group,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxLoadMoreItem,
  Popover,
  Tag,
  TagGroup,
  TagList,
  type Key,
} from "react-aria-components";
import { useAsyncList } from "react-stately";
import { ChevronDown } from "lucide-react";
import { Avatar } from "./avatar";

export type ResourceKind =
  | "user"
  | "organization"
  | "team"
  | "member"
  | "media"
  | "oauth-client"
  | "resource-server"
  | "record"
  // A generic collection kind. The admin app uses the named kinds above; a
  // domain-agnostic consumer (the editor's reference blocks, docs/026 §16) passes
  // its own collection name (e.g. "post", "product"). `kind` only selects a
  // default avatar (`withAvatar` below) and the fallback search label, so any
  // string is safe; `& {}` keeps autocomplete for the named kinds.
  | (string & {});

export type ResourceOption = {
  readonly id: string;
  readonly label: string;
  readonly sublabel?: string;
  readonly image?: string | null;
  readonly badge?: string;
};

export type ResourcePage = {
  readonly items: ResourceOption[];
  /** Opaque cursor for the next page; omit/undefined when there are no more pages. */
  readonly cursor?: string;
};

export type ResourceSource =
  | {
      readonly mode: "async";
      readonly load: (
        query: string,
        signal: AbortSignal,
      ) => Promise<ResourceOption[]>;
    }
  | {
      readonly mode: "paginated";
      readonly load: (params: {
        readonly query: string;
        readonly cursor?: string;
        readonly signal: AbortSignal;
      }) => Promise<ResourcePage>;
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
  /** Options to seed the id-to-label cache up front for selected async values. */
  readonly initialOptions?: ReadonlyArray<ResourceOption>;
  /** Minimum query length before async loading starts. Default 0. */
  readonly minQueryLength?: number;
  /** Debounce in ms for async search input. Default 250. */
  readonly searchDebounceMs?: number;
  readonly renderOption?: (option: ResourceOption) => ReactNode;
  readonly onSelectOption?: (option: ResourceOption) => void;
  readonly size?: "sm" | "md";
  /**
   * Retained for API compatibility. All variants now render the same React Aria
   * `ComboBox` (search input + popover listbox); the prop no longer changes the
   * structure.
   */
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
        <span className="truncate text-base-content group-data-[selected]:text-primary-content">
          {option.label}
        </span>
        {option.sublabel ? (
          <span className="truncate text-xs text-base-content/50 group-data-[selected]:text-primary-content/80">
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

function optionChanged(
  current: ResourceOption | undefined,
  next: ResourceOption,
): boolean {
  return (
    !current ||
    current.label !== next.label ||
    current.sublabel !== next.sublabel ||
    current.image !== next.image ||
    current.badge !== next.badge
  );
}

function useDebouncedCallback<T extends readonly unknown[]>(
  callback: (...args: T) => void,
  delayMs: number,
) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  return useCallback(
    (...args: T) => {
      if (timeout.current) clearTimeout(timeout.current);
      if (delayMs <= 0) {
        callback(...args);
        return;
      }
      timeout.current = setTimeout(() => callback(...args), delayMs);
    },
    [callback, delayMs],
  );
}

export function ResourceSelector({
  kind,
  selectionMode = "single",
  value,
  onChange,
  source,
  initialOptions,
  minQueryLength = 0,
  searchDebounceMs = 250,
  placeholder = "Search…",
  label,
  showLabel,
  name,
  excludeIds = [],
  renderOption,
  onSelectOption,
  size = "md",
  width = "full",
}: ResourceSelectorProps) {
  const [cache, setCache] = useState<Record<string, ResourceOption>>({});
  const [rawQuery, setRawQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const fieldLabel = label ?? `Search ${kind}s`;
  const multiple = selectionMode === "multiple";
  const paginated = source.mode === "paginated";

  const list = useAsyncList<ResourceOption, string | undefined>({
    async load({ signal, filterText, cursor }) {
      if (source.mode === "paginated") {
        const query = filterText ?? "";
        // First page only is gated by minQueryLength; paginating keeps the query.
        if (!cursor && query.trim().length < minQueryLength)
          return { items: [] };
        const page = await source.load({ query, cursor, signal });
        return { items: page.items, cursor: page.cursor };
      }
      if (source.mode === "async") {
        const query = filterText ?? "";
        if (query.trim().length < minQueryLength) return { items: [] };
        const items = await source.load(query, signal);
        return { items };
      }
      return { items: [...source.items] };
    },
  });

  const setListFilterTextRef = useRef(list.setFilterText);
  setListFilterTextRef.current = list.setFilterText;
  const setListFilterText = useCallback(
    (query: string) => setListFilterTextRef.current(query),
    [],
  );
  const debouncedSetFilterText = useDebouncedCallback(
    setListFilterText,
    source.mode === "sync" ? 0 : searchDebounceMs,
  );

  useEffect(() => {
    if (source.mode === "sync") return;
    debouncedSetFilterText(rawQuery);
  }, [debouncedSetFilterText, rawQuery, source.mode]);

  const selectedIds = Array.isArray(value) ? value : value ? [value] : [];
  const hidden = new Set([...excludeIds, ...(multiple ? selectedIds : [])]);
  const sourceItems = source.mode === "sync" ? source.items : list.items;
  const query = rawQuery.trim();

  // Sync sources filter client-side off the typed query; async/paginated are
  // already filtered server-side by useAsyncList's filterText.
  const filteredItems =
    source.mode === "sync" && query !== ""
      ? sourceItems.filter((option) =>
          [option.label, option.sublabel, option.badge].some((text) =>
            text ? text.toLowerCase().includes(query.toLowerCase()) : false,
          ),
        )
      : sourceItems;
  const items = filteredItems.filter((option) => !hidden.has(option.id));
  const selectedId = selectedIds[0];

  useEffect(() => {
    if (sourceItems.length === 0) return;
    setCache((current) => {
      let changed = false;
      const next = { ...current };
      for (const option of sourceItems) {
        if (optionChanged(next[option.id], option)) {
          next[option.id] = option;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [sourceItems]);

  useEffect(() => {
    if (!initialOptions?.length) return;
    setCache((current) => {
      let changed = false;
      const next = { ...current };
      for (const option of initialOptions) {
        if (optionChanged(next[option.id], option)) {
          next[option.id] = option;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [initialOptions]);

  function cacheOption(id: string) {
    const option = sourceItems.find((o) => o.id === id) ?? cache[id];
    if (option) {
      setCache((c) => ({ ...c, [id]: option }));
      onSelectOption?.(option);
    }
  }

  function handleSingleChange(key: Key | null) {
    if (key === null || key === undefined) {
      onChange("");
      return;
    }
    const id = String(key);
    cacheOption(id);
    onChange(id);
  }

  function handleMultipleChange(keys: Key[]) {
    const ids = keys.map(String);
    for (const id of ids) cacheOption(id);
    onChange(ids);
  }

  function removeKeys(keys: Set<Key>) {
    onChange(selectedIds.filter((v) => !keys.has(v)));
  }

  const labelFor = (id: string) => cache[id]?.label ?? id;
  const inputSize = size === "sm" ? "input-sm" : "";
  const widthClass = width === "compact" ? "w-64 max-w-full" : "w-full";

  // Single select shows the chosen item's label while idle and switches to the
  // live search text while focused (multiple select always shows the search
  // text; the chosen items render as tags above the field).
  const singleDisplayValue =
    !isFocused && selectedId ? labelFor(selectedId) : rawQuery;

  const renderedEmptyState = (
    <div className="px-3 py-2 text-sm text-base-content/50">
      {(source.mode === "async" || paginated) && query.length < minQueryLength
        ? "Type to search"
        : list.loadingState === "loading"
          ? "Searching…"
          : "No results"}
    </div>
  );

  const renderItem = (option: ResourceOption) => (
    <ListBoxItem
      id={option.id}
      textValue={option.label}
      className="group shrink-0 cursor-pointer rounded-field px-3 py-2 text-sm outline-none data-[focused]:bg-base-200 data-[selected]:bg-primary data-[selected]:text-primary-content"
    >
      {renderOption ? renderOption(option) : defaultRenderOption(kind, option)}
    </ListBoxItem>
  );

  // Shared ComboBox children — identical for single and multiple selection.
  const comboChildren = (
    <>
      <Group className="relative w-full">
        <Input
          aria-label={fieldLabel}
          placeholder={placeholder}
          className={`input input-bordered ${inputSize} w-full bg-base-100 pr-9 text-base-content focus:input-primary`.trim()}
        />
        <AriaButton
          aria-label={`Toggle ${fieldLabel}`}
          className="absolute inset-y-0 right-0 flex items-center px-2 text-base-content/50 outline-none"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </AriaButton>
      </Group>
      <Popover className="z-50 w-(--trigger-width) data-[entering]:animate-popover-in data-[exiting]:animate-popover-out">
        <ListBox
          renderEmptyState={() => renderedEmptyState}
          className="menu menu-sm max-h-64 w-full flex-nowrap overflow-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
        >
          <Collection items={items}>{renderItem}</Collection>
          {paginated ? (
            <ListBoxLoadMoreItem
              onLoadMore={list.loadMore}
              isLoading={list.loadingState === "loadingMore"}
              className="flex shrink-0 items-center justify-center py-2"
            >
              <span
                className="loading loading-spinner loading-sm text-base-content/50"
                aria-label="Loading more"
              />
            </ListBoxLoadMoreItem>
          ) : null}
        </ListBox>
      </Popover>
    </>
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

      {multiple && selectedIds.length > 0 ? (
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

      {multiple ? (
        <ComboBox
          aria-label={fieldLabel}
          selectionMode="multiple"
          value={selectedIds}
          onChange={handleMultipleChange}
          inputValue={rawQuery}
          onInputChange={setRawQuery}
          menuTrigger="focus"
          allowsEmptyCollection
          className="w-full"
        >
          {comboChildren}
        </ComboBox>
      ) : (
        <ComboBox
          aria-label={fieldLabel}
          selectedKey={selectedId ?? null}
          onSelectionChange={handleSingleChange}
          inputValue={singleDisplayValue}
          onInputChange={setRawQuery}
          onFocusChange={(focused) => {
            setIsFocused(focused);
            // Reset the search text on blur so the field re-shows the label and
            // the next open starts from a clean browse.
            if (!focused) setRawQuery("");
          }}
          menuTrigger="focus"
          allowsEmptyCollection
          className="w-full"
        >
          {comboChildren}
        </ComboBox>
      )}

      {name ? (
        <input type="hidden" name={name} value={selectedIds.join(",")} />
      ) : null}
    </div>
  );
}
