/**
 * Text-leaf character diff by character id, with a text-alignment fallback (docs/036 §5.2, D4).
 *
 * Why this file exists
 * --------------------
 * A prose leaf stores one string plus run-encoded character ids, and those ids are
 * preserved across edits (`sliceTextContent`/`replaceTextContent`, `model.ts`). So
 * two versions of the *same* leaf share id lineage, and the diff is exact: expand
 * both sides to per-character id arrays and merge by id — a character in both is a
 * `keep`, only in base a `delete`, only in target an `insert`. No LCS, no
 * heuristic, no false rename. This is the identity path.
 *
 * Two things force a fallback, and both keep the function total:
 *
 * - **Disjoint lineage** (a leaf deleted and retyped, or two unrelated documents):
 *   the two leaves share no ids, so an id merge would report everything
 *   deleted-then-inserted. When *both* sides carry text yet share zero ids we
 *   align the raw characters with Myers instead and flag `alignment: "text"`, so
 *   the leaf still diffs and the display can badge it heuristic (§8).
 * - **Id anomaly** (should not happen): a `keep` whose two characters disagree, or
 *   shared ids that appear in a different relative order, breaks the ordered-merge
 *   invariant. We downgrade that leaf to the text fallback rather than emit a
 *   corrupt run, with a dev-flag assertion so a real lineage bug is loud in dev
 *   but never crashes prod.
 */
import { isDevInvariantsEnabled } from "../dev-flags";
import {
  type CharacterId,
  characterIdsForSlice,
  type TextLeafNode,
} from "../model";
import { diffSequences } from "./lcs";
import { diffMarks } from "./marks";
import type { TextLeafDiff, TextRunDiff } from "./types";

type Char = { readonly id: CharacterId; readonly char: string };

/**
 * Diff two versions of one text leaf into character runs plus mark changes (§5.2/§5.3).
 *
 * Defaults to the identity path (`alignment: "id"`, runs carry their character
 * ids); falls back to a raw-character Myers alignment (`alignment: "text"`, no
 * ids) when the leaves share no id lineage or an id anomaly is detected. An
 * identical leaf returns a single `keep` run (or no runs when empty); the caller
 * decides `unchanged` vs `changed` from the runs, the mark changes, and the leaf's
 * attrs/type.
 */
export function diffTextLeaf(
  base: TextLeafNode,
  target: TextLeafNode,
): TextLeafDiff {
  const markChanges = diffMarks(base, target);
  const runs = diffLeafRuns(base, target);
  return { alignment: runs.alignment, markChanges, runs: runs.runs };
}

function diffLeafRuns(
  base: TextLeafNode,
  target: TextLeafNode,
): { alignment: "id" | "text"; runs: readonly TextRunDiff[] } {
  const baseChars = expand(base);
  const targetChars = expand(target);

  // A leaf typed from empty (or emptied) shares no ids, but the id path is still
  // exact there: it is a clean all-insert or all-delete. Only fall back when BOTH
  // sides carry text yet share nothing — a genuine retype, where aligning raw
  // characters recovers the common substrings the id merge cannot see.
  const targetKeys = new Map<string, string>();
  for (const c of targetChars) targetKeys.set(idKey(c.id), c.char);
  let shared = 0;
  for (const c of baseChars) if (targetKeys.has(idKey(c.id))) shared += 1;
  if (baseChars.length > 0 && targetChars.length > 0 && shared === 0) {
    return { alignment: "text", runs: textFallback(base, target) };
  }

  const baseKeys = new Set(baseChars.map((c) => idKey(c.id)));
  const raw: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < baseChars.length || j < targetChars.length) {
    const b = baseChars[i];
    const t = targetChars[j];
    if (b && t && idKey(b.id) === idKey(t.id)) {
      if (b.char !== t.char) {
        // Same id, different character: an id collision or a lineage bug (§8). The
        // ordered id merge cannot trust this leaf; align by raw text instead.
        if (isDevInvariantsEnabled()) {
          throw new Error(
            `diffTextLeaf: character id ${idKey(b.id)} maps to '${b.char}' in base but '${t.char}' in target`,
          );
        }
        return { alignment: "text", runs: textFallback(base, target) };
      }
      raw.push({ char: t.char, id: t.id, op: "keep" });
      i += 1;
      j += 1;
    } else if (t && !baseKeys.has(idKey(t.id))) {
      raw.push({ char: t.char, id: t.id, op: "insert" });
      j += 1;
    } else if (b && !targetKeys.has(idKey(b.id))) {
      raw.push({ char: b.char, id: b.id, op: "delete" });
      i += 1;
    } else {
      // Both pointers sit on ids the other side owns but not in aligned order —
      // surviving characters were reordered within the leaf, which the same-
      // document invariant forbids. Downgrade to the total text fallback.
      return { alignment: "text", runs: textFallback(base, target) };
    }
  }
  return { alignment: "id", runs: coalesce(raw) };
}

function textFallback(
  base: TextLeafNode,
  target: TextLeafNode,
): readonly TextRunDiff[] {
  const ops = diffSequences(
    [...base.content.text],
    [...target.content.text],
    (ch) => ch,
  );
  const runs: TextRunDiff[] = [];
  for (const step of ops) {
    const text = (step.op === "delete" ? step.base : step.target) ?? "";
    const previous = runs.at(-1);
    if (previous && previous.op === step.op) {
      runs[runs.length - 1] = { op: previous.op, text: previous.text + text };
    } else {
      runs.push({ op: step.op, text });
    }
  }
  return runs;
}

type RawOp = {
  readonly op: "keep" | "insert" | "delete";
  readonly char: string;
  readonly id: CharacterId;
};

function coalesce(raw: readonly RawOp[]): readonly TextRunDiff[] {
  const runs: Array<{ op: RawOp["op"]; text: string; ids: CharacterId[] }> = [];
  for (const item of raw) {
    const previous = runs.at(-1);
    if (previous && previous.op === item.op) {
      previous.text += item.char;
      previous.ids.push(item.id);
    } else {
      runs.push({ ids: [item.id], op: item.op, text: item.char });
    }
  }
  return runs.map((run) => ({ ids: run.ids, op: run.op, text: run.text }));
}

function expand(node: TextLeafNode): readonly Char[] {
  const ids = characterIdsForSlice(node.content);
  const text = node.content.text;
  // ids.length === text.length by construction (one id per UTF-16 unit), so a
  // per-unit pairing is exact — the same coordinate the model, marks, and points
  // use, surrogate halves included.
  return ids.map((id, index) => ({ char: text[index]!, id }));
}

function idKey(id: CharacterId): string {
  return `${id.client}:${id.clock}`;
}
