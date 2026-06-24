/**
 * The surface-neutral command projector (docs/024 §5.5/§5.6) — the shared resolver
 * the flat command surfaces (context menu, selection flyout, slash menu) read.
 *
 * The ribbon keeps its richer tab/slot resolver (`computeToolbarLayout`,
 * `toolbar-layout.ts`) because it is the one surface with a bespoke arrangement
 * (docs/024 §4.7/§6.3). The other three surfaces are *grouped lists in a fixed group
 * order* — there is nothing to arrange — so they share one pure function,
 * `resolveCommandList(surface, ctx)`, which:
 *
 *   1. projects the registries (marks / block-types / inserts) by-kind onto the
 *      surface (docs/024 §6.3 — no per-surface layout config; the "layout" is the
 *      fixed group order), plus every registered `Command` that declares the surface;
 *   2. gathers scope contributions by walking the live `scopePath` innermost-first
 *      and calling each enclosing node view's `contributeCommands` (docs/024 §5.3);
 *   3. gates by `isAvailable`, computes `isActive`/`isDisabled`/placement;
 *   4. buckets by `group`, orders groups by `COMMAND_GROUP_ORDER`, drops empties.
 *
 * It is pure and DOM-free (reads the model through `ctx`, never the DOM), so a
 * surface's contents are unit-asserted by calling it (docs/024 §10) — exactly as
 * docs/023 §5.5 made the ribbon testable. The renderers in `chrome/surfaces/*` hold
 * zero command knowledge; all of it flows as data from here.
 */
import type { EditorStore, EditorSelection, NodeId } from "../../core";
import { activeScope, collectSelectionText, scopePath } from "../../core";
import { listMarks } from "./mark-registry";
import { listBlockTypes } from "./block-type-registry";
import {
  getNodeView,
  listInsertableNodes,
  type NodeViewResourceConfigField,
} from "./node-view";
import { getDataSource } from "./data-source-registry";
import {
  getStructuralView,
  listInsertableStructuralNodes,
} from "./structural-view";
import {
  commandTargetsSurface,
  listCommands,
  type Command,
  type CommandContext,
  type CommandPlacement,
  type CommandScope,
  type CommandSurface,
  type PanelHost,
  type ToolbarCapabilities,
  type ToolbarSelectionFacts,
} from "./command-registry";

/**
 * The fixed command groups (docs/024 §5.6), adapted from legacy `COMMAND_GROUP_ORDER`.
 * A command's group is fixed; the *surface* decides which groups it renders (the
 * context menu shows `edit` first; the flyout omits `edit`/`history`/`insert`; the
 * slash menu is dominated by `blockStyle`/`insert`). Scope contributions slot into
 * their declared group, so they interleave with registry commands by group, not by
 * source.
 */
export type CommandGroup =
  | "edit" // cut/copy/paste/select-all/delete (context menu)
  | "history" // undo/redo
  | "blockStyle" // paragraph/heading/quote turn-into
  | "inlineFormat" // bold/italic/underline/strike/code (the marks)
  | "list" // bulleted/numbered
  | "indent" // indent/outdent
  | "annotate" // link/comment/glossary
  | "insert" // callout/table/media/divider/…
  | "structure" // table/cell ops (scope-contributed)
  | "object" // object-instance ops (scope-contributed)
  | "panel"; // open a side-panel workspace (Outline/Comments/Glossary/Insights, docs/027 §8.2)

/** The single relative sequence every surface shares (docs/024 §5.6). */
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  "edit",
  "history",
  "blockStyle",
  "inlineFormat",
  "list",
  "indent",
  "annotate",
  "insert",
  "structure",
  "object",
  "panel",
];

/** One command resolved for a surface (docs/024 §5.5): identity + live predicate state. */
export type ResolvedCommand = {
  readonly id: string;
  readonly command: Command;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly placement: CommandPlacement;
};

/** A non-empty group of resolved commands, in `COMMAND_GROUP_ORDER` position. */
export type ResolvedCommandGroup = {
  readonly group: CommandGroup;
  readonly items: readonly ResolvedCommand[];
};

