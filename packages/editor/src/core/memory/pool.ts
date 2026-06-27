/**
 * The memory budget arbiter and its pool contract (docs/030 §7.6 D6, Stage three; SLP-4).
 *
 * Why this file exists
 * --------------------
 * A book-scale document keeps several growable allocators resident at once: the resident
 * object *bake cache*, undo/redo *history*, and (when body paging lands) purgeable node
 * *bodies*. Left alone each grows without bound. The honest constraint (D6) is that pure
 * JS cannot enforce a *hard* byte cap — no forced GC, no heap ceiling, and accounted bytes
 * are only calibrated to RSS, not equal to it — so this is a *soft* budget: one accounted
 * ceiling divided across typed pools, kept near a target by high/low-water hysteresis and
 * rebalanced under pressure by stealing budget from the largest pools first.
 *
 * The arbiter is deliberately mechanism, not policy about *what* a pool holds. A pool is
 * anything that can estimate its bytes and shed them on demand (`MemoryPool`). The bake
 * cache (`core/bake/bake-cache.ts`) and the history pool (`core/store/history-pool.ts`)
 * implement it today; a future resident-body pool (the `BodyStore`-backed skeleton/body
 * split, deferred per D6/§7.6) registers behind the same seam with no arbiter change.
 *
 * Hysteresis, not a slam: the arbiter does nothing until the total crosses the *high*
 * water mark, then evicts down to the *low* water mark, so the resident set oscillates
 * around the target instead of thrashing one allocation above a hard line on every edit.
 * Default budget is `Infinity` — today's unbounded behavior (D6: "default generous/
 * unbounded ... calibrate before tightening") — so an editor with no `memoryBudget` set
 * behaves exactly as before and the arbiter is inert.
 */

/**
 * @categoryDefault Snapshot & Performance
 */

/**
 * A budget-managed allocator the arbiter can size and shrink. The arbiter never learns
 * what a pool stores — only its accounted size and how to shed toward a target.
 */
export type MemoryPool = {
  /** A stable, human-readable id for diagnostics (e.g. "bake", "history", "bodies"). */
  readonly name: string;
  /** Accounted resident bytes for this pool (a coarse estimate; see D6 on RSS skew). */
  estimateBytes(): number;
  /**
   * Shed resident entries until the pool is at or below `targetBytes`, returning the
   * number of bytes actually freed. A pool with an unevictable floor (a pinned entry)
   * returns less than requested; the arbiter tolerates that and moves to the next pool.
   */
  evict(targetBytes: number): number;
};

/** Construction options for a `MemoryArbiter`: the soft budget and its water marks. */
export type MemoryArbiterOptions = {
  /**
   * The overall soft budget in accounted bytes. `Infinity` (the default) keeps today's
   * unbounded behavior; the arbiter is inert until a host sets a finite budget calibrated
   * to measured RSS (D6).
   */
  readonly budgetBytes?: number;
  /**
   * Fraction of the budget at which a rebalance begins evicting (default 1.0 — evict only
   * once over budget). Must be in (0, 1].
   */
  readonly highWater?: number;
  /**
   * Fraction of the budget a rebalance evicts *down to* (default 0.8). Lower than
   * `highWater` so the resident set settles below the trigger and does not re-evict on the
   * very next allocation. Must be in (0, highWater].
   */
  readonly lowWater?: number;
};

/**
 * One accounted soft budget across registered pools, evicting from the largest pool first
 * down to the low-water mark when the total crosses the high-water mark.
 */
export class MemoryArbiter {
  readonly #pools: MemoryPool[] = [];
  readonly #budget: number;
  readonly #high: number;
  readonly #low: number;

  constructor(options?: MemoryArbiterOptions) {
    this.#budget = options?.budgetBytes ?? Number.POSITIVE_INFINITY;
    this.#high = options?.highWater ?? 1;
    // Clamp low-water below high-water so the post-evict total is genuinely under the
    // trigger; an inverted config would otherwise re-evict every pass.
    this.#low = Math.min(options?.lowWater ?? 0.8, this.#high);
  }

  /** The overall soft budget in bytes (`Infinity` when unbounded). */
  get budgetBytes(): number {
    return this.#budget;
  }

  /** Register a pool the arbiter manages. Pools are evicted largest-first under pressure. */
  register(pool: MemoryPool): void {
    this.#pools.push(pool);
  }

  /** The summed accounted bytes across every registered pool. */
  totalBytes(): number {
    let total = 0;
    for (const pool of this.#pools) total += pool.estimateBytes();
    return total;
  }

  /**
   * Run one rebalance pass. No-op when unbounded or below the high-water mark (the
   * hysteresis gate). Otherwise evict from the largest pools first until the total is at
   * or below the low-water target, stealing budget from whichever pool is currently
   * heaviest — a long scroll grows bodies/bake, a long edit session grows history, and the
   * arbiter shrinks whichever dominates. Returns the bytes freed this pass.
   */
  rebalance(): number {
    if (!Number.isFinite(this.#budget)) return 0;
    let total = this.totalBytes();
    if (total <= this.#budget * this.#high) return 0;
    const target = this.#budget * this.#low;
    let freed = 0;
    // Re-sort each iteration: evicting the heaviest pool can make another the new
    // heaviest, and a pinned pool that frees nothing must not be retried forever.
    const remaining = [...this.#pools];
    while (total > target && remaining.length > 0) {
      remaining.sort((a, b) => b.estimateBytes() - a.estimateBytes());
      const pool = remaining[0]!;
      const poolBytes = pool.estimateBytes();
      const overshoot = total - target;
      // Ask this pool to give up its share of the overshoot; never below zero.
      const evictTo = Math.max(0, poolBytes - overshoot);
      const poolFreed = pool.evict(evictTo);
      freed += poolFreed;
      total -= poolFreed;
      // A pool that could not shed (pinned floor) is dropped so the loop terminates
      // instead of asking it again every iteration.
      if (poolFreed <= 0) remaining.shift();
    }
    return freed;
  }
}
