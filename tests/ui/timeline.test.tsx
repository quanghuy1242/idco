// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Timeline } from "@idco/ui";

describe("Timeline", () => {
  it("renders title, meta, and detail for each item", () => {
    render(
      <Timeline
        items={[
          {
            id: "1",
            title: "Secret rotated",
            meta: "by alice · 14:02",
            detail: "auth method unchanged",
          },
          { id: "2", title: "Application created", meta: "by bob · 10:00" },
        ]}
      />,
    );
    expect(screen.getByText("Secret rotated")).toBeInTheDocument();
    expect(screen.getByText("by alice · 14:02")).toBeInTheDocument();
    expect(screen.getByText("auth method unchanged")).toBeInTheDocument();
    expect(screen.getByText("Application created")).toBeInTheDocument();
  });

  it("applies the tone class to the marker", () => {
    const { container } = render(
      <Timeline items={[{ id: "1", title: "Rotated", tone: "warning" }]} />,
    );
    expect(container.querySelector(".timeline-middle")).toHaveClass(
      "text-warning",
    );
  });

  it("renders an icon when provided", () => {
    const { container } = render(
      <Timeline items={[{ id: "1", title: "Rotated", icon: "RefreshCw" }]} />,
    );
    expect(container.querySelector(".timeline-middle svg")).toBeInTheDocument();
  });

  it("renders an empty list without crashing", () => {
    const { container } = render(<Timeline items={[]} />);
    expect(container.querySelector("ul.timeline")).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});
