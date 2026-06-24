/**
 * Glossary model logic (docs/027 §6) — the term shape, the index→rows projection,
 * and the transaction builders for the two authoring flows and the management ops.
 *
 * The structural cure for legacy's drift (docs/027 §6.1): a glossary mark stores only
 * `attrs: { term: id }`, a *reference* into the one collection item; the definition
 * exists exactly once. So "inconsistent definitions" is not a lint — it is a state the
 * model cannot represent. The only representable problems are an unused term (no mark
 * references it) and an orphaned reference (a mark whose term was deleted), both
 * surfaced from the index here (§6.1/§6.3).
 *
 * Every mutating helper routes through the store's transaction/history chokepoint
 * (docs/027 §5.3): a type-first creation marks a range *and* appends the term in one
 * atomic transaction (`compileAddRefMark(...).setCollection(...)`), so undo reverses
 * both halves together and never leaves a mark pointing at a term undo removed.
 */
import {
  compileAddRefMark,
  type CollectionItem,
  type CommentIndexEntry,
  type DocumentIndex,
  type EditorStore,
  type NodeId,
  type TextMark,
} from "../../../core";

/** The document-owned collection id glossary terms live under (docs/027 §6.1). */
export const GLOSSARY_COLLECTION = "glossary";

/** One glossary term, stored once in `document.collections.glossary` (docs/027 §6.1). */
export type GlossaryTerm = CollectionItem & {
  readonly term: string;
  readonly definition: string;
  readonly aliases?: readonly string[];
  readonly category?: string;
};

/** A term plus its derived occurrence count and the nodes it appears in (docs/027 §6.3). */
export type GlossaryRow = {
  readonly term: GlossaryTerm;
  readonly occurrences: number;
  readonly nodeIds: readonly NodeId[];
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Read an opaque collection item into the normalized term shape (defensive). */
export function asGlossaryTerm(item: CollectionItem): GlossaryTerm {
  const aliases = Array.isArray(item.aliases)
    ? item.aliases.filter((alias): alias is string => typeof alias === "string")
    : undefined;
  return {
    ...item,
    ...(aliases && aliases.length > 0 ? { aliases } : {}),
    ...(typeof item.category === "string" ? { category: item.category } : {}),
    definition: asString(item.definition),
    id: item.id,
    term: asString(item.term),
  };
}

/** The glossary terms from the live index, normalized (docs/027 §5.4 passthrough). */
export function glossaryTerms(index: DocumentIndex | null): GlossaryTerm[] {
  const items = index?.collections[GLOSSARY_COLLECTION] ?? [];
  return items.map(asGlossaryTerm);
}

/**
 * Join the glossary terms with their occurrence marks (docs/027 §5.4/§6.3): every
 * term, with the count and the node ids of the marks that reference it. The join key
 * is `CommentIndexEntry.ref` (the mark's `attrs.term`), so it is pure index work — no
 * document walk.
 */
export function buildGlossaryRows(index: DocumentIndex | null): GlossaryRow[] {
  const occurrences = (index?.comments ?? []).filter(
    (entry) => entry.kind === "glossary",
  );
  return glossaryTerms(index).map((term) => {
    const mine = occurrences.filter((entry) => entry.ref === term.id);
    return {
      nodeIds: mine.map((entry) => entry.node),
      occurrences: mine.length,
      term,
    };
  });
}

/**
 * Glossary occurrence marks whose `ref` names no live term (docs/027 §6.3 orphaned
 * references). Keep-and-flag, never silent-drop: the pane surfaces these so the author
 * re-links or removes them.
 */
export function orphanedGlossaryRefs(
  index: DocumentIndex | null,
): CommentIndexEntry[] {
  const termIds = new Set(glossaryTerms(index).map((term) => term.id));
  return (index?.comments ?? []).filter(
    (entry) =>
      entry.kind === "glossary" &&
      (entry.ref === undefined || !termIds.has(entry.ref)),
  );
}

/** The live glossary items as stored (for building the next array on a mutation). */
function liveItems(store: EditorStore): readonly CollectionItem[] {
  return store.getCollection(GLOSSARY_COLLECTION);
}

/** Upsert a term by id, returning the next item array. */
function withTerm(
  items: readonly CollectionItem[],
  term: GlossaryTerm,
): CollectionItem[] {
  const next = items.filter((item) => item.id !== term.id);
  next.push(term);
  return next;
}

/**
 * Define-first (docs/027 §6.2): add or edit a term in the registry with no occurrence.
 * A pure collection edit — one `set-collection` transaction, undoable on its own.
 */
export function commitTerm(store: EditorStore, term: GlossaryTerm): void {
  store.command({
    collection: GLOSSARY_COLLECTION,
    items: withTerm(liveItems(store), term),
    type: "set-collection",
  });
}

/**
 * Type-first, create-new (docs/027 §6.2): mark the current selection *and* add the new
 * term in one atomic transaction, so undo reverses both halves (§5.3). Returns false
 * when there is no text range to mark.
 */
export function createTermOverSelection(
  store: EditorStore,
  term: GlossaryTerm,
): boolean {
  const tr = compileAddRefMark(store, "glossary", { term: term.id });
  if (!tr) return false;
  tr.setCollection(GLOSSARY_COLLECTION, withTerm(liveItems(store), term));
  store.dispatch(tr);
  return true;
}

/**
 * Type-first, link-existing (docs/027 §6.2): mark the selection as a reference to an
 * existing term — a new occurrence, no new item. Returns false with no selection.
 */
export function linkTermOverSelection(
  store: EditorStore,
  termId: string,
): boolean {
  const result = store.command({
    attrs: { term: termId },
    mark: "glossary",
    type: "add-ref-mark",
  });
  return result !== null;
}

/** Find a glossary mark object on a node by mark id (for removal). */
function glossaryMarkOn(
  store: EditorStore,
  node: NodeId,
  markId: string,
): TextMark | undefined {
  const target = store.getNode(node);
  if (target?.kind !== "text") return undefined;
  return target.marks.find(
    (mark) => mark.id === markId && mark.kind === "glossary",
  );
}

/**
 * Delete a term (docs/027 §6.3). `unmark` true removes the term *and* every occurrence
 * mark in one transaction (delete-and-unmark); false removes only the term and leaves
 * the marks as orphaned references for later re-linking (delete-and-keep-as-orphan).
 * Either way it is one atomic, undoable transaction.
 */
export function deleteTerm(
  store: EditorStore,
  index: DocumentIndex | null,
  termId: string,
  unmark: boolean,
): void {
  const tr = store.transaction();
  if (unmark) {
    const occurrences = (index?.comments ?? []).filter(
      (entry) => entry.kind === "glossary" && entry.ref === termId,
    );
    for (const entry of occurrences) {
      const mark = glossaryMarkOn(store, entry.node, entry.id);
      if (mark) tr.removeMark(entry.node, mark);
    }
  }
  tr.setCollection(
    GLOSSARY_COLLECTION,
    liveItems(store).filter((item) => item.id !== termId),
  );
  store.dispatch(tr);
}
