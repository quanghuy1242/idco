// DaisyUI 5: https://daisyui.com/components/input/
"use client";

import { Input, TextField } from "react-aria-components";
import { Button } from "./button";

type UrlListBuilderProps = {
  readonly label: string;
  readonly value: ReadonlyArray<string>;
  readonly onChange: (next: string[]) => void;
  readonly validate?: (value: string) => string | undefined;
  readonly placeholder?: string;
  readonly name?: string;
  readonly minRows?: number;
  readonly addLabel?: string;
  readonly size?: "sm" | "md";
};

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
