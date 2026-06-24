/**
 * The Glossary dock pane + the selection-flyout "Add to glossary" popover (docs/027
 * §6.3/§6.2) — the professional management surface the legacy editor never had.
 *
 * The pane is a *consumer* of the live document index (docs/027 §2.2): it reads the
 * glossary terms (passed through the index, §5.4) joined with their occurrence marks
 * for counts and jump-to, and surfaces the two representable problems — unused terms
 * and orphaned references (§6.1/§6.3). Every edit routes through the glossary
 * transaction builders, so it lands in the same undo stack as text (§5.3).
 *
 * The add popover is the type-first flow (§6.2): it matches the selected text against
 * the registry and offers link-existing or create-new from one surface, so the author
 * is never asked to pick a flow. React Aria behavior + DaisyUI styling throughout, per
 * the package rule.
 */
import { useMemo, useState } from "react";
import { Badge, Button, Input, NavIcon } from "@quanghuy1242/idco-ui";
import type { CommandRenderContext } from "../../spi";
import { useDocumentIndex } from "../../document-index";
import type { EditorStore, NodeId } from "../../../core";
import {
  asGlossaryTerm,
  buildGlossaryRows,
  commitTerm,
  createTermOverSelection,
  deleteTerm,
  glossaryTerms,
  linkTermOverSelection,
  orphanedGlossaryRefs,
  type GlossaryRow,
  type GlossaryTerm,
} from "./glossary";
import { useScrollToFocus } from "./use-reveal-focus";

/** Mint a unique term id without a new mechanism (the document allocator). */
function newTermId(store: EditorStore): string {
  return store.allocator.createNodeId();
}

/** Inline definition editor: local state, commits on blur so history is per-edit. */
function DefinitionCell(props: {
  readonly store: EditorStore;
  readonly term: GlossaryTerm;
}) {
  const { store, term } = props;
  const [value, setValue] = useState(term.definition);
  // Commit on Enter (form submit), not per keystroke: a collection edit is its own
  // history entry (it breaks typing coalescing, §5.3), so per-keystroke commits would
  // make one undo per character. One edit per Enter keeps undo sane.
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value !== term.definition) {
          commitTerm(store, { ...term, definition: value });
        }
      }}
    >
      <Input
        ariaLabel={`Definition of ${term.term}`}
        onChange={setValue}
        placeholder="Definition… (Enter to save)"
        size="sm"
        value={value}
      />
    </form>
  );
}

/** One term row: term, inline definition, occurrence jump, delete. */
function GlossaryRowView(props: {
  readonly store: EditorStore;
  readonly row: GlossaryRow;
  readonly reveal: (id: NodeId) => void;
  readonly index: ReturnType<typeof useDocumentIndex>;
  readonly focused: boolean;
}) {
  const { store, row, reveal, index, focused } = props;
  const { term, occurrences, nodeIds } = row;
  return (
    <div
      className={`grid gap-1 border-b border-base-200 py-2 last:border-0 ${
        focused ? "rounded-box ring-2 ring-primary" : ""
      }`}
      data-focus-key={term.id}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium">{term.term || "Untitled term"}</span>
        {term.category ? (
          <Badge size="sm" tone="neutral">
            {term.category}
          </Badge>
        ) : null}
        {occurrences === 0 ? (
          <Badge size="sm" tone="warning">
            unused
          </Badge>
        ) : (
          <Button
            ariaLabel={`Jump to first of ${occurrences} occurrences`}
            onClick={() => nodeIds[0] && reveal(nodeIds[0])}
            size="sm"
            tooltip="Jump to first occurrence"
            variant="ghost"
          >
            {occurrences}×
          </Button>
        )}
        <span className="ml-auto" />
        <Button
          ariaLabel={`Delete ${term.term}`}
          iconName="Trash2"
          onClick={() => deleteTerm(store, index, term.id, true)}
          size="sm"
          square
          tooltip={
            occurrences > 0
              ? `Delete and unmark ${occurrences} occurrence(s)`
              : "Delete term"
          }
          variant="ghost"
        />
      </div>
      <DefinitionCell store={store} term={term} />
    </div>
  );
}

