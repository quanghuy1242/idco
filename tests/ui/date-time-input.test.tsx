// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DateTimeInput } from "@idco/ui";

// A fixed local instant: 2026-06-12T09:30 local time.
const sample = new Date(2026, 5, 12, 9, 30, 0, 0).getTime();

describe("DateTimeInput", () => {
  it("renders the label with an (Optional) hint when not required", () => {
    render(<DateTimeInput label="Starts at" name="startsAt" />);
    expect(screen.getByText(/optional/i)).toBeInTheDocument();
  });

  it("renders editable date segments and a calendar trigger", () => {
    render(<DateTimeInput label="Starts at" name="startsAt" />);
    expect(screen.getAllByRole("spinbutton").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /open calendar/i }),
    ).toBeInTheDocument();
  });

  it("serializes the default value into the hidden field as epoch ms", () => {
    render(
      <DateTimeInput label="Starts at" name="startsAt" defaultValue={sample} />,
    );
    const hidden = document.querySelector(
      "input[type='hidden'][name='startsAt']",
    );
    expect(hidden).toHaveValue(String(sample));
  });

  it("leaves the hidden field empty when there is no value", () => {
    render(<DateTimeInput label="Expires at" name="expiresAt" />);
    const hidden = document.querySelector(
      "input[type='hidden'][name='expiresAt']",
    );
    expect(hidden).toHaveValue("");
  });

  it("opens the calendar popover from the trigger", async () => {
    render(<DateTimeInput label="Starts at" name="startsAt" />);
    fireEvent.click(screen.getByRole("button", { name: /open calendar/i }));
    expect(await screen.findByRole("application")).toBeInTheDocument();
  });

  it("only renders day segments in date mode", () => {
    render(
      <DateTimeInput
        label="Day"
        name="day"
        mode="date"
        defaultValue={sample}
      />,
    );
    const hidden = document.querySelector("input[type='hidden'][name='day']");
    // Date-only normalizes to local midnight.
    const expected = new Date(2026, 5, 12, 0, 0, 0, 0).getTime();
    expect(hidden).toHaveValue(String(expected));
  });
});
