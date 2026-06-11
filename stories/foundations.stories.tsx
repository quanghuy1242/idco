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
