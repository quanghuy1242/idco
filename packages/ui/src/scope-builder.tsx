// DaisyUI 5: https://daisyui.com/components/badge/
// React Aria: https://react-spectrum.adobe.com/react-aria/ComboBox.html
"use client";

import { useState, type KeyboardEvent } from "react";
import {
  Button as AriaButton,
  Collection,
  ComboBox,
  Group,
  Input,
  ListBox,
  ListBoxItem,
  Popover,
  Tag,
  TagGroup,
  TagList,
  type Key,
} from "react-aria-components";
import { useFilter } from "react-aria";
import { ChevronDown } from "lucide-react";

/**
 * Scope/permission multi-select: a React Aria ComboBox + TagGroup with DaisyUI badge styling.
 *
 * @categoryDefault Pickers
 */

/** A selectable scope offered in the builder's suggestion list. */
export type ScopeSuggestion = {
  /** The scope token (e.g. `posts:write`). */
  readonly value: string;
  /** Human-readable explanation shown beside the value. */
  readonly description?: string;
  /** Optional grouping label for organizing suggestions. */
  readonly group?: string;
};

/** Props for {@link ScopeBuilder}. */
type ScopeBuilderProps = {
  /** Accessible label for the combobox. */
  readonly label: string;
  /** Selected scope tokens (controlled). */
  readonly value: ReadonlyArray<string>;
  /** Called with the next selection when scopes are added or removed. */
  readonly onChange: (next: string[]) => void;
  /** Suggested scopes to filter and pick from. */
  readonly suggestions?: ReadonlyArray<ScopeSuggestion>;
  /** Allow committing a typed value not present in `suggestions`. */
  readonly allowCustom?: boolean;
  /** Validate a candidate scope; return an error message to reject it. */
  readonly validate?: (scope: string) => string | undefined;
  /** Field name to submit the joined scopes under. */
  readonly name?: string;
  /** Control size; defaults to `md`. */
  readonly size?: "sm" | "md";
  /**
   * Retained for API compatibility. The builder now always renders the same
   * React Aria `ComboBox`; the prop no longer changes the structure.
   */
  readonly variant?: "inline" | "menu";
  readonly placeholder?: string;
  /** Controlled search text for the input. */
  readonly searchValue?: string;
  /** Called as the search text changes (for async suggestion loading). */
  readonly onSearchValueChange?: (next: string) => void;
};

const scopePattern = /^[a-z][a-z0-9:_-]*$/;

/** The default scope validator: accepts lowercase tokens of letters, numbers, and `: _ -`. */
export function defaultScopeValidate(scope: string): string | undefined {
  return scopePattern.test(scope)
    ? undefined
    : "Scopes are lowercase and may contain letters, numbers, : _ -";
}

/**
 * A multi-select for scopes/permissions with filtering, suggestions, custom entries, and tag chips.
 *
 * @example
 * <ScopeBuilder label="Scopes" value={scopes} onChange={setScopes}
 *   suggestions={available} allowCustom />
 */
export function ScopeBuilder({
  label,
  value,
  onChange,
  suggestions = [],
  allowCustom,
  validate = defaultScopeValidate,
  name,
  size = "md",
  placeholder = "Filter scopes…",
  searchValue,
  onSearchValueChange,
}: ScopeBuilderProps) {
  const { contains } = useFilter({ sensitivity: "base" });
  const [internalInputValue, setInternalInputValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

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
    allowCustom === true &&
    trimmed !== "" &&
    !selected.has(trimmed) &&
    !available.some((s) => s.value === trimmed);

  function setInputValue(next: string) {
    if (searchValue === undefined) setInternalInputValue(next);
    onSearchValueChange?.(next);
    if (error) setError(undefined);
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
  }

  // ComboBox multiple selection only fires for additions here — selected scopes
  // are excluded from the list, so the only path to remove them is the TagGroup.
  function handleSelectionChange(keys: Key[]) {
    const added = keys.map(String).find((id) => !selected.has(id));
    if (added !== undefined) addScope(added);
  }

  function removeKeys(keys: Set<Key>) {
    onChange(value.filter((v) => !keys.has(v)));
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // ComboBox does not auto-highlight the first option, so Enter on the raw
    // input adds the exact/custom/top match — matching the other pickers' feel.
    if (event.key === "Enter") {
      const exact = filteredAvailable.find((s) => s.value === trimmed);
      const next =
        exact?.value ?? (showCustom ? trimmed : filteredAvailable[0]?.value);
      if (next) {
        event.preventDefault();
        addScope(next);
      }
      return;
    }

    if (event.key === "Backspace" && inputValue === "" && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

  const inputSize = size === "sm" ? "input-sm" : "";
  const emptyState = (
    <div className="px-3 py-2 text-sm text-base-content/50">
      No matching scopes
    </div>
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

      <ComboBox
        aria-label={label}
        selectionMode="multiple"
        value={[...value]}
        onChange={handleSelectionChange}
        inputValue={inputValue}
        onInputChange={setInputValue}
        allowsCustomValue={allowCustom}
        menuTrigger="focus"
        allowsEmptyCollection
        className="w-full"
      >
        <Group className="relative w-full">
          <Input
            placeholder={placeholder}
            onKeyDown={handleInputKeyDown}
            className={`input input-bordered ${inputSize} w-full bg-base-100 pr-9 text-base-content focus:input-primary`.trim()}
          />
          <AriaButton
            aria-label={`Toggle ${label}`}
            className="absolute inset-y-0 right-0 flex items-center px-2 text-base-content/50 outline-none"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </AriaButton>
        </Group>
        <Popover className="z-50 w-(--trigger-width) data-[entering]:animate-popover-in data-[exiting]:animate-popover-out">
          <ListBox
            renderEmptyState={() => emptyState}
            className="menu menu-sm max-h-56 w-full flex-nowrap overflow-auto rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
          >
            {showCustom ? (
              <ListBoxItem
                id={trimmed}
                textValue={trimmed}
                className="shrink-0 cursor-pointer rounded-field px-3 py-2 text-sm outline-none data-[focused]:bg-base-200"
              >
                Add “<span className="font-mono">{trimmed}</span>”
              </ListBoxItem>
            ) : null}
            <Collection
              items={filteredAvailable.map((s) => ({ ...s, id: s.value }))}
            >
              {(s) => (
                <ListBoxItem
                  id={s.value}
                  textValue={s.value}
                  className="shrink-0 cursor-pointer flex-col rounded-field px-3 py-2 text-sm outline-none data-[focused]:bg-base-200"
                >
                  <span className="font-mono text-base-content">{s.value}</span>
                  {s.description ? (
                    <span className="text-xs text-base-content/50">
                      {s.description}
                    </span>
                  ) : null}
                </ListBoxItem>
              )}
            </Collection>
          </ListBox>
        </Popover>
      </ComboBox>

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
