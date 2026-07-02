import type { Story, StoryDefault } from "@ladle/react";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  CodeBlock,
  Columns,
  Container,
  EmptyState,
  ErrorAlert,
  Grid,
  Heading,
  Inline,
  LinkButton,
  NavIcon,
  Page,
  PageBody,
  PageHeader,
  PageIntro,
  PageSection,
  Panel,
  PanelFooter,
  Skeleton,
  Spacer,
  Stack,
  Text,
  Toolbar,
  focusRing,
} from "@idco/ui";

export default { title: "Packages UI / Foundations" } satisfies StoryDefault;

const iconNames = [
  "Activity",
  "AppWindow",
  "Bell",
  "Building2",
  "Check",
  "Clock",
  "Copy",
  "Download",
  "FileText",
  "LayoutDashboard",
  "Pencil",
  "Plus",
  "RefreshCw",
  "Settings",
  "ShieldCheck",
  "Trash2",
  "Upload",
  "Users",
] as const;

export const LayoutSurfaces: Story = () => (
  <Page layout="dashboard">
    <PageHeader>
      <Stack gap="xs">
        <Heading level="h1">Shared UI preview</Heading>
        <Text variant="caption">
          PageHeader, PageBody, Container, Stack, Toolbar, Panel, Grid, and
          PanelFooter
        </Text>
      </Stack>
      <Toolbar>
        <Button variant="secondary" iconName="Settings">
          Settings
        </Button>
        <Button iconName="Plus">Create</Button>
      </Toolbar>
    </PageHeader>
    <PageBody>
      <Stack>
        <PageIntro
          title="Reusable admin foundations"
          description="Shared layout primitives keep product routes focused on composition."
          info="These primitives live in @idco/ui so product apps can share structure without copying markup."
          actions={<Button iconName="Plus">Primary action</Button>}
        />
        <Grid columns="three">
          <Panel>
            <Stack gap="sm">
              <Text variant="h2">Panel</Text>
              <Text>Base surface with semantic spacing and border tokens.</Text>
            </Stack>
          </Panel>
          <Panel tone="muted">
            <Stack gap="sm">
              <Text variant="h2">Muted panel</Text>
              <Text>
                Secondary grouping that stays inside the theme palette.
              </Text>
            </Stack>
          </Panel>
          <Panel padding="none">
            <Stack gap="sm">
              <div className="px-4 pt-4">
                <Text variant="h2">Footer</Text>
              </div>
              <PanelFooter>
                <Text variant="caption">PanelFooter</Text>
                <Button size="sm">Save</Button>
              </PanelFooter>
            </Stack>
          </Panel>
        </Grid>
        <Columns>
          <Panel>
            <Text>Primary column content</Text>
          </Panel>
          <Panel tone="muted">
            <Text>Secondary column content</Text>
          </Panel>
        </Columns>
        <PageSection padding="sm">
          <Container width="content">
            <Panel tone="muted">
              <Text variant="caption">
                PageSection and Container width controls
              </Text>
            </Panel>
          </Container>
        </PageSection>
      </Stack>
    </PageBody>
  </Page>
);

// R1 (note.md §5.7): `PageBody`/`PageHeader` take a `width`, forwarded to the
// inner container, plus the new `xwide` (1536px) step between `wide` (1280px) and
// edge-to-edge `full`. A content-CMS edit screen (editor column + Publish/SEO
// sidebar) is cramped at `wide` and unbounded at `full`; `xwide` is the in-between.
// Each row keeps its header and body on the SAME width so they stay aligned. A
// tinted body box visualizes the column extent at each step.
export const PageBodyWidths: Story = () => {
  const widths = ["wide", "xwide", "full"] as const;
  return (
    <Page layout="dashboard">
      {widths.map((width) => (
        <div key={width} className="border-b border-base-300">
          <PageHeader width={width}>
            <Heading level="h2">width=&quot;{width}&quot;</Heading>
            <Text variant="caption">header + body share the width</Text>
          </PageHeader>
          <PageBody width={width}>
            <Panel tone="muted">
              <Text>
                Main content column at <code>{width}</code>. The editor column
                plus a Publish/SEO sidebar fits here without dropping PageBody.
              </Text>
            </Panel>
          </PageBody>
        </div>
      ))}
    </Page>
  );
};