export function GlossaryPane(props: {
  readonly store: EditorStore;
  readonly reveal: (id: NodeId) => void;
  readonly focusId?: string;
}) {
  const { store, reveal, focusId } = props;
  const index = useDocumentIndex();
  const rows = buildGlossaryRows(index);
  // Scroll the routed-to term row into view when opened from a clicked occurrence
  // (docs/027 §16 P6); the ring is a literal class on that row.
  const listRef = useScrollToFocus(focusId);
  const orphans = orphanedGlossaryRefs(index);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const [newDef, setNewDef] = useState("");

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter(
        (row) =>
          row.term.term.toLowerCase().includes(needle) ||
          row.term.definition.toLowerCase().includes(needle),
      )
    : rows;

  const addTerm = () => {
    const term = newTerm.trim();
    if (term.length === 0) return;
    commitTerm(store, {
      definition: newDef.trim(),
      id: newTermId(store),
      term,
    });
    setNewTerm("");
    setNewDef("");
    setAdding(false);
  };

  return (
    <div className="grid gap-2 p-3" data-engine-glossary="">
      <div className="flex items-center gap-2">
        <Input
          ariaLabel="Search glossary"
          onChange={setQuery}
          placeholder="Search terms…"
          size="sm"
          value={query}
        />
        <Button
          ariaLabel="New term"
          iconName="Plus"
          onClick={() => setAdding((open) => !open)}
          size="sm"
          square
          tooltip="New term"
          variant={adding ? "primary" : "ghost"}
        />
      </div>

      {adding ? (
        <form
          className="grid gap-2 rounded-box border border-base-300 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            addTerm();
          }}
        >
          <Input
            ariaLabel="New term"
            autoFocus
            onChange={setNewTerm}
            placeholder="Term"
            size="sm"
            value={newTerm}
          />
          <Input
            ariaLabel="New definition"
            onChange={setNewDef}
            placeholder="Definition"
            size="sm"
            value={newDef}
          />
          <div className="flex justify-end">
            <Button size="sm" type="submit" variant="primary">
              Add term
            </Button>
          </div>
        </form>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-base-content/60">
          No glossary terms yet. Add one here, or select a word in the document
          and choose “Add to glossary”.
        </p>
      ) : (
        <div className="grid" ref={listRef}>
          {visible.map((row) => (
            <GlossaryRowView
              focused={row.term.id === focusId}
              index={index}
              key={row.term.id}
              reveal={reveal}
              row={row}
              store={store}
            />
          ))}
        </div>
      )}

      {orphans.length > 0 ? (
        <div className="rounded-box border border-warning/40 bg-warning/10 p-2 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <NavIcon name="TriangleAlert" />
            {orphans.length} orphaned reference(s)
          </div>
          <p className="text-xs text-base-content/70">
            These occurrences point at a deleted term. Jump to one to re-link or
            remove it.
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {orphans.map((entry) => (
              <Button
                ariaLabel={`Jump to orphaned “${entry.text}”`}
                key={entry.id}
                onClick={() => reveal(entry.node)}
                size="sm"
                variant="secondary"
              >
                {entry.text || "(empty)"}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The selection-flyout "Add to glossary" popover (docs/027 §6.2 type-first): matches
 * the selected text against the registry and offers link-existing terms or create-new
 * with a definition, from one surface. The disambiguation happens here, so the author
 * never picks a flow.
 */
export function GlossaryAddPopover(props: {
  readonly ctx: CommandRenderContext;
}) {
  const { ctx } = props;
  const { store } = ctx;
  const selected = ctx.selection.selectedText.trim();
  const index = useDocumentIndex();
  // Read terms from the live store (the popover may open before the worker index
  // lands); fall back to the index when present.
  const terms = useMemo(
    () =>
      index
        ? glossaryTerms(index)
        : store.getCollection("glossary").map(asGlossaryTerm),
    [index, store],
  );
  // Search the *whole* registry to link the selection to any existing term
  // (docs/027 §6.2 — link-existing is by search, not only an exact-name match),
  // seeded with the selected text so an exact match surfaces first.
  const [query, setQuery] = useState(selected);
  const [definition, setDefinition] = useState("");
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? terms.filter(
        (term) =>
          term.term.toLowerCase().includes(needle) ||
          (term.aliases ?? []).some((alias) =>
            alias.toLowerCase().includes(needle),
          ),
      )
    : terms;

  const create = () => {
    createTermOverSelection(store, {
      definition: definition.trim(),
      id: newTermId(store),
      term: selected,
    });
    ctx.close();
  };

  return (
    <div className="grid w-72 gap-2" data-engine-glossary-add="">
      <span className="text-xs font-medium opacity-70">
        Add “{selected || "selection"}” to glossary
      </span>
      {terms.length > 0 ? (
        <div className="grid gap-1">
          <span className="text-xs opacity-60">Link to an existing term</span>
          <Input
            ariaLabel="Search terms"
            onChange={setQuery}
            placeholder="Search terms…"
            size="sm"
            value={query}
          />
          <div className="grid max-h-40 gap-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <span className="px-1 py-2 text-xs opacity-50">
                No matching term.
              </span>
            ) : (
              filtered.map((term) => (
                <Button
                  ariaLabel={`Link to ${term.term}`}
                  key={term.id}
                  onClick={() => {
                    linkTermOverSelection(store, term.id);
                    ctx.close();
                  }}
                  size="sm"
                  variant="secondary"
                >
                  {term.term}
                </Button>
              ))
            )}
          </div>
        </div>
      ) : null}
      <form
        className="grid gap-2 border-t border-base-200 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          create();
        }}
      >
        <span className="text-xs opacity-60">Or define a new term</span>
        <Input
          ariaLabel="Definition"
          onChange={setDefinition}
          placeholder={`Definition of “${selected}”`}
          size="sm"
          value={definition}
        />
        <div className="flex justify-end">
          <Button size="sm" type="submit" variant="primary">
            Create &amp; mark
          </Button>
        </div>
      </form>
    </div>
  );
}
