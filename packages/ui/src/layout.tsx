// DaisyUI 5: https://daisyui.com/components/card/
"use client";
/**
 * Page-frame and surface layout primitives that map typed spacing and alignment props onto flex/grid with DaisyUI surface tones.
 *
 * @categoryDefault Layout
 */
import type { ReactNode } from "react";

/** Spacing scale token for gaps between children. */
type Gap = "xs" | "sm" | "md" | "lg";
/** Cross-axis alignment token for laid-out children. */
type Align = "start" | "center" | "end" | "stretch";
/** Max-width scale token that constrains a container's content. */
type Width = "narrow" | "content" | "wide" | "xwide" | "full";
/** Inner padding scale token for surfaces. */
type Padding = "none" | "sm" | "md" | "lg";
/** Surface background tone token, neutral base or muted. */
type SurfaceTone = "base" | "muted";

/** Common base props shared by surface primitives, carrying only their children. */
type SurfaceProps = {
  readonly children?: ReactNode;
};

/** Props for {@link Page}. */
type PageProps = SurfaceProps & {
  /** Page frame mode: `centered` for a single narrow card, `dashboard` for a full-height column. */
  readonly layout?: "centered" | "dashboard";
};

const gapClass: Record<Gap, string> = {
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
};

const alignClass: Record<Align, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

const responsiveToolbarAlignClass: Record<Align, string> = {
  start: "md:items-start",
  center: "md:items-center",
  end: "md:items-end",
  stretch: "md:items-stretch",
};

const widthClass: Record<Width, string> = {
  narrow: "max-w-md",
  content: "max-w-3xl",
  wide: "max-w-7xl",
  // The step between `wide` (1280px) and edge-to-edge `full` (R1, note.md §5.7):
  // a CMS edit screen is an editor column plus a Publish/SEO sidebar, which is
  // cramped at `wide` and unbounded at `full`. Tailwind v4 dropped the
  // `max-w-screen-2xl` token, so this is the explicit 1536px arbitrary value.
  xwide: "max-w-[1536px]",
  full: "max-w-none",
};

const paddingClass: Record<Padding, string> = {
  none: "p-0",
  sm: "p-3",
  md: "p-6",
  lg: "p-8",
};