/**
 * Derive the live `CommandScope` from the model (docs/024 §5.4). Computed once per
 * resolve from `scopePath`/`activeScope`/`store.activeObjectId`, so contributions and
 * predicates reason about where the caret is without re-walking. An active object
 * (or a node selection on an object) is the innermost scope so its `contributeCommands`
 * run; otherwise the innermost container of the `scopePath` is.
 */
export function computeCommandScope(store: EditorStore): CommandScope {
  const sel: EditorSelection | null = store.selection;
  const path = sel ? scopePath(store, sel) : [store.bodyId];
  // The object the click/caret targets: the active (live-editing) object, or a
  // node selection landing on an object block. An object never appears in
  // `scopePath` (it is a leaf, not a container scope), so it is tracked here.
  const selectedObject =
    sel?.type === "node" && store.getNode(sel.node)?.kind === "object"
      ? sel.node
      : null;
  const activeObject = store.activeObjectId ?? selectedObject;
  if (activeObject) {
    return {
      activeObject,
      innermost: activeObject,
      innermostKind: "object",
      path,
    };
  }
  const innermost = path.at(-1) ?? store.bodyId;
  const node = innermost === store.bodyId ? null : store.getNode(innermost);
  const innermostKind: CommandScope["innermostKind"] =
    innermost === store.bodyId
      ? "root"
      : node?.kind === "structural"
        ? "structural"
        : node?.kind === "object"
          ? "object"
          : "root";
  return { activeObject: null, innermost, innermostKind, path };
}

/**
 * Synthesize the registry commands a flat surface projects by-kind (docs/024 §6.3).
 * Marks, chooser block-types, and insertables are not `Command` descriptors — they
 * live in their own registries — so they are wrapped into surface-neutral commands
 * here, with the by-kind default surface participation. This keeps "register a mark →
 * it appears on every text surface" true with no per-surface config (the flat
 * surfaces have no arrangement to externalize, unlike the ribbon).
 */
function registryCommands(): Command[] {
  const out: Command[] = [];

  // Marks → inline formats on every text surface (context menu + flyout). Gated on
  // a live selection: an inline format applies to a range, not a bare caret (the
  // ribbon's collapsed-caret pending-format path is the ribbon resolver's, not this).
  for (const mark of listMarks()) {
    if (!mark.toolbar) continue;
    const meta = mark.toolbar;
    out.push({
      group: "inlineFormat",
      icon: meta.icon,
      id: `mark:${mark.kind}`,
      isActive: (ctx) => ctx.selection.activeMarks.has(mark.kind),
      isAvailable: (ctx) => ctx.selection.hasSelection,
      keywords: [meta.label.toLowerCase()],
      kind: "toggle",
      label: meta.label,
      run: (ctx) => ctx.store.command({ mark: mark.kind, type: "toggle-mark" }),
      surfaces: { contextMenu: "primary", flyout: "primary" },
    });
  }

  // Chooser block-types → turn-into on the context menu (block branch) + slash menu.
  for (const entry of listBlockTypes()) {
    if (!entry.chooser) continue;
    out.push({
      group: "blockStyle",
      icon: entry.icon,
      id: `block:${entry.id}`,
      isActive: (ctx) =>
        ctx.selection.blockType === entry.blockType &&
        currentTag(ctx.store) === (entry.tag ?? undefined),
      keywords: [entry.label.toLowerCase()],
      kind: "button",
      label: entry.label,
      run: (ctx) =>
        ctx.store.command({
          blockType: entry.blockType,
          ...(entry.tag ? { tag: entry.tag } : {}),
          type: "set-block-type",
        }),
      surfaces: { contextMenu: "primary", slash: "primary" },
    });
  }

  // Insertables (structural + object) → primary on the slash menu, overflow on the
  // context menu. The slash inserts a sensible default (a structural type's
  // `createCommand()` carries no params → its default subtree, e.g. a 3×3 table),
  // the fast path; the ribbon keeps the richer dimension picker (docs/024 §7.3).
  for (const view of listInsertableStructuralNodes()) {
    const insert = view.insert;
    out.push({
      group: "insert",
      icon: insert.icon ?? "Plus",
      id: `insert:${view.type}`,
      keywords: insert.keywords ?? [insert.label.toLowerCase()],
      kind: "button",
      label: insert.label,
      run: (ctx) => ctx.store.command(insert.createCommand()),
      surfaces: { contextMenu: "more", slash: "primary" },
    });
  }
  for (const view of listInsertableNodes()) {
    if (!getNodeView(view.type)) continue;
    const insert = view.insert;
    const resourceField = view.configFields?.find(
      (field): field is NodeViewResourceConfigField =>
        field.kind === "resource",
    );
    // Provenance gating (docs/026 §9): a reference block whose source is not
    // registered in this deployment cannot function, so it is hidden from the
    // insert affordance entirely. A registry lookup, not a feature flag — existing
    // instances in a loaded document still render their persisted snapshot (§7.4).
    if (resourceField && !getDataSource(resourceField.source)) continue;
    out.push({
      group: "insert",
      icon: insert.icon ?? "Plus",
      id: `insert:${view.type}`,
      keywords: insert.keywords ?? [insert.label.toLowerCase()],
      kind: "button",
      label: insert.label,
      run: (ctx) => {
        ctx.store.command({
          data: insert.createData(),
          objectType: view.type,
          type: "insert-object",
        });
        // Choose-first (docs/026 §7.1): a reference block opens its picker
        // immediately and rolls back if dismissed before a record is picked. The
        // insert just set the selection to the new node.
        if (resourceField) {
          const sel = ctx.store.selection;
          if (sel?.type === "node") ctx.store.beginProvisionalInsert(sel.node);
        }
      },
      surfaces: { contextMenu: "more", slash: "primary" },
    });
  }

  return out;
}

