/**
 * The shared cell fill-color swatch grid (docs/029 R1-E dedup). Both surfaces that fill a cell
 * — the hover `…` popover (`table-interactions.tsx`) and the right-click context-menu drill-in
 * (`table-commands.tsx`) — used to hand-roll the same palette + `FILL_COLORS`, the kind of
 * scattered duplication docs/029 set out to remove. This is the one definition; each caller
 * resolves *which* cells the fill targets and dismisses its own surface via `onPick`.
 *
 * No `@idco/ui` primitive models a "swatch grid", so the swatches stay small bespoke buttons
 * (a documented last resort), kept accessible with native button labels.
 */
import { NavIcon } from "@quanghuy1242/idco-ui";

/** A compact fill palette that reads on light and dark surfaces; the trailing button clears. */
export const FILL_COLORS: readonly string[] = [
  "#7f1d1d",
  "#7c2d12",
  "#713f12",
  "#14532d",
  "#0f766e",
  "#1e3a8a",
  "#4c1d95",
  "#831843",
  "#3f3f46",
];

/** The fill swatch grid + clear button. `onPick(color)` fills; `onPick(undefined)` clears. */
export function CellFillPalette(props: {
  readonly onPick: (color: string | undefined) => void;
}) {
  const { onPick } = props;
  return (
    <div className="flex flex-wrap gap-2 px-1">
      {FILL_COLORS.map((color) => (
        <button
          aria-label={`Fill ${color}`}
          className="size-6 rounded-full border border-base-300 transition hover:scale-110"
          key={color}
          onClick={() => onPick(color)}
          style={{ background: color }}
          type="button"
        />
      ))}
      <button
        aria-label="Clear fill"
        className="grid size-6 place-items-center rounded-full border border-base-300 text-base-content/60 transition hover:scale-110"
        onClick={() => onPick(undefined)}
        type="button"
      >
        <NavIcon name="X" />
      </button>
    </div>
  );
}
