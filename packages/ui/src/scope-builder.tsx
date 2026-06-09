// DaisyUI 5: https://daisyui.com/components/badge/
"use client";

import { useState, type KeyboardEvent } from "react";
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
import { ChevronDown } from "lucide-react";

export type ScopeSuggestion = {
  readonly value: string;
  readonly description?: string;
  readonly group?: string;
};

type ScopeBuilderProps = {
  readonly label: string;
  readonly value: ReadonlyArray<string>;
  readonly onChange: (next: string[]) => void;
  readonly suggestions?: ReadonlyArray<ScopeSuggestion>;
  readonly allowCustom?: boolean;
  readonly validate?: (scope: string) => string | undefined;
  readonly name?: string;
  readonly size?: "sm" | "md";
  readonly variant?: "inline" | "menu";
  readonly placeholder?: string;
  readonly searchValue?: string;
  readonly onSearchValueChange?: (next: string) => void;
};

const scopePattern = /^[a-z][a-z0-9:_-]*$/;

export function defaultScopeValidate(scope: string): string | undefined {
  return scopePattern.test(scope)
    ? undefined
    : "Scopes are lowercase and may contain letters, numbers, : _ -";
}

export function ScopeBuilder({
  label,
  value,
  onChange,
  suggestions = [],
  allowCustom,
  validate = defaultScopeValidate,
  name,
  size = "md",
  variant = "inline",
  placeholder = "Filter scopes…",
  searchValue,
  onSearchValueChange,
}: ScopeBuilderProps) {
  const { contains } = useFilter({ sensitivity: "base" });
  const [internalInputValue, setInternalInputValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);

  const inputValue = searchValue ?? internalInputValue;
  const selected = new Set(value);
  const available = suggestions.filter((s) => !selected.has(s.value));
  const knownValues = new Set(suggestions.map((s) => s.value));
  const trimmed = inputValue.trim();
  const filteredAvailable =
    trimmed === ""
      ? available
      : available.filter((s) =>
          [s.value, s.description, s.group].some((text) =>
            text ? contains(text, trimmed) : false,
          ),
        );
  const showCustom =
    allowCustom &&
    trimmed !== "" &&
    !selected.has(trimmed) &&
    !available.some((s) => s.value === trimmed);

  function setInputValue(next: string) {
    if (searchValue === undefined) setInternalInputValue(next);
    onSearchValueChange?.(next);
  }

  function addScope(scope: string) {
    const next = scope.trim();
    if (next === "" || selected.has(next)) {
      setInputValue("");
      return;
    }
    const validationError = validate(next);
    if (validationError) {
      setError(validationError);
      return;
    }
    onChange([...value, next]);
    setInputValue("");
    setError(undefined);
    setMenuOpen(false);
  }

  function removeKeys(keys: Set<Key>) {
    onChange(value.filter((v) => !keys.has(v)));
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const exact = filteredAvailable.find((s) => s.value === trimmed);
      const next =
        exact?.value ?? (showCustom ? trimmed : filteredAvailable[0]?.value);
      if (next) addScope(next);
      return;
    }

    if (event.key === "Backspace" && inputValue === "" && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  const inputSize = size === "sm" ? "input-sm" : "";
  const triggerSize = size === "sm" ? "select-sm" : "";
  const triggerLabel =
    value.length > 0 ? `${value.length} selected` : trimmed || placeholder;
  const emptyState = (
    <div className="px-3 py-2 text-sm text-base-content/50">
      No matching scopes
    </div>
  );

  const searchField = (
    <SearchField
      aria-label={`Search ${label}`}
      className="w-full"
      onClear={() => setError(undefined)}
    >
      <Label className="sr-only">{label}</Label>
      <Input
        placeholder={placeholder}
        onKeyDown={handleInputKeyDown}
        className={`input input-bordered ${inputSize} w-full bg-base-100 text-base-content focus:input-primary`.trim()}
      />
    </SearchField>
  );

  const suggestionItems = (
    <>
      {showCustom ? (
        <ListBoxItem
          id={trimmed}
          textValue={trimmed}
          className="rounded-field px-3 py-2 text-sm data-[focused]:bg-base-200"
        >
          Add “<span className="font-mono">{trimmed}</span>”
        </ListBoxItem>
      ) : null}
      {filteredAvailable.map((s) => (
        <ListBoxItem
          key={s.value}
          id={s.value}
          textValue={s.value}
          className="flex flex-col rounded-field px-3 py-2 text-sm data-[focused]:bg-base-200"
        >
          <span className="font-mono text-base-content">{s.value}</span>
          {s.description ? (
            <span className="text-xs text-base-content/50">
              {s.description}
            </span>
          ) : null}
        </ListBoxItem>
      ))}
    </>
  );

  return (
    <div className="form-control w-full">
      <span className="label-text mb-1 text-base font-medium text-base-content">
        {label}
      </span>

      {value.length > 0 ? (
        <TagGroup
          aria-label={`Selected ${label}`}
          onRemove={removeKeys}
          className="mb-2"
        >
          <TagList
            items={value.map((v) => ({ id: v }))}
            className="flex flex-wrap gap-2"
          >
            {(item) => {
              const inCatalog =
                knownValues.size === 0 || knownValues.has(String(item.id));
              return (
                <Tag
                  id={item.id}
                  textValue={String(item.id)}
                  className={`badge badge-outline gap-1 ${inCatalog ? "badge-primary" : "badge-warning"}`}
                >
                  <span className="font-mono">{item.id}</span>
                  <AriaButton
                    slot="remove"
                    aria-label={`Remove ${item.id}`}
                    className="cursor-pointer opacity-70 outline-none hover:opacity-100"
                  >
                    ✕
                  </AriaButton>
                </Tag>
              );
            }}
          </TagList>
        </TagGroup>
      ) : null}

      {variant === "menu" ? (
        <MenuTrigger isOpen={menuOpen} onOpenChange={setMenuOpen}>
          <AriaButton
            aria-label={label}
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
                inputValue={inputValue}
                onInputChange={(next) => {
                  setInputValue(next);
                  if (error) setError(undefined);
                }}
                filter={contains}
              >
                {searchField}
                <Menu
                  aria-label={`${label} suggestions`}
                  onAction={(key) => addScope(String(key))}
                  renderEmptyState={() => emptyState}
                  className="menu menu-sm max-h-56 w-full overflow-auto p-1"
                >
                  {showCustom ? (
                    <MenuItem
                      id={trimmed}
                      textValue={trimmed}
                      className="rounded-field px-3 py-2 text-sm outline-none data-[focused]:bg-base-200"
                    >
                      Add “<span className="font-mono">{trimmed}</span>”
                    </MenuItem>
                  ) : null}
                  {filteredAvailable.map((s) => (
                    <MenuItem
                      key={s.value}
                      id={s.value}
                      textValue={s.value}
                      className="flex flex-col rounded-field px-3 py-2 text-sm outline-none data-[focused]:bg-base-200"
                    >
                      <span className="font-mono text-base-content">
                        {s.value}
                      </span>
                      {s.description ? (
                        <span className="text-xs text-base-content/50">
                          {s.description}
                        </span>
                      ) : null}
                    </MenuItem>
                  ))}
                </Menu>
              </Autocomplete>
            </div>
          </Popover>
        </MenuTrigger>
      ) : (
        <Autocomplete
          inputValue={inputValue}
          onInputChange={(next) => {
            setInputValue(next);
            if (error) setError(undefined);
          }}
          filter={contains}
        >
          {searchField}
          <ListBox
            aria-label={`${label} suggestions`}
            selectionMode="none"
            onAction={(key) => addScope(String(key))}
            renderEmptyState={() => emptyState}
            className="menu mt-1 max-h-56 w-full overflow-auto rounded-box border border-base-300 bg-base-100 p-1"
          >
            {suggestionItems}
          </ListBox>
        </Autocomplete>
      )}

      {error ? (
        <span role="alert" className="label-text-alt mt-1 text-error">
          {error}
        </span>
      ) : null}
      {name ? (
        <input type="hidden" name={name} value={value.join(" ")} />
      ) : null}
    </div>
  );
}
