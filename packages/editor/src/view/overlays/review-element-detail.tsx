/**
 * `ReviewElementDetail` — the ring affordance's detail surface (docs/039 R-RG, R-EX, §7.6/§7.7, P4d).
 *
 * The passive layer draws a two-tone ring on a nested element whose attr/object changed (a re-colored
 * table cell, a code block whose language changed). The ring is where the reviewer LEARNS what changed,
 * but it is deliberately silent about the detail (a live document can be any color, so the ring can only
 * signal "here", not "red → green"). This component is the disclosure: one delegated `click` listener on
 * the review root (a ring is a `data-*` attribute, not a component, so a per-ring listener is wrong and
 * would not survive virtualization remounts) resolves the clicked ring's `data-engine-block-id`, looks up
 * its `BlockDiff` via `blockDiffIndex` (O(1)), and opens either:
 *
 * - a floating CHIP — the shared reader `<ChangeDetail>` for a one-line invisible (`Fill: red → green`,
 *   docs/039 D5); or
 * - a BAND — a `<DiffView>` scoped to that one block, so a code block shows its own line diff through the
 *   injected `getNodeDiffRenderer` (docs/039 §7.7). The scoped diff is a projection of the full diff (its
 *   `base`/`target` are carried), never a second diff pass.
 *
 * The host injects `RICH_TEXT_DIFF_CSS` once (the chip and band render `.rt-diff-*` markup); the band
 * sets `embedStyles={false}` so the stylesheet is not duplicated per surface. Positioned `fixed` at the
 * ring's rect captured on click — a transient inspect-then-dismiss popover, dismissed by a click outside
 * a ring or the card.
 *
 * @categoryDefault Inline Review
 */
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  ChangeDetail,
  DiffView,
  type NodeDiffRenderer,
} from "@quanghuy1242/idco-reader";
import {
  blockDiffIndex,
  type BlockDiff,
  type NodeId,
  type SnapshotDiff,
} from "../../core";
import { elementDisclosure } from "@quanghuy1242/idco-reader";

/**
 * @categoryDefault Inline Review
 */

const CARD: CSSProperties = {
  background: "var(--color-base-100, #fff)",
  border: "1px solid var(--color-base-300, #d4d4d4)",
  borderRadius: "0.5rem",
  boxShadow: "0 4px 16px rgba(0,0,0,0.16)",
  color: "var(--color-base-content, #171717)",
  font: "13px/1.4 ui-sans-serif, system-ui, sans-serif",
  maxHeight: "60vh",
  overflow: "auto",
  padding: "0.55rem 0.7rem",
  position: "fixed",
  zIndex: 61,
};

/** Escape a node id for a CSS attribute selector (node ids are safe today; this keeps it robust). */
function escapeId(id: string): string {
  return id.replace(/["\\]/g, "\\$&");
}

/** Project the full diff into a one-block `SnapshotDiff` for the band (docs/039 §7.7) — no re-diff. */
function scopedDiff(diff: SnapshotDiff, block: BlockDiff): SnapshotDiff {
  // Real per-block stats (not a hardcoded `changed:1`): harmless while the band forces `showStats:false`,
  // but correct if a caller ever shows them.
  const stats = { added: 0, changed: 0, moved: 0, removed: 0 };
  if (block.status === "added") stats.added = 1;
  else if (block.status === "removed") stats.removed = 1;
  else if (block.status === "moved") stats.moved = 1;
  else stats.changed = 1;
  return {
    base: diff.base,
    blocks: [block],
    collections: [],
    settingsChanged: false,
    stats,
    target: diff.target,
  };
}

/**
 * The ring affordance: click a nested change's ring to open its detail (a chip or a scoped-diff band).
 *
 * Renders nothing until a ring is clicked. Reads the diff via `blockDiffIndex`, decides chip vs band via
 * `elementDisclosure`, and floats the surface at the ring. A host mounts one of these beside the editor
 * (passing the review root and the same `getNodeDiffRenderer` the diff view uses) and injects
 * `RICH_TEXT_DIFF_CSS` once.
 *
 * @category Inline Review
 */
export function ReviewElementDetail(props: {
  readonly diff: SnapshotDiff | null;
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly getNodeDiffRenderer?: (type: string) => NodeDiffRenderer | undefined;
}) {
  const { diff, rootRef, getNodeDiffRenderer } = props;
  // Store only the focused id; the position is RE-MEASURED from the live ring element each layout pass
  // (docs/039 R-RG), so the popover tracks its anchor on scroll/resize instead of freezing at the click
  // rect over unrelated content. It also self-dismisses when its ring disappears (the change resolved).
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const index = useMemo(() => (diff ? blockDiffIndex(diff) : null), [diff]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const ring = target?.closest?.("[data-engine-review-ring]");
      if (ring instanceof HTMLElement) {
        const id = ring.getAttribute("data-engine-block-id");
        if (id) {
          setFocusedId(id);
          return;
        }
      }
      // A click outside a ring and outside the open card dismisses it.
      if (!target?.closest?.("[data-engine-review-detail]")) setFocusedId(null);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, [rootRef]);

  // Re-measure on scroll/resize (the same `tick` pattern the cursor surface uses) so the card follows
  // its ring; the position is derived below from the live ring rect, never captured once at click time.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    return () => {
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
    };
  }, []);

  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!focusedId) {
      setPos(null);
      return;
    }
    const root: ParentNode = rootRef.current ?? document;
    const ring = root.querySelector(
      `[data-engine-review-ring][data-engine-block-id="${escapeId(focusedId)}"]`,
    );
    const rect = ring?.getBoundingClientRect();
    if (!rect) {
      setPos(null); // the ring is gone (resolved / scrolled out of a virtualized window) → dismiss
      return;
    }
    setPos({
      left: Math.min(rect.left, Math.max(8, window.innerWidth - 380)),
      top: Math.min(rect.bottom + 8, Math.max(8, window.innerHeight - 80)),
    });
  }, [focusedId, tick, rootRef]);

  if (!focusedId || !pos || !diff || !index) return null;
  const block = index.get(focusedId as NodeId);
  if (!block) return null;
  const band = elementDisclosure(block, getNodeDiffRenderer) === "band";
  return (
    <div
      data-engine-review-detail=""
      style={{
        ...CARD,
        left: pos.left,
        top: pos.top,
        width: band ? 440 : 320,
      }}
    >
      {band ? (
        <DiffView
          diff={scopedDiff(diff, block)}
          embedStyles={false}
          getNodeDiffRenderer={getNodeDiffRenderer}
          showStats={false}
        />
      ) : (
        <ChangeDetail block={block} base={diff.base} target={diff.target} />
      )}
    </div>
  );
}
