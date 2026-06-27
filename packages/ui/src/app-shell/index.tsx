// DaisyUI 5: https://daisyui.com/components/menu/
"use client";
/**
 * Admin shell primitives — a topbar, sidebar, and main-content frame plus nav menus, links, a mobile dock and route tabs, breadcrumb, and avatar menu, built with React Aria behavior and DaisyUI styling.
 *
 * @categoryDefault App Shell
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { MenuTrigger as AriaMenuTrigger, Popover } from "react-aria-components";
import { Avatar } from "../avatar";
import { Button } from "../button";
import { Menu, MenuItem } from "../menu";
import { NavIcon } from "../nav-icons";

type SurfaceProps = {
  readonly children?: ReactNode;
};

/**
 * Full-height root frame that stacks the topbar and content area and applies base admin theming.
 */
export function AppShell({ children }: SurfaceProps) {
  return (
    <div className="h-screen overflow-hidden flex flex-col bg-base-200 text-base-content">
      {children}
    </div>
  );
}

/**
 * Sticky top navbar bar that holds brand, breadcrumb, and account controls.
 */
export function Topbar({ children }: SurfaceProps) {
  return (
    <header className="navbar min-h-16 shrink-0 bg-base-100 border-b border-base-300 shadow-sm px-4 sm:px-6">
      {children}
    </header>
  );
}

/**
 * Left-aligned region of the topbar that grows to fill available space.
 */
export function TopbarStart({ children }: SurfaceProps) {
  return <div className="navbar-start flex-1 w-auto gap-2">{children}</div>;
}

/**
 * Right-aligned region of the topbar for trailing actions such as the avatar menu.
 */
export function TopbarEnd({ children }: SurfaceProps) {
  return <div className="navbar-end w-auto gap-2">{children}</div>;
}

/**
 * Fixed-width scrollable side rail for primary navigation, shown only on large screens.
 */
export function Sidebar({ children }: SurfaceProps) {
  return (
    <aside className="hidden lg:block w-72 shrink-0 border-r border-base-300 bg-base-100 p-4 overflow-y-auto">
      {children}
    </aside>
  );
}

/**
 * Section heading rendered as a DaisyUI menu title inside a nav menu list.
 */
export function NavTitle({ children }: SurfaceProps) {
  return (
    <li>
      <h2 className="menu-title px-3 pt-4 pb-1">{children}</h2>
    </li>
  );
}

/**
 * Horizontal flex row that places the sidebar beside the main content area.
 */
export function SidebarLayout({ children }: SurfaceProps) {
  return <div className="flex flex-1 min-h-0 overflow-hidden">{children}</div>;
}

/**
 * Scrollable primary content column with mobile-dock-aware bottom padding.
 */
export function MainContent({ children }: SurfaceProps) {
  return (
    <main className="flex flex-col flex-1 min-h-0 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] scroll-pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0 lg:scroll-pb-0">
      {children}
    </main>
  );
}

/**
 * Mobile-only horizontal tab strip shown below the topbar for the current route's sub-navigation.
 */
export function MobileRouteTabs({ children }: SurfaceProps) {
  return (
    <div className="lg:hidden border-b border-base-300 bg-base-100 px-6">
      {children}
    </div>
  );
}

/**
 * Props for {@link MobileDock}.
 */
type MobileDockProps = SurfaceProps & {
  /** Accessible label announced for the dock navigation landmark. */
  readonly ariaLabel?: string;
};

/**
 * Fixed bottom navigation bar holding {@link DockLink} items, shown only on small screens.
 */
export function MobileDock({
  ariaLabel = "Primary mobile navigation",
  children,
}: MobileDockProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className="dock bg-base-100 border-t border-base-300 lg:hidden"
    >
      {children}
    </nav>
  );
}

/**
 * Props for {@link NavMenu}.
 */
type NavMenuProps = SurfaceProps & {
  /** Accessible label announced for the nav landmark wrapping the menu list. */
  readonly label?: string;
};

/**
 * Navigation landmark wrapping a DaisyUI menu list of {@link NavLink} and {@link NavSection} items.
 */
export function NavMenu({ label, children }: NavMenuProps) {
  return (
    <nav aria-label={label}>
      <ul className="menu w-full p-0">{children}</ul>
    </nav>
  );
}

/**
 * Props for {@link NavSection}.
 */
type NavSectionProps = SurfaceProps & {
  /** Optional heading shown above the section's links. */
  readonly title?: string;
  /** When true and a title is set, renders the section as an expandable details/summary group. */
  readonly collapsible?: boolean;
};

/**
 * Grouped block of nav links with an optional title, rendered flat or as a collapsible disclosure.
 */
export function NavSection({
  title,
  collapsible = false,
  children,
}: NavSectionProps) {
  if (collapsible && title) {
    return (
      <li>
        <details open>
          <summary>{title}</summary>
          <ul>{children}</ul>
        </details>
      </li>
    );
  }

  return (
    <li>
      {title ? <h2 className="menu-title">{title}</h2> : null}
      <ul>{children}</ul>
    </li>
  );
}

/**
 * Props for {@link NavLink}.
 */
