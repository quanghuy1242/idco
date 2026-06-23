/**
 * Scroll-anchoring math (docs/025 §5.4). Pure, so it is unit-testable without a
 * DOM.
 *
 * Anchoring keeps the topmost visible block at the same screen position when a
 * geometry correction lands: shift `scrollTop` by the change in that block's top
 * edge (its `prefix`). Because the anchor is the *top edge* — the sum of heights
 * *before* the block — a correction to the anchor block's own height does not
 * move it; only corrections to blocks above it do. When nothing above moved, the
 * delta is ~0 and this returns `null` (no scroll write).
 */
export function anchorScrollAdjustment(args: {
  readonly prevPrefix: number;
  readonly newPrefix: number;
  readonly scrollTop: number;
  readonly fling: boolean;
  readonly tolerance?: number;
}): number | null {
  // Never write scrollTop mid-inertia (docs/025 §5.4): it stutters or cancels
  // native momentum on trackpads and free-spin wheels. The velocity gate makes
  // this safe by construction (no measurement → no correction during a fling),
  // but guard here too so the math is self-contained.
  if (args.fling) return null;
  const delta = args.newPrefix - args.prevPrefix;
  if (Math.abs(delta) <= (args.tolerance ?? 0.5)) return null;
  return Math.max(0, args.scrollTop + delta);
}

/**
 * Fling detection (docs/025 §5.5): a scroll moving faster than
 * `thresholdPxPerMs` is a fling. While flinging, the controller renders cheap
 * seed-sized placeholders and suppresses anchoring, so the per-frame DOM cost
 * and the jump-on-correction both disappear during a flywheel spin. `dtMs <= 0`
 * (same frame, or a stale/again-zero timestamp) is treated as "not a fling".
 */
export function isFlingVelocity(
  deltaPx: number,
  dtMs: number,
  thresholdPxPerMs: number,
): boolean {
  if (!(dtMs > 0)) return false;
  return Math.abs(deltaPx) / dtMs > thresholdPxPerMs;
}
