// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NavIcon } from "@idco/ui";

describe("NavIcon", () => {
  it("renders a registered icon (Copy) as an svg", () => {
    const { container } = render(<NavIcon name="Copy" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders a registered icon (RefreshCw) as an svg", () => {
    const { container } = render(<NavIcon name="RefreshCw" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("renders the sidebar size by default", () => {
    const { container } = render(<NavIcon name="Copy" />);
    expect(container.querySelector("svg")).toHaveClass("size-4");
  });

  it("renders the dock size for the dock variant", () => {
    const { container } = render(<NavIcon name="Copy" variant="dock" />);
    expect(container.querySelector("svg")).toHaveClass("size-[1.2em]");
  });

  it("renders the timeline size for timeline markers", () => {
    const { container } = render(<NavIcon name="Check" variant="timeline" />);
    expect(container.querySelector("svg")).toHaveClass("size-2.5");
  });

  it("renders nothing for an unregistered name", () => {
    const { container } = render(
      <NavIcon name="DefinitelyNotARegisteredIcon" />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders nothing when no name is given", () => {
    const { container } = render(<NavIcon />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
