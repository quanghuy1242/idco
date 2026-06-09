// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Page,
  Container,
  PageSection,
  PageHeader,
  PageBody,
  Panel,
  Stack,
  Grid,
  Columns,
  Spacer,
  AppShell,
  Topbar,
  Sidebar,
  MainContent,
  MobileRouteTabs,
  MobileDock,
  TopbarAvatarMenu,
} from "@idco/ui";

describe("Page", () => {
  it("renders centered layout by default", () => {
    render(<Page>Content</Page>);
    const main = screen.getByText(/content/i).closest("main");
    expect(main).toHaveClass(
      "flex",
      "flex-col",
      "items-center",
      "justify-center",
    );
  });

  it("renders dashboard layout when specified", () => {
    render(<Page layout="dashboard">Dashboard</Page>);
    const main = screen.getByText(/dashboard/i).closest("main");
    expect(main).toHaveClass("flex", "flex-col");
    expect(main).not.toHaveClass("items-center", "justify-center");
  });

  it("wraps content in Container and Stack for centered layout", () => {
    render(<Page>Centered</Page>);
    expect(screen.getByText(/centered/i)).toBeInTheDocument();
  });
});

describe("Container", () => {
  it("renders wide width by default", () => {
    const { container } = render(<Container>Wide</Container>);
    expect(container.firstChild).toHaveClass("max-w-7xl");
  });

  it("renders narrow width", () => {
    const { container } = render(<Container width="narrow">Narrow</Container>);
    expect(container.firstChild).toHaveClass("max-w-md");
  });

  it("renders content width", () => {
    const { container } = render(
      <Container width="content">Content</Container>,
    );
    expect(container.firstChild).toHaveClass("max-w-3xl");
  });

  it("renders full width", () => {
    const { container } = render(<Container width="full">Full</Container>);
    expect(container.firstChild).toHaveClass("max-w-none");
  });
});

describe("PageSection", () => {
  it("renders with md padding by default", () => {
    render(<PageSection>Section</PageSection>);
    const section = screen.getByText(/section/i).closest("section");
    expect(section).toHaveClass("p-6");
  });

  it("renders with sm padding", () => {
    render(<PageSection padding="sm">Small</PageSection>);
    expect(screen.getByText(/small/i).closest("section")).toHaveClass("p-3");
  });

  it("renders with lg padding", () => {
    render(<PageSection padding="lg">Large</PageSection>);
    expect(screen.getByText(/large/i).closest("section")).toHaveClass("p-8");
  });

  it("renders with no padding", () => {
    render(<PageSection padding="none">None</PageSection>);
    expect(screen.getByText(/none/i).closest("section")).toHaveClass("p-0");
  });
});

describe("PageHeader", () => {
  it("renders as a header element", () => {
    render(<PageHeader>Header</PageHeader>);
    const header = screen.getByText(/header/i).closest("header");
    expect(header).toBeInTheDocument();
    expect(header).toHaveClass("border-b", "bg-base-100");
  });
});

describe("PageBody", () => {
  it("renders with flex-1 for content area", () => {
    render(<PageBody>Body</PageBody>);
    const body = screen.getByText(/body/i).parentElement;
    expect(body).toHaveClass("flex-1");
  });
});

describe("Panel", () => {
  it("renders with base tone by default", () => {
    render(<Panel>Panel</Panel>);
    const panel = screen.getByText(/panel/i).closest("section");
    expect(panel).toHaveClass(
      "card",
      "bg-base-100",
      "border",
      "border-base-300",
    );
  });

  it("renders with muted tone", () => {
    render(<Panel tone="muted">Muted</Panel>);
    const panel = screen.getByText(/muted/i).closest("section");
    expect(panel).toHaveClass("bg-base-200");
  });

  it("renders with md padding by default", () => {
    render(<Panel>Default</Panel>);
    const panel = screen.getByText(/default/i).closest("section");
    expect(panel).toHaveClass("p-6");
  });

  it("renders with sm padding", () => {
    render(<Panel padding="sm">Small</Panel>);
    expect(screen.getByText(/small/i).closest("section")).toHaveClass("p-3");
  });
});

