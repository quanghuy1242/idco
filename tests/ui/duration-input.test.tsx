// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DurationInput } from "@idco/ui";

describe("DurationInput", () => {
  it("renders with label and default quantity", () => {
    render(<DurationInput label="Ban duration" name="banExpiresIn" />);
    expect(screen.getByText(/ban duration/i)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /quantity/i })).toHaveValue("1");
  });

  it("submits computed seconds via hidden input", () => {
    render(<DurationInput label="Ban duration" name="banExpiresIn" />);
    const hidden = document.querySelector(
      "input[type='hidden'][name='banExpiresIn']",
    );
    expect(hidden).toBeInTheDocument();
    // Default: 1 hour = 3600 seconds
    expect(hidden).toHaveValue("3600");
  });

  it("decomposes defaultValue into quantity and unit", () => {
    render(<DurationInput label="Duration" name="dur" defaultValue={7200} />);
    // 7200 = 2 hours
    expect(screen.getByRole("textbox", { name: /quantity/i })).toHaveValue("2");
  });

  it("updates hidden input when quantity changes via stepper", () => {
    render(<DurationInput label="Duration" name="dur" />);
    const incrementBtn = document.querySelector("[slot='increment']");
    expect(incrementBtn).toBeInTheDocument();
    fireEvent.click(incrementBtn!);
    fireEvent.click(incrementBtn!);
    const hidden = document.querySelector("input[type='hidden'][name='dur']");
    // 3 hours = 10800 seconds
    expect(hidden).toHaveValue("10800");
  });

  it("updates hidden input when unit changes", async () => {
    const { container } = render(<DurationInput label="Duration" name="dur" />);
    const trigger = screen.getByRole("button", { name: /duration unit/i });
    fireEvent.click(trigger);
    const option = await screen.findByRole("option", { name: /days/i });
    fireEvent.click(option);
    const hidden = container.querySelector("input[type='hidden'][name='dur']");
    // 1 day = 86400 seconds
    expect(hidden).toHaveValue("86400");
  });

  it("shows (Optional) in label when not required", () => {
    render(<DurationInput label="Ban duration" name="banExpiresIn" />);
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
  });

  it("does not show (Optional) when required", () => {
    render(<DurationInput label="Ban duration" name="banExpiresIn" required />);
    expect(screen.queryByText(/optional/i)).toBeNull();
  });

  it("has increment and decrement stepper buttons", () => {
    render(<DurationInput label="Duration" name="dur" />);
    const buttons = document.querySelectorAll(
      "[slot='increment'], [slot='decrement']",
    );
    expect(buttons.length).toBe(2);
  });

  it("renders unit selector with all options", async () => {
    render(<DurationInput label="Duration" name="dur" />);
    const trigger = screen.getByRole("button", { name: /duration unit/i });
    fireEvent.click(trigger);
    const listbox = await screen.findByRole("listbox");
    const options = Array.from(listbox.querySelectorAll("[role='option']")).map(
      (el) => el.textContent ?? "",
    );
    expect(options).toEqual(["minutes", "hours", "days", "weeks", "months"]);
  });

  it("defaults to quantity 1 when defaultValue is 0", () => {
    render(<DurationInput label="Duration" name="dur" defaultValue={0} />);
    expect(screen.getByRole("textbox", { name: /quantity/i })).toHaveValue("1");
  });

  it("stepper buttons use md size not sm", () => {
    render(<DurationInput label="Duration" name="dur" />);
    const incrementBtn = document.querySelector("[slot='increment']");
    expect(incrementBtn).not.toHaveClass("btn-sm");
  });
});
