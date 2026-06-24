/**
 * The Statistics dock pane (docs/027 §9.4) — the first Insights surface.
 *
 * A read-only renderer over the live `index.text` rollup (docs/027 §2.2 — derive, do
 * not store): word/character counts, estimated reading time, sentence and heading
 * counts, and a Flesch readability estimate. It is a *renderer, not a calculator*; the
 * pure counting lives in `text-stats.ts`, and the pane stays correct as the author
 * types because the index is live (the dock re-renders it on every commit).
 *
 * Selection-scoped counts (docs/027 §9.4) read `ctx.selection.selectedText`, the real
 * selection facts the command context already carries (the §10 prerequisite, satisfied
 * by `commandSelectionFacts`). The dock rebuilds `ctx` on every selection change, so a
 * "selected: N words" line tracks the selection with no extra wiring.
 */
import type { CommandContext } from "../../spi";
import { useDocumentIndex } from "../../document-index";
import { computeTextStats, joinIndexText } from "./text-stats";

/** One label/value row in the stats list. */
function StatRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-base-content/70">{props.label}</span>
      <span className="font-mono text-sm tabular-nums">{props.value}</span>
    </div>
  );
}

export function StatisticsPane(props: { readonly ctx: CommandContext }) {
  const { ctx } = props;
  const index = useDocumentIndex();
  const docStats = computeTextStats(joinIndexText(index?.text ?? []));
  const headings = index?.toc.length ?? 0;
  const blocks = index?.text.length ?? 0;

  // Selection-scoped figures, shown only when a real range is selected (§9.4). The
  // selected text rides on the live command context, not a separate DOM read.
  const selectedText = ctx.selection.hasSelection
    ? ctx.selection.selectedText
    : "";
  const selStats = selectedText ? computeTextStats(selectedText) : null;

  return (
    <div className="grid gap-4 p-3" data-engine-statistics="">
      <section className="grid">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">
          Document
        </h3>
        <StatRow label="Words" value={docStats.words.toLocaleString()} />
        <StatRow
          label="Characters"
          value={docStats.characters.toLocaleString()}
        />
        <StatRow
          label="Characters (no spaces)"
          value={docStats.charactersNoSpaces.toLocaleString()}
        />
        <StatRow
          label="Sentences"
          value={docStats.sentences.toLocaleString()}
        />
        <StatRow label="Blocks" value={blocks.toLocaleString()} />
        <StatRow label="Headings" value={headings.toLocaleString()} />
        <StatRow
          label="Reading time"
          value={
            docStats.readingMinutes === 0
              ? "—"
              : `${docStats.readingMinutes} min`
          }
        />
        <StatRow
          label="Readability (Flesch)"
          value={
            docStats.readability === null ? "—" : String(docStats.readability)
          }
        />
      </section>

      {selStats ? (
        <section className="grid border-t border-base-300 pt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">
            Selection
          </h3>
          <StatRow label="Words" value={selStats.words.toLocaleString()} />
          <StatRow
            label="Characters"
            value={selStats.characters.toLocaleString()}
          />
        </section>
      ) : (
        <p className="border-t border-base-300 pt-3 text-xs text-base-content/50">
          Select text to see selection-scoped counts.
        </p>
      )}
    </div>
  );
}