type NavLinkProps = {
  /** Destination route for the link. */
  readonly href: string;
  /** Whether the link represents the current location, applying active styling. */
  readonly active?: boolean;
  /** Sets `aria-current` when this link points to the active page. */
  readonly current?: "page";
  /** Registered icon name rendered before the label in sidebar variant. */
  readonly iconName?: string;
  readonly children: ReactNode;
};

/**
 * Sidebar menu item linking to a route, with an optional leading icon and active highlight.
 */
export function NavLink({
  href,
  active = false,
  current,
  iconName,
  children,
}: NavLinkProps) {
  return (
    <li>
      <Link
        href={href}
        aria-current={current}
        className={active ? "menu-active" : undefined}
        style={
          active
            ? {
                backgroundColor: "var(--color-primary)",
                color: "var(--color-primary-content)",
              }
            : undefined
        }
      >
        {iconName ? <NavIcon name={iconName} variant="sidebar" /> : null}
        {children}
      </Link>
    </li>
  );
}

/**
 * Props for {@link DockLink}.
 */
type DockLinkProps = {
  /** Destination route for the dock item. */
  readonly href: string;
  /** Whether the item represents the current location, applying active styling. */
  readonly active?: boolean;
  /** Sets `aria-current` when this item points to the active page. */
  readonly current?: "page";
  /** Text shown beneath the icon as the dock label. */
  readonly label: string;
  /** Registered icon name rendered in dock variant; a dot is shown when omitted. */
  readonly iconName?: string;
};

/**
 * Single icon-and-label destination within {@link MobileDock}, with an active highlight.
 */
export function DockLink({
  href,
  active = false,
  current,
  label,
  iconName,
}: DockLinkProps) {
  return (
    <Link
      href={href}
      aria-current={current}
      className={active ? "dock-active" : undefined}
    >
      {iconName ? (
        <NavIcon name={iconName} variant="dock" />
      ) : (
        <span
          className="size-[0.35rem] rounded-full bg-current opacity-70"
          aria-hidden="true"
        />
      )}
      <span className="dock-label">{label}</span>
    </Link>
  );
}

/**
 * Props for {@link TopbarBrandLink}.
 */
type BrandLinkProps = {
  /** Destination route for the brand link, typically the dashboard home. */
  readonly href: string;
  readonly children: ReactNode;
};

/**
 * Ghost-styled brand or wordmark link rendered at the start of the topbar.
 */
export function TopbarBrandLink({ href, children }: BrandLinkProps) {
  return (
    <Link
      href={href}
      className="btn btn-ghost text-xl font-semibold normal-case"
    >
      {children}
    </Link>
  );
}

/**
 * Props for {@link TopbarBreadcrumb}.
 */
type TopbarBreadcrumbProps = {
  /** Ordered breadcrumb segment labels from root to current page. */
  readonly items: readonly string[];
};

/**
 * DaisyUI breadcrumb trail rendering an ordered list of location labels in the topbar.
 */
export function TopbarBreadcrumb({ items }: TopbarBreadcrumbProps) {
  return (
    <div className="breadcrumbs text-sm text-base-content/60">
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A single entry in the topbar account menu, navigating via `href` or invoking `onAction`.
 */
type TopbarAvatarMenuItem = {
  /** Visible text for the menu entry. */
  readonly label: string;
  /** Optional trailing badge text, e.g. a count or status tag. */
  readonly badge?: string;
  /** Route to navigate to when the item is selected; mutually used with or in place of `onAction`. */
  readonly href?: string;
  /** Callback fired when the item is activated. */
  readonly onAction?: () => void;
};

/**
 * Props for {@link TopbarAvatarMenu}.
 */
type TopbarAvatarMenuProps = {
  /** Accessible label for the avatar trigger button. */
  readonly ariaLabel?: string;
  /** Initials shown inside the avatar when no image is provided. */
  readonly initials?: string;
  /** Account menu entries rendered in the popover. */
  readonly items: readonly TopbarAvatarMenuItem[];
};

/**
 * Avatar button that opens a React Aria menu of account actions in a DaisyUI-styled popover.
 */
export function TopbarAvatarMenu({
  ariaLabel = "Open account menu",
  initials = "AD",
  items,
}: TopbarAvatarMenuProps) {
  return (
    <AriaMenuTrigger aria-label={ariaLabel}>
      <Button variant="ghost" size="sm" circle ariaLabel={ariaLabel}>
        <Avatar initials={initials} size="sm" />
      </Button>
      <Popover
        className="z-50 max-w-[calc(100vw-1rem)] data-[entering]:animate-popover-in data-[exiting]:animate-popover-out"
        placement="bottom end"
        offset={4}
        crossOffset={0}
        containerPadding={8}
      >
        <Menu className="w-72 max-w-[calc(100vw-1rem)] overflow-hidden">
          {items.map((item) => (
            <MenuItem
              key={item.href ?? item.label}
              href={item.href}
              textValue={item.label}
              className="flex min-w-0 items-center gap-2"
              onAction={item.onAction}
            >
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.badge ? (
                <span className="badge badge-sm shrink-0">{item.badge}</span>
              ) : null}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </AriaMenuTrigger>
  );
}
