// DaisyUI 5: https://daisyui.com/components/input/
// React Aria: https://react-spectrum.adobe.com/react-aria/DatePicker.html
"use client";

import { useState } from "react";
import {
  type CalendarDate,
  type CalendarDateTime,
  fromDate,
  getLocalTimeZone,
  toCalendarDate,
  toCalendarDateTime,
} from "@internationalized/date";
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Label,
  Popover,
} from "react-aria-components";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

type DateValue = CalendarDate | CalendarDateTime;

type DateTimeInputProps = {
  readonly label: string;
  readonly name?: string;
  readonly value?: number | null;
  readonly defaultValue?: number | null;
  readonly onChange?: (value: number | null) => void;
  readonly mode?: "datetime" | "date";
  readonly required?: boolean;
  readonly size?: "sm" | "md";
  readonly description?: string;
};

function toDateValue(
  ms: number | null | undefined,
  mode: "datetime" | "date",
): DateValue | null {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return null;
  const zoned = fromDate(new Date(ms), getLocalTimeZone());
  return mode === "date" ? toCalendarDate(zoned) : toCalendarDateTime(zoned);
}

function toMillis(value: DateValue | null): number | null {
  if (!value) return null;
  return value.toDate(getLocalTimeZone()).getTime();
}

// DaisyUI `input` shell around a React Aria `DatePicker` (segmented field + calendar
// popover) so dates/times are picked, never typed as raw ISO strings into a text box.
export function DateTimeInput({
  label,
  name,
  value,
  defaultValue,
  onChange,
  mode = "datetime",
  required,
  size = "md",
  description,
}: DateTimeInputProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<DateValue | null>(() =>
    toDateValue(defaultValue, mode),
  );
  const current = isControlled ? toDateValue(value, mode) : internal;
  const granularity = mode === "date" ? "day" : "minute";
  const inputSize = size === "sm" ? "input-sm" : "";
  const hidden = current ? String(toMillis(current)) : "";

  function handleChange(next: DateValue | null) {
    if (!isControlled) setInternal(next);
    onChange?.(toMillis(next));
  }

  return (
    <div className="form-control w-full">
      <DatePicker
        value={current}
        onChange={handleChange}
        granularity={granularity}
        isRequired={required}
        shouldForceLeadingZeros
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
        <Group
          className={`input input-bordered ${inputSize} flex w-full items-center gap-2 bg-base-100 text-base-content focus-within:input-primary`.trim()}
        >
          <DateInput className="flex flex-1 items-center">
            {(segment) => (
              <DateSegment
                segment={segment}
                className="rounded px-0.5 tabular-nums outline-none data-[focused]:bg-primary data-[focused]:text-primary-content data-[placeholder]:text-base-content/40"
              />
            )}
          </DateInput>
          <AriaButton
            aria-label="Open calendar"
            className="cursor-pointer text-base-content/60 outline-none hover:text-base-content"
          >
            <CalendarIcon className="size-4" aria-hidden="true" />
          </AriaButton>
        </Group>
        <Popover className="z-50 data-[entering]:animate-popover-in data-[exiting]:animate-popover-out">
          <Dialog className="rounded-box border border-base-300 bg-base-100 p-3 shadow-lg outline-none">
            <Calendar className="w-fit">
              <header className="mb-2 flex items-center justify-between gap-2">
                <AriaButton
                  slot="previous"
                  aria-label="Previous month"
                  className="btn btn-ghost btn-square btn-sm"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </AriaButton>
                <Heading className="text-sm font-semibold text-base-content" />
                <AriaButton
                  slot="next"
                  aria-label="Next month"
                  className="btn btn-ghost btn-square btn-sm"
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </AriaButton>
              </header>
              <CalendarGrid className="border-separate border-spacing-1">
                <CalendarGridHeader>
                  {(day) => (
                    <CalendarHeaderCell className="text-xs font-medium text-base-content/50">
                      {day}
                    </CalendarHeaderCell>
                  )}
                </CalendarGridHeader>
                <CalendarGridBody>
                  {(date) => (
                    <CalendarCell
                      date={date}
                      className="flex size-9 cursor-pointer items-center justify-center rounded-field text-sm outline-none data-[disabled]:opacity-30 data-[hovered]:bg-base-200 data-[selected]:bg-primary data-[selected]:text-primary-content data-[unavailable]:opacity-30"
                    />
                  )}
                </CalendarGridBody>
              </CalendarGrid>
            </Calendar>
          </Dialog>
        </Popover>
      </DatePicker>
      {description ? (
        <span className="label-text-alt mt-1 text-base-content/60">
          {description}
        </span>
      ) : null}
      {name ? <input type="hidden" name={name} value={hidden} /> : null}
    </div>
  );
}
