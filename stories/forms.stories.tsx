import { useState } from "react";
import type { Story, StoryDefault } from "@ladle/react";
import {
  Checkbox,
  DateTimeInput,
  DurationInput,
  FilterDropdown,
  Form,
  HiddenInput,
  Inline,
  Input,
  NumberInput,
  Panel,
  RadioGroup,
  SearchInput,
  Stack,
  Switch,
  TagInput,
  Text,
  TextInput,
  Textarea,
  TopbarSearchField,
  defaultDomainValidate,
} from "@idco/ui";

export default { title: "Packages UI / Forms" } satisfies StoryDefault;

const radioOptions = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
] as const;

const filterOptions = [
  { value: "all", label: "All records" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
] as const;

export const Inputs: Story = () => (
  <Form>
    <Stack>
      <TextInput
        label="Display name"
        name="displayName"
        defaultValue="Ada Lovelace"
        required
      />
      <TextInput
        label="Email"
        name="email"
        type="email"
        defaultValue="ada@example.test"
      />
      <Textarea
        label="Notes"
        name="notes"
        defaultValue="Created from the shared package story preview."
      />
      <HiddenInput name="source" value="ladle" />
    </Stack>
  </Form>
);

// R4 (note.md §5.10): a borderless, label-less document-title input. `variant=
// "ghost"` + a large `size` turns the bare `Input` into a Notion/Word-style hero
// title that sits directly above the body — the one part of content-api's redesign
// the labelled `TextInput` could not deliver. The bordered/size variants are shown
// alongside so the ghost-vs-bordered and md→xl scale are visible at a glance.
export const GhostTitleInput: Story = () => {
  const [title, setTitle] = useState("");
  const [bordered, setBordered] = useState("Bordered, size md");
  return (
    <Stack gap="lg">
      <div className="border-b border-base-300 pb-4">
        <Text variant="caption">
          Document title (ghost, xl) — sits above the body:
        </Text>
        <Input
          ariaLabel="Title"
          onChange={setTitle}
          placeholder="Untitled document"
          size="xl"
          value={title}
          variant="ghost"
        />
        <Input
          ariaLabel="Subtitle"
          onChange={() => {}}
          placeholder="Add a subtitle…"
          size="lg"
          value=""
          variant="ghost"
        />
      </div>
      <Stack gap="sm">
        <Text variant="caption">Bordered (default), for comparison:</Text>
        <Input
          ariaLabel="Bordered md"
          onChange={setBordered}
          value={bordered}
        />
        <Input
          ariaLabel="Bordered lg"
          onChange={() => {}}
          placeholder="size lg"
          size="lg"
          value=""
        />
      </Stack>
    </Stack>
  );
};

export const ChoiceControls: Story = () => (
  <Stack>
    <RadioGroup
      title="Role"
      name="role"
      options={radioOptions}
      defaultValue="admin"
    />
    <RadioGroup
      title="Compact role"
      name="role-sm"
      options={radioOptions}
      defaultValue="member"
      size="sm"
    />
    <Checkbox
      label="Require step-up before sensitive actions"
      name="stepUp"
      defaultSelected
    />
    <Checkbox label="Inherited permission" name="inherited" selected />
    <Checkbox label="Partial selection" name="partial" indeterminate />
    <Checkbox
      label="Policy acceptance"
      name="policy"
      error="Required before continuing"
    />
    <Switch label="Enable automation" name="automation" defaultSelected />
    <Switch
      label="Send success notifications"
      name="notify"
      tone="success"
      size="sm"
    />
  </Stack>
);

export const SearchAndFilters: Story = () => {
  const [query, setQuery] = useState("team");
  const [status, setStatus] = useState("active");

  return (
    <Stack>
      <Inline>
        <SearchInput
          value={query}
          onChange={setQuery}
          grow
          placeholder="Search members"
        />
        <FilterDropdown
          label="Status"
          options={filterOptions}
          value={status}
          onChange={setStatus}
        />
      </Inline>
      <FilterDropdown
        label="Status"
        options={filterOptions}
        value={status}
        onChange={setStatus}
        showLabel
      />
      <Panel tone="muted">
        <Stack gap="sm">
          <Text variant="h3">Topbar search field</Text>
          <TopbarSearchField placeholder="Search settings" />
        </Stack>
      </Panel>
      <Text variant="caption">
        Query: {query}; filter: {status}
      </Text>
    </Stack>
  );
};

export const Duration: Story = () => (
  <Stack>
    <DurationInput
      label="Session TTL"
      name="sessionTtl"
      defaultValue={3600}
      required
    />
    <DurationInput
      label="Compact TTL"
      name="compactTtl"
      defaultValue={604800}
      size="sm"
    />
  </Stack>
);

export const NumbersAndDates: Story = () => {
  const [quota, setQuota] = useState<number | null>(1000);
  const [startsAt, setStartsAt] = useState<number | null>(Date.now());
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [domains, setDomains] = useState<string[]>(["acme.com"]);

  return (
    <Stack>
      <NumberInput
        label="Quota limit"
        name="quotaLimit"
        value={quota}
        onChange={setQuota}
        minValue={0}
        description="Leave empty for an unlimited quota."
      />
      <DateTimeInput
        label="Starts at"
        name="startsAt"
        value={startsAt}
        onChange={setStartsAt}
      />
      <DateTimeInput
        label="Expires at"
        name="expiresAt"
        value={expiresAt}
        onChange={setExpiresAt}
      />
      <TagInput
        label="Email domains"
        name="emailDomains"
        value={domains}
        onChange={setDomains}
        validate={defaultDomainValidate}
        normalize={(value) => value.toLowerCase()}
        placeholder="acme.com, then Enter"
      />
      <Text variant="caption">
        Quota: {quota ?? "∞"}; domains: {domains.join(", ") || "any"}
      </Text>
    </Stack>
  );
};
