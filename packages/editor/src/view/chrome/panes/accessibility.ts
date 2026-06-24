/**
 * Content accessibility checks (docs/027 §9.5) — recommendation-only, derived.
 *
 * This is *content* accessibility (is the authored document accessible to its
 * readers), not editor accessibility (is the editing UI keyboard/AT-correct, which is
 * baseline product quality, out of scope here). Every check is a pure function of
 * already-derived state — the document index plus a cheap object/mark walk — so the
 * pane stays a renderer (docs/027 §2.2) and the engine never marks or rewrites prose:
 * it flags and explains, the author fixes (the §6.4 recommendation-only posture).
 *
 * Heading-order and alt-text ship first (highest value, lowest cost, §9.5); link-text
 * and table-headers follow, all grounded in existing state.
 */
import {
  resolveBoundaryOffset,
  type DocumentIndex,
  type EditorStore,
  type JsonObject,
  type NodeId,
  type StructuralNode,
  type TextLeafNode,
} from "../../../core";

export type A11ySeverity = "warning" | "info";

/** One accessibility finding, linked to the node it concerns (docs/027 §9.5). */
export type A11yFinding = {
  /** Stable id for keying/dedup. */
  readonly id: string;
  /** The node to jump to (jump-to, §9.5). */
  readonly node: NodeId;
  readonly kind: "heading" | "image" | "link" | "table";
  readonly message: string;
  readonly severity: A11ySeverity;
};

/** Vague link phrases that tell a screen-reader user nothing out of context. */
const VAGUE_LINK = /^(click here|here|read more|more|link|this|this link)$/i;
const URL_LIKE = /^(https?:\/\/|www\.)/i;

/** Whether a table has any header-flagged cell (legacy `headerState` bitfield). */
function tableHasHeader(store: EditorStore, table: StructuralNode): boolean {
  const stack = [...table.children];
  while (stack.length > 0) {
    const node = store.getNode(stack.pop()!);
    if (node?.kind !== "structural") continue;
    const headerState = node.attrs?.headerState;
    if (
      node.type === "tablecell" &&
      typeof headerState === "number" &&
      headerState > 0
    ) {
      return true;
    }
    stack.push(...node.children);
  }
  return false;
}

/**
 * Compute every content-accessibility finding (docs/027 §9.5). Reads the index for
 * heading structure and walks the store once for images, links, and tables. Pure and
 * cheap; nothing is auto-applied.
 */
export function accessibilityFindings(
  index: DocumentIndex | null,
  store: EditorStore,
): A11yFinding[] {
  const findings: A11yFinding[] = [];

  // Empty headings — index.text keeps them (the TOC drops them), so they are visible
  // here as a structural problem a reader's heading navigation would trip on.
  for (const entry of index?.text ?? []) {
    if (entry.type === "heading" && entry.text.trim().length === 0) {
      findings.push({
        id: `empty-${entry.id}`,
        kind: "heading",
        message: "Empty heading",
        node: entry.id,
        severity: "warning",
      });
    }
  }
  // Heading-order skips (h1 → h3): a level more than one deeper than the previous.
  let previousLevel = 0;
  for (const heading of index?.toc ?? []) {
    if (previousLevel > 0 && heading.level > previousLevel + 1) {
      findings.push({
        id: `skip-${heading.id}`,
        kind: "heading",
        message: `Heading jumps from H${previousLevel} to H${heading.level}`,
        node: heading.id,
        severity: "warning",
      });
    }
    previousLevel = heading.level;
  }

  for (const id of store.order) {
    const node = store.getNode(id);
    if (!node) continue;

    // Image alt text — a media object with a missing/empty snapshot `alt`.
    if (node.kind === "object" && node.type === "media") {
      const data = node.data as JsonObject;
      const snapshot = data.snapshot as JsonObject | undefined;
      const alt = snapshot?.alt;
      if (typeof alt !== "string" || alt.trim().length === 0) {
        findings.push({
          id: `alt-${id}`,
          kind: "image",
          message: "Image is missing alt text",
          node: id,
          severity: "warning",
        });
      }
    }

    // Link text — vague phrases and bare URLs as the visible link text.
    if (node.kind === "text") {
      const leaf = node as TextLeafNode;
      for (const mark of leaf.marks) {
        if (mark.kind !== "link") continue;
        const from = resolveBoundaryOffset(leaf.content, mark.from);
        const to = resolveBoundaryOffset(leaf.content, mark.to);
        const text = leaf.content.text.slice(from, to).trim();
        if (VAGUE_LINK.test(text)) {
          findings.push({
            id: `linktext-${mark.id}`,
            kind: "link",
            message: `Vague link text: “${text}”`,
            node: id,
            severity: "info",
          });
        } else if (URL_LIKE.test(text)) {
          findings.push({
            id: `linkurl-${mark.id}`,
            kind: "link",
            message: "Bare URL used as link text",
            node: id,
            severity: "info",
          });
        }
      }
    }

    // Table headers — a table with no header-flagged cell.
    if (node.kind === "structural" && node.type === "table") {
      if (!tableHasHeader(store, node)) {
        findings.push({
          id: `tablehead-${id}`,
          kind: "table",
          message: "Table has no header row or column",
          node: id,
          severity: "warning",
        });
      }
    }
  }

  return findings;
}
