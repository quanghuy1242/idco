/**
 * The Accessibility + Broken-references dock panes (docs/027 §9.5/§9.6) — document
 * health surfaces, both recommendation-only renderers over derived state.
 *
 * Neither stores anything: the accessibility pane reads the live index plus a cheap
 * store walk, the broken-references pane reads the object statuses the store already
 * holds. Each finding links to its node (jump-to) and explains the issue; nothing is
 * auto-applied — the engine flags, the author fixes (docs/027 §6.4).
 */
import { Badge, NavIcon } from "@quanghuy1242/idco-ui";
import type { EditorStore, NodeId } from "../../../core";
import { useDocumentIndex } from "../../document-index";
import { accessibilityFindings } from "./accessibility";
import { brokenReferences } from "./broken-refs";

export function AccessibilityPane(props: {
  readonly store: EditorStore;
  readonly reveal: (id: NodeId) => void;
}) {
  const { store, reveal } = props;
  const index = useDocumentIndex();
  const findings = accessibilityFindings(index, store);

  if (findings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-base-content/60">
        <NavIcon name="ShieldCheck" />
        <span>No accessibility issues found.</span>
      </div>
    );
  }

  return (
    <div className="grid gap-2 p-3" data-engine-accessibility="">
      {findings.map((finding) => (
        <button
          className="flex items-start gap-2 rounded-box border border-base-200 p-2 text-left outline-none hover:border-primary"
          key={finding.id}
          onClick={() => reveal(finding.node)}
          type="button"
        >
          <Badge
            size="sm"
            tone={finding.severity === "warning" ? "warning" : "neutral"}
          >
            {finding.kind}
          </Badge>
          <span className="text-sm">{finding.message}</span>
        </button>
      ))}
    </div>
  );
}

export function BrokenRefsPane(props: {
  readonly store: EditorStore;
  readonly reveal: (id: NodeId) => void;
}) {
  const { store, reveal } = props;
  const refs = brokenReferences(store);

  if (refs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-base-content/60">
        <NavIcon name="ShieldCheck" />
        <span>No broken references.</span>
      </div>
    );
  }

  return (
    <div className="grid gap-2 p-3" data-engine-broken-refs="">
      {refs.map((ref) => (
        <button
          className="flex items-center gap-2 rounded-box border border-base-200 p-2 text-left outline-none hover:border-primary"
          key={ref.node}
          onClick={() => reveal(ref.node)}
          type="button"
        >
          <Badge
            size="sm"
            tone={ref.status === "invalid" ? "warning" : "neutral"}
          >
            {ref.status}
          </Badge>
          <span className="min-w-0 flex-1 truncate text-sm">{ref.label}</span>
          <span className="text-xs opacity-60">{ref.type}</span>
        </button>
      ))}
    </div>
  );
}
