// Shared block-chrome vocabulary: the badges, icon buttons, and dropdown
// selectors that float on a block. One token set, three render hosts —
// decorator nodes (inside `BlockShell`), the code block (its own corner
// cluster), and the table controls (a `document.body` portal overlay). Before
// this, each host hand-rolled the same elements with drifting tokens; these
// primitives are the single source of truth. See docs/003 §5.

import { cn } from "@quanghuy1242/idco-lib";
import { Menu, MenuItem, MenuTrigger, NavIcon } from "@quanghuy1242/idco-ui";
import type { CSSProperties, ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";

/** Surface shared by every chrome element: a light floating pill. */
const CHROME_SURFACE = "border border-base-300 bg-base-100 shadow-sm";
const CHROME_BADGE_PILL =
  "flex h-6 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide";
const CHROME_SELECT_PILL =
  "flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase leading-none tracking-wide";

/**
 * Hover/focus-within reveal for chrome inside a `group/block` scope: hidden
 * until the block is hovered or holds focus. Every block that floats chrome (the
 * decorator shell, the code block) shares this one definition and the
 * `group/block` scope so the literal Tailwind variants are generated once.
 */
export const CHROME_REVEAL =
  "opacity-0 transition-opacity group-hover/block:opacity-100 group-focus-within/block:opacity-100";

export type ChromeIntent = "neutral" | "primary" | "danger";

const INTENT_TEXT: Record<ChromeIntent, string> = {
  neutral: "text-base-content/60 hover:text-base-content",
  primary: "text-base-content/80 hover:text-primary",
  danger: "text-base-content/60 hover:text-error",
};

// Filled hover (the table insert/delete affordances): the whole pill takes the
// intent color rather than just the glyph.
const INTENT_FILL: Record<ChromeIntent, string> = {
  neutral:
    "text-base-content/80 hover:border-base-content hover:bg-base-content",
  primary:
    "text-base-content/80 hover:border-primary hover:bg-primary hover:text-primary-content",
  danger:
    "text-base-content/80 hover:border-error hover:bg-error hover:text-error-content",
};

const BUTTON_SIZE = {
  md: "size-6",
  sm: "size-[18px]",
} as const;

/**
 * A round icon button. `intent` selects the hover color; `fill` makes the whole
 * pill take that color on hover (used by the table's `+`/`-` affordances) rather
 * than tinting only the glyph. `className`/`style` let a host position the
 * button (e.g. the table overlay's absolute placement) without forking styles.
 */
export function ChromeButton({
  icon,
  label,
  intent = "neutral",
  fill = false,
  size = "md",
  onPress,
  className,
  style,
}: {
  readonly icon: string;
  readonly label: string;
  readonly intent?: ChromeIntent;
  readonly fill?: boolean;
  readonly size?: keyof typeof BUTTON_SIZE;
  readonly onPress?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  return (
    <AriaButton
      type="button"
      aria-label={label}
      onPress={onPress}
      style={style}
      className={cn(
        "grid place-items-center rounded-full transition",
        BUTTON_SIZE[size],
        CHROME_SURFACE,
        fill ? INTENT_FILL[intent] : INTENT_TEXT[intent],
        className,
      )}
    >
      <NavIcon name={icon} variant="timeline" />
    </AriaButton>
  );
}

/** A non-interactive icon + label pill (e.g. the "Callout" / "Table" tag). */
export function ChromeBadge({
  icon,
  label,
  className,
}: {
  readonly icon: string;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        `${CHROME_BADGE_PILL} text-base-content/60`,
        CHROME_SURFACE,
        className,
      )}
    >
      <NavIcon name={icon} variant="timeline" />
      {label}
    </span>
  );
}

export function BlockChrome({
  actions,
  icon,
  label,
  onRemove,
  persistentActions,
  removeLabel = `Remove ${label}`,
  visibility = "hover",
}: {
  readonly actions?: ReactNode;
  readonly icon: string;
  readonly label: string;
  readonly onRemove?: () => void;
  readonly persistentActions?: ReactNode;
  readonly removeLabel?: string;
  readonly visibility?: "hover" | "visible";
}) {
  const revealClass = visibility === "hover" ? CHROME_REVEAL : "";

  return (
    <>
      <div
        className={cn(
          "pointer-events-none absolute -top-2.5 left-3 z-10",
          revealClass,
        )}
      >
        <ChromeBadge icon={icon} label={label} />
      </div>
      <div className="pointer-events-auto absolute -top-2.5 right-2 z-10 flex items-center gap-1">
        {persistentActions}
        {actions || onRemove ? (
          <div className={cn("flex items-center gap-1", revealClass)}>
            {actions}
            {onRemove ? (
              <ChromeButton
                icon="X"
                label={removeLabel}
                intent="danger"
                onPress={onRemove}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

export type ChromeSelectOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly icon?: string;
  /** Optional color class applied to the option icon (e.g. callout tones). */
  readonly iconClassName?: string;
};

/**
 * The chrome dropdown selector, backed by a React Aria `Menu`. Two trigger
 * shapes: the default pill shows the current value (the code-block language,
 * table layout mode, …); pass `triggerIcon` for an icon-only round button (the
 * callout tone gear) when the block's badge already conveys the current value.
 */
export function ChromeSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  onOpenChange,
  menuClassName = "w-44",
  triggerIcon,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly ChromeSelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly menuClassName?: string;
  readonly triggerIcon?: string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <MenuTrigger onOpenChange={onOpenChange}>
      {triggerIcon ? (
        <ChromeButton icon={triggerIcon} label={label} />
      ) : (
        <AriaButton
          aria-label={label}
          className={`${CHROME_SELECT_PILL} text-base-content/70 transition hover:text-base-content ${CHROME_SURFACE}`}
        >
          {selected?.icon ? (
            <NavIcon name={selected.icon} variant="timeline" />
          ) : null}
          {selected?.label ?? value}
          <NavIcon name="ChevronDown" variant="timeline" />
        </AriaButton>
      )}
      <Menu aria-label={label} className={menuClassName}>
        {options.map((option) => (
          <MenuItem
            key={option.value}
            id={option.value}
            textValue={option.label}
            onAction={() => onChange(option.value)}
          >
            <span className="flex items-center gap-2">
              {option.icon ? (
                option.iconClassName ? (
                  <span className={option.iconClassName}>
                    <NavIcon name={option.icon} />
                  </span>
                ) : (
                  <NavIcon name={option.icon} />
                )
              ) : null}
              {option.label}
            </span>
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}

/** Layout-only horizontal cluster with the standard chrome gap. */
export function ChromeBar({ children }: { readonly children: ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}
