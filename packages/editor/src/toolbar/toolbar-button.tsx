import { NavIcon, Tooltip } from "@quanghuy1242/idco-ui";
import { Button as AriaButton } from "react-aria-components";

export function ToolbarButton({
  icon,
  isActive,
  isDisabled,
  label,
  onPress,
}: {
  readonly icon: string;
  readonly isActive?: boolean;
  readonly isDisabled?: boolean;
  readonly label: string;
  readonly onPress?: () => void;
}) {
  return (
    <Tooltip content={label}>
      <AriaButton
        type="button"
        aria-label={label}
        isDisabled={isDisabled}
        onPress={onPress}
        className={`btn btn-sm btn-square ${isActive ? "btn-primary" : "btn-ghost"}`}
      >
        <NavIcon name={icon} />
      </AriaButton>
    </Tooltip>
  );
}

export function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px bg-base-300" aria-hidden="true" />;
}
