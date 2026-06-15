import {
  Menu,
  MenuItem,
  MenuTrigger,
  NavIcon,
  Tooltip,
} from "@quanghuy1242/idco-ui";
import {
  Button as AriaButton,
  Header,
  MenuSection,
  type PopoverProps,
} from "react-aria-components";
import {
  groupedSurfaceCommands,
  type CommandContext,
  type CommandGroup,
  type CommandSurface,
  type EditorCommand,
} from "../model/commands";

/** Section headers for the groups that can land in a "More" overflow. */
const GROUP_LABELS: Partial<Record<CommandGroup, string>> = {
  insert: "Insert",
};

/**
 * A surface's "More" overflow — a sectioned React Aria menu rendering every
 * command whose placement on `surface` is `"more"`, grouped under headers. On the
 * toolbar this is the "Insert" block catalog (`variant="labeled"`); the flyout
 * uses `variant="compact"`. New groups (Layout, Advanced, …) appear here
 * automatically as commands declare a `more` placement, so the inline controls
 * stay uncrowded as the editor grows.
 */
export function MoreMenu({
  ctx,
  isOpen,
  label,
  onOpenChange,
  onRun,
  shouldCloseOnInteractOutside,
  surface = "toolbar",
  variant = "labeled",
}: {
  readonly ctx: CommandContext;
  readonly isOpen: boolean;
  readonly label: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onRun: (command: EditorCommand) => void;
  readonly shouldCloseOnInteractOutside?: PopoverProps["shouldCloseOnInteractOutside"];
  readonly surface?: CommandSurface;
  readonly variant?: "labeled" | "compact";
}) {
  const segments = groupedSurfaceCommands(ctx, surface, "more");
  if (segments.length === 0) return null;

  const trigger =
    variant === "labeled" ? (
      <AriaButton
        aria-label="More"
        className={`btn btn-sm gap-1.5 ${isOpen ? "btn-primary" : "btn-ghost"}`}
      >
        <NavIcon name="MoreHorizontal" />
        <span>More</span>
      </AriaButton>
    ) : (
      <Tooltip content="More">
        <AriaButton
          aria-label="More"
          onMouseDown={(event) => event.preventDefault()}
          className={`btn btn-sm btn-square ${isOpen ? "btn-primary" : "btn-ghost"}`}
        >
          <NavIcon name="MoreHorizontal" />
        </AriaButton>
      </Tooltip>
    );

  return (
    <MenuTrigger
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      placement="bottom start"
      shouldCloseOnInteractOutside={shouldCloseOnInteractOutside}
    >
      {trigger}
      <Menu aria-label={`${label} more actions`} className="w-56">
        {segments.map((segment) => (
          <MenuSection key={segment.group} className="border-base-200">
            <Header className="px-3 pb-1 pt-2 text-xs font-medium text-base-content/50">
              {GROUP_LABELS[segment.group] ?? segment.group}
            </Header>
            {segment.commands.map((command) => (
              <MenuItem
                key={command.id}
                id={command.id}
                textValue={command.label}
                onAction={() => onRun(command)}
              >
                <span className="flex items-center gap-2.5">
                  <NavIcon name={command.icon} />
                  {command.label}
                </span>
              </MenuItem>
            ))}
          </MenuSection>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