export const TypographyAndInline: Story = () => (
  <Stack>
    <Heading level="h1">Heading h1</Heading>
    <Heading level="h2">Heading h2</Heading>
    <Heading level="h3">Heading h3</Heading>
    <Text>Body text uses the package type scale and theme content tokens.</Text>
    <Text variant="caption">Caption text supports supporting metadata.</Text>
    <Text mono>usr_01HZR706YH7CEXAMPLE</Text>
    <Inline gap="sm" align="center">
      <Badge tone="primary">Inline</Badge>
      <Badge tone="success">Wraps</Badge>
      <Badge tone="warning">Across rows</Badge>
    </Inline>
    <Spacer size="sm" />
    <Toolbar align="end">
      <Button variant="secondary" size="sm">
        Cancel
      </Button>
      <Button size="sm">Continue</Button>
    </Toolbar>
  </Stack>
);

export const ButtonsBadgesAndAvatars: Story = () => (
  <Stack>
    <Inline gap="sm">
      <Button variant="primary" iconName="Plus">
        Primary
      </Button>
      <Button variant="secondary" iconName="Pencil">
        Secondary
      </Button>
      <Button variant="danger" iconName="Trash2">
        Danger
      </Button>
      <Button
        variant="ghost"
        iconName="Ellipsis"
        ariaLabel="More actions"
        tooltip="More actions"
      />
      <Button
        variant="primary"
        circle
        iconName="Plus"
        ariaLabel="Add"
        tooltip="Add item"
      />
      <Button
        variant="secondary"
        square
        iconName="Copy"
        ariaLabel="Copy"
        tooltip="Copy"
      />
      <LinkButton href="/settings" iconName="Settings" variant="secondary">
        Settings link
      </LinkButton>
    </Inline>
    <Inline gap="sm">
      <Badge tone="neutral">neutral</Badge>
      <Badge tone="primary">primary</Badge>
      <Badge tone="secondary">secondary</Badge>
      <Badge tone="accent">accent</Badge>
      <Badge tone="success">success</Badge>
      <Badge tone="warning">warning</Badge>
      <Badge tone="error">error</Badge>
      <Badge tone="info">info</Badge>
    </Inline>
    <Inline gap="md">
      <Avatar initials="ID" size="xs" />
      <Avatar initials="ID" size="sm" />
      <Avatar initials="ID" size="md" />
      <Avatar initials="ID" size="lg" />
    </Inline>
  </Stack>
);

export const Icons: Story = () => (
  <Grid columns="three">
    {iconNames.map((name) => (
      <Panel key={name} padding="sm">
        <Inline gap="sm">
          <NavIcon name={name} />
          <Text variant="caption" mono>
            {name}
          </Text>
        </Inline>
      </Panel>
    ))}
  </Grid>
);

export const FeedbackAndLoading: Story = () => (
  <Stack>
    <Alert tone="info">Informational alert for neutral guidance.</Alert>
    <Alert tone="success">Success alert for completed operations.</Alert>
    <Alert tone="warning">Warning alert for reversible risks.</Alert>
    <Alert tone="error">Error alert for blocking failures.</Alert>
    <ErrorAlert
      message="The request could not be completed."
      onRetry={() => {}}
    />
    <Panel>
      <EmptyState
        message="No records match the current filters."
        cta="Create record"
        onCta={() => {}}
      />
    </Panel>
    <Skeleton rows={3} height="md" />
    <CodeBlock
      label="Token payload"
      value={'{\n  "sub": "usr_123",\n  "scope": "read:items write:items"\n}'}
      action={
        <Button size="sm" variant="secondary" iconName="Copy">
          Copy
        </Button>
      }
    />
  </Stack>
);

