/**
 * Intra-transaction position mapping for the owned-model editor.
 *
 * Why this file exists
 * --------------------
 * A composite command (split, merge, delete-then-insert) computes some positions
 * against the pre-edit document, then pushes several steps. A position computed
 * before step 1 must still be correct after step 2 applies, so the builder
 * threads every pushed step into a cumulative `Mapping` (docs/011 §6.10). This is
 * ProseMirror's `tr.mapping`, in node-relative coordinates.
 *
 * The node-relative rules (docs/011 §8.8, §16, locked here as the first split and
 * merge land):
 *
 * - `ReplaceText` on the same node shifts the offset by the §8.8 rule; a position
 *   inside the removed span collapses to the edit boundary chosen by `bias`.
 * - `MoveNode` leaves an inside offset unchanged; only document order changes,
 *   which `comparePoints` recovers for free.
 * - `RemoveNode` of the position's node (or a captured descendant) deletes the
 *   position; with no redirect it maps to `null`.
 * - Newly minted or absorbed node ids (split's new block, merge's join target)
 *   are not derivable from offset math, so the command registers an explicit
 *   `redirect` that claims those positions. Redirects take precedence over the
 *   step math, matching "commands must provide explicit point redirects" (§16).
 */
import type { NodeId } from "./model";
import type { Step } from "./steps";

export type MapBias = -1 | 1;

/** A node-relative position threaded through a transaction's steps. */
export type MapPos = {
  readonly node: NodeId;
  readonly offset: number;
};

/**
 * An explicit position redirect for ids a command mints or absorbs.
 *
 * Returns the relocated position, `null` when the position is destroyed, or
 * `undefined` to decline (the step math then applies). Redirects see the
 * original pre-edit position so they can claim a position before the step math
 * would collapse it (split's tail, merge's absorbed node).
 */
export type PointRedirect = (
  pos: MapPos,
  bias: MapBias,
) => MapPos | null | undefined;

export class Mapping {
  readonly #steps: Step[] = [];
  readonly #redirects: PointRedirect[] = [];

  /** Record a step so later position math threads through it. */
  append(step: Step): void {
    this.#steps.push(step);
  }

  /** Register an explicit redirect for minted or absorbed node ids (§16). */
  redirect(redirect: PointRedirect): void {
    this.#redirects.push(redirect);
  }

  /**
   * Map a position computed against the pre-transaction state through every
   * redirect and step pushed so far.
   */
  mapPos(pos: MapPos, bias: MapBias = 1): MapPos | null {
    for (const redirect of this.#redirects) {
      const claimed = redirect(pos, bias);
      if (claimed !== undefined) return claimed;
    }
    let current: MapPos | null = pos;
    for (const step of this.#steps) {
      if (!current) return null;
      current = mapPosThroughStep(current, step, bias);
    }
    return current;
  }
}

function mapPosThroughStep(
  pos: MapPos,
  step: Step,
  bias: MapBias,
): MapPos | null {
  switch (step.type) {
    case "replace-text":
      if (step.node !== pos.node) return pos;
      return {
        node: pos.node,
        offset: mapTextOffset(
          pos.offset,
          step.at,
          step.removed.text.length,
          step.inserted.text.length,
          bias,
        ),
      };
    case "remove-node":
      if (
        step.node.id === pos.node ||
        (step.descendants ?? []).some((d) => d.id === pos.node)
      ) {
        // The node hosting this position is gone; with no redirect to relocate
        // it, the position no longer exists (§16 boundary-relocation default is
        // the command's redirect, not an implicit guess here).
        return null;
      }
      return pos;
    case "move-node":
    case "insert-node":
    case "add-mark":
    case "remove-mark":
    case "set-node-type":
    case "set-node-attr":
    case "set-object-data":
    case "set-settings":
    case "set-collection":
      // Document-level steps do not move any body position.
      return pos;
  }
}

/** docs/011 §8.8: shift one offset through a same-node `ReplaceText`. */
export function mapTextOffset(
  offset: number,
  at: number,
  removedLength: number,
  insertedLength: number,
  bias: MapBias,
): number {
  if (offset <= at) return offset;
  if (offset >= at + removedLength) {
    return offset + insertedLength - removedLength;
  }
  return at + (bias < 0 ? 0 : insertedLength);
}
