/**
 * The command-surface coordinator (docs/024 §8) — the cross-cutting hook that keeps the
 * *flat* surfaces from fighting. After the docs/029 overlay-authority migration (R1-D, P2),
 * the **selection flyout moved to the overlay authority** (`useOverlayAuthority` +
 * `OverlayLayer`), so this coordinator now owns only the two surfaces still on the legacy
 * path: the right-click **context menu** and the **slash menu** (both migrate to the
 * authority in P3). They are mutually exclusive by trigger — slash needs a collapsed caret,
 * the context menu is an explicit right-click — and the selection bar (authority) needs a
 * *non-collapsed* selection, so the two systems never contend for the same model shape
 * (docs/029 §6.1 "each surface flips atomically").
 *
 * - **One of each kind.** At most one of {context, slash} is open (`SurfaceState` is a single
 *   value); opening one closes the other.
 * - **Precedence by intent.** Right-click (explicit) beats the slash trigger; encoded in the
 *   slash driver's functional update (a `context` state is never overwritten by slash).
 * - **Slash from the committed model text, not keystrokes** (docs/024 §9): `/` is detected on
 *   the committed leaf text in a commit/selection subscription, never a raw keydown that
 *   would fight IME + the markdown cascade.
 */
import { useCallback, useEffect, useState } from "react";
import type { EditorStore, NodeId } from "../../../core";
import {
  buildCommandContext,
  resolveCommandList,
  type CommandContext,
  type PanelHost,
  type ToolbarCapabilities,
} from "../../spi";
import { useStoreVersion } from "./use-store-version";

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

/** Which single flat surface is open (docs/024 §8 — one of each kind at a time). */
export type SurfaceState =
  | { readonly kind: "context"; readonly x: number; readonly y: number }
  | ({ readonly kind: "slash" } & SlashTrigger)
  | null;

/**
 * Detect a slash trigger from the committed model text (docs/024 §7.3/§9). A trigger is a `/`
 * whose following run up to the caret is the query — no whitespace, no second `/` — and whose
 * position is valid: the start of the leaf, or immediately after whitespace. Pure: only the
 * collapsed caret's leaf text is read, so it is safe on the commit hot path.
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
  /** Which flat surface is open, or null. */
  readonly surface: SurfaceState;
  /**
   * Open the context menu at a client point if any command resolves there; returns `false`
   * when nothing resolves so the caller leaves the native menu (docs/024 §9).
   */
  requestContextMenu(x: number, y: number): boolean;
  /** Close whichever flat surface is open. */
  closeAll(): void;
};

export function useCommandSurfaces(
  store: EditorStore,
  capabilities: ToolbarCapabilities,
  panelHost?: PanelHost,
): CommandSurfacesController {
  // Re-render (and re-run the slash driver) on every selection/commit change.
  const version = useStoreVersion(store);
  const [surface, setSurface] = useState<SurfaceState>(null);
  const ctx = buildCommandContext(store, capabilities, panelHost);

  // Slash driver (docs/024 §8). Reads committed model text; a `context` state wins
  // (right-click is explicit), so it is left alone.
  useEffect(() => {
    const trigger = detectSlashTrigger(store);
    setSurface((prev) => {
      if (trigger) {
        if (prev?.kind === "context") return prev;
        return { kind: "slash", ...trigger };
      }
      return prev?.kind === "slash" ? null : prev;
    });
  }, [store, version]);

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
