// @vitest-environment jsdom

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastRegion, toast, toastQueue } from "@idco/ui";

afterEach(() => {
  // Clear the global singleton queue between tests.
  const keys = toastQueue.visibleToasts.map((t) => t.key);
  keys.forEach((key) => toastQueue.close(key));
});

describe("ToastRegion + toast", () => {
  it("renders the daisyUI toast region class once a toast is queued", async () => {
    render(<ToastRegion />);
    act(() => {
      toast.info("Hi");
    });
    await waitFor(() => {
      expect(document.querySelector(".toast")).toBeInTheDocument();
    });
  });

  it("shows a success toast with title and description", async () => {
    render(<ToastRegion />);
    act(() => {
      toast.success("Saved", "Your changes were stored.");
    });
    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
      expect(screen.getByText("Your changes were stored.")).toBeInTheDocument();
    });
    expect(document.querySelector(".alert-success")).toBeInTheDocument();
  });

  it("applies the error tone class", async () => {
    render(<ToastRegion />);
    act(() => {
      toast.error("Something failed");
    });
    await waitFor(() => {
      expect(screen.getByText("Something failed")).toBeInTheDocument();
    });
    expect(document.querySelector(".alert-error")).toBeInTheDocument();
  });

  it("can be dismissed programmatically", async () => {
    render(<ToastRegion />);
    let key = "";
    act(() => {
      key = toast.info("Processing");
    });
    await waitFor(() =>
      expect(screen.getByText("Processing")).toBeInTheDocument(),
    );
    act(() => {
      toast.dismiss(key);
    });
    await waitFor(() =>
      expect(screen.queryByText("Processing")).not.toBeInTheDocument(),
    );
  });

  it("renders a close button for each toast", async () => {
    render(<ToastRegion />);
    act(() => {
      toast.warning("Heads up");
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /dismiss notification/i }),
      ).toBeInTheDocument();
    });
  });
});
