/**
 * The overlay authority (docs/029 §4 / §7, R1-A) — one manager that owns the *envelope* of
 * every floating surface: which surfaces are open, how they co-slot, their drill-in mode
 * stacks, and (via the focus-reclaim seam) who owns focus. It generalizes the three-surface
 * coordinator (`use-command-surfaces.ts`, docs/024 §8) to all targets and adds the *compose*
 * (co-slot) half the coordinator never had.
 *
 * The module splits into a **pure engine** (state + reconcile + the push/pop/dismiss
 * transforms + envelope resolution) and a **React hook** (`useOverlayAuthority`) that ports
 * the coordinator's pointer-settle debounce, computes per-target signatures, drives the
 * reclaim seam, and exposes the imperative API. The engine is DOM-free and deterministic so
 * arbitration, co-slot, the mode stack, reconciliation, and suppression are unit-asserted
 * without React or a layout engine (docs/029 §8.1). The anchor→rect resolution and central
 * positioning are deliberately *not* here — they live in `../overlays/overlay-anchor.ts` and
 * `overlay-positioning.ts`, consumed by the render layer (`overlay-layer.tsx`).
 *
 * In Phase 1 the authority is built and tested but not yet wired into the live editor (the
 * old coordinator still drives the live surfaces); mounting it is the Phase 2 selection-
 * surface migration (docs/029 §6.1). So nothing user-visible changes — the P1 gate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorStore } from "../../core";
import {
  canCoSlot,
  getOverlayContributor,
  listOverlayContributors,
  type AnchorRef,
  type AnchorTargetKind,
  type ContentKind,
  type FocusMode,
  type MarkProbe,
  type OverlayContributor,
  type OverlayPanel,
  type OverlaySurfaceContext,
} from "./anchor-target";
import { buildCommandContext, resolveCommandList } from "./command-surface";
import type {
  CommandContext,
  PanelHost,
  ToolbarCapabilities,
} from "./command-registry";

// ---------------------------------------------------------------------------
// Pure engine
// ---------------------------------------------------------------------------

/** One surface currently open on a target (docs/029 §4.5). */
export type OpenSurface = {
  readonly target: AnchorTargetKind;
  readonly anchor: AnchorRef;
  /** The co-slotted root contributor ids, in registration order (the bar's slots). */
  readonly rootContributorIds: readonly string[];
  /** The drill-in mode stack; empty = the root view is showing. */
  readonly modeStack: readonly OverlayPanel[];
};

/**
 * The authority's persistent state (docs/029 §7.2). `open` is the live surfaces; `explicit`
 * is the persistent press/click-opened requests (they stay until dismissed, unlike ambient
 * surfaces which are re-derived each frame); `suppressed` is the per-target dismissed-anchor
 * signature that keeps a sticky surface from re-raising until its anchor changes (the
 * generalized coordinator `suppressedSig`).
 */
export type AuthorityState = {
  readonly open: readonly OpenSurface[];
  readonly explicit: readonly {
    readonly target: AnchorTargetKind;
    readonly anchor: AnchorRef;
    readonly contributorId: string;
  }[];
  readonly suppressed: Readonly<Record<string, string | null>>;
};

/** The empty starting state. */
export const EMPTY_AUTHORITY_STATE: AuthorityState = {
  explicit: [],
  open: [],
  suppressed: {},
};

/** Inputs to one reconcile pass (docs/029 §7.2/§7.3). All model-derived, no DOM. */
export type ReconcileInput = {
  readonly contributors: readonly OverlayContributor[];
  readonly ctx: CommandContext;
  /** Per-target current anchor signature (for suppression compare + vanish detection). */
  readonly signatures: Readonly<Record<string, string | null>>;
  /** Per-target ambient-ready gate (the settle debounce); a target absent/true is ready. */
  readonly ready?: Readonly<Record<string, boolean>>;
};

/** The text-flow targets are mutually exclusive — one text interaction at a time (docs/029 §7.3). */
const TEXT_FLOW_RANK: Readonly<Record<string, number>> = {
  caret: 2,
  point: 3,
  selection: 1,
};

