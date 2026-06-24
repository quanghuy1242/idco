/**
 * The command-surface coordinator (docs/024 §8) — the cross-cutting hook that keeps
 * the three *flat* surfaces (context menu, selection flyout, slash menu) from
 * fighting. A single `useCommandSurfaces(store, capabilities)` owns "which surface is
 * open" so the precedence rules are centralized, not raced (docs/024 §8):
 *
 * - **One of each kind.** At most one flat surface is open at a time (`SurfaceState`
 *   is a single value); opening one closes the others.
 * - **Precedence by intent.** Right-click (explicit) beats the flyout (ambient); the
 *   slash trigger (typing/inserting) beats the flyout; the flyout is lowest-priority.
 *   Encoded in the two driver effects' functional updates: a `context`/`slash` state
 *   is never overwritten by the ambient flyout.
 * - **Slash from the committed model text, not keystrokes.** The highest-risk item
 *   (docs/024 §9) is avoided by detecting `/` on the *committed* leaf text around the
 *   caret in a commit/selection subscription — never a raw keydown listener that would
 *   fight IME + the markdown cascade. Slash and markdown are disjoint by trigger (a
 *   markdown prefix is anchored at block start; `/query` always leads with `/`), so no
 *   markdown suppression in the input path is needed (docs/024 §8 "disjoint by trigger").
 * - **Flyout on a settled selection.** The flyout shows only on a non-collapsed text
 *   selection when no pointer drag is in progress (`pointerDown`) and no object is
 *   active — re-evaluated on selection change + a *debounced* `pointerup`, so it does
 *   not thrash mid-drag (docs/024 §7.2 "settled"). The debounce is what makes a
 *   double/triple-click resolve to ONE appearance at the end of the gesture: each click
 *   is its own pointerdown→up, so an immediate raise would flash the flyout in after the
 *   first release and re-raise on the next, visible jank. `pointerup` only arms a short
 *   settle timer, and a following `pointerdown` (the next click, or a new drag) cancels
 *   it — so a 1-, 2-, or 3-click selection all land as a single clean appearance.
 *
 * The live `CommandContext` is rebuilt each render via `buildCommandContext` so every
 * host resolves against the same selection/scope. The hosts are presentational: they
 * render from `ctx` + their slice of `SurfaceState` and call `closeAll` (docs/024 §5.7).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorStore, NodeId } from "../../../core";
import {
  buildCommandContext,
  resolveCommandList,
  type CommandContext,
  type PanelHost,
  type ToolbarCapabilities,
} from "../../spi";
import { useStoreVersion } from "./use-store-version";

/**
 * How long the pointer must stay up before a selection is "settled" enough to raise the
 * flyout (docs/024 §7.2). It bridges the gap *between* the clicks of a double/triple-click
 * (a fast multi-click's inter-click gap is well under this), so the gesture coalesces into
 * one appearance at the end instead of flickering per click. Kept short so a plain
 * drag-select still feels prompt on release.
 */
const FLYOUT_SETTLE_MS = 180;

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
  | { readonly kind: "flyout" }
  | ({ readonly kind: "slash" } & SlashTrigger)
  | null;

/**
 * Detect a slash trigger from the committed model text (docs/024 §7.3/§9). A trigger
 * is a `/` whose following run up to the caret is the query — no whitespace, no second
 * `/` — and whose position is valid: the start of the leaf, or immediately after
 * whitespace (so "a/b" mid-word is not a trigger, but "a /b" and "/b" are). Pure: only
 * the collapsed caret's leaf text is read, so it is safe on the commit hot path.
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

/**
 * A stable signature of the current non-collapsed text selection, or null when the
 * selection is collapsed/absent. The flyout uses it to avoid re-raising for a selection
 * the user already moved past — when a context menu opens, or any surface is dismissed,
 * the flyout is suppressed for *that* selection until the selection changes (docs/024 §8).
 * Without this, the sticky flyout pops back over a context-menu-spawned link popover and
 * the two fight for focus.
 */
/**
 * True while one of the flyout's child command popovers (link / glossary-add / comment-add)
 * is open: its portaled content is marked `data-engine-flyout-child` (the always-present
 * trigger span is not). The ambient flyout must NOT close while a child is open, or it tears
 * the child popover — and the input the author is typing in — out from under them. This
 * regressed when the flyout re-evaluation became a debounced settle (b6c82bc): the delayed
 * re-eval now lands *after* the modal child has opened, so without this guard a transient
 * "don't show" verdict would dismiss the flyout and unmount the child mid-interaction.
 */
function flyoutChildOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector("[data-engine-flyout-child]") !== null
  );
}

