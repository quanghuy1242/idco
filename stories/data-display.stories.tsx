import { useMemo, useState, type ReactNode } from "react";
import type { Story, StoryDefault } from "@ladle/react";
import {
  Badge,
  Button,
  DataTable,
  DescriptionList,
  Disclosure,
  DisclosureGroup,
  JsonViewer,
  Panel,
  Stack,
  Stat,
  StatGroup,
  StatSummaryGroup,
  Stepper,
  Text,
  Timeline,
  type DataTableColumn,
  type SortDirection,
  type Step,
} from "@idco/ui";

export default { title: "Packages UI / Data Display" } satisfies StoryDefault;

type RecordRow = {
  id: string;
  name: string;
  type: string;
  owner: string;
  status: "active" | "draft" | "archived";
};

const rows: RecordRow[] = [
  {
    id: "1",
    name: "Admin guide",
    type: "Document",
    owner: "Ada",
    status: "active",
  },
  {
    id: "2",
    name: "Release checklist",
    type: "Checklist",
    owner: "Grace",
    status: "draft",
  },
  {
    id: "3",
    name: "Theme tokens",
    type: "Config",
    owner: "Linus",
    status: "active",
  },
  {
    id: "4",
    name: "Legacy import",
    type: "Archive",
    owner: "Katherine",
    status: "archived",
  },
];

const statusTone = {
  active: "success",
  draft: "warning",
  archived: "neutral",
} as const;

const columns: DataTableColumn<RecordRow>[] = [
  { key: "name", label: "Name", sortable: true, width: "lg" },
  { key: "type", label: "Type", sortable: true },
  { key: "owner", label: "Owner" },
  {
    key: "status",
    label: "Status",
    render: (row): ReactNode => (
      <Badge tone={statusTone[row.status]}>{row.status}</Badge>
    ),
  },
  {
    key: "actions",
    label: "Actions",
    actions: () => [
      { id: "edit", label: "Edit", iconName: "Pencil", onAction: () => {} },
      { id: "delete", label: "Delete", variant: "danger", onAction: () => {} },
    ],
  },
];

export const Table: Story = () => {
  const [sortBy, setSortBy] = useState("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [offset, setOffset] = useState(0);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(
    new Set(["1"]),
  );

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aValue = String(a[sortBy as keyof RecordRow] ?? "");
      const bValue = String(b[sortBy as keyof RecordRow] ?? "");
      const result = aValue.localeCompare(bValue);
      return sortDirection === "desc" ? -result : result;
    });
  }, [sortBy, sortDirection]);

  return (
    <Stack>
      <DataTable
        columns={columns}
        rows={sorted.slice(offset, offset + 3)}
        getRowKey={(row) => row.id}
        sortBy={sortBy}
        sortDirection={sortDirection}
        onSort={(key, direction) => {
          setSortBy(key);
          setSortDirection(direction);
        }}
        pagination={{
          total: rows.length,
          limit: 3,
          offset,
          onChange: setOffset,
        }}
        rowSelection={{
          selectedKeys,
          onChange: setSelectedKeys,
          getRowDisabled: (row) => row.status === "archived",
        }}
        layout="fixed"
        overflow="contained"
        minWidth="md"
      />
      <Text variant="caption">
        Selected: {[...selectedKeys].join(", ") || "none"}
      </Text>
    </Stack>
  );
};

export const StructuredContent: Story = () => (
  <Stack>
    <DescriptionList
      columns={3}
      items={[
        { term: "Environment", description: "Production" },
        {
          term: "Identifier",
          description: "env_01HZR706YH7CEXAMPLE",
          mono: true,
        },
        { term: "Status", description: <Badge tone="success">Healthy</Badge> },
      ]}
    />
    <StatGroup columns={3}>
      <Stat
        title="Requests"
        value="1.2M"
        description="+8.2% this week"
        tone="primary"
        iconName="Activity"
      />
      <Stat
        title="Errors"
        value="0.08%"
        description="Within target"
        tone="success"
        iconName="Check"
        meter={{ value: 8, max: 100 }}
      />
      <Stat
        title="Latency"
        value="84ms"
        description="p95"
        tone="info"
        iconName="Clock"
      />
    </StatGroup>
    <StatSummaryGroup>
      <Stat
        title="Compact summary"
        value="42"
        description="Rendered through StatSummaryGroup"
      />
    </StatSummaryGroup>
    <Timeline
      items={[
        {
          id: "created",
          title: "Created",
          meta: "09:00",
          tone: "success",
          icon: "Check",
        },
        {
          id: "reviewed",
          title: "Reviewed",
          meta: "09:30",
          tone: "info",
          detail: "Changes approved.",
        },
        {
          id: "published",
          title: "Published",
          meta: "10:00",
          tone: "primary",
          icon: "Upload",
        },
      ]}
    />
    <JsonViewer
      label="Manifest"
      value={{ package: "@idco/ui", stories: true, theme: "idco-light" }}
    />
  </Stack>
);

export const DisclosureAndStepper: Story = () => {
  const [activeStep, setActiveStep] = useState(0);
  const steps: Step[] = [
    {
      id: "details",
      label: "Details",
      content: (
        <Panel>
          <Text>Enter shared component details.</Text>
        </Panel>
      ),
      isValid: true,
    },
    {
      id: "review",
      label: "Review",
      content: (
        <Panel>
          <Text>Review props and accessible names.</Text>
        </Panel>
      ),
      isValid: true,
    },
    {
      id: "publish",
      label: "Publish",
      content: (
        <Panel>
          <Text>Publish a tagged package for consumers.</Text>
        </Panel>
      ),
      isValid: true,
    },
  ];

  return (
    <Stack>
      <DisclosureGroup allowsMultiple defaultExpandedKeys={["first"]}>
        <Disclosure id="first" title="Open by default" defaultExpanded>
          <Text>Disclosure content with default chevron icon.</Text>
        </Disclosure>
        <Disclosure title="Plus icon" icon="plus" width="contained">
          <Text>Contained disclosure content.</Text>
        </Disclosure>
      </DisclosureGroup>
      <Stepper
        steps={steps}
        activeStep={activeStep}
        onStepChange={setActiveStep}
        onComplete={() => setActiveStep(0)}
        completeLabel="Restart"
      />
      <Button variant="secondary" size="sm" onClick={() => setActiveStep(0)}>
        Reset stepper
      </Button>
    </Stack>
  );
};
