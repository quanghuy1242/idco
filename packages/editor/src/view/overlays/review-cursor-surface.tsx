/**
 * `ReviewCursorSurface` — the single active review surface (docs/038 §4 L3, §7, §16, R6-J J4).
 *
 * Exactly ONE control at a time, anchored to the block under the review cursor ({@link useReviewCursor}),
 * carrying: the change's one-line detail, prev/next navigation, and the accept/reject affordance (this
 * block, or the whole proposal), plus a "view diff" drill-in (§6 T3). "Exactly one" is true BY
 * CONSTRUCTION — a single cursor has a single current block — so this needs no overlay-authority
 * arbitration; it is a standalone anchored control in the shipped `comment-affordance.tsx` mould (a
 * positioned element that reads the anchor block's rect), which is also how every other opt-in review
 * piece is wired (the R6-I indicator, J2/J3's model + markers). See {@link useReviewCursor} for why the
 * internal overlay authority is not the home here.
 *
 * FOCUS SAFETY (docs/038 §7, §13 — "operating it does not tear editor focus"): this is a
 * `taking`-focus surface with RECLAIM (§7, docs/029 §7.1), not a focus-transparent one. Pressing a
 * button takes focus (React Aria focuses on press), but the editor's model selection survives focus
 * loss (docs/017 §8.6), the buttons never dispatch a selection change, and a TERMINAL action
 * (accept/reject/exit) reclaims editor focus through `focusEditor` — so the caret returns to the
 * document. Navigation (next/prev) does not reclaim, so the reviewer keeps stepping. `onMouseDown →
 * preventDefault` is a best-effort belt-and-suspenders where the browser honors it, not the mechanism.
 *
 * One caveat the reclaim cannot cover in J4: if the host RESOLVES a change by REBUILDING the editor
 * (the store-rebuild-on-reject a J4-era consumer does before optimistic apply exists), the `focusEditor`
 * call lands on the about-to-unmount editor and the remounted one comes up unfocused. Reclaim holds for
 * an action that does not remount (accept, exit, and — once J6's in-place optimistic apply + revert
 * removes the rebuild — reject too). So in J4 the focus guarantee is solid for accept/exit and rides J6
 * for a rebuild-on-reject host.
 *
 * WHAT ACCEPT/REJECT DOES HERE (docs/038 §16): the surface is the AFFORDANCE — it emits scoped intents
 * (`onAcceptBlock`/`onRejectBlock`/`onAcceptAll`/`onRejectAll`). WHOLE accept/reject is functional today
 * over the pure `applyProposal` (docs/036 §9 J1). Per-block ACCEPT that clears just that block's marker
 * needs the baseline to advance as blocks resolve — the optimistic-apply / moving-baseline plumbing
 * that is J6 (docs/038 §14–§16); until then a host wires per-block reject (recompute the proposed doc
 * without that block's ops) and defers per-block accept, or treats accept-all/reject-all as the
 * resolution. The surface does not bake that policy in — it stays a pure intent emitter.
 *
 * @categoryDefault Inline Review
 */
import { Button } from "@quanghuy1242/idco-ui";
import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { NodeId } from "../../core";
import type { ReviewCursor, ReviewCursorEntry } from "../review-cursor";

/** Card footprint + gap used to choose a placement that does not cover the change (right gutter first). */
const CARD_W = 320;
const CARD_H = 150;
const CARD_GAP = 12;

/** A human label + tone for each change status (drives the surface's status chip). */
const STATUS_LABEL: Record<string, string> = {
  added: "Added",
  changed: "Edited",
  moved: "Moved",
  removed: "Removed",
};

const CARD: CSSProperties = {
  background: "var(--color-base-100, #fff)",
  border: "1px solid var(--color-base-300, #d4d4d4)",
  borderRadius: "0.5rem",
  boxShadow: "0 4px 16px rgba(0,0,0,0.16)",
  color: "var(--color-base-content, #171717)",
  display: "flex",
  flexDirection: "column",
  font: "13px/1.4 ui-sans-serif, system-ui, sans-serif",
  gap: "0.4rem",
  maxWidth: 340,
  minWidth: 260,
  padding: "0.6rem 0.7rem",
  // A fixed overlay beside the change (see the placement effect); a terminal action reclaims editor
  // focus (§7), so this is a review control, not a focus sink.
  position: "fixed",
  zIndex: 60,
};