// R1 (content-api PV21): the 3-step surface-elevation scale + the deliberate
// focus-ring token. `Panel tone` now reads page / card / raised-rail off DaisyUI's
// `base-100 / 200 / 300`, so an inspector rail separates from the page and the cards
// on it instead of every surface being one flat grey. `focusRing` is a shared class
// token consumers spread onto their own focusable surfaces — a visible ring without
// a per-app `globals.css` add.
export const SurfaceElevationAndFocusRing: Story = () => (
  // The `muted` page tone stands in for the app backdrop so the three panels' tones
  // read against something recessed.
  <div className="rounded-box bg-base-200 p-6">
    <Stack>
      <Text variant="h3">Elevation scale — page vs card vs raised rail</Text>
      <Columns sidebarWidth="md" gap="lg">
        <Stack>
          <Panel tone="base">
            <Stack gap="xs">
              <Text variant="h4">Card — tone=&quot;base&quot; (base-100)</Text>
              <Text variant="caption">
                The default content surface, sitting on the recessed page.
              </Text>
            </Stack>
          </Panel>
          <Panel tone="muted">
            <Stack gap="xs">
              <Text variant="h4">
                Recessed — tone=&quot;muted&quot; (base-200)
              </Text>
              <Text variant="caption">A quieter, sunken sub-surface.</Text>
            </Stack>
          </Panel>
        </Stack>
        <Panel tone="raised">
          <Stack gap="xs">
            <Text variant="h4">Rail — tone=&quot;raised&quot; (base-300)</Text>
            <Text variant="caption">
              The most-separated zone, for an inspector rail that must not blend
              into the page or the cards beside it.
            </Text>
          </Stack>
        </Panel>
      </Columns>
      <Spacer />
      <Text variant="h3">Focus-ring token</Text>
      <Text variant="caption">
        Tab into the swatch below: `focusRing` is spread onto a plain focusable
        element and rings consistently — no globals.css authoring.
      </Text>
      <div
        className={`flex h-16 w-48 items-center justify-center rounded-box border border-base-300 bg-base-100 ${focusRing}`}
        tabIndex={0}
      >
        <Text variant="caption">Focusable surface</Text>
      </div>
    </Stack>
  </div>
);

// R2 (content-api PV21): `EmptyState` gains an optional registered `icon` rendered
// as a colored chip, plus a `tone`, so the admin's four empty states read as
// distinct, context-carrying zones instead of identical grey blocks.
export const EmptyStateTones: Story = () => (
  <Grid columns="two" gap="md">
    <Panel>
      <EmptyState
        icon="FileText"
        tone="primary"
        message="No posts yet — write your first one."
        cta="New post"
        onCta={() => {}}
      />
    </Panel>
    <Panel>
      <EmptyState
        icon="Image"
        tone="info"
        message="Your media library is empty."
        cta="Upload media"
        onCta={() => {}}
      />
    </Panel>
    <Panel>
      <EmptyState
        icon="ShieldCheck"
        tone="success"
        message="No access issues — every binding checks out."
      />
    </Panel>
    <Panel>
      <EmptyState
        icon="Bell"
        tone="warning"
        message="No scheduled posts. Nothing will publish automatically."
      />
    </Panel>
  </Grid>
);

// R3 (content-api PV22): `Columns` gains a readable main measure, a sized sidebar,
// and a collapsible rail. The writing column centers at ~720px and grows into the
// gutter instead of stretching edge-to-edge; the rail widens to ~360px (near a real
// SERP width) and collapses to an icon rail so the main column reclaims the space.
export const RecordLayout: Story = () => (
  <div className="rounded-box bg-base-200 p-6">
    <Columns
      mainMaxWidth="prose"
      sidebarWidth="md"
      collapsibleSidebar
      sidebarLabel="inspector"
      gap="lg"
    >
      <Panel>
        <Stack gap="sm">
          <Text variant="h3">Writing column</Text>
          <Text variant="caption">
            Capped at a readable measure (~720px) and centered, so it does not
            stretch on a wide screen — the freed width falls to the gutter.
            Toggle the rail (top-right of the sidebar) to watch this column
            reclaim it.
          </Text>
          <Text>
            The quick brown fox jumps over the lazy dog. The quick brown fox
            jumps over the lazy dog. The quick brown fox jumps over the lazy
            dog.
          </Text>
        </Stack>
      </Panel>
      <Panel tone="raised">
        <Stack gap="xs">
          <Text variant="h4">Inspector</Text>
          <Text variant="caption">
            A ~360px raised rail — wide enough for a SERP preview near
            Google&apos;s real width. Collapsible via the header toggle.
          </Text>
        </Stack>
      </Panel>
    </Columns>
  </div>
);
