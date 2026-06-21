/**
 * The framework-free (core) half of the structural-container node SPI — the
 * symmetric twin of the object `NodeDefinition` (`registry.ts`) and the structural
 * *view* half (`view/structural-view.ts`).
 *
 * Why this file exists
 * --------------------
 * A structural container (callout, the future table) owns block *children* the
 * engine renders recursively. Before this file, a structural type's core behavior
 * — how it is inserted and how it round-trips through the legacy compat JSON —
 * was welded into core as hardcoded `node.type === "callout"` branches
 * (`compat.ts`) plus a bespoke `insert-callout` command (`commands/objects.ts`).
 * That made callout's *view* pluggable but its store/persistence half closed: a
 * new structural type could render but could not own its insert or survive
 * save/load without editing core (note §4.2).
 *
 * A `StructuralDefinition` is the explicit, DOM-free contract for that half:
 * - `createSubtree` builds the initial container + descendants for the generic
 *   `insert-structural` command (no per-type command needed);
 * - `fromCompatNode` imports the legacy JSON shape into attrs + child ids
 *   (registry-driven import, mirroring the object `normalizeCompatObject` path).
 *
 * Export is already generic for any structural node (`compat.ts` spreads attrs +
 * recurses children), so there is no `toCompatNode` here yet.
 *
 * Scope (note §7): this is the minimal core half, proven by migrating the
 * built-in callout off its hardcoded paths. The closed `StructuralNodeType` union
 * (`model.ts`) is deliberately NOT opened yet — that lands with the first
 * genuinely-new structural type (the docs/019 table), per the plan's step 3.
 */
import {
  makeStructuralNode,
  makeTextNode,
  type EditorNode,
  type IdAllocator,
  type JsonObject,
  type NodeId,
  type RichTextCompatNode,
  type StructuralNode,
} from "./model";

/**
 * The initial subtree a structural insert builds: the container root plus its
 * already-built descendants (carried on one `insert-node` step so the whole
 * subtree registers atomically), and the optional leaf to land the caret in.
 */
export type StructuralSubtree = {
  readonly root: StructuralNode;
  readonly descendants: readonly EditorNode[];
  /** A descendant (or the root) to land the caret in at offset 0 after insert. */
  readonly caret?: NodeId;
};

/**
 * The compat-import machinery a `StructuralDefinition` borrows from `compat.ts`,
 * so a definition decides *which* attrs/children to keep without owning the
 * recursion engine (which lives at the compat boundary). Mirrors how the object
 * registry leans on `compat.ts` for the document walk.
 */
export type StructuralCompatContext = {
  readonly allocator: IdAllocator;
  /** Import a node's block children recursively into owned-model ids. */
  importChildren(
    children: readonly RichTextCompatNode[] | undefined,
  ): readonly NodeId[];
  /** True when any child is a block (vs inline text). */
  hasBlockChildren(
    children: readonly RichTextCompatNode[] | undefined,
  ): boolean;
  /** Wrap a node's inline children as one paragraph leaf, returning its id. */
  importInlineAsParagraph(node: RichTextCompatNode): readonly NodeId[];
  /** Pick JSON-primitive attrs off the legacy node (the compat `pickAttrs`). */
  pickAttrs(
    node: RichTextCompatNode,
    keys: readonly string[],
  ): JsonObject | undefined;
};

/** What a structural import resolves a legacy node into. */
export type StructuralCompatResult = {
  readonly attrs?: JsonObject;
  readonly children: readonly NodeId[];
};

/**
 * The core half of one structural type's contract (note §7). Paired by `type`
 * with the view-layer `StructuralNodeView`; `registerNode` registers both halves.
 */
export type StructuralDefinition = {
  readonly type: string;
  /** Build the initial subtree for the generic `insert-structural` command. */
  createSubtree(allocator: IdAllocator): StructuralSubtree;
  /** Import a legacy compat node into attrs + child ids (registry-driven). */
  fromCompatNode(
    node: RichTextCompatNode,
    ctx: StructuralCompatContext,
  ): StructuralCompatResult;
};

/**
 * The built-in `callout` core half. Lives here (core), not in the view, so compat
 * import/insert see it without depending on the React layer — mirroring how
 * `BUILT_IN_OBJECT_DEFINITIONS` keeps built-in object cores out of the view.
 */
function calloutStructuralDefinition(): StructuralDefinition {
  return {
    createSubtree(allocator) {
      // A callout is a scope, not an atom: it holds one empty paragraph the caret
      // lands in (docs/019 §4), inserted as one subtree.
      const paragraphId = allocator.createNodeId();
      const paragraph = makeTextNode({
        content: allocator.createTextSlice(""),
        id: paragraphId,
        type: "paragraph",
      });
      const root = makeStructuralNode({
        attrs: { tone: "info" },
        children: [paragraphId],
        id: allocator.createNodeId(),
        type: "callout",
      });
      return { caret: paragraphId, descendants: [paragraph], root };
    },
    fromCompatNode(node, ctx) {
      // A callout carrying block children imports them directly; one carrying only
      // inline text wraps that text in a single paragraph so the legacy
      // inline-content shape becomes the same container model.
      const children = ctx.hasBlockChildren(node.children)
        ? ctx.importChildren(node.children)
        : ctx.importInlineAsParagraph(node);
      return { attrs: ctx.pickAttrs(node, ["tone"]), children };
    },
    type: "callout",
  };
}

/** Built-in structural cores (note §7: only callout migrated so far). */
export const BUILT_IN_STRUCTURAL_DEFINITIONS: readonly StructuralDefinition[] =
  [calloutStructuralDefinition()];

const BUILT_IN_BY_TYPE = new Map(
  BUILT_IN_STRUCTURAL_DEFINITIONS.map((definition) => [
    definition.type,
    definition,
  ]),
);

/**
 * Globally registered custom structural definitions (the third-party path). A
 * custom registration takes precedence over a built-in of the same type, matching
 * the object registry's last-write-wins-for-globals shape.
 */
const GLOBAL_STRUCTURAL_DEFINITIONS = new Map<string, StructuralDefinition>();

/** Register a custom structural core globally. Idempotent by type. */
export function registerGlobalStructuralDefinition(
  definition: StructuralDefinition,
): void {
  GLOBAL_STRUCTURAL_DEFINITIONS.set(definition.type, definition);
}

/** The custom structural definitions registered so far. */
export function globalStructuralDefinitions(): readonly StructuralDefinition[] {
  return [...GLOBAL_STRUCTURAL_DEFINITIONS.values()];
}

/** The structural core for a type (custom first, then built-in), or undefined. */
export function getStructuralDefinition(
  type: string,
): StructuralDefinition | undefined {
  return GLOBAL_STRUCTURAL_DEFINITIONS.get(type) ?? BUILT_IN_BY_TYPE.get(type);
}

/** Whether a type has a registered structural core (compat import + nesting). */
export function isStructuralDefinitionType(type: string): boolean {
  return getStructuralDefinition(type) !== undefined;
}
