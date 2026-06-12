// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NumberInput } from "@idco/ui";

describe("NumberInput", () => {
  it("renders the label with an (Optional) hint when not required", () => {
    render(<NumberInput label="Quota limit" name="quotaLimit" />);
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /quota limit/i })).toHaveValue(
      "",
    );
  });

  it("omits the (Optional) hint when required", () => {
    render(<NumberInput label="Quota limit" name="quotaLimit" required />);
    expect(screen.queryByText(/optional/i)).toBeNull();
  });

  it("serializes the default value into the hidden field", () => {
    render(
      <NumberInput label="Quota limit" name="quotaLimit" defaultValue={1000} />,
    );
    const hidden = document.querySelector(
      "input[type='hidden'][name='quotaLimit']",
    );
    expect(hidden).toHaveValue("1000");
  });

  it("leaves the hidden field empty when there is no value", () => {
    render(<NumberInput label="Quota limit" name="quotaLimit" />);
    const hidden = document.querySelector(
      "input[type='hidden'][name='quotaLimit']",
    );
    expect(hidden).toHaveValue("");
  });

  it("emits null through onChange when cleared and a number when stepped", () => {
    const onChange = vi.fn<(value: number | null) => void>();
    render(
      <NumberInput
        label="Quota limit"
        value={5}
        onChange={onChange}
        minValue={0}
      />,
    );
    const increment = document.querySelector("[slot='increment']");
    fireEvent.click(increment!);
    expect(onChange).toHaveBeenCalledWith(6);
  });

  it("has increment and decrement steppers", () => {
    render(<NumberInput label="Quota limit" name="quotaLimit" />);
    expect(
      document.querySelectorAll("[slot='increment'], [slot='decrement']")
        .length,
    ).toBe(2);
  });
});
