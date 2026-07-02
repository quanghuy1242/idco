/**
 * The shared, deliberate focus-ring token (R1 / content-api PV21).
 *
 * A single source of truth for a visible keyboard focus indicator so consumers
 * do not hand-author a ring in their app `globals.css`, and so every interactive
 * surface in the system rings the same way (same color, width, and offset). It is
 * a Tailwind class string, not a CSS `@layer` add — `@idco/ui` is side-effect-free
 * and cannot own global CSS, so the "token" is an exported constant the consumer
 * (and our own primitives) spread onto a focusable element.
 *
 * Two variants because focus arrives through two different selectors depending on
 * how the element manages focus:
 * - `focusRing` — native `:focus-visible`, for a plain focusable element or a
 *   native `<input>`/`<button>` the consumer controls.
 * - `focusRingData` — React Aria's `data-focus-visible` attribute, for a
 *   `react-aria-components` element (RAC does not toggle the CSS pseudo-class; it
 *   exposes a data attribute its render tree can style).
 *
 * DaisyUI-styled controls that already carry their own focus treatment (`btn`,
 * `input`, `tab`) do not need this — the token is for surfaces that would
 * otherwise be ring-less. `outline-none` suppresses the UA outline so the ring is
 * the single, consistent indicator; the offset color is `base-100` so the gap
 * reads on the default page surface.
 *
 * @categoryDefault Theming
 */

/** Visible keyboard focus ring for native `:focus-visible` (spread onto a focusable element). */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100";

/** Visible keyboard focus ring for React Aria's `data-focus-visible` attribute. */
export const focusRingData =
  "outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-primary data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-base-100";