/** The `tag` attr of the current text leaf (Heading 1/2/3 disambiguation), or undefined. */
function currentTag(store: EditorStore): string | undefined {
  const sel = store.selection;
  const node = sel?.type === "text" ? store.getNode(sel.focus.node) : null;
  return node?.kind === "text" && typeof node.attrs?.tag === "string"
    ? node.attrs.tag
    : undefined;
}

/**
 * Gather scope contributions (docs/024 §5.3): walk the enclosing containers
 * innermost-first and ask each node view for the commands of *its* scope. The
 * generic surfaces enumerate this slot and keep no per-type knowledge — a table cell
 * contributes merge/fill/align, a table insert/delete row+column, an image
 * replace/alt — the same inversion `renderOverlay`/`handleTab`/`caretInk` use. A
 * contributor returns plain descriptors; it must never call `resolveCommandList`
 * itself (docs/024 §9 — infinite loop).
 */
function scopeContributions(ctx: CommandContext): Command[] {
  const { store, scope } = ctx;
  const out: Command[] = [];
  const seen = new Set<NodeId>();
  // Innermost-first: the active object (if any) is the innermost scope, then the
  // `scopePath` reversed (root-first → innermost-first).
  const ids: NodeId[] = [];
  if (scope.activeObject) ids.push(scope.activeObject);
  for (let i = scope.path.length - 1; i >= 0; i -= 1) ids.push(scope.path[i]!);
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === store.bodyId) continue;
    const node = store.getNode(id);
    if (!node) continue;
    const view =
      node.kind === "object"
        ? getNodeView(node.type)
        : node.kind === "structural"
          ? getStructuralView(node.type)
          : undefined;
    const contributed = view?.contributeCommands?.(ctx);
    if (contributed) out.push(...contributed);
  }
  return out;
}

/**
 * Resolve a flat surface's grouped, ordered command list (docs/024 §5.5). Pure and
 * DOM-free. `surface` is any command surface except the ribbon (the ribbon uses
 * `computeToolbarLayout`). Scope contributions are gathered first so an innermost
 * scope's command precedes a registry command of equal `order` within a group
 * (docs/024 §8 — innermost-first), then registry projections + registered commands;
 * a duplicate id keeps the first (scope) writer.
 */