/** Full-screen page frame that either centers a narrow card or stacks a full-height dashboard column. */
export function Page({ layout = "centered", children }: PageProps) {
  if (layout === "centered") {
    return (
      <main className="min-h-screen bg-base-200 text-base-content font-sans flex flex-col items-center justify-center p-4">
        <Container width="narrow">
          <Stack>{children}</Stack>
        </Container>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-base-200 text-base-content font-sans flex flex-col">
      {children}
    </main>
  );
}

/** Props for {@link Container}. */
type ContainerProps = SurfaceProps & {
  /** Max-width constraint applied to the centered content. */
  readonly width?: Width;
};

/** Horizontally centered wrapper that constrains content to a chosen max-width. */
export function Container({ width = "wide", children }: ContainerProps) {
  return (
    <div className={`w-full ${widthClass[width]} mx-auto`}>{children}</div>
  );
}

/** Props for {@link PageSection}. */
type PageSectionProps = SurfaceProps & {
  /** Vertical and horizontal padding applied around the section's contained content. */
  readonly padding?: Padding;
};

/** Full-width page section that pads its area and centers its content in a container. */
export function PageSection({ padding = "md", children }: PageSectionProps) {
  return (
    <section className={`w-full ${paddingClass[padding]}`}>
      <Container>{children}</Container>
    </section>
  );
}

/** Props for {@link PageHeader} and {@link PageBody}. */
type PageRegionProps = SurfaceProps & {
  /** Max-width constraint forwarded to the inner container; defaults to `wide`. */
  readonly width?: Width;
};

/** Bordered top header bar that centers its content and spaces children apart in a row. */
export function PageHeader({ width = "wide", children }: PageRegionProps) {
  return (
    <header className="border-b border-base-300 bg-base-100 px-6 py-4 w-full">
      <Container width={width}>
        <div className="flex items-center justify-between">{children}</div>
      </Container>
    </header>
  );
}

/**
 * Flexible-height main content area that pads and centers its content below a page header.
 *
 * `width` is forwarded to the inner container so a content-CMS edit screen (an
 * editor column plus a sidebar) can widen past `wide` without dropping `PageBody`
 * and losing its padding/centering (R1, note.md §5.7). Keep it equal to the
 * `PageHeader` width so the header stays aligned with the body column.
 */
export function PageBody({ width = "wide", children }: PageRegionProps) {
  return (
    <div className="flex-1 p-6 w-full">
      <Container width={width}>{children}</Container>
    </div>
  );
}

/** Props for {@link Panel}. */
type PanelProps = SurfaceProps & {
  /** Surface background tone, `base` for the default card or `muted` for a recessed shade. */
  readonly tone?: SurfaceTone;
  /** Inner padding around the panel's content. */
  readonly padding?: Padding;
};

/** A bordered DaisyUI card surface with a selectable tone and inner padding. */
export function Panel({ tone = "base", padding = "md", children }: PanelProps) {
  const toneClass = tone === "muted" ? "bg-base-200" : "bg-base-100";
  return (
    <section
      className={`card ${toneClass} border border-base-300 shadow-sm ${paddingClass[padding]} w-full`}
    >
      {children}
    </section>
  );
}

/** Props for {@link Stack}. */
type StackProps = SurfaceProps & {
  /** Vertical spacing between stacked children. */
  readonly gap?: Gap;
  /** Cross-axis (horizontal) alignment of stacked children. */
  readonly align?: Align;
  /** Main-axis (vertical) distribution of stacked children. */
  readonly justify?: "start" | "between" | "end";
  /** When set, stretches the stack to fill its parent's height. */
  readonly fill?: boolean;
};

const justifyClass: Record<NonNullable<StackProps["justify"]>, string> = {
  start: "justify-start",
  between: "justify-between",
  end: "justify-end",
};

/** A vertical flex column that spaces, aligns, and distributes its children. */
export function Stack({
  gap = "md",
  align = "stretch",
  justify = "start",
  fill,
  children,
}: StackProps) {
  return (
    <div
      className={`flex flex-col ${alignClass[align]} ${justifyClass[justify]} ${gapClass[gap]} w-full ${fill ? "h-full" : ""}`.trim()}
    >
      {children}
    </div>
  );
}

/** Props for {@link Toolbar}. */
type ToolbarProps = SurfaceProps & {
  /** Spacing between toolbar children. */
  readonly gap?: Gap;
  /** Cross-axis alignment applied at the medium breakpoint and up. */
  readonly align?: Align;
};

/** A responsive action row that stacks on small screens and becomes a horizontal row at the medium breakpoint. */
export function Toolbar({
  gap = "sm",
  align = "center",
  children,
}: ToolbarProps) {
  return (
    <div
      className={`flex flex-col ${gapClass[gap]} md:flex-row ${responsiveToolbarAlignClass[align]}`}
    >
      {children}
    </div>
  );
}

/** Props for {@link PanelFooter}. */
type PanelFooterProps = SurfaceProps & {
  /** Horizontal distribution of footer children, spread apart or pushed to the end. */
  readonly justify?: "between" | "end";
};

/** A top-bordered footer row for panel actions, distributing its children horizontally. */
export function PanelFooter({
  justify = "between",
  children,
}: PanelFooterProps) {
  return (
    <div
      className={`flex items-center ${justifyClass[justify]} border-t border-base-300 px-4 py-3`}
    >
      {children}
    </div>
  );
}

/** Props for {@link Grid}. */
type GridProps = SurfaceProps & {
  /** Number of equal columns at the medium breakpoint and up; collapses to a single column below it. */
  readonly columns?: "one" | "two" | "three";
  /** Spacing between grid cells. */
  readonly gap?: Gap;
};

/** A responsive equal-column grid that collapses to one column on small screens. */
export function Grid({ columns = "one", gap = "md", children }: GridProps) {
  const columnsClass = {
    one: "grid-cols-1",
    two: "grid-cols-1 md:grid-cols-2",
    three: "grid-cols-1 md:grid-cols-3",
  }[columns];
  return (
    <div className={`grid ${columnsClass} ${gapClass[gap]}`}>{children}</div>
  );
}

/** Props for {@link Columns}. */
type ColumnsProps = SurfaceProps & {
  /** Spacing between the main column and the sidebar. */
  readonly gap?: Gap;
};

/** A two-track main-and-sidebar layout that collapses to a single column on small screens. */
export function Columns({ gap = "md", children }: ColumnsProps) {
  return (
    <div
      className={`grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] ${gapClass[gap]}`}
    >
      {children}
    </div>
  );
}

/** Props for {@link Spacer}. */
type SpacerProps = {
  /** Height of the empty gap, drawn from the spacing scale. */
  readonly size?: Gap;
};

/** A fixed-height, aria-hidden vertical gap inserted between elements. */
export function Spacer({ size = "md" }: SpacerProps) {
  const sizeClass = {
    xs: "h-1",
    sm: "h-2",
    md: "h-4",
    lg: "h-6",
  }[size];
  return <div aria-hidden="true" className={sizeClass} />;
}
