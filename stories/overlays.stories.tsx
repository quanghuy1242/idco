import { useState } from "react";
import type { Story, StoryDefault } from "@ladle/react";
import {
  Button,
  CommandPalette,
  ConfirmDialog,
  Drawer,
  InfoPopover,
  Inline,
  Panel,
  Stack,
  Text,
  ThemeDialog,
  ToastRegion,
  Tooltip,
  toast,
  type CommandPaletteGroup,
} from "@idco/ui";

export default { title: "Packages UI / Overlays" } satisfies StoryDefault;

const commandGroups: CommandPaletteGroup[] = [
  {
    id: "navigation",
    label: "Navigation",
    items: [
      { id: "dashboard", label: "Open dashboard", meta: "G then D" },
      { id: "members", label: "Open members", meta: "G then M" },
    ],
  },
  {
    id: "actions",
    label: "Actions",
    items: [
      { id: "create", label: "Create record", meta: "C" },
      { id: "archive", label: "Archive selected", meta: "A", disabled: true },
    ],
  },
];

export const ModalSurfaces: Story = () => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);

  return (
    <Stack>
      <Inline>
        <Button
          onClick={() => setConfirmOpen(true)}
          iconName="Trash2"
          variant="danger"
        >
          Confirm dialog
        </Button>
        <Button
          onClick={() => setDrawerOpen(true)}
          iconName="ExternalLink"
          variant="secondary"
        >
          Drawer
        </Button>
        <Button
          onClick={() => setThemeOpen(true)}
          iconName="Settings"
          variant="secondary"
        >
          Theme dialog
        </Button>
      </Inline>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete selected item?"
        description="This preview exercises React Aria ModalOverlay and DaisyUI modal-box styling."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => setConfirmOpen(false)}
      />
      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Record detail"
        width="md"
      >
        <Stack>
          <Text>
            This side panel uses the active IDCO theme on the portal-mounted
            modal.
          </Text>
          <Panel tone="muted">
            <Text variant="caption">
              Drawer content stays scrollable and constrained.
            </Text>
          </Panel>
        </Stack>
      </Drawer>
      <ThemeDialog open={themeOpen} onOpenChange={setThemeOpen} />
    </Stack>
  );
};

export const CommandPalettePreview: Story = () => {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [lastAction, setLastAction] = useState("none");

  const filteredGroups = commandGroups.map((group) => ({
    id: group.id,
    label: group.label,
    items: group.items.filter((item) =>
      item.label.toLowerCase().includes(searchValue.toLowerCase()),
    ),
  }));

  return (
    <Stack>
      <Button
        onClick={() => setOpen(true)}
        iconName="CircleHelp"
        variant="secondary"
      >
        Open command palette
      </Button>
      <Text variant="caption">Last action: {lastAction}</Text>
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        groups={filteredGroups}
        onAction={(id) => {
          setLastAction(id);
          setOpen(false);
        }}
      />
    </Stack>
  );
};

export const TeachingAndToasts: Story = () => (
  <Stack>
    <Inline>
      <InfoPopover title="Info popover" placement="bottom">
        Persistent teaching content that works for pointer and touch input.
      </InfoPopover>
      <Tooltip content="Tooltip content" placement="right">
        <Button variant="secondary" iconName="CircleHelp">
          Hover or focus
        </Button>
      </Tooltip>
      <Button
        iconName="Bell"
        onClick={() =>
          toast.info("Preview toast", "ToastRegion renders queued messages.")
        }
      >
        Queue toast
      </Button>
    </Inline>
    <ToastRegion />
  </Stack>
);
