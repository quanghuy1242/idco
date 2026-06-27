/**
 * The undo/redo history as a budgeted memory pool (docs/030 §7.6 Stage three, SLP-4).
 *
 * Why this file exists
 * --------------------
 * Inverse-step history grows with edit count and was never capped: a long authoring
 * session accumulates every undo state forever. This class owns the done/undone stacks and
 * the typing-coalesce bookkeeping (lifted out of `EditorStore`) and adds a bounded
 * sub-budget so history takes its place under the memory arbiter (`core/memory/pool.ts`)
 * alongside the bake cache and, later, resident bodies.
 *
 * History eviction is *lossy by design*, unlike body purge: a dropped inverse step is undo
 * the user can no longer reach (D6). So the policy is a per-deployment choice:
 *
 * - `"drop"` (default): discard the *oldest* (deepest) undo states past the cap. Undo then
 *   stops cleanly at the cap — a surfaced, intentional limit, never an error or a corrupt
 *   state. Cheap; mobile webviews use this.
 * - `"cold-store"`: page the oldest inverse steps to a cold tier instead of discarding
 *   them, and fault them back when the user undoes that far. Keeps deep undo at storage
 *   cost; desktop authoring uses this. The cold tier here is an in-memory array — the
 *   durable IndexedDB realization is a view-layer follow-on over the same boundary (the
 *   `BodyStore` seam, §7.6); the synchronous fault-back below is what the in-memory tier
 *   needs and what an async store's deep-undo path will mirror once undo can await.
 *
 * Consistency with incremental save (SLP-1): evicting old history never touches `#nodes` or
 * the maintained `#snapshotBlocks` — it only forgets how to revert past a point — so the
 * document state and the persisted snapshot stay correct by construction; there is nothing
 * to reconcile beyond not corrupting the stacks (D6: "keep the maintained `#snapshotBlocks`
 * and the live history consistent").
 *
 * Eviction always removes the *oldest* entry (`shift`), never the most recent — the
 * deepest undo is the first to go. `estimateBytes()` accounts only the *resident* stacks
 * (done + undone); a cold-stored entry is "paged out" and not counted, mirroring how an
 * IndexedDB tier would move it off-heap.
 */
import {
  TYPING_COALESCE_MS,
  canCoalesceTyping,
  mergeTypingEntries,
  nowMs,
} from "./history";
import type { CommittedTransaction } from "../model";
import type { MemoryPool } from "../memory/pool";

/**
 * @categoryDefault Snapshot & Performance
 */

/** What to do with undo states evicted past the budget: discard them or page them cold. */
export type HistoryOverflow = "drop" | "cold-store";

/**
 * Per-deployment undo budget (docs/030 §7.6). All optional: omitted fields mean unbounded
 * (today's behavior). A host caps undo independently of the body budget — mobile webview:
 * shallow `drop`; desktop authoring: deep or `cold-store`.
 */
export type HistoryConfig = {
  /** Maximum reachable undo depth (entries in the done stack) before eviction. */
  readonly maxDepth?: number;
  /** Maximum resident history bytes (done + undone) before eviction. */
  readonly maxBytes?: number;
  /** What to do with evicted oldest entries (default `"drop"`). */
  readonly overflow?: HistoryOverflow;
};

/** Coarse byte estimate for one history entry: its forward + inverse step JSON length. */
function estimateEntryBytes(entry: CommittedTransaction): number {
  return (
    JSON.stringify(entry.steps).length + JSON.stringify(entry.inverse).length
  );
}

export class HistoryPool implements MemoryPool {
  readonly name = "history";
  readonly #done: CommittedTransaction[] = [];
  readonly #undone: CommittedTransaction[] = [];
  // Overflow="cold-store" tier: evicted oldest entries, ordered oldest(0)→newest(end), so
  // a deep undo faults them back from the end (the newest cold entry is the next-oldest
  // reachable state). Stays empty under overflow="drop".
  readonly #cold: CommittedTransaction[] = [];
  readonly #maxDepth: number;
  readonly #maxBytes: number;
  readonly #overflow: HistoryOverflow;
  // Undo-coalescing bookkeeping (docs/011 §7.5, docs/018 §2.2). Starts broken so the first
  // edit opens its own group; a hard boundary (undo/redo, paste, object activation, caret
  // move) re-breaks it so the next edit starts fresh.
  #coalesceBroken = true;
  #lastEditAt = 0;

  constructor(config?: HistoryConfig) {
    this.#maxDepth = config?.maxDepth ?? Number.POSITIVE_INFINITY;
    this.#maxBytes = config?.maxBytes ?? Number.POSITIVE_INFINITY;
    this.#overflow = config?.overflow ?? "drop";
  }

