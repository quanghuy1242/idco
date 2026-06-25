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
import { registerOverlay } from "../../spi";

/** Register the built-in overlay contributors (idempotent by id). */
export function registerBuiltInOverlays(): void {
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