describe("Stack", () => {
  it("renders children in a flex column", () => {
    const { container } = render(
      <Stack>
        <span>Item 1</span>
        <span>Item 2</span>
      </Stack>,
    );
    expect(container.firstChild).toHaveClass("flex", "flex-col");
  });

  it("applies md gap by default", () => {
    const { container } = render(<Stack>Content</Stack>);
    expect(container.firstChild).toHaveClass("gap-4");
  });

  it("applies xs gap when specified", () => {
    const { container } = render(<Stack gap="xs">XS</Stack>);
    expect(container.firstChild).toHaveClass("gap-1");
  });

  it("applies sm gap when specified", () => {
    const { container } = render(<Stack gap="sm">SM</Stack>);
    expect(container.firstChild).toHaveClass("gap-2");
  });

  it("applies lg gap when specified", () => {
    const { container } = render(<Stack gap="lg">LG</Stack>);
    expect(container.firstChild).toHaveClass("gap-6");
  });

  it("applies start alignment when specified", () => {
    const { container } = render(<Stack align="start">Aligned</Stack>);
    expect(container.firstChild).toHaveClass("items-start");
  });

  it("can fill height and distribute children", () => {
    const { container } = render(
      <Stack fill justify="between">
        Aligned
      </Stack>,
    );
    expect(container.firstChild).toHaveClass("h-full", "justify-between");
  });
});

describe("Grid", () => {
  it("renders one column by default", () => {
    const { container } = render(<Grid>Grid</Grid>);
    expect(container.firstChild).toHaveClass("grid-cols-1");
  });

  it("renders two columns with responsive breakpoint", () => {
    const { container } = render(<Grid columns="two">Two</Grid>);
    expect(container.firstChild).toHaveClass("grid-cols-1", "md:grid-cols-2");
  });

  it("renders three columns with responsive breakpoint", () => {
    const { container } = render(<Grid columns="three">Three</Grid>);
    expect(container.firstChild).toHaveClass("grid-cols-1", "md:grid-cols-3");
  });

  it("applies md gap by default", () => {
    const { container } = render(<Grid>Default</Grid>);
    expect(container.firstChild).toHaveClass("gap-4");
  });

  it("applies custom gap", () => {
    const { container } = render(<Grid gap="lg">Large</Grid>);
    expect(container.firstChild).toHaveClass("gap-6");
  });
});

describe("Columns", () => {
  it("renders with sidebar layout", () => {
    const { container } = render(<Columns>Columns</Columns>);
    expect(container.firstChild).toHaveClass(
      "grid",
      "grid-cols-1",
      "lg:grid-cols-[minmax(0,1fr)_20rem]",
    );
  });

  it("applies md gap by default", () => {
    const { container } = render(<Columns>Default</Columns>);
    expect(container.firstChild).toHaveClass("gap-4");
  });
});

function getSpacerElement() {
  return document.querySelector("[aria-hidden='true']");
}

describe("Spacer", () => {
  it("renders md size by default", () => {
    render(<Spacer />);
    const spacer = getSpacerElement();
    expect(spacer).toHaveClass("h-4");
  });

  it("renders xs size", () => {
    render(<Spacer size="xs" />);
    const spacer = getSpacerElement();
    expect(spacer).toHaveClass("h-1");
  });

  it("renders sm size", () => {
    render(<Spacer size="sm" />);
    const spacer = getSpacerElement();
    expect(spacer).toHaveClass("h-2");
  });

  it("renders lg size", () => {
    render(<Spacer size="lg" />);
    const spacer = getSpacerElement();
    expect(spacer).toHaveClass("h-6");
  });
});

