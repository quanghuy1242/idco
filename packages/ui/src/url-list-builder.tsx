// DaisyUI 5: https://daisyui.com/components/input/
"use client";

import { Input, TextField } from "react-aria-components";
import { Button } from "./button";

/** Props for {@link UrlListBuilder}. */
type UrlListBuilderProps = {
  /** Visible label above the rows. */
  readonly label: string;
  /** Current list of URLs (controlled). */
  readonly value: ReadonlyArray<string>;
  /** Called with the next list when a row is edited, added, or removed. */
  readonly onChange: (next: string[]) => void;
  /** Validate a single URL; return an error message to flag the row. */
  readonly validate?: (value: string) => string | undefined;
  readonly placeholder?: string;
  /** Field name to submit the newline-joined URLs under. */
  readonly name?: string;
  /** Minimum number of rows kept (the remove button disables at this count). Defaults to 1. */
  readonly minRows?: number;
  /** Label for the add-row button; defaults to "Add URL". */
  readonly addLabel?: string;
  /** Control size; defaults to `md`. */
  readonly size?: "sm" | "md";
};

/**
 * Repeatable URL input: React Aria TextField rows with add/remove and per-row validation.
 *
 * @categoryDefault Pickers
 */

/** The default URL validator: requires an absolute https (or localhost) URL with no fragment. */
export function defaultUrlValidate(value: string): string | undefined {
  if (value.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter an absolute URL";
  }
  if (url.hash) return "URL must not contain a fragment (#…)";
  const isLocalhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !isLocalhost)
    return "Must be https or localhost";
  return undefined;
}

/**
 * A repeatable list of URL inputs with add/remove controls and per-row validation.
 *
 * @example
 * <UrlListBuilder label="Redirect URIs" value={uris} onChange={setUris} name="redirectUris" />
 */
export function UrlListBuilder({
  label,
  value,
  onChange,
  validate = defaultUrlValidate,
  placeholder,
  name,
  minRows = 1,
  addLabel = "Add URL",
  size = "md",
}: UrlListBuilderProps) {
  const rows = value.length === 0 ? [""] : [...value];
  const inputSize = size === "sm" ? "input-sm" : "";

  function update(index: number, next: string) {
    const copy = [...rows];
    copy[index] = next;
    onChange(copy);
  }

  function remove(index: number) {
    const copy = rows.filter((_, i) => i !== index);
    onChange(copy.length === 0 ? [] : copy);
  }

  function add() {
    onChange([...rows, ""]);
  }

  return (
    <div className="form-control w-full">
      <span className="label-text mb-1 text-base font-medium text-base-content">
        {label}
      </span>
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const error = validate(row);
          return (
            <div key={index} className="flex flex-col gap-1">
              <div className="flex w-full items-stretch">
                <TextField
                  aria-label={`${label} ${index + 1}`}
                  isInvalid={error ? true : undefined}
                  value={row}
                  onChange={(next) => update(index, next)}
                  className="w-full"
                >
                  <Input
                    placeholder={placeholder}
                    className={`input input-bordered ${inputSize} w-full rounded-r-none bg-base-100 text-base-content focus:input-primary${
                      error ? " input-error" : ""
                    }`.trim()}
                  />
                </TextField>
                <Button
                  variant="secondary"
                  size={size}
                  square
                  attached="left"
                  iconName="X"
                  ariaLabel={`Remove ${label} ${index + 1}`}
                  tooltip="Remove"
                  disabled={rows.length <= minRows}
                  onClick={() => remove(index)}
                />
              </div>
              {error ? (
                <span role="alert" className="label-text-alt text-error">
                  Row {index + 1}: {error}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2">
        <Button variant="secondary" size={size} iconName="Plus" onClick={add}>
          {addLabel}
        </Button>
      </div>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={value.filter((v) => v.trim() !== "").join("\n")}
        />
      ) : null}
    </div>
  );
}