/** Per-target stacking weight; higher floats above + stays put under collision (docs/029 §7.4). */
const TARGET_Z: Readonly<Record<AnchorTargetKind, number>> = {
  block: 45,
  caret: 40,
  cell: 50,
  mark: 55,
  point: 60,
  selection: 35,
};

function naturalAnchor(target: AnchorTargetKind): AnchorRef | null {
  if (target === "selection") return { kind: "selection" };
  if (target === "caret") return { kind: "caret" };
  return null;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** A candidate contributor + the anchor it would open on, for one target. */
type Candidate = { readonly c: OverlayContributor; readonly anchor: AnchorRef };

/** The highest `priority` among a co-slot class's candidates (default 0). */
function maxClassPriority(cls: readonly Candidate[]): number {
  return Math.max(...cls.map((x) => x.c.priority ?? 0));
}

/**
 * Pick the winning co-slot group for one target (docs/029 §7.3 rule 3). Candidates are
 * partitioned into co-slot-compatible classes; the class with the highest max priority wins
 * (ties broken by registration order, preserved because candidates arrive in that order),
 * and its members co-slot. Returns the winning root ids (registration-ordered) + the anchor.
 */
function winnerForTarget(
  cands: readonly Candidate[],
  registrationIndex: ReadonlyMap<string, number>,
): { readonly rootIds: string[]; readonly anchor: AnchorRef } | null {
  if (cands.length === 0) return null;
  const classes: Candidate[][] = [];
  for (const cand of cands) {
    const cls = classes.find((group) => canCoSlot(group[0]!.c, cand.c));
    if (cls) cls.push(cand);
    else classes.push([cand]);
  }
  let best = classes[0]!;
  let bestPriority = maxClassPriority(best);
  for (const cls of classes.slice(1)) {
    const priority = maxClassPriority(cls);
    if (priority > bestPriority) {
      best = cls;
      bestPriority = priority;
    }
  }
  const rootIds = best
    .map((x) => x.c.id)
    .sort(
      (a, b) =>
        (registrationIndex.get(a) ?? 0) - (registrationIndex.get(b) ?? 0),
    );
  // Prefer an explicitly-provided anchor (its kind carries ids); fall back to the first.
  const anchor = best.find((x) => x.anchor)?.anchor ?? best[0]!.anchor;
  return { anchor, rootIds };
}

/** The effective focus mode of an open surface: the top mode-stack level, else its root. */
export function effectiveFocusMode(
  surface: OpenSurface,
  lookup: (id: string) => OverlayContributor | undefined,
): FocusMode {
  const top = surface.modeStack.at(-1);
  if (top) return top.focusMode;
  const root = lookup(surface.rootContributorIds[0] ?? "");
  return root?.focusMode ?? "transparent";
}

/** The effective content kind of an open surface (top mode-stack level, else its root). */
export function effectiveContentKind(
  surface: OpenSurface,
  lookup: (id: string) => OverlayContributor | undefined,
): ContentKind {
  const top = surface.modeStack.at(-1);
  if (top) return top.contentKind;
  const root = lookup(surface.rootContributorIds[0] ?? "");
  return root?.contentKind ?? "actions";
}

/**
 * Reconcile the authority state against the live model (docs/029 §7.2/§7.3). Pure: same
 * inputs → same output. The pass, in order:
 *
 *  1. Gather candidates per target — persistent explicit opens (press/click), then ambient
 *     contributors whose `when` is true, gated by the settle `ready` map and by suppression.
 *  2. Pick each target's winner via the two-level co-slot rule (`winnerForTarget`).
 *  3. Apply text-flow exclusivity: among `selection`/`caret`/`point` winners keep only the
 *     highest-rank one (the generalized coordinator precedence); other targets coexist.
 *  4. Build the next `open`, carrying a surface's mode stack forward when its root set is
 *     unchanged (so a drill-in survives re-projection) and resetting it when it changed.
 *  5. Reconciliation survive (docs/029 §7.2): a previously-open surface whose content
 *     vanished this frame survives iff its effective focus mode is `taking` (a form the user
 *     is mid-interaction with), and is dropped if `transparent` (an ambient bar).
 *  6. Clear stale suppression (a target whose signature changed re-raises).
 */
export function reconcileAuthority(
  prev: AuthorityState,
  input: ReconcileInput,
): AuthorityState {
  const { contributors, ctx, signatures, ready } = input;
  const byId = new Map(contributors.map((c) => [c.id, c] as const));
  const registrationIndex = new Map(
    contributors.map((c, i) => [c.id, i] as const),
  );
  const lookup = (id: string) => byId.get(id);

  const candByTarget = new Map<AnchorTargetKind, Candidate[]>();
  const pushCandidate = (c: OverlayContributor, anchor: AnchorRef) => {
    const list = candByTarget.get(c.target) ?? [];
    list.push({ anchor, c });
    candByTarget.set(c.target, list);
  };

  // (1a) Persistent explicit opens — always candidates until dismissed, ignoring `when`.
  const explicitTargets = new Set<AnchorTargetKind>();
  for (const req of prev.explicit) {
    const c = byId.get(req.contributorId);
    if (!c) continue;
    pushCandidate(c, req.anchor);
    explicitTargets.add(c.target);
  }

  // (1b) Ambient contributors — raised from model state, gated by settle + suppression.
  for (const c of contributors) {
    if (!c.when) continue;
    if (ready && ready[c.target] === false) continue;
    if (!c.when(ctx)) continue;
    const suppressedSig = prev.suppressed[c.target] ?? null;
    const currentSig = signatures[c.target] ?? null;
    if (
      suppressedSig !== null &&
      currentSig !== null &&
      suppressedSig === currentSig
    ) {
      continue; // suppressed for this exact anchor until it changes
    }
    const anchor = c.ambientAnchor?.(ctx) ?? naturalAnchor(c.target);
    if (!anchor) continue;
    pushCandidate(c, anchor);
  }

  // (2) Per-target winner.
  const winners = new Map<
    AnchorTargetKind,
    { rootIds: string[]; anchor: AnchorRef }
  >();
  for (const [target, cands] of candByTarget) {
    const winner = winnerForTarget(cands, registrationIndex);
    if (winner) winners.set(target, winner);
  }

  // (3) Text-flow exclusivity: keep only the highest-rank text-flow winner.
  const textFlowWinners = [...winners.keys()].filter(
    (t) => t in TEXT_FLOW_RANK,
  );
  if (textFlowWinners.length > 1) {
    const keep = textFlowWinners.reduce((a, b) =>
      (TEXT_FLOW_RANK[b] ?? 0) > (TEXT_FLOW_RANK[a] ?? 0) ? b : a,
    );
    for (const t of textFlowWinners) if (t !== keep) winners.delete(t);
  }

  // (4) Build next open, carrying mode stacks forward when the root set is unchanged.
  const open: OpenSurface[] = [];
  const represented = new Set<AnchorTargetKind>();
  for (const [target, winner] of winners) {
    const prevOpen = prev.open.find((o) => o.target === target);
    const sameRoot =
      prevOpen && sameIds(prevOpen.rootContributorIds, winner.rootIds);
    open.push({
      anchor: winner.anchor,
      modeStack: sameRoot ? prevOpen.modeStack : [],
      rootContributorIds: winner.rootIds,
      target,
    });
    represented.add(target);
  }

  // (5) Reconciliation survive: a vanished surface lives on iff it is focus-taking.
  for (const prevOpen of prev.open) {
    if (represented.has(prevOpen.target)) continue;
    if (effectiveFocusMode(prevOpen, lookup) === "taking") {
      open.push(prevOpen);
      represented.add(prevOpen.target);
    }
  }

  // (6) Clear stale suppression; explicit opens clear their target's suppression.
  const suppressed: Record<string, string | null> = { ...prev.suppressed };
  for (const target of Object.keys(suppressed)) {
    const sig = signatures[target] ?? null;
    if (suppressed[target] !== null && sig !== suppressed[target]) {
      suppressed[target] = null;
    }
  }
  for (const target of explicitTargets) suppressed[target] = null;

  return { explicit: prev.explicit, open, suppressed };
}

/** Add a persistent explicit open (press/click), replacing any prior request on its target. */
export function openExplicit(
  state: AuthorityState,
  anchor: AnchorRef,
  contributorId: string,
  target: AnchorTargetKind,
): AuthorityState {
  const explicit = [
    ...state.explicit.filter((e) => e.target !== target),
    { anchor, contributorId, target },
  ];
  // Clear suppression so the explicit open is honored even over a just-dismissed anchor.
  const suppressed = { ...state.suppressed, [target]: null };
  return { ...state, explicit, suppressed };
}

/** Push a drill-in panel onto a target's open surface (docs/029 §4.5). */
export function pushPanel(
  state: AuthorityState,
  target: AnchorTargetKind,
  panel: OverlayPanel,
): AuthorityState {
  const open = state.open.map((s) =>
    s.target === target ? { ...s, modeStack: [...s.modeStack, panel] } : s,
  );
  return { ...state, open };
}

/** Pop one drill-in level from a target's open surface (no-op at the root, docs/029 §4.5). */
export function popPanel(
  state: AuthorityState,
  target: AnchorTargetKind,
): AuthorityState {
  const open = state.open.map((s) =>
    s.target === target && s.modeStack.length > 0
      ? { ...s, modeStack: s.modeStack.slice(0, -1) }
      : s,
  );
  return { ...state, open };
}

/**
 * Dismiss a surface (docs/029 §4.5/§7.2): a non-empty mode stack pops one level (dismiss
 * pops one, not the whole surface); at the root it closes the surface, drops any explicit
 * request, and records the anchor signature as suppressed so a sticky ambient surface does
 * not immediately re-raise for the same anchor.
 */
export function dismissSurface(
  state: AuthorityState,
  target: AnchorTargetKind,
  signature: string | null,
): AuthorityState {
  const surface = state.open.find((s) => s.target === target);
  if (surface && surface.modeStack.length > 0) return popPanel(state, target);
  return {
    explicit: state.explicit.filter((e) => e.target !== target),
    open: state.open.filter((s) => s.target !== target),
    suppressed: { ...state.suppressed, [target]: signature },
  };
}

/** Dismiss every open surface, recording each text-flow target's suppression signature. */
export function dismissAllState(
  state: AuthorityState,
  signatures: Readonly<Record<string, string | null>>,
): AuthorityState {
  const suppressed: Record<string, string | null> = { ...state.suppressed };
  for (const s of state.open) {
    if (s.target in TEXT_FLOW_RANK) {
      suppressed[s.target] = signatures[s.target] ?? null;
    }
  }
  return { explicit: [], open: [], suppressed };
}

// ---------------------------------------------------------------------------
// Resolved output (for the render layer)
// ---------------------------------------------------------------------------

/** One co-slotted slot of a root view: a contributor that fills part of the envelope. */
export type ResolvedSlot = {
  readonly id: string;
  readonly contributor: OverlayContributor;
};

/** A fully-resolved envelope ready for the render layer (docs/029 §4.7D). */
export type ResolvedEnvelope = {
  /** Stable id: target + the winning root ids (so React keys are stable across frames). */
  readonly id: string;
  readonly target: AnchorTargetKind;
  readonly anchor: AnchorRef;
  readonly focusMode: FocusMode;
  readonly contentKind: ContentKind;
  /** The root view's co-slotted contributors (empty when a drill-in panel covers the root). */
  readonly slots: readonly ResolvedSlot[];
  /** The top drill-in panel, or null when the root view is showing. */
  readonly panel: OverlayPanel | null;
  /** Stacking weight for z-order + the collision solve. */
  readonly z: number;
};

/** Turn the persistent state into render-ready envelopes (docs/029 §4.7D). */
export function resolveEnvelopes(
  state: AuthorityState,
  lookup: (id: string) => OverlayContributor | undefined,
): readonly ResolvedEnvelope[] {
  return state.open.map((surface) => {
    const slots: ResolvedSlot[] = surface.rootContributorIds
      .map((id) => {
        const contributor = lookup(id);
        return contributor ? { contributor, id } : null;
      })
      .filter((slot): slot is ResolvedSlot => slot !== null);
    const panel = surface.modeStack.at(-1) ?? null;
    return {
      anchor: surface.anchor,
      contentKind: effectiveContentKind(surface, lookup),
      focusMode: effectiveFocusMode(surface, lookup),
      id: `${surface.target}:${surface.rootContributorIds.join("+")}`,
      panel,
      slots,
      target: surface.target,
      z: TARGET_Z[surface.target],
    };
  });
}

// ---------------------------------------------------------------------------
// Ownership registry (containment by ownership, not DOM ancestry — docs/029 §7.4)
// ---------------------------------------------------------------------------

/**
 * Tracks each live envelope's surface element + its parent envelope (for drill-ins), so
 * "is this press inside me or a descendant overlay of mine" is one registry walk instead of
 * a `closest("[data-engine-*]")` selector (docs/029 §7.4). Drill-in children may render as
 * DOM siblings in the flat portal layer, so DOM ancestry alone is insufficient — ownership
 * is the reliable relation. The dismissal *use* of this is Phase 2; Phase 1 ships and tests
 * the registry + the containment query.
 */
export type OwnershipRegistry = {
  register(id: string, el: HTMLElement | null, parentId?: string | null): void;
  unregister(id: string): void;
  /** Whether `node` is inside any registered overlay element. */
  isWithin(node: Node | null): boolean;
  /** Whether `node` is inside surface `id` or any descendant overlay of it. */
  isWithinSurface(id: string, node: Node | null): boolean;
};

export function createOwnershipRegistry(): OwnershipRegistry {
  const els = new Map<string, HTMLElement>();
  const parentOf = new Map<string, string | null>();
  return {
    isWithin(node) {
      if (!node) return false;
      for (const el of els.values()) if (el.contains(node)) return true;
      return false;
    },
    isWithinSurface(id, node) {
      if (!node) return false;
      // Collect the surface + every descendant overlay (by parent links).
      const ids = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const [childId, parentId] of parentOf) {
          if (parentId && ids.has(parentId) && !ids.has(childId)) {
            ids.add(childId);
            grew = true;
          }
        }
      }
      for (const owned of ids) {
        const el = els.get(owned);
        if (el && el.contains(node)) return true;
      }
      return false;
    },
    register(id, el, parentId = null) {
      if (el) {
        els.set(id, el);
        parentOf.set(id, parentId);
      } else {
        els.delete(id);
        parentOf.delete(id);
      }
    },
    unregister(id) {
      els.delete(id);
      parentOf.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * The per-target anchor signature used for suppression + vanish detection. For the text-flow
 * targets it mirrors the coordinator: a non-collapsed selection's endpoints, or the caret
 * position; null when the shape is absent. Explicit-target signatures fall out of the open
 * anchor and are not needed here (explicit surfaces persist until dismissed).
 */
function computeSignatures(store: EditorStore): Record<string, string | null> {
  const sel = store.selection;
  let selection: string | null = null;
  let caret: string | null = null;
  if (sel?.type === "text") {
    const collapsed =
      sel.anchor.node === sel.focus.node &&
      sel.anchor.offset === sel.focus.offset;
    if (collapsed) caret = `${sel.focus.node}:${sel.focus.offset}`;
    else {
      selection = `${sel.anchor.node}:${sel.anchor.offset}-${sel.focus.node}:${sel.focus.offset}`;
    }
  }
  return { caret, selection };
}

/** How long the pointer must be up before the ambient selection surface settles (docs/024 §7.2). */
const FLYOUT_SETTLE_MS = 180;

/** Options for {@link useOverlayAuthority}. */
export type UseOverlayAuthorityOptions = {
  /** The side-panel dock seam, threaded into the command context (docs/027 §8.2). */
  readonly panelHost?: PanelHost;
  /**
   * Restore editor focus on the deliberate resume after a focus-taking surface closes
   * (docs/029 §7.1). The authority calls this once when the last taking surface dismisses.
   */
  readonly focusEditor?: () => void;
};

/** The public authority handle (docs/029 §4.6). */
export type OverlayAuthority = {
  readonly ctx: CommandContext;
  readonly envelopes: readonly ResolvedEnvelope[];
  /** Open a contributor explicitly at an anchor; false when the contributor is unregistered. */
  open(anchor: AnchorRef, contributorId: string): boolean;
  /** Open the first `mark` contributor that matches the clicked mark; false if none. */
  openMark(probe: MarkProbe): boolean;
  /** Open the context menu at a point if any command resolves there; false → native menu. */
  requestContextMenu(x: number, y: number): boolean;
  /** Dismiss a target's surface (pops one drill-in level, or closes at the root). */
  dismiss(target: AnchorTargetKind): void;
  /** Dismiss every open surface. */
  dismissAll(): void;
  /** Drill in: push a panel onto a target's surface. */
  push(target: AnchorTargetKind, panel: OverlayPanel): void;
  /** Pop one drill-in level from a target's surface. */
  pop(target: AnchorTargetKind): void;
  /** The ownership registry for containment checks (docs/029 §7.4). */
  readonly ownership: OwnershipRegistry;
  /** Build the surface context a body/panel receives (push/pop/dismiss/focusEditor + ctx). */
  surfaceContext(target: AnchorTargetKind): OverlaySurfaceContext;
};

/**
 * The overlay authority hook (docs/029 §4.6/§8.1). Generalizes `useCommandSurfaces`: holds
 * the engine state, ports the pointer-settle debounce (so a double/triple-click resolves to
 * one ambient appearance), recomputes signatures + reconciles on every selection/commit/
 * settle change, drives the focus-reclaim seam while a taking surface is open, and exposes
 * the imperative API. DOM-free except for the pointer listeners — anchor rects + positioning
 * live in the render layer.
 */
export function useOverlayAuthority(
  store: EditorStore,
  capabilities: ToolbarCapabilities,
  options: UseOverlayAuthorityOptions = {},
): OverlayAuthority {
  const { panelHost, focusEditor } = options;

  // Re-render on every selection / commit / active-object change.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    const unsubs = [
      store.subscribeSelection(bump),
      store.subscribeCommit(bump),
      store.subscribeActiveObject(bump),
    ];
    return () => unsubs.forEach((u) => u());
  }, [store]);

  const ctx = useMemo(
    () => buildCommandContext(store, capabilities, panelHost),
    // Rebuild whenever the model version changes so predicates read live state; `version`
    // is an intentional recompute trigger (the model is read imperatively inside).
    [store, capabilities, panelHost, version],
  );

  const [state, setState] = useState<AuthorityState>(EMPTY_AUTHORITY_STATE);

  // Pointer-settle debounce (ported from `use-command-surfaces.ts`): the ambient selection
  // surface only raises once the pointer has been up `FLYOUT_SETTLE_MS`, so a double/triple-
  // click coalesces into one appearance instead of flashing per click. `pointerDownRef`
  // gates ambient readiness; `settleTick` re-triggers reconcile after the settle.
  const pointerDownRef = useRef(false);
  const [settleTick, setSettleTick] = useState(0);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const cancel = () => {
      if (settleTimerRef.current !== null) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
    const onDown = () => {
      pointerDownRef.current = true;
      cancel();
    };
    const onUp = () => {
      pointerDownRef.current = false;
      cancel();
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null;
        setSettleTick((n) => n + 1);
      }, FLYOUT_SETTLE_MS);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
    };
  }, []);

  // Build a reconcile input from the live model. The ambient `selection` target is gated
  // `ready` by the settle (not mid-drag); other targets are always ready. Shared by the
  // model-change effect and the imperative opens so an explicit open reconciles immediately
  // (otherwise the new `explicit` request would not become an open surface until the next
  // selection/commit/settle bump).
  const reconcileInput = useCallback(
    (): ReconcileInput => ({
      contributors: listOverlayContributors(),
      ctx,
      ready: { selection: !pointerDownRef.current },
      signatures: computeSignatures(store),
    }),
    [ctx, store],
  );

  // Reconcile on every model/settle change.
  useEffect(() => {
    setState((prev) => reconcileAuthority(prev, reconcileInput()));
  }, [reconcileInput, version, settleTick]);

  const lookup = useCallback((id: string) => getOverlayContributor(id), []);

  const envelopes = useMemo(
    () => resolveEnvelopes(state, lookup),
    [state, lookup],
  );

  // Drive the focus-reclaim seam (docs/029 §7.1): while any open surface is focus-taking,
  // suspend the editor's automatic reclaim so the surface's field keeps focus; on the last
  // taking surface closing, resume and restore editor focus once.
  const anyTaking = envelopes.some((e) => e.focusMode === "taking");
  useEffect(() => {
    if (!anyTaking) return undefined;
    store.suspendReclaim();
    return () => {
      store.resumeReclaim();
      focusEditor?.();
    };
  }, [anyTaking, store, focusEditor]);

  const ownership = useMemo(() => createOwnershipRegistry(), []);

  const dismiss = useCallback(
    (target: AnchorTargetKind) => {
      const signature = computeSignatures(store)[target] ?? null;
      setState((prev) => dismissSurface(prev, target, signature));
    },
    [store],
  );

  const surfaceContext = useCallback(
    (target: AnchorTargetKind): OverlaySurfaceContext => ({
      ...buildCommandContext(store, capabilities, panelHost),
      dismiss: () => dismiss(target),
      focusEditor: () => focusEditor?.(),
      pop: () => setState((prev) => popPanel(prev, target)),
      push: (panel) => setState((prev) => pushPanel(prev, target, panel)),
    }),
    [store, capabilities, panelHost, dismiss, focusEditor],
  );

  const authority: OverlayAuthority = useMemo(
    () => ({
      ctx,
      dismiss,
      dismissAll: () =>
        setState((prev) => dismissAllState(prev, computeSignatures(store))),
      envelopes,
      open: (anchor, contributorId) => {
        const contributor = getOverlayContributor(contributorId);
        if (!contributor) return false;
        setState((prev) =>
          reconcileAuthority(
            openExplicit(prev, anchor, contributorId, contributor.target),
            reconcileInput(),
          ),
        );
        return true;
      },
      openMark: (probe) => {
        const contributor = listOverlayContributors().find(
          (c) => c.target === "mark" && c.match?.(probe),
        );
        if (!contributor) return false;
        setState((prev) =>
          reconcileAuthority(
            openExplicit(
              prev,
              { kind: "mark", markId: probe.markId, nodeId: probe.nodeId },
              contributor.id,
              "mark",
            ),
            reconcileInput(),
          ),
        );
        return true;
      },
      ownership,
      pop: (target) => setState((prev) => popPanel(prev, target)),
      push: (target, panel) =>
        setState((prev) => pushPanel(prev, target, panel)),
      requestContextMenu: (x, y) => {
        // Resolve against fresh state at click time; an empty resolution yields the native
        // menu (docs/024 §9). The first registered `point` contributor is the context menu.
        const contributor = listOverlayContributors().find(
          (c) => c.target === "point",
        );
        if (!contributor) return false;
        if (contributor.projects) {
          const groups = resolveCommandList(
            contributor.projects as Parameters<typeof resolveCommandList>[0],
            ctx,
          );
          if (groups.length === 0) return false;
        }
        setState((prev) =>
          reconcileAuthority(
            openExplicit(
              prev,
              { kind: "point", x, y },
              contributor.id,
              "point",
            ),
            reconcileInput(),
          ),
        );
        return true;
      },
      surfaceContext,
    }),
    [ctx, dismiss, envelopes, ownership, reconcileInput, store, surfaceContext],
  );

  return authority;
}
