/**
 * The command-surface coordinator (docs/024 §8) — the cross-cutting hook for the legacy flat
 * surfaces. After the docs/029 overlay-authority migration the **selection flyout** (R1-D, P2)
 * and the **slash menu** (R1-F, P3) moved to the overlay authority, so this coordinator now
 * owns only the right-click **context menu**. `detectSlashTrigger`/`SlashTrigger` stay here —
 * the committed-text trigger detection the slash *contributor* now reads — so the detection
 * lives in one place (docs/024 §7.3/§9).
 */
import { useCallback, useState } from "react";
import type { EditorStore, NodeId } from "../../../core";
import {
  buildCommandContext,
  resolveCommandList,
  type CommandContext,
  type PanelHost,
  type ToolbarCapabilities,
} from "../../spi";

/** A live slash trigger detected on the committed leaf text (docs/024 §7.3). */
export type SlashTrigger = {
  /** The text leaf holding the `/query`. */
  readonly leafId: NodeId;
  /** The `/` index in the leaf (the start of the text to remove on execute). */
  readonly slashPos: number;
  /** The caret offset (end of the query run). */
  readonly caret: number;
  /** The query typed after the `/` (the slash menu's filter), "" right after `/`. */
  readonly query: string;
};

/** Which single flat surface is open (only the context menu remains here). */
export type SurfaceState = {
  readonly kind: "context";
  readonly x: number;
  readonly y: number;
} | null;

/**
 * Detect a slash trigger from the committed model text (docs/024 §7.3/§9). A trigger is a `/`
 * whose following run up to the caret is the query — no whitespace, no second `/` — and whose
 * position is valid: the start of the leaf, or immediately after whitespace. Pure: only the
 * collapsed caret's leaf text is read, so it is safe on the commit hot path. Read by the slash
 * overlay contributor's `when`/body (docs/029 R1-F).
 */
export function detectSlashTrigger(store: EditorStore): SlashTrigger | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  // Collapsed caret only — a range is a selection gesture, not a slash query.
  if (
    sel.anchor.node !== sel.focus.node ||
    sel.anchor.offset !== sel.focus.offset
  ) {
    return null;
  }
  const leaf = store.getNode(sel.focus.node);
  if (leaf?.kind !== "text") return null;
  const text = leaf.content.text;
  const caret = sel.focus.offset;
  // Walk back over the contiguous non-space, non-slash run ending at the caret.
  let i = caret;
  while (i > 0 && !/\s/.test(text[i - 1]!) && text[i - 1] !== "/") i -= 1;
  // The char before the run must be the trigger `/`.
  if (i === 0 || text[i - 1] !== "/") return null;
  const slashPos = i - 1;
  // The `/` itself must sit at a valid position: leaf start or after whitespace.
  if (slashPos > 0 && !/\s/.test(text[slashPos - 1]!)) return null;
  return { caret, leafId: leaf.id, query: text.slice(i, caret), slashPos };
}

export type CommandSurfacesController = {
  /** The live command context (selection facts + scope + capabilities). */
  readonly ctx: CommandContext;
  /** Whether the context menu is open, or null. */
  readonly surface: SurfaceState;
  /**
   * Open the context menu at a client point if any command resolves there; returns `false`
   * when nothing resolves so the caller leaves the native menu (docs/024 §9).
   */
  requestContextMenu(x: number, y: number): boolean;
  /** Close the context menu. */
  closeAll(): void;
};

export function useCommandSurfaces(
  store: EditorStore,
  capabilities: ToolbarCapabilities,
  panelHost?: PanelHost,
): CommandSurfacesController {
  const [surface, setSurface] = useState<SurfaceState>(null);
  const ctx = buildCommandContext(store, capabilities, panelHost);

  const requestContextMenu = useCallback(
    (x: number, y: number): boolean => {
      // Resolve against fresh state at click time; an empty resolution yields the native
      // menu (docs/024 §9 — object with no contributions, click off a block).
      const liveCtx = buildCommandContext(store, capabilities, panelHost);
      const groups = resolveCommandList("contextMenu", liveCtx);
      if (groups.length === 0) return false;
      setSurface({ kind: "context", x, y });
      return true;
    },
    [store, capabilities, panelHost],
  );

  const closeAll = useCallback(() => setSurface(null), []);

  return { closeAll, ctx, requestContextMenu, surface };
}