function selectionSignature(store: EditorStore): string | null {
  const sel = store.selection;
  if (sel?.type !== "text") return null;
  if (
    sel.anchor.node === sel.focus.node &&
    sel.anchor.offset === sel.focus.offset
  ) {
    return null;
  }
  return `${sel.anchor.node}:${sel.anchor.offset}-${sel.focus.node}:${sel.focus.offset}`;
}

export type CommandSurfacesController = {
  /** The live command context (selection facts + scope + capabilities). */
  readonly ctx: CommandContext;
  /** Which flat surface is open, or null. */
  readonly surface: SurfaceState;
  /**
   * Open the context menu at a client point if any command resolves there; returns
   * `false` when nothing resolves so the caller leaves the native menu (docs/024 §9).
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
  // Re-render (and re-run the driver effects) on every selection/commit change.
  const version = useStoreVersion(store);
  const [surface, setSurface] = useState<SurfaceState>(null);
  const ctx = buildCommandContext(store, capabilities, panelHost);

  // Track an in-progress pointer drag so the ambient flyout does not flicker mid-drag
  // (docs/024 §7.2 "settled"). `settleTick` bumps once the gesture *fully* settles so the
  // flyout effect re-evaluates then.
  const pointerDownRef = useRef(false);
  // The selection signature the flyout is suppressed for (set when a context menu opens
  // or any surface is dismissed); the flyout will not re-raise for it until the selection
  // changes (docs/024 §8 — keeps the sticky flyout from fighting a context-menu popover).
  const suppressedSigRef = useRef<string | null>(null);
  const [settleTick, setSettleTick] = useState(0);
  // The pending settle timer (debounced pointerup). A double/triple-click is several
  // pointerdown→up cycles; arming on up and cancelling on the next down collapses the
  // whole sequence into one settle so the flyout appears once, at the end (the user's ask),
  // instead of flashing in per click.
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const cancelSettle = () => {
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
    const onDown = () => {
      pointerDownRef.current = true;
      // A new press — the next click of a multi-click, or the start of a fresh drag —
      // cancels the pending settle so the flyout does not raise between clicks.
      cancelSettle();
    };
    const onUp = () => {
      pointerDownRef.current = false;
      cancelSettle();
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        setSettleTick((n) => n + 1);
      }, FLYOUT_SETTLE_MS);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      cancelSettle();
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
    };
  }, []);

  // Slash driver (highest-priority ambient surface, docs/024 §8). Reads committed
  // model text; a `context` state wins (right-click is explicit), so it is left alone.
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

  // Flyout driver (lowest-priority ambient surface, docs/024 §7.2/§8). Shows only on a
  // settled non-collapsed text selection with no active object, and only if the flyout is
  // not suppressed for this exact selection (so it does not re-raise over a context-menu
  // popover or after the user dismissed it); `context`/`slash` win.
  useEffect(() => {
    const sig = selectionSignature(store);
    // A collapsed/absent selection clears the suppression, so the next fresh selection
    // raises the flyout again.
    if (sig === null) suppressedSigRef.current = null;
    const show =
      sig !== null &&
      sig !== suppressedSigRef.current &&
      store.activeObjectId === null &&
      !pointerDownRef.current;
    setSurface((prev) => {
      if (prev?.kind === "context" || prev?.kind === "slash") return prev;
      if (show) return prev?.kind === "flyout" ? prev : { kind: "flyout" };
      // Keep the flyout open while one of its own child command popovers is open, so a
      // delayed/transient "don't show" verdict never tears the child (and its focused
      // input) out from under the author (docs/027 annotation-input focus).
      if (prev?.kind === "flyout" && flyoutChildOpen()) return prev;
      return prev?.kind === "flyout" ? null : prev;
    });
  }, [store, version, settleTick]);

  const requestContextMenu = useCallback(
    (x: number, y: number): boolean => {
      // Resolve against fresh state at click time; an empty resolution yields the
      // native menu (docs/024 §9 — object with no contributions, click off a block).
      const liveCtx = buildCommandContext(store, capabilities, panelHost);
      const groups = resolveCommandList("contextMenu", liveCtx);
      if (groups.length === 0) return false;
      // Right-click is explicit: suppress the ambient flyout for this selection so it
      // does not pop back over the context menu or a command popover it spawns.
      suppressedSigRef.current = selectionSignature(store);
      setSurface({ kind: "context", x, y });
      return true;
    },
    [store, capabilities, panelHost],
  );

  const closeAll = useCallback(() => {
    // Remember the selection we dismissed on, so the flyout stays down for it until the
    // selection changes (the link-popover-vs-flyout conflict fix).
    suppressedSigRef.current = selectionSignature(store);
    setSurface(null);
  }, [store]);

  return { closeAll, ctx, requestContextMenu, surface };
}