const HEADER: CSSProperties = {
  alignItems: "center",
  display: "flex",
  gap: "0.5rem",
  justifyContent: "space-between",
};

const STATUS_CHIP: CSSProperties = {
  background: "var(--color-base-200, #e5e5e5)",
  borderRadius: "0.35rem",
  fontSize: "0.7rem",
  fontWeight: 600,
  letterSpacing: "0.02em",
  padding: "0.1rem 0.4rem",
  textTransform: "uppercase",
};

const ROW: CSSProperties = {
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: "0.35rem",
};

/** Escape a node id for a CSS attribute selector (node ids are safe today; this keeps it robust). */
function escapeId(id: string): string {
  return id.replace(/["\\]/g, "\\$&");
}

/**
 * The active review surface exports (docs/038 §7). This standalone block, immediately before the first
 * exported symbol, is the api-map module header (the file header above precedes elided value imports
 * and is dropped from the emitted `.d.ts`), so it also stops `ReviewCursorSurface`'s own doc from being
 * consumed as the header (the `review-model.ts` convention).
 *
 * @categoryDefault Inline Review
 */

/**
 * The single active review surface, anchored to the block under the review cursor (docs/038 §7).
 *
 * Renders nothing when the cursor has no current change. Positions itself beside the cursor block (the
 * right gutter, never over the change) and re-measures on scroll/resize so it tracks the change as the
 * document scrolls (the cursor's own `next`/`prev` reveal the block first). All actions are callbacks;
 * the surface never mutates the store.
 *
 * @category Inline Review
 */
export function ReviewCursorSurface(props: {
  readonly cursor: ReviewCursor;
  /** Scope the block lookup to this editor root (defaults to the whole document). */
  readonly rootRef?: RefObject<HTMLElement | null>;
  readonly onAcceptBlock?: (id: NodeId, entry: ReviewCursorEntry) => void;
  readonly onRejectBlock?: (id: NodeId, entry: ReviewCursorEntry) => void;
  readonly onAcceptAll?: () => void;
  readonly onRejectAll?: () => void;
  /** Open the full diff for this block (§6 T3 drill-in) — a host wires it to a scoped `DiffView`. */
  readonly onViewDiff?: (id: NodeId) => void;
  /** Leave review mode (the ✕). */
  readonly onExit?: () => void;
  /**
   * Return focus to the editor after a TERMINAL action (accept/reject/exit) — the focus-reclaim of the
   * `taking`-focus surface (docs/038 §7, docs/029 §7.1). Wire to the editor handle's
   * `getEditorHandle().focus()`. Navigation (next/prev) deliberately does NOT reclaim, so the reviewer
   * can keep stepping without focus bouncing.
   */
  readonly focusEditor?: () => void;
}) {
  const {
    cursor,
    rootRef,
    onAcceptBlock,
    onRejectBlock,
    onAcceptAll,
    onRejectAll,
    onViewDiff,
    onExit,
    focusEditor,
  } = props;
  const current = cursor.current;
  // Anchor on `revealId`, not `id`: a removed change has no live element of its own, so it anchors to
  // its surviving neighbor (the block at the deletion gap), which IS mounted after `onReveal` scrolls it
  // in. For a present change `revealId === id`.
  const currentId = current?.revealId ?? null;

  // A terminal action resolves a change then reclaims editor focus (§7 taking+reclaim): the RA button
  // took focus on press, so without this the caret would sit on the button, not the document.
  const terminal = (run: () => void) => () => {
    run();
    focusEditor?.();
  };

  // Position is computed in a POST-COMMIT layout effect, not during render, because the anchor block's
  // DOM element does not exist yet on the surface's first render (the editor commits in the same pass),
  // so a render-time `getBoundingClientRect` returns nothing and — with no re-render trigger — the
  // surface would stay invisible. The effect runs after the editor's DOM is present, re-measures on
  // scroll/resize (a `tick`) and whenever the cursor lands on a new block (`currentId`), and places the
  // card in the right gutter (never over the change) or, with no room, above/below it — all clamped.
  const [tick, setTick] = useState(0);
  useLayoutEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    return () => {
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
    };
  }, []);

  const [pos, setPos] = useState<{
    top: number;
    left: number;
    liftY: boolean;
  } | null>(null);
  useLayoutEffect(() => {
    if (!currentId) {
      setPos(null);
      return;
    }
    const root: ParentNode = rootRef?.current ?? document;
    const el = root.querySelector(
      `[data-engine-block-id="${escapeId(currentId)}"]`,
    );
    const rect = el?.getBoundingClientRect();
    if (!rect) {
      setPos(null);
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer the RIGHT GUTTER — beside the change, never over it (the card must not cover the prose it
    // points at). Fall back to above/below (clamped) only when there is no room to the right (a narrow
    // viewport / a full-width block), keeping the card off the change body as much as possible.
    const rightRoom = rect.right + CARD_GAP + CARD_W <= vw - 8;
    if (rightRoom) {
      setPos({
        left: rect.right + CARD_GAP,
        liftY: false,
        top: Math.min(Math.max(rect.top, 8), Math.max(8, vh - CARD_H)),
      });
      return;
    }
    const above = rect.top > CARD_H + CARD_GAP;
    setPos({
      left: Math.min(Math.max(rect.left, 8), Math.max(8, vw - CARD_W - 8)),
      liftY: above,
      top: above
        ? rect.top - CARD_GAP
        : Math.min(rect.bottom + CARD_GAP, vh - CARD_H),
    });
  }, [currentId, tick, rootRef]);

  if (!current || !pos) return null;
  const style: CSSProperties = {
    ...CARD,
    left: pos.left,
    top: pos.top,
    ...(pos.liftY ? { transform: "translateY(-100%)" } : {}),
  };

  return (
    <div
      aria-label="Review change"
      data-engine-review-surface=""
      // Best-effort: keep the press from stealing focus where the browser honors it. The model
      // selection survives focus loss regardless (docs/017 §8.6), and a terminal action reclaims focus
      // via `focusEditor` (§7 taking+reclaim), so this is belt-and-suspenders, not the sole mechanism.
      onMouseDown={(event) => event.preventDefault()}
      role="toolbar"
      style={style}
    >
      <div style={HEADER}>
        <span>
          <strong>
            Change {cursor.index + 1} of {cursor.count}
          </strong>{" "}
          <span style={STATUS_CHIP}>
            {STATUS_LABEL[current.status] ?? current.status}
          </span>
        </span>
        {onExit ? (
          <Button
            ariaLabel="Exit review"
            iconName="X"
            onClick={terminal(onExit)}
            size="sm"
            tooltip="Exit review"
            variant="ghost"
          />
        ) : null}
      </div>

      <div style={{ opacity: 0.85 }}>{current.detail}</div>

      <div style={ROW}>
        <Button
          ariaLabel="Previous change"
          iconName="ChevronLeft"
          onClick={cursor.prev}
          size="sm"
          tooltip="Previous change"
          variant="ghost"
        />
        <Button
          ariaLabel="Next change"
          iconName="ChevronRight"
          onClick={cursor.next}
          size="sm"
          tooltip="Next change"
          variant="ghost"
        />
        <span style={{ flex: 1 }} />
        {onViewDiff ? (
          <Button
            ariaLabel="View diff"
            onClick={() => onViewDiff(current.id)}
            size="sm"
            variant="secondary"
          >
            View diff
          </Button>
        ) : null}
      </div>

      <div style={ROW}>
        {onAcceptBlock ? (
          <Button
            ariaLabel="Accept this change"
            iconName="Check"
            onClick={terminal(() => onAcceptBlock(current.id, current))}
            size="sm"
            variant="primary"
          >
            Accept
          </Button>
        ) : null}
        {onRejectBlock ? (
          <Button
            ariaLabel="Reject this change"
            iconName="X"
            onClick={terminal(() => onRejectBlock(current.id, current))}
            size="sm"
            variant="danger"
          >
            Reject
          </Button>
        ) : null}
        <span style={{ flex: 1 }} />
        {onAcceptAll ? (
          <Button
            ariaLabel="Accept all changes"
            onClick={terminal(onAcceptAll)}
            size="sm"
            variant="ghost"
          >
            Accept all
          </Button>
        ) : null}
        {onRejectAll ? (
          <Button
            ariaLabel="Reject all changes"
            onClick={terminal(onRejectAll)}
            size="sm"
            variant="ghost"
          >
            Reject all
          </Button>
        ) : null}
      </div>
    </div>
  );
}