export function resolveCommandList(
  surface: Exclude<CommandSurface, "ribbon">,
  ctx: CommandContext,
): readonly ResolvedCommandGroup[] {
  const candidates: Command[] = [
    ...scopeContributions(ctx),
    ...registryCommands(),
    ...listCommands(),
  ];

  const resolved: ResolvedCommand[] = [];
  const seen = new Set<string>();
  for (const command of candidates) {
    if (seen.has(command.id)) continue;
    if (!commandTargetsSurface(command, surface)) continue;
    if (command.isAvailable && !command.isAvailable(ctx)) continue;
    seen.add(command.id);
    resolved.push({
      active: command.isActive?.(ctx) ?? false,
      command,
      disabled: command.isDisabled?.(ctx) ?? false,
      id: command.id,
      placement: command.surfaces[surface]!,
    });
  }

  const byGroup = new Map<CommandGroup, ResolvedCommand[]>();
  for (const item of resolved) {
    const bucket = byGroup.get(item.command.group) ?? [];
    bucket.push(item);
    byGroup.set(item.command.group, bucket);
  }
  const groups: ResolvedCommandGroup[] = [];
  for (const group of COMMAND_GROUP_ORDER) {
    const items = byGroup.get(group);
    if (!items || items.length === 0) continue;
    // No sort: within a group, items keep their gather order — scope contributions
    // first (innermost scope first, then each contributor's declared array order),
    // then registry projections + registered commands in registration order (docs/024
    // §8). A contributor arranges its own commands by the order it returns them.
    groups.push({ group, items });
  }
  return groups;
}

/**
 * Derive the live `ToolbarSelectionFacts` from the model (docs/023 §5.3). Real, not
 * the legacy hardcoded `hasSelectedText: false`: selection-scoped commands (the
 * flyout's apply-to-selection, comment, AI-on-selection) depend on these. The single
 * source shared by the ribbon and the flat surfaces — duplicating it per surface
 * would drift and trip the duplicate-code gate. `collectSelectionText` walks the
 * document (O(leaves)); a collapsed caret has no selected text, so the scan is
 * skipped on the keystroke-commit hot path and only paid for a real range.
 */
export function commandSelectionFacts(
  store: EditorStore,
): ToolbarSelectionFacts {
  const sel = store.selection;
  const blockTypeQuery = store.query({ type: "current-block-type" });
  const blockType = typeof blockTypeQuery === "string" ? blockTypeQuery : null;
  const activeMarks = new Set(
    listMarks()
      .filter(
        (mark) =>
          store.query({ mark: mark.kind, type: "is-mark-active" }) === true,
      )
      .map((mark) => mark.kind),
  );
  let hasSelection = false;
  let selectedText = "";
  if (sel?.type === "text") {
    hasSelection =
      sel.anchor.node !== sel.focus.node ||
      sel.anchor.offset !== sel.focus.offset;
    if (hasSelection) selectedText = collectSelectionText(store, sel);
  }
  const inObject = sel ? activeScope(store, sel) !== store.bodyId : false;
  return { activeMarks, blockType, hasSelection, inObject, selectedText };
}

/**
 * Build the full `CommandContext` (selection facts + scope + capabilities) the
 * resolvers consume (docs/024 §5.4). Every surface — ribbon and flat — builds its
 * context through this one function so they cannot disagree about what the live
 * scope/selection is.
 */
export function buildCommandContext(
  store: EditorStore,
  capabilities: ToolbarCapabilities,
  panelHost?: PanelHost,
): CommandContext {
  return {
    capabilities,
    // Spread the dock seam only when present so a bare/test context keeps the key
    // absent (a command's `run` reads `ctx.panelHost?.open`, docs/027 §8.2).
    ...(panelHost ? { panelHost } : {}),
    scope: computeCommandScope(store),
    selection: commandSelectionFacts(store),
    store,
  };
}

// Re-export so a surface host or test can derive the scope without importing core's
// `activeScope` directly (kept here to keep the scope-walk in one place).
export { activeScope };
