/**
 * The pure, RSC-safe resolution kernel the reader renders a native
 * `EditorDocumentSnapshot` through (docs/028 §4.1). It is a deliberate, *test-bound*
 * mirror of the editor's canonical model logic — `resolveBoundaryOffset` (core
 * `model/model.ts`), `resolveLeafMarks`/`segmentText` (core `model/marks.ts`), and
 * `safeHref` (core `url-safety.ts`).
 *
 * Why a mirror and not an import. The editor package depends on `@idco/reader`
 * (the reader owns the `.rt-*` typography the editor's live host wears), so the
 * reader importing the editor would be a circular package dependency; and the
 * editor's core is React-free/worker-safe and must not be dragged across the RSC
 * boundary into the reader's server graph. So the small, *stable* resolution
 * algorithm lives here, below the editor, and the editor keeps its own copy. They
 * cannot silently drift: `tests/reader-parity.test.tsx` feeds a shared corpus of
 * leaves through both this module and the editor's `segmentLeaf`/`resolveLeafMarks`
 * and fails the build on any divergence (docs/028 §9). That active equality check
 * is the guard the forked compat-walk never had (docs/028 §2).
 *
 * RSC-safe: pure data + pure functions, no React, no hooks, no client imports — so
 * the server `<Reader>` and the dispatch run it with zero client JavaScript.
 */

/** Run-encoded character ids for a text leaf (mirror of core `CharacterRun`). */
export type ReaderCharacterRun = {
  readonly client: string;
  readonly startClock: number;
  readonly length: number;
};

/** A text leaf's content: the string plus its run-encoded character ids. */
export type ReaderTextContent = {
  readonly text: string;
  readonly runs: readonly ReaderCharacterRun[];
};

/** A durable text anchor (mirror of core `TextAnchor`). */
export type ReaderTextAnchor =
  | {
      readonly kind: "char";
      readonly id: { readonly client: string; readonly clock: number };
    }
  | { readonly kind: "edge"; readonly edge: "start" | "end" };

/** A mark boundary: its durable anchor, the offset fallback, and its stickiness. */
export type ReaderMarkBoundary = {
  readonly anchor: ReaderTextAnchor;
  readonly offset: number;
  readonly stickiness: "before" | "after";
};

/** A stored mark on a leaf (mirror of core `TextMark`). */
export type ReaderTextMark = {
  readonly id: string;
  readonly kind: string;
  readonly from: ReaderMarkBoundary;
  readonly to: ReaderMarkBoundary;
  readonly attrs?: Readonly<Record<string, unknown>>;
};

/** A mark resolved to concrete `[from, to)` offsets in the leaf's text. */
export type ReaderResolvedMark = {
  readonly id: string;
  readonly kind: string;
  readonly from: number;
  readonly to: number;
  readonly attrs?: Readonly<Record<string, unknown>>;
};

/** A maximal run of text covered by one constant set of marks. */
export type ReaderTextSegment = {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly marks: readonly ReaderResolvedMark[];
};

/** The minimal text-leaf shape the resolution kernel reads (snapshot-compatible). */
export type ReaderTextLeaf = {
  readonly content: ReaderTextContent;
  readonly marks: readonly ReaderTextMark[];
};

// --- anchor resolution (mirror of core `model.ts`) ---------------------------

function findCharacterOffset(
  content: ReaderTextContent,
  id: { readonly client: string; readonly clock: number },
): number {
  let offset = 0;
  for (const run of content.runs) {
    if (
      run.client === id.client &&
      id.clock >= run.startClock &&
      id.clock < run.startClock + run.length
    ) {
      return offset + id.clock - run.startClock;
    }
    offset += run.length;
  }
  return -1;
}

function resolveAnchorOffset(
  content: ReaderTextContent,
  anchor: ReaderTextAnchor,
  assoc: -1 | 1 | undefined,
  fallback: number,
): number {
  if (anchor.kind === "edge") {
    return anchor.edge === "start" ? 0 : content.text.length;
  }
  const index = findCharacterOffset(content, anchor.id);
  if (index === -1) {
    return Math.max(0, Math.min(content.text.length, fallback));
  }
  return assoc === 1 ? index + 1 : index;
}

/**
 * Resolve a mark boundary to a concrete offset. Mirrors core `resolveBoundaryOffset`:
 * the durable anchor is authoritative (so a mark survives edits before it), the
 * stored offset is only the fallback when the anchor's character is gone.
 */
export function resolveBoundaryOffset(
  content: ReaderTextContent,
  boundary: ReaderMarkBoundary,
): number {
  return resolveAnchorOffset(
    content,
    boundary.anchor,
    boundary.stickiness === "after" ? 1 : -1,
    boundary.offset,
  );
}

