// DaisyUI 5: https://daisyui.com/components/input/
// React Aria: https://react-spectrum.adobe.com/react-aria/NumberField.html
"use client";

import { useMemo, useState } from "react";
import {
  NumberField,
  Input,
  Group,
  Button as NumberFieldButton,
} from "react-aria-components";
import { Minus, Plus } from "lucide-react";
import { FilterDropdown } from "./filter-dropdown";

const durationUnits = [
  { value: "60", label: "minutes" },
  { value: "3600", label: "hours" },
  { value: "86400", label: "days" },
  { value: "604800", label: "weeks" },
  { value: "2592000", label: "months" },
] as const;

function decomposeSeconds(seconds: number): { quantity: number; unit: string } {
  if (!seconds || seconds <= 0) return { quantity: 1, unit: "3600" };
  for (let i = durationUnits.length - 1; i >= 0; i--) {
    const unit = durationUnits[i];
    const unitSeconds = Number(unit.value);
    if (seconds % unitSeconds === 0) {
      return { quantity: seconds / unitSeconds, unit: unit.value };
    }
  }
  return { quantity: 1, unit: "3600" };
}

/** Props for {@link DurationInput}. */
type DurationInputProps = {
  readonly label: string;
  readonly name: string;
  /** Initial duration in seconds; decomposed into the largest whole quantity-and-unit pair. */
  readonly defaultValue?: number;
  readonly required?: boolean;
  /** Control height: `sm` for compact, `md` (default) for standard. */
  readonly size?: "sm" | "md";
};

/**
 * Quantity-plus-unit duration field that submits a single seconds value.
 *
 * @categoryDefault Forms
 */

/**
 * A duration picker pairing a numeric quantity with a unit (minutes through months) that posts the total seconds via a hidden input.
 */
export function DurationInput({
  label,
  name,
  defaultValue,
  required,
  size = "md",
}: DurationInputProps) {
  const initial = useMemo(
    () => decomposeSeconds(defaultValue ?? 0),
    [defaultValue],
  );

  const [quantity, setQuantity] = useState(initial.quantity);
  const [unit, setUnit] = useState(initial.unit);

  const computedSeconds =
    quantity > 0 ? String(Math.round(quantity * Number(unit))) : "";
  const inputSizeClass = size === "sm" ? "input-sm" : "";

  return (
    <div className="form-control w-full">
      <label className="label">
        <span className="label-text text-base font-medium text-base-content">
          {label}
          {!required ? " (Optional)" : ""}
        </span>
      </label>
      <div className="flex items-center gap-2">
        <NumberField
          aria-label="Quantity"
          value={quantity}
          onChange={(v) => setQuantity(v)}
          minValue={1}
          isRequired={required}
          step={1}
          className="contents"
        >
          <Group className="flex items-center">
            <NumberFieldButton
              slot="decrement"
              className="btn btn-ghost btn-square rounded-r-none border border-base-300 bg-base-100"
            >
              <Minus className="size-4" />
            </NumberFieldButton>
            <Input
              className={`input input-bordered ${inputSizeClass} w-20 text-center bg-base-100 text-base-content rounded-none border-x-0`}
            />
            <NumberFieldButton
              slot="increment"
              className="btn btn-ghost btn-square rounded-l-none border border-base-300 bg-base-100"
            >
              <Plus className="size-4" />
            </NumberFieldButton>
          </Group>
        </NumberField>
        <FilterDropdown
          label="Duration unit"
          options={[...durationUnits]}
          value={unit}
          onChange={setUnit}
          size={size}
          className="w-28 shrink-0"
        />
      </div>
      <input type="hidden" name={name} value={computedSeconds} />
    </div>
  );
}
