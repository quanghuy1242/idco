import type { CommandContext, EditorCommand } from "../model/commands";
import { ToolbarButton } from "./toolbar-button";

/**
 * Renders a group of generic button commands (history / inline format / align /
 * list / indent) as `ToolbarButton`s, deriving active + disabled state straight
 * from each command's scope predicates. Block-style and annotate groups are
 * widget-shaped and rendered by their own controls, not here.
 */
export function CommandButtonGroup({
  commands,
  ctx,
  onRun,
}: {
  readonly commands: readonly EditorCommand[];
  readonly ctx: CommandContext;
  readonly onRun: (command: EditorCommand) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {commands.map((command) => (
        <ToolbarButton
          key={command.id}
          icon={command.icon}
          label={command.label}
          isActive={command.isActive(ctx)}
          isDisabled={!command.isEnabled(ctx)}
          onPress={() => onRun(command)}
        />
      ))}
    </div>
  );
}