/** Resolve every mark on a leaf to concrete offsets, dropping empty/inverted ranges. */
export function resolveLeafMarks(
  node: ReaderTextLeaf,
): readonly ReaderResolvedMark[] {
  const resolved: ReaderResolvedMark[] = [];
  for (const mark of node.marks) {
    const from = resolveBoundaryOffset(node.content, mark.from);
    const to = resolveBoundaryOffset(node.content, mark.to);
    if (to <= from) continue;
    resolved.push({
      ...(mark.attrs ? { attrs: mark.attrs } : {}),
      from,
      id: mark.id,
      kind: mark.kind,
      to,
    });
  }
  return resolved;
}

// --- segmentation (mirror of core `marks.ts`) --------------------------------

/**
 * Data-bearing mark kinds whose *identity* (not just kind) keeps adjacent runs
 * separate. Seeded with the built-ins so the standard reader works with no
 * registration; mirrors core `IDENTITY_MARKS`. A host that opened a new
 * data-bearing kind in the editor (`registerIdentityMark`) registers it here too so
 * segmentation matches.
 */
const IDENTITY_MARKS = new Set<string>(["link", "comment", "glossary"]);

/** Register a data-bearing mark kind so its id/attrs distinguish segments. */
export function registerReaderIdentityMark(kind: string): void {
  IDENTITY_MARKS.add(kind);
}

function segmentSignature(marks: readonly ReaderResolvedMark[]): string {
  return marks
    .map((mark) =>
      IDENTITY_MARKS.has(mark.kind)
        ? `${mark.kind}#${mark.id}#${
            typeof mark.attrs?.href === "string" ? mark.attrs.href : ""
          }`
        : mark.kind,
    )
    .sort()
    .join("|");
}

/**
 * Flatten `text` plus its resolved marks into ordered, non-overlapping segments,
 * each with a constant covering set. Mirrors core `segmentText` exactly (including
 * the adjacent-run merge that keeps sticky-typed `code`/`highlight` from rendering
 * one chip per character); the parity test asserts the two stay identical.
 */
export function segmentText(
  text: string,
  marks: readonly ReaderResolvedMark[],
): readonly ReaderTextSegment[] {
  if (text.length === 0) return [];
  if (marks.length === 0) {
    return [{ from: 0, marks: [], text, to: text.length }];
  }
  const boundaries = new Set<number>([0, text.length]);
  for (const mark of marks) {
    if (mark.from > 0) boundaries.add(mark.from);
    if (mark.to < text.length) boundaries.add(mark.to);
  }
  const ordered = [...boundaries].sort((a, b) => a - b);
  const segments: ReaderTextSegment[] = [];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const from = ordered[i]!;
    const to = ordered[i + 1]!;
    if (to <= from) continue;
    const covering = marks
      .filter((mark) => mark.from <= from && mark.to >= to)
      .sort((a, b) => a.from - b.from || b.to - a.to);
    const previous = segments.at(-1);
    if (
      previous &&
      previous.to === from &&
      segmentSignature(previous.marks) === segmentSignature(covering)
    ) {
      segments[segments.length - 1] = {
        from: previous.from,
        marks: previous.marks,
        text: previous.text + text.slice(from, to),
        to,
      };
      continue;
    }
    segments.push({ from, marks: covering, text: text.slice(from, to), to });
  }
  return segments;
}

/** Resolve and segment a leaf in one call (mirror of core `segmentLeaf`). */
export function segmentLeaf(
  node: ReaderTextLeaf,
): readonly ReaderTextSegment[] {
  return segmentText(node.content.text, resolveLeafMarks(node));
}

// --- href sanitization (mirror of core `url-safety.ts`) ----------------------

const SAFE_HREF = /^(?:https?:|mailto:|tel:|#|\/)/i;
// ASCII control characters (incl. tab/newline) an attacker could splice into a
// scheme to dodge the allowlist, e.g. "java\tscript:". Built from an escaped string
// so the source carries no literal control bytes.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

/** A safe href, or `""` when the input is unsafe/empty (renders inert). */
export function safeHref(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.replace(CONTROL_CHARS, "").trim();
  return SAFE_HREF.test(value) ? value : "";
}

// --- heading anchors + levels (mirror of core `bake.ts` / lib) ---------------

/** The anchor id of a heading: its pinned `attrs.anchorId`, else its node id. */
export function readerHeadingAnchor(
  id: string,
  attrs: Readonly<Record<string, unknown>> | undefined,
): string {
  const anchorId = attrs?.anchorId;
  return typeof anchorId === "string" && anchorId.length > 0 ? anchorId : id;
}

/** A heading leaf's level 1..6 from its `attrs.tag`, defaulting to 2. */
export function readerHeadingLevel(
  attrs: Readonly<Record<string, unknown>> | undefined,
): number {
  const tag = attrs?.tag;
  switch (tag) {
    case "h1":
      return 1;
    case "h3":
      return 3;
    case "h4":
      return 4;
    case "h5":
      return 5;
    case "h6":
      return 6;
    default:
      return 2;
  }
}
