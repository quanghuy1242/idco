// DaisyUI 5: https://daisyui.com/components/badge/
"use client";

import { useState, type KeyboardEvent } from "react";
import {
  Button as AriaButton,
  Input,
  Tag,
  TagGroup,
  TagList,
  TextField,
  type Key,
} from "react-aria-components";

/** Props for {@link TagInput}. */
type TagInputProps = {
  readonly label: string;
  /** Controlled list of committed tags. */
  readonly value: ReadonlyArray<string>;
  /** Called with the next full tag list whenever a tag is added or removed. */
  readonly onChange: (next: string[]) => void;
  readonly name?: string;
  readonly placeholder?: string;
  /** Validates a normalized candidate tag; return an error message to reject it, or `undefined` to accept. */
  readonly validate?: (tag: string) => string | undefined;
  /** Transforms a candidate tag before it is committed (e.g. lowercasing). */
  readonly normalize?: (tag: string) => string;
  /** Delimiter joining tags in the hidden input value (default a space). */
  readonly separator?: string;
  /** Control height: `sm` for compact, `md` (default) for standard. */
  readonly size?: "sm" | "md";
  readonly description?: string;
};

/**
 * Free-text chip entry on a React Aria `TagGroup` with DaisyUI `badge` chips.
 *
 * @categoryDefault Forms
 */

/** Default {@link TagInputProps.validate} that accepts only well-formed DNS domain names like `acme.com`. */
export function defaultDomainValidate(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return undefined;
  const domainPattern =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
  return domainPattern.test(trimmed)
    ? undefined
    : "Enter a valid domain like acme.com";
}

/**
 * A multi-value text field that commits chips on Enter or comma, with optional normalization and validation.
 */
// Free-text chips on a React Aria `TagGroup` (keyboard-removable) plus a React Aria
// `TextField`; DaisyUI `badge` for the visible chips. Enter/comma commits a value.
export function TagInput({
  label,
  value,
  onChange,
  name,
  placeholder = "Type a value and press Enter",
  validate,
  normalize,
  separator = " ",
  size = "md",
  description,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);
  const selected = new Set(value);
  const inputSize = size === "sm" ? "input-sm" : "";

  function addTag(raw: string) {
    const normalized = (normalize ? normalize(raw) : raw).trim();
    if (normalized === "" || selected.has(normalized)) {
      setInputValue("");
      return;
    }
    const validationError = validate?.(normalized);
    if (validationError) {
      setError(validationError);
      return;
    }
    onChange([...value, normalized]);
    setInputValue("");
    setError(undefined);
  }

  function removeKeys(keys: Set<Key>) {
    onChange(value.filter((entry) => !keys.has(entry)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(inputValue);
      return;
    }
    if (event.key === "Backspace" && inputValue === "" && value.length > 0) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  }

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
            items={value.map((entry) => ({ id: entry }))}
            className="flex flex-wrap gap-2"
          >
            {(item) => (
              <Tag
                id={item.id}
                textValue={String(item.id)}
                className="badge badge-outline badge-primary gap-1"
              >
                {item.id}
                <AriaButton
                  slot="remove"
                  aria-label={`Remove ${item.id}`}
                  className="cursor-pointer opacity-70 outline-none hover:opacity-100"
                >
                  ✕
                </AriaButton>
              </Tag>
            )}
          </TagList>
        </TagGroup>
      ) : null}

      <TextField
        aria-label={label}
        value={inputValue}
        onChange={(next) => {
          setInputValue(next);
          if (error) setError(undefined);
        }}
        onBlur={() => addTag(inputValue)}
        isInvalid={error ? true : undefined}
        className="w-full"
      >
        <Input
          placeholder={placeholder}
          onKeyDown={handleKeyDown}
          className={`input input-bordered ${inputSize} w-full bg-base-100 text-base-content focus:input-primary${
            error ? " input-error" : ""
          }`.trim()}
        />
      </TextField>

      {error ? (
        <span role="alert" className="label-text-alt mt-1 text-error">
          {error}
        </span>
      ) : description ? (
        <span className="label-text-alt mt-1 text-base-content/60">
          {description}
        </span>
      ) : null}
      {name ? (
        <input type="hidden" name={name} value={value.join(separator)} />
      ) : null}
    </div>
  );
}
