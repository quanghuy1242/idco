import { useState } from "react";
import type { Story, StoryDefault } from "@ladle/react";
import {
  AppShell,
  Badge,
  Button,
  DockLink,
  Inline,
  MainContent,
  MobileFilterMenu,
  Menu,
  MenuItem,
  MenuTrigger,
  MobileDock,
  MobileRouteTabs,
  NavLink,
  NavMenu,
  NavSection,
  NavTitle,
  Panel,
  ResponsiveActions,
  ResponsiveBreadcrumb,
  Sidebar,
  SidebarLayout,
  ScopePickerTrigger,
  Stack,
  Tabs,
  Text,
  Topbar,
  TopbarAvatarMenu,
  TopbarBrandLink,
  TopbarBreadcrumb,
  TopbarEnd,
  TopbarSearchField,
  TopbarStart,
  type PanelTabItem,
} from "@idco/ui";

export default { title: "Packages UI / Navigation" } satisfies StoryDefault;

const tabs: PanelTabItem[] = [
  {
    id: "overview",
    label: "Overview",
    content: <Text>Overview panel content.</Text>,
  },
  {
    id: "activity",
    label: "Activity",
    content: <Text>Activity panel content.</Text>,
  },
  {
    id: "settings",
    label: "Settings",
    content: <Text>Settings panel content.</Text>,
  },
];

export const Shell: Story = () => (
  <AppShell>
    <Topbar>
      <TopbarStart>
        <TopbarBrandLink href="/">IDCO</TopbarBrandLink>
        <TopbarBreadcrumb items={["Platform", "Access", "Members"]} />
      </TopbarStart>
      <TopbarEnd>
        <TopbarSearchField placeholder="Search" />
        <TopbarAvatarMenu
          initials="ID"
          items={[
            { label: "Profile", href: "/profile" },
            { label: "Workspace", href: "/workspace", badge: "Admin" },
            { label: "Sign out", onAction: () => {} },
          ]}
        />
      </TopbarEnd>
    </Topbar>
    <SidebarLayout>
      <Sidebar>
        <NavMenu label="Primary">
          <NavTitle>Platform</NavTitle>
          <NavSection>
            <NavLink
              href="/overview"
              iconName="LayoutDashboard"
              active
              current="page"
            >
              Overview
            </NavLink>
            <NavLink href="/members" iconName="Users">
              Members
            </NavLink>
            <NavLink href="/security" iconName="ShieldCheck">
              Security
            </NavLink>
          </NavSection>
          <NavSection title="Settings" collapsible>
            <NavLink href="/settings" iconName="Settings">
              General
            </NavLink>
            <NavLink href="/integrations" iconName="Boxes">
              Integrations
            </NavLink>
          </NavSection>
        </NavMenu>
      </Sidebar>
      <MainContent>
        <MobileRouteTabs>
          <Tabs
            ariaLabel="Mobile route tabs"
            items={[
              { id: "overview", label: "Overview", href: "/overview" },
              { id: "members", label: "Members", href: "/members" },
              { id: "security", label: "Security", href: "/security" },
            ]}
            selectedKey="overview"
            size="sm"
          />
        </MobileRouteTabs>
        <div className="p-6">
          <Panel>
            <Stack>
              <Text variant="h1">Main content</Text>
              <Text>
                AppShell, Topbar, Sidebar, MainContent, MobileRouteTabs,
                MobileDock, and nav links.
              </Text>
            </Stack>
          </Panel>
        </div>
      </MainContent>
    </SidebarLayout>
    <MobileDock>
      <DockLink
        href="/overview"
        label="Home"
        iconName="LayoutDashboard"
        active
        current="page"
      />
      <DockLink href="/members" label="Members" iconName="Users" />
      <DockLink href="/security" label="Security" iconName="ShieldCheck" />
    </MobileDock>
  </AppShell>
);

export const TabsAndBreadcrumbs: Story = () => {
  const [selected, setSelected] = useState("overview");

  return (
    <Stack>
      <ResponsiveBreadcrumb
        leadingItem={<Badge tone="info">Current</Badge>}
        items={[
          "Platform",
          "Organizations",
          "Acme Publishing",
          "Access",
          "Members",
        ]}
      />
      <Tabs
        ariaLabel="Panel tabs"
        items={tabs}
        selectedKey={selected}
        onSelectionChange={setSelected}
        variant="lift"
      />
      <Tabs
        ariaLabel="Link tabs"
        items={[
          { id: "general", label: "General", href: "/settings" },
          { id: "billing", label: "Billing", href: "/billing" },
          { id: "audit", label: "Audit", href: "/audit", disabled: true },
        ]}
        selectedKey="general"
        size="sm"
      />
    </Stack>
  );
};

export const MenusAndResponsiveActions: Story = () => (
  <Stack>
    <Inline>
      <MenuTrigger placement="bottom start">
        <Button variant="secondary" iconName="Ellipsis">
          Open menu
        </Button>
        <Menu aria-label="Example menu">
          <MenuItem id="copy" label="Copy link" />
          <MenuItem id="download" label="Download" />
          <MenuItem id="delete" label="Delete" />
        </Menu>
      </MenuTrigger>
      <Text variant="caption">Menu, MenuItem, and MenuTrigger</Text>
    </Inline>
    <Panel>
      <ResponsiveActions
        actions={[
          {
            id: "create",
            label: "Create",
            variant: "primary",
            iconName: "Plus",
            onAction: () => {},
          },
          {
            id: "export",
            label: "Export",
            iconName: "Download",
            onAction: () => {},
          },
          {
            id: "refresh",
            label: "Refresh",
            iconName: "RefreshCw",
            onAction: () => {},
          },
          {
            id: "delete",
            label: "Delete",
            variant: "danger",
            iconName: "Trash2",
            onAction: () => {},
          },
        ]}
      />
    </Panel>
    <Inline>
      <ScopePickerTrigger label="Acme Publishing" tone="accent" />
      <ScopePickerTrigger label="Platform" tone="info" />
    </Inline>
    <MobileFilterMenu
      groups={[
        {
          key: "status",
          label: "Status",
          value: "active",
          onChange: () => {},
          options: [
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
          ],
        },
        {
          key: "type",
          label: "Type",
          value: "all",
          onChange: () => {},
          options: [
            { value: "all", label: "All" },
            { value: "document", label: "Document" },
            { value: "config", label: "Config" },
          ],
        },
      ]}
    />
  </Stack>
);
