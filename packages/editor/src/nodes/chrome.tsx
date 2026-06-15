// Shared block-chrome vocabulary: the badges, icon buttons, and dropdown
// selectors that float on a block. One token set, three render hosts —
// decorator nodes (inside `BlockShell`), the code block (its own corner
// cluster), and the table controls (a `document.body` portal overlay). Before
// this, each host hand-rolled the same elements with drifting tokens; these
// primitives are the single source of truth. See docs/003 §5.

import { Menu, MenuItem, MenuTrigger, NavIcon } from "@quanghuy1242/idco-ui";
import type { CSSProperties, ReactNode } from "react";
import { Button as AriaButton } from "react-aria-components";

/** Surface shared by every chrome element: a light floating pill. */
const CHROME_SURFACE = "border border-base-300 bg-base-100 shadow-sm";
const CHROME_INLINE_PILL =
  "flex h-6 min-h-0 items-center gap-1 rounded-full px-2 text-[10px] font-semibold uppercase leading-none tracking-wide";

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
      className={[
        "grid place-items-center rounded-full transition",
        BUTTON_SIZE[size],
        CHROME_SURFACE,
        fill ? INTENT_FILL[intent] : INTENT_TEXT[intent],
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
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
      className={[
        `${CHROME_INLINE_PILL} text-base-content/60`,
        CHROME_SURFACE,
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <NavIcon name={icon} variant="timeline" />
      {label}
    </span>
  );
}

export type ChromeSelectOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly icon?: string;
};

/**
 * The code-block language dropdown, generalized. A pill trigger showing the
 * current value, backed by a React Aria `Menu`. The reusable selector the rest
 * of the chrome (table layout mode, …) builds on.
 */
export function ChromeSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  onOpenChange,
  menuClassName = "w-44",
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly ChromeSelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly onOpenChange?: (isOpen: boolean) => void;
  readonly menuClassName?: string;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <MenuTrigger onOpenChange={onOpenChange}>
      <AriaButton
        aria-label={label}
        className={`${CHROME_INLINE_PILL} text-base-content/70 transition hover:text-base-content ${CHROME_SURFACE}`}
      >
        {selected?.icon ? (
          <NavIcon name={selected.icon} variant="timeline" />
        ) : null}
        {selected?.label ?? value}
        <NavIcon name="ChevronDown" variant="timeline" />
      </AriaButton>
      <Menu aria-label={label} className={menuClassName}>
        {options.map((option) => (
          <MenuItem
            key={option.value}
            id={option.value}
            textValue={option.label}
            onAction={() => onChange(option.value)}
          >
            <span className="flex items-center gap-2">
              {option.icon ? <NavIcon name={option.icon} /> : null}
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