describe("AppShell", () => {
  it("renders with base styling", () => {
    const { container } = render(<AppShell>Shell</AppShell>);
    expect(container.firstChild).toHaveClass(
      "h-screen",
      "overflow-hidden",
      "flex",
      "flex-col",
      "bg-base-200",
      "text-base-content",
    );
  });

  it("renders children content", () => {
    render(
      <AppShell>
        <span data-testid="shell-child">Content</span>
      </AppShell>,
    );
    expect(screen.getByTestId("shell-child")).toBeInTheDocument();
    expect(screen.getByTestId("shell-child")).toHaveTextContent("Content");
  });

  it("does not render empty fragments in output", () => {
    const { container } = render(<AppShell />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe("Topbar", () => {
  it("renders as a navbar header", () => {
    render(<Topbar>Top</Topbar>);
    const header = screen.getByText(/top/i).closest("header");
    expect(header).toHaveClass("navbar", "bg-base-100", "border-b");
  });
});

describe("TopbarAvatarMenu", () => {
  it("labels the avatar menu trigger", () => {
    render(
      <TopbarAvatarMenu
        items={[{ label: "Logout", onAction: () => undefined }]}
      />,
    );
    expect(
      screen.getByRole("button", { name: /open account menu/i }),
    ).toBeInTheDocument();
  });

  it("constrains long account labels inside the menu", async () => {
    render(
      <TopbarAvatarMenu
        items={[
          {
            label: "quanghuy1242@gmail.com",
            badge: "Account",
            onAction: () => undefined,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));

    expect(await screen.findByRole("menu")).toHaveClass(
      "w-72",
      "max-w-[calc(100vw-1rem)]",
      "overflow-hidden",
    );
    expect(screen.getByText("quanghuy1242@gmail.com")).toHaveClass(
      "min-w-0",
      "flex-1",
      "truncate",
    );
    expect(screen.getByText("Account")).toHaveClass("shrink-0");
  });
});

describe("Sidebar", () => {
  it("renders as a sidebar container", () => {
    render(<Sidebar>Side</Sidebar>);
    const aside = screen.getByText(/side/i).closest("aside");
    expect(aside).toHaveClass(
      "w-72",
      "bg-base-100",
      "border-r",
      "p-4",
      "overflow-y-auto",
    );
  });
});

describe("MainContent", () => {
  it("adds mobile dock clearance to the scroll container", () => {
    render(<MainContent>Main</MainContent>);
    const main = screen.getByText(/main/i).closest("main");
    expect(main).toHaveClass(
      "overflow-y-auto",
      "pb-[calc(4rem+env(safe-area-inset-bottom))]",
      "scroll-pb-[calc(4rem+env(safe-area-inset-bottom))]",
      "lg:pb-0",
      "lg:scroll-pb-0",
    );
  });
});

describe("MobileDock", () => {
  it("renders as a dock nav", () => {
    render(<MobileDock>Dock</MobileDock>);
    const nav = screen.getByText(/dock/i).closest("nav");
    expect(nav).toHaveClass(
      "dock",
      "bg-base-100",
      "border-t",
      "border-base-300",
      "lg:hidden",
    );
  });

  it("exposes an accessible navigation label for mobile layouts", () => {
    render(
      <MobileDock>
        <span>Admin</span>
      </MobileDock>,
    );
    expect(
      screen.getByRole("navigation", { name: /primary mobile navigation/i }),
    ).toHaveClass("lg:hidden");
  });

  it("allows a specific accessible navigation label", () => {
    render(<MobileDock ariaLabel="Admin mobile navigation">Dock</MobileDock>);
    expect(
      screen.getByRole("navigation", { name: /admin mobile navigation/i }),
    ).toBeInTheDocument();
  });
});

describe("MobileRouteTabs", () => {
  it("renders a mobile-only route tab container", () => {
    render(<MobileRouteTabs>Tabs</MobileRouteTabs>);
    expect(screen.getByText(/tabs/i)).toHaveClass(
      "lg:hidden",
      "border-b",
      "border-base-300",
      "bg-base-100",
      "px-6",
    );
  });
});
