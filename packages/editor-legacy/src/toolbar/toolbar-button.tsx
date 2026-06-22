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
        // Keep focus (and the text selection) in the editor when the button is
        // clicked. Without this, mousedown moves focus to the button, which
        // makes React Aria's selection flyout popover think focus left the
        // overlay and briefly start its exit animation -> visible flicker/
        // "remount". Keyboard focus (Tab / roving tabindex) is unaffected.
        onMouseDown={(event) => event.preventDefault()}
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