  /** True when there is something to undo — a resident done entry *or* a cold-stored one. */
  get canUndo(): boolean {
    return this.#done.length > 0 || this.#cold.length > 0;
  }

  get canRedo(): boolean {
    return this.#undone.length > 0;
  }

  /** Reachable-without-fault undo depth (resident done stack). Diagnostics/tests. */
  get undoDepth(): number {
    return this.#done.length;
  }

  get redoDepth(): number {
    return this.#undone.length;
  }

  /** Cold-stored (paged-out) entry count; always 0 under `overflow: "drop"`. */
  get coldDepth(): number {
    return this.#cold.length;
  }

  /** Open a fresh undo group on the next edit (a hard boundary, docs/011 §7.5). */
  breakCoalescing(): void {
    this.#coalesceBroken = true;
  }

  /**
   * Record a committed transaction, coalescing a typing run into the previous entry
   * (docs/011 §7.5) and then enforcing the budget. The coalescing merge keeps the run's
   * original `selectionBefore` and the latest `selectionAfter`, so one undo reverts the
   * whole run. A hard boundary, a stale gap, a direction change, or a non-text step opens a
   * fresh entry.
   */
  record(committed: CommittedTransaction): void {
    const now = nowMs();
    const previous = this.#done.at(-1);
    if (
      !this.#coalesceBroken &&
      previous &&
      now - this.#lastEditAt <= TYPING_COALESCE_MS &&
      canCoalesceTyping(previous, committed)
    ) {
      this.#done[this.#done.length - 1] = mergeTypingEntries(
        previous,
        committed,
      );
    } else {
      this.#done.push(committed);
    }
    this.#coalesceBroken = false;
    this.#lastEditAt = now;
    this.#enforceBudget();
  }

  /**
   * Clear the redo stack — called on a real edit (docs/010 §10.5: a new edit invalidates
   * any undone future). Doing this first means eviction never has to reconcile a
   * half-truncated redo (D6 edge case).
   */
  clearRedo(): void {
    this.#undone.length = 0;
  }

  /**
   * Take the entry to undo: pop the done stack, faulting one cold-stored entry back first
   * when done is empty (the `cold-store` deep-undo path). Returns null when nothing is
   * reachable. Undo is a hard coalesce boundary. The caller commits the entry's inverse and
   * then calls `pushUndone` — split so a throwing commit does not strand the entry on the
   * redo stack (mirrors the pre-refactor pop-before-commit/push-after order).
   */
  takeUndo(): CommittedTransaction | null {
    if (this.#done.length === 0) {
      const cold = this.#cold.pop();
      if (!cold) return null;
      this.#done.push(cold);
    }
    const entry = this.#done.pop() ?? null;
    if (entry) this.#coalesceBroken = true;
    return entry;
  }

  pushUndone(entry: CommittedTransaction): void {
    this.#undone.push(entry);
  }

  /** Take the entry to redo: pop the undone stack. Redo is a hard coalesce boundary. */
  takeRedo(): CommittedTransaction | null {
    const entry = this.#undone.pop() ?? null;
    if (entry) this.#coalesceBroken = true;
    return entry;
  }

  /** Return a redone entry to the done stack (re-enforcing the budget). */
  pushDone(entry: CommittedTransaction): void {
    this.#done.push(entry);
    this.#enforceBudget();
  }

  /** Resident history bytes (done + undone); a cold-stored entry is paged out, not counted. */
  estimateBytes(): number {
    let total = 0;
    for (const entry of this.#done) total += estimateEntryBytes(entry);
    for (const entry of this.#undone) total += estimateEntryBytes(entry);
    return total;
  }

  /**
   * Arbiter-driven eviction: shed oldest undo states until resident bytes are at or below
   * `targetBytes`, returning the bytes freed. Uses the configured overflow policy (drop vs
   * cold-store), exactly like the local budget enforcement.
   */
  evict(targetBytes: number): number {
    const before = this.estimateBytes();
    while (this.estimateBytes() > targetBytes && this.#done.length > 0) {
      this.#evictOldest();
    }
    return before - this.estimateBytes();
  }

  /** Enforce the local depth/byte caps after a push (drop or cold-store the oldest). */
  #enforceBudget(): void {
    while (
      this.#done.length > 0 &&
      (this.#done.length > this.#maxDepth ||
        this.estimateBytes() > this.#maxBytes)
    ) {
      this.#evictOldest();
    }
  }

  /** Remove the oldest (deepest) done entry, paging it to the cold tier when configured. */
  #evictOldest(): void {
    const oldest = this.#done.shift();
    if (!oldest) return;
    // cold-store keeps deep undo reachable (faulted back by `takeUndo`); drop forgets it.
    if (this.#overflow === "cold-store") this.#cold.push(oldest);
  }
}
