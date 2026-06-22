/**
 * View-layer block-type registry (note.md W5 / C3).
 *
 * Text-leaf block types (paragraph, heading h1-h4, quote, and the list item) used
 * to be hardcoded twice in chrome — the toolbar's `BLOCK_TYPES` and the context
 * menu's `BLOCK_ITEMS`, which had already drifted (the menu was missing H3/H4) —
 * and again as the aria-role map in `selection-overlay`. This registry is the
 * single source for the block-type chooser and the aria role: each entry carries
 * its `blockType`/`tag`, display `label`/`icon`/`preview`, whether it appears in
 * the chooser, and its `ariaRole`. The toolbar and context menu consume
 * `listBlockTypes().filter((b) => b.chooser)` (W6); `selection-overlay` reads
 * `blockTypeRole`.
 *
 * `TextLeafType` stays the persisted set in core (`model.ts`); only the chrome and
 * aria wiring derives from here. Scope: this is the VIEW half. The core block
 * concerns stay in core and are not moved here — markdown autoformat prefixes
 * (`markdown-shortcuts`, which carry list-specific data like a bullet item's two
 * prefixes `-`/`*`) and the heading TOC level (`bake`, worker-safe) cannot import a
 * view registry. This is the same core/view boundary the mark registry draws for
 * the bake annotation index (W4).
 */
import type { TextLeafType } from "../../core";

/** One block-type chooser entry plus its aria role. */
export type BlockTypeDefinition = {
  /** Stable id independent of array order: `${blockType}:${tag ?? ""}`. */
  readonly id: string;
  readonly blockType: TextLeafType;
  readonly tag?: string;
  readonly label: string;
  readonly icon: string;
  /** Preview class for the chooser dropdown item (the toolbar's style preview). */
  readonly preview?: string;
  /** Whether this entry appears in the block-type chooser (toolbar + menu). */
  readonly chooser?: boolean;
  /** ARIA role name announced for a block of this type (selection-overlay). */
  readonly ariaRole: string;
};

/** The stable chooser id for a block type, independent of registration order. */
export function blockTypeKey(blockType: string, tag?: string): string {
  return `${blockType}:${tag ?? ""}`;
}

const BLOCK_TYPES = new Map<string, BlockTypeDefinition>();

/** Register a block-type chooser entry. Idempotent by id. */
export function registerBlockType(definition: BlockTypeDefinition): void {
  BLOCK_TYPES.set(definition.id, definition);
}

/** The definition for a chooser id, or undefined. */
export function getBlockType(id: string): BlockTypeDefinition | undefined {
  return BLOCK_TYPES.get(id);
}

/** Every registered block type, in registration order (the chooser's order). */
export function listBlockTypes(): readonly BlockTypeDefinition[] {
  return [...BLOCK_TYPES.values()];
}

/**
 * The aria role announced for a leaf's block type, else Paragraph. The role is
 * per-`blockType`, not per-`id` (all four heading tags share "Heading"), so the
 * first registered entry for the type wins — registration order only matters if a
 * host registers two entries of one `blockType` with different roles.
 */
export function blockTypeRole(blockType: TextLeafType): string {
  for (const definition of BLOCK_TYPES.values()) {
    if (definition.blockType === blockType) return definition.ariaRole;
  }
  return "Paragraph";
}

// Built-in block types (note.md W5). Registration order is the chooser's display
// order. `chooser` is true for the six the toolbar offers; the list item is
// registered (for `blockTypeRole`) but not a chooser entry, because lists toggle
// through their own toolbar buttons. Adding a heading level is now one entry here.
const BUILT_IN_BLOCK_TYPES: readonly BlockTypeDefinition[] = [
  {
    ariaRole: "Paragraph",
    blockType: "paragraph",
    chooser: true,
    icon: "Pilcrow",
    id: blockTypeKey("paragraph"),
    label: "Paragraph",
    preview: "text-sm",
  },
  {
    ariaRole: "Heading",
    blockType: "heading",
    chooser: true,
    icon: "Heading1",
    id: blockTypeKey("heading", "h1"),
    label: "Heading 1",
    preview: "text-2xl font-bold",
    tag: "h1",
  },
  {
    ariaRole: "Heading",
    blockType: "heading",
    chooser: true,
    icon: "Heading2",
    id: blockTypeKey("heading", "h2"),
    label: "Heading 2",
    preview: "text-xl font-bold",
    tag: "h2",
  },
  {
    ariaRole: "Heading",
    blockType: "heading",
    chooser: true,
    icon: "Heading3",
    id: blockTypeKey("heading", "h3"),
    label: "Heading 3",
    preview: "text-lg font-semibold",
    tag: "h3",
  },
  {
    ariaRole: "Heading",
    blockType: "heading",
    chooser: true,
    icon: "Heading4",
    id: blockTypeKey("heading", "h4"),
    label: "Heading 4",
    preview: "text-base font-semibold",
    tag: "h4",
  },
  {
    ariaRole: "Quote",
    blockType: "quote",
    chooser: true,
    icon: "Quote",
    id: blockTypeKey("quote"),
    label: "Quote",
    preview: "text-sm italic text-base-content/70",
  },
  {
    ariaRole: "List item",
    blockType: "listitem",
    icon: "List",
    id: blockTypeKey("listitem"),
    label: "List item",
  },
];

let builtInBlockTypesRegistered = false;

/**
 * Register the built-in block types once (idempotent). Self-called at module load
 * so a direct importer (`selection-overlay`'s `blockTypeRole`) sees a populated
 * registry, and exported so the view orchestrator can call it explicitly. The
 * guard means a second call cannot clobber a host's `registerBlockType` override.
 */
export function registerBuiltInBlockTypes(): void {
  if (builtInBlockTypesRegistered) return;
  builtInBlockTypesRegistered = true;
  for (const definition of BUILT_IN_BLOCK_TYPES) registerBlockType(definition);
}

registerBuiltInBlockTypes();
