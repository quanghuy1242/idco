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

  it("uses DaisyUI timeline markers and connector segments", () => {
    const { container } = render(
      <Timeline
        items={[
          { id: "1", title: "Created", tone: "success", icon: "Check" },
          { id: "2", title: "Reviewed", tone: "info" },
          { id: "3", title: "Published", tone: "primary", icon: "Upload" },
        ]}
      />,
    );
    expect(container.querySelector("ul")).toHaveClass(
      "timeline",
      "timeline-snap-icon",
      "timeline-vertical",
      "timeline-compact",
    );
    expect(container.querySelector(".timeline-middle > span")).toHaveClass(
      "size-4",
      "rounded-full",
    );
    expect(container.querySelector(".timeline-middle svg")).toHaveClass(
      "size-2.5",
    );
    expect(
      container.querySelectorAll(".timeline-middle > span.size-4"),
    ).toHaveLength(3);
    expect(container.querySelectorAll("hr")).toHaveLength(4);
  });

  it("renders an empty list without crashing", () => {
    const { container } = render(<Timeline items={[]} />);
    expect(container.querySelector("ul.timeline")).toBeInTheDocument();
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});
