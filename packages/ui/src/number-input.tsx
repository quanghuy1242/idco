// DaisyUI 5: https://daisyui.com/components/input/
// React Aria: https://react-spectrum.adobe.com/react-aria/NumberField.html
"use client";

import { useState } from "react";
import {
  Button as NumberFieldButton,
  Group,
  Input,
  Label,
  NumberField,
} from "react-aria-components";
import { Minus, Plus } from "lucide-react";

type NumberInputProps = {
  readonly label: string;
  readonly name?: string;
  readonly value?: number | null;
  readonly defaultValue?: number | null;
  readonly onChange?: (value: number | null) => void;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly step?: number;
  readonly required?: boolean;
  readonly size?: "sm" | "md";
  readonly description?: string;
  readonly placeholder?: string;
  readonly formatOptions?: Intl.NumberFormatOptions;
};

function toFieldValue(value: number | null | undefined): number {
  return value === null || value === undefined ? Number.NaN : value;
}

// DaisyUI `input` styled around React Aria `NumberField` so the field stays a real
// number control (steppers, min/max, locale formatting) instead of a free-text box.
export function NumberInput({
  label,
  name,
  value,
  defaultValue,
  onChange,
  minValue,
  maxValue,
  step = 1,
  required,
  size = "md",
  description,
  placeholder,
  formatOptions = { maximumFractionDigits: 0, useGrouping: false },
}: NumberInputProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<number>(toFieldValue(defaultValue));
  const current = isControlled ? toFieldValue(value) : internal;

  function handleChange(next: number) {
    if (!isControlled) setInternal(next);
    onChange?.(Number.isNaN(next) ? null : next);
  }

  const inputSize = size === "sm" ? "input-sm" : "";
  const hidden = Number.isNaN(current) ? "" : String(current);

  return (
    <div className="form-control w-full">
      <NumberField
        value={current}
        onChange={handleChange}
        minValue={minValue}
        maxValue={maxValue}
        step={step}
        isRequired={required}
        formatOptions={formatOptions}
        className="contents"
      >
        <Label className="label">
          <span className="label-text text-base font-medium text-base-content">
            {label}
            {!required ? (
              <span aria-hidden="true" className="text-base-content/50">
                {" "}
                (Optional)
              </span>
            ) : null}
          </span>
        </Label>
        <Group className="flex items-center">
          <NumberFieldButton
            slot="decrement"
            className="btn btn-ghost btn-square rounded-r-none border border-base-300 bg-base-100"
          >
            <Minus className="size-4" />
          </NumberFieldButton>
          <Input
            placeholder={placeholder}
            className={`input input-bordered ${inputSize} w-full rounded-none border-x-0 bg-base-100 text-center text-base-content`.trim()}
          />
          <NumberFieldButton
            slot="increment"
            className="btn btn-ghost btn-square rounded-l-none border border-base-300 bg-base-100"
          >
            <Plus className="size-4" />
          </NumberFieldButton>
        </Group>
      </NumberField>
      {description ? (
        <span className="label-text-alt mt-1 text-base-content/60">
          {description}
        </span>
      ) : null}
      {name ? <input type="hidden" name={name} value={hidden} /> : null}
    </div>
  );
}
