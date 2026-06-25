/**
 * Built-in overlay contributors (docs/029 §5.2 / §8.3, R1-D). Registers the one selection
 * surface that replaces both the desktop selection flyout and the touch range toolbar.
 *
 * The bar is a single ambient `selection` contributor projecting the `flyout` command list
 * (docs/024): that list already aggregates the inline-format marks + the annotate commands,
 * and clipboard (copy/cut/paste) now projects there too (command-builtins), so the one bar
 * carries clipboard + format + annotate — the merge (docs/029 §5.2). Rendering is device-
 * adaptive (a touch skin) and a render-bearing command drills in as a form panel
 * (`overlay-content.tsx`). Registered through this explicit call — not a module side effect —
 * so the package stays `sideEffects: false`, exactly like `registerBuiltInCommands`.
 *
 * Co-slot of *separate* contributors (the general capability, unit-proven in
 * `engine-overlay-authority.test.ts`) is used where content comes from different sources;
 * here one projector surface already aggregates the three command groups, which is the
 * content-equivalent merge and reuses the existing projector.
 */
import type { ReactNode } from "react";
import { registerOverlay, type OverlaySurfaceContext } from "../../spi";
import { registerSlashOverlay } from "./slash-menu";
import { registerLinkOverlay } from "../link-popover";
import { registerAnnotationOverlay } from "../annotation-popover";
import { registerObjectConfigOverlay } from "../../render/object-block";

/** The render-function shape `openForm` carries as the ephemeral surface's payload. */
type EphemeralFormRender = (ctx: OverlaySurfaceContext) => ReactNode;

/** Register the built-in overlay contributors (idempotent by id). */
export function registerBuiltInOverlays(): void {
  // The slash menu (docs/029 R1-F) — a `caret`-target `menu` contributor, focus-transparent,
  // driven by the §7.5 keyboard routing.
  registerSlashOverlay();
  // The click-to-edit `mark` surfaces (docs/029 R1-G): the link edit form and the glossary
  // read card, opened by `authority.openMark` from the editor's click handler. Explicit-only
  // (no `when`), so registering them globally is inert until a mark click fires `openMark`.
  registerLinkOverlay();
  registerAnnotationOverlay();
  // The object-config form (docs/029 R1-G): ambient on a non-in-place active object, anchored
  // to its block. `volatile`, so it closes the moment the object deactivates.
  registerObjectConfigOverlay();
  // The ephemeral form (docs/029 R1-F/R1-G) — a `point`-target form opened via
  // `authority.openForm(x, y, render)`; its render rides as the surface `payload`. The
  // context menu's and the ribbon's form-commands open through it instead of hand-rolling a
  // popover, which is what lets their bespoke focus/dismiss guards be deleted.
  registerOverlay({
    contentKind: "form",
    focusMode: "taking",
    id: "ephemeral.form",
    render: (ctx) => {
      const payload = ctx.payload as EphemeralFormRender | undefined;
      return typeof payload === "function" ? payload(ctx) : null;
    },
    target: "point",
  });
  // The sticky ephemeral form (docs/029 R1-G) — same payload channel as `ephemeral.form` but
  // focus-mode `sticky`: it keeps focus yet survives an outside press, so the find bar's field
  // stays focused while the author clicks matches in the document. Opened via
  // `authority.openStickyForm`. Closes on Escape / explicit dismiss only.
  registerOverlay({
    contentKind: "form",
    focusMode: "sticky",
    id: "ephemeral.sticky",
    render: (ctx) => {
      const payload = ctx.payload as EphemeralFormRender | undefined;
      return typeof payload === "function" ? payload(ctx) : null;
    },
    target: "point",
  });
  // The transient caret actions surface (docs/029 R1-G) — the touch caret long-press paste
  // affordance, opened via `authority.openCaretActions`. Same payload channel; `actions`/
  // `taking` at the `caret` anchor.
  registerOverlay({
    contentKind: "actions",
    focusMode: "taking",
    id: "ephemeral.caretActions",
    render: (ctx) => {
      const payload = ctx.payload as EphemeralFormRender | undefined;
      return typeof payload === "function" ? payload(ctx) : null;
    },
    target: "caret",
  });
  registerOverlay({
    // The ambient selection bar: shown on a settled non-collapsed text selection with no
    // active object (the coordinator's old flyout condition, docs/024 §7.2; the settle
    // debounce + suppression are the authority's, not this predicate's). Focus-transparent
    // so the editor keeps focus and the painted caret stays over the formatted run.
    contentKind: "actions",
    focusMode: "transparent",
    id: "selection.bar",
    projects: "flyout",
    target: "selection",
    when: (ctx) =>
      ctx.selection.hasSelection && ctx.store.activeObjectId === null,
  });
}
