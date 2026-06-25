/**
 * Overlay content renderer (docs/029 §4.7D, R1-D) — turns a resolved envelope into its body
 * for the `OverlayLayer`. The selection surface's *content* lives here: an `actions` envelope
 * renders the projected command bar (the merged clipboard + format + annotate row that
 * replaces the desktop flyout AND the touch range toolbar), and a render-bearing command
 * opens as a **drill-in** (a mode-stack push) instead of a nested popover. A drill-in `panel`
 * renders its body; a non-actions root renders its contributors' `render`.
 *
 * There is no per-surface branch: the bar is fed by `resolveCommandList(projects, ctx)`
 * (docs/024), so adding a command is registration, not an edit here. The `data-engine-flyout`
 * attribute is kept on the selection bar so the existing flyout e2e contract holds unchanged.
 */
import { Fragment, type ReactNode } from "react";
import { Toolbar as AriaToolbar } from "react-aria-components";
import { Button } from "@quanghuy1242/idco-ui";
import { useTouchDevice } from "../../overlays";
import {
  resolveCommandList,
  type CommandSurface,
  type OverlayAuthority,
  type OverlaySurfaceContext,
  type ResolvedCommand,
  type ResolvedEnvelope,
} from "../../spi";

/** The projected command bar (the merged selection actions row). */
function ActionsBar(props: {
  readonly envelope: ResolvedEnvelope;
  readonly ctx: OverlaySurfaceContext;
  readonly authority: OverlayAuthority;
}): ReactNode {
  const { envelope, ctx, authority } = props;
  // Touch gets a denser-hit-target skin (docs/029 §5.2: the `actions` content-kind chooses
  // a skin at render time; this is the only device-specific bit of the merge).
  const touch = useTouchDevice();

  // The bar's commands come from each co-slotted contributor's projector list (docs/024).
  const items: ResolvedCommand[] = envelope.slots.flatMap((slot) =>
    slot.contributor.projects
      ? resolveCommandList(
          slot.contributor.projects as Exclude<CommandSurface, "ribbon">,
          ctx,
        ).flatMap((group) => group.items)
      : [],
  );

  // A plain command is *sticky* (docs/024 §7.2): it runs and restores editor focus, but does
  // not dismiss — the surface survives because the selection is unchanged. The reclaim seam
  // makes `focusEditor` safe (the bar is transparent, so the reclaim is not suspended).
  const run = (item: ResolvedCommand) => {
    item.command.run?.(ctx);
    ctx.focusEditor();
  };
  // A render-bearing command (link / glossary / comment) drills in: it pushes a focus-taking
  // form panel onto this surface's mode stack instead of opening a nested popover (docs/029
  // §4.5). `close` maps to `pop`, so committing the form returns to the action row.
  const drillIn = (item: ResolvedCommand) =>
    authority.push(envelope.target, {
      contentKind: "form",
      focusMode: "taking",
      id: item.id,
      render: (surface) =>
        item.command.render?.({ ...surface, close: surface.pop }) ?? null,
    });

  return (
    <div
      data-engine-actions={envelope.target}
      data-engine-flyout={envelope.target === "selection" ? "" : undefined}
    >
      <AriaToolbar
        aria-label="Selection actions"
        className={`flex items-center ${touch ? "gap-1" : "gap-0.5"}`}
      >
        {items.map((item) => (
          <Button
            ariaLabel={item.command.label}
            disabled={item.disabled}
            iconName={item.command.icon}
            key={item.id}
            onClick={() => (item.command.render ? drillIn(item) : run(item))}
            size={touch ? "md" : "sm"}
            square
            tooltip={item.command.label}
            variant={item.active ? "primary" : "ghost"}
          />
        ))}
      </AriaToolbar>
    </div>
  );
}

/** Render an envelope's body: drill-in panel, projected actions bar, or render contributors. */
export function OverlayContent(props: {
  readonly envelope: ResolvedEnvelope;
  readonly ctx: OverlaySurfaceContext;
  readonly authority: OverlayAuthority;
}): ReactNode {
  const { envelope, ctx, authority } = props;
  // A pushed drill-in panel covers the root view (docs/029 §4.5).
  if (envelope.panel) return <>{envelope.panel.render(ctx)}</>;
  // The *projected* actions bar (the selection bar): an `actions` root that names a command
  // list. A render-bearing `actions` surface (the touch caret-paste, which carries its body as
  // a payload and has no `projects`) is NOT this — it falls through to render its own body,
  // exactly like a form/card/menu does. Without this `projects` guard such a surface would hit
  // ActionsBar and resolve an empty command list (an empty box).
  if (
    envelope.contentKind === "actions" &&
    envelope.slots.some((slot) => slot.contributor.projects)
  ) {
    return <ActionsBar authority={authority} ctx={ctx} envelope={envelope} />;
  }
  // Every other root (form / card / menu, and a render-bearing actions surface) renders its
  // contributor's own body.
  return (
    <>
      {envelope.slots.map((slot) => (
        <Fragment key={slot.id}>
          {slot.contributor.render?.(ctx) ?? null}
        </Fragment>
      ))}
    </>
  );
}
