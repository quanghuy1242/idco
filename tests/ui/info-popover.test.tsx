// @vitest-environment jsdom

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InfoPopover } from "@idco/ui";

describe("InfoPopover", () => {
  it("renders a labelled trigger button", () => {
    render(
      <InfoPopover label="About roles">Roles control access.</InfoPopover>,
    );
    expect(
      screen.getByRole("button", { name: /about roles/i }),
    ).toBeInTheDocument();
  });

  it("reveals teaching content on click", async () => {
    render(
      <InfoPopover title="Roles" label="About roles">
        Admins can manage everything.
      </InfoPopover>,
    );
    fireEvent.click(screen.getByRole("button", { name: /about roles/i }));
    await waitFor(() => {
      expect(
        screen.getByText("Admins can manage everything."),
      ).toBeInTheDocument();
      expect(screen.getByText("Roles")).toBeInTheDocument();
    });
  });

  it("does not show content before it is opened", () => {
    render(
      <InfoPopover label="About roles">Hidden until clicked.</InfoPopover>,
    );
    expect(screen.queryByText("Hidden until clicked.")).not.toBeInTheDocument();
  });

  it("uses the help icon variant without error", () => {
    render(
      <InfoPopover icon="help" label="Help">
        Need help?
      </InfoPopover>,
    );
    expect(screen.getByRole("button", { name: /help/i })).toBeInTheDocument();
  });
});
