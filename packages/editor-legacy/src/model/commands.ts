import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import { $createQuoteNode, type HeadingTagType } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  INDENT_CONTENT_COMMAND,
  OUTDENT_CONTENT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type ElementFormatType,
  type LexicalCommand,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import {
  capabilityFor,
  type BlockCapability,
  type BlockKind,
} from "./capabilities";
import { editorInsertActions } from "./insert-actions";
import { canUse } from "./schema";
import {
  $clampRangeSelectionToText,
  INLINE_TEXT_ACTIONS,
  selectionBlockKind,
} from "./selection-actions";
import { $createEditorHeadingNode } from "../nodes/heading-node";
import type { RichTextEditorBindings } from "../nodes";

/**
 * Single declarative registry of editor commands. The toolbar, selection flyout,
 * slash menu, and context menu all render from this one source instead of each
 * hardcoding which actions to show, where they go (inline "primary" vs the "More"
 * overflow), and when they apply. To add an authoring action — and have it appear
 * on the right surfaces — add one entry here.
 *
 * Two genuinely widget-shaped groups are rendered by bespoke components and so are
 * *not* generic commands: `blockStyle` (the Turn-into menu, see `BLOCK_STYLE_OPTIONS`
 * + `applyBlockStyle`) and `annotate` (link/glossary/comment, which own their own
 * popovers). They still participate in the shared scope model via `availableAnnotations`
 * and `COMMAND_GROUP_ORDER`, so surfaces place them consistently.
 */

export type CommandGroup =
  | "history"
  | "blockStyle"
  | "inlineFormat"
  | "align"
  | "list"
  | "indent"
  | "annotate"
  | "insert";

export type CommandSurface = "toolbar" | "flyout" | "slash" | "context";

/** Inline on the bar vs tucked into a surface's overflow ("More") menu. */
export type CommandPlacement = "primary" | "more";

/** Fixed render order of groups across every surface (slots interleave by group). */
export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  "history",
  "blockStyle",
  "inlineFormat",
  "align",
  "list",
  "indent",
  "annotate",
  "insert",
];

export type CommandContext = {
  readonly editor: LexicalEditor;
  readonly allowedNodes: readonly string[];
  readonly bindings: RichTextEditorBindings;
  readonly blockKind: BlockKind;
  readonly capability: BlockCapability;
  readonly activeFormats: ReadonlySet<TextFormatType>;
  readonly activeAlign: ElementFormatType;
  readonly hasSelectedText: boolean;
  /** Editable text is focused (caret/selection in text, not a block widget). */
  readonly canFormat: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly selectedText: string;
};

export type EditorCommand = {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly keywords?: readonly string[];
  readonly group: CommandGroup;
  /** Inline-format payload for surfaces with bespoke direct-apply (flyout/context). */
  readonly format?: TextFormatType;
  /** Per-surface placement; an absent surface key means "not shown there". */
  readonly surfaces: Partial<Record<CommandSurface, CommandPlacement>>;
  /** Hidden when false — allowlist / binding gating. */
  isAvailable(ctx: CommandContext): boolean;
  /** Disabled when false — capability / selection gating. */
  isEnabled(ctx: CommandContext): boolean;
  /** Toggle (pressed) state. */
  isActive(ctx: CommandContext): boolean;
  run(ctx: CommandContext): void;
};

// ---------------------------------------------------------------------------
// Block style ("Turn into") — rendered by `block-style-control.tsx`.
// ---------------------------------------------------------------------------

export type BlockStyleId = "paragraph" | HeadingTagType | "quote";

export const BLOCK_STYLE_OPTIONS: readonly {
  readonly id: BlockStyleId;
  readonly label: string;
  readonly icon: string;
  readonly preview: string;
  readonly node?: "heading" | "quote";
}[] = [
  { icon: "Pilcrow", id: "paragraph", label: "Paragraph", preview: "text-sm" },
  {
    icon: "Heading1",
    id: "h1",
    label: "Heading 1",
    node: "heading",
    preview: "text-2xl font-bold",
  },
  {
    icon: "Heading2",
    id: "h2",
    label: "Heading 2",
    node: "heading",
    preview: "text-xl font-bold",
  },
  {
    icon: "Heading3",
    id: "h3",
    label: "Heading 3",
    node: "heading",
    preview: "text-lg font-semibold",
  },
  {
    icon: "Heading4",
    id: "h4",
    label: "Heading 4",
    node: "heading",
    preview: "text-base font-semibold",
  },
  {
    icon: "Quote",
    id: "quote",
    label: "Quote",
    node: "quote",
    preview: "text-sm italic text-base-content/70",
  },
];

/** Block styles permitted by the allowlist; paragraph is always available. */
export function availableBlockStyles(
  allowedNodes: readonly string[],
): readonly (typeof BLOCK_STYLE_OPTIONS)[number][] {
  return BLOCK_STYLE_OPTIONS.filter(
    (option) =>
      option.id === "paragraph" ||
      (option.node === "heading" && canUse("heading", allowedNodes)) ||
      (option.node === "quote" && canUse("quote", allowedNodes)),
  );
}

/**
 * Convert the selected block(s) to the chosen style. Exiting a list needs the
 * list command first; `$setBlocksType` alone leaves orphan list wrappers.
 */
export function applyBlockStyle(
  editor: LexicalEditor,
  blockKind: BlockKind,
  id: BlockStyleId,
): void {
  if (
    blockKind === "bullet" ||
    blockKind === "number" ||
    blockKind === "check"
  ) {
    editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
  }
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    if (id === "paragraph") {
      $setBlocksType(selection, () => $createParagraphNode());
    } else if (id === "quote") {
      $setBlocksType(selection, () => $createQuoteNode());
    } else {
      $setBlocksType(selection, () => $createEditorHeadingNode(id));
    }
  });
}

// ---------------------------------------------------------------------------
// Annotate (link / glossary / comment) — rendered by the bespoke buttons.
// ---------------------------------------------------------------------------

export type AnnotateId = "link" | "glossary" | "comment";

/** Which inline annotations the allowlist + bindings permit. */
export function availableAnnotations(
  ctx: CommandContext,
): ReadonlySet<AnnotateId> {
  const set = new Set<AnnotateId>();
  if (canUse("link", ctx.allowedNodes)) set.add("link");
  if (canUse("glossary", ctx.allowedNodes)) set.add("glossary");
  if (canUse("mark", ctx.allowedNodes) && Boolean(ctx.bindings.onComment)) {
    set.add("comment");
  }
  return set;
}

// ---------------------------------------------------------------------------
// Generic button commands.
// ---------------------------------------------------------------------------

const HISTORY_COMMANDS: readonly EditorCommand[] = [
  {
    group: "history",
    icon: "Undo2",
    id: "undo",
    isActive: () => false,
    isAvailable: () => true,
    isEnabled: (ctx) => ctx.canUndo,
    label: "Undo",
    run: (ctx) => ctx.editor.dispatchCommand(UNDO_COMMAND, undefined),
    surfaces: { toolbar: "primary" },
  },
  {
    group: "history",
    icon: "Redo2",
    id: "redo",
    isActive: () => false,
    isAvailable: () => true,
    isEnabled: (ctx) => ctx.canRedo,
    label: "Redo",
    run: (ctx) => ctx.editor.dispatchCommand(REDO_COMMAND, undefined),
    surfaces: { toolbar: "primary" },
  },
];

const INLINE_FORMAT_COMMANDS: readonly EditorCommand[] =
  INLINE_TEXT_ACTIONS.map(
    ({ format, icon, id, label }): EditorCommand => ({
      format,
      group: "inlineFormat",
      icon,
      id,
      isActive: (ctx) => ctx.activeFormats.has(format),
      isAvailable: (ctx) => canUse("text", ctx.allowedNodes),
      isEnabled: (ctx) =>
        ctx.canFormat && ctx.capability.inlineFormats.has(format),
      label,
      run: (ctx) => ctx.editor.dispatchCommand(FORMAT_TEXT_COMMAND, format),
      surfaces: { context: "primary", flyout: "primary", toolbar: "primary" },
    }),
  );

const ALIGNMENT_OPTIONS: readonly {
  readonly value: Exclude<ElementFormatType, "" | "start" | "end">;
  readonly icon: string;
  readonly label: string;
}[] = [
  { icon: "AlignLeft", label: "Align left", value: "left" },
  { icon: "AlignCenter", label: "Align center", value: "center" },
  { icon: "AlignRight", label: "Align right", value: "right" },
  { icon: "AlignJustify", label: "Justify", value: "justify" },
];

const ALIGN_COMMANDS: readonly EditorCommand[] = ALIGNMENT_OPTIONS.map(
  ({ icon, label, value }): EditorCommand => ({
    group: "align",
    icon,
    id: `align-${value}`,
    isActive: (ctx) => ctx.activeAlign === value,
    isAvailable: (ctx) => canUse("text", ctx.allowedNodes),
    isEnabled: (ctx) => ctx.canFormat && ctx.capability.canAlign,
    label,
    run: (ctx) => ctx.editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, value),
    surfaces: { toolbar: "primary" },
  }),
);

const LIST_OPTIONS: readonly {
  readonly id: string;
  readonly kind: Extract<BlockKind, "bullet" | "number" | "check">;
  readonly icon: string;
  readonly label: string;
  readonly insert: LexicalCommand<void>;
}[] = [
  {
    icon: "List",
    id: "bullet-list",
    insert: INSERT_UNORDERED_LIST_COMMAND,
    kind: "bullet",
    label: "Bullet list",
  },
  {
    icon: "ListOrdered",
    id: "numbered-list",
    insert: INSERT_ORDERED_LIST_COMMAND,
    kind: "number",
    label: "Numbered list",
  },
  {
    icon: "ListChecks",
    id: "check-list",
    insert: INSERT_CHECK_LIST_COMMAND,
    kind: "check",
    label: "Check list",
  },
];

const LIST_COMMANDS: readonly EditorCommand[] = LIST_OPTIONS.map(
  ({ icon, id, insert, kind, label }): EditorCommand => ({
    group: "list",
    icon,
    id,
    isActive: (ctx) => ctx.blockKind === kind,
    isAvailable: (ctx) => canUse("list", ctx.allowedNodes),
    isEnabled: (ctx) => ctx.canFormat,
    label,
    run: (ctx) => {
      // Toggle off when already this list type; otherwise convert/insert.
      if (ctx.blockKind === kind) {
        ctx.editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
      } else {
        ctx.editor.dispatchCommand(insert, undefined);
      }
    },
    surfaces: { toolbar: "primary" },
  }),
);

const INDENT_COMMANDS: readonly EditorCommand[] = [
  {
    group: "indent",
    icon: "IndentDecrease",
    id: "outdent",
    isActive: () => false,
    isAvailable: (ctx) => canUse("text", ctx.allowedNodes),
    isEnabled: (ctx) => ctx.canFormat && ctx.capability.canIndent,
    label: "Outdent",
    run: (ctx) =>
      ctx.editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined),
    surfaces: { context: "primary", toolbar: "primary" },
  },
  {
    group: "indent",
    icon: "IndentIncrease",
    id: "indent",
    isActive: () => false,
    isAvailable: (ctx) => canUse("text", ctx.allowedNodes),
    isEnabled: (ctx) => ctx.canFormat && ctx.capability.canIndent,
    label: "Indent",
    run: (ctx) => ctx.editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined),
    surfaces: { context: "primary", toolbar: "primary" },
  },
];

const STATIC_COMMANDS: readonly EditorCommand[] = [
  ...HISTORY_COMMANDS,
  ...INLINE_FORMAT_COMMANDS,
  ...ALIGN_COMMANDS,
  ...LIST_COMMANDS,
  ...INDENT_COMMANDS,
];

/** Block-insert commands, generated from the allowlist + bindings each call. */
function insertCommands(ctx: CommandContext): readonly EditorCommand[] {
  return editorInsertActions({
    allowedNodes: ctx.allowedNodes,
    bindings: ctx.bindings,
  }).map(
    (action): EditorCommand => ({
      group: "insert",
      icon: action.icon,
      id: action.id,
      isActive: () => false,
      isAvailable: () => true,
      isEnabled: () => true,
      keywords: action.keywords,
      label: action.label,
      run: (commandCtx) => action.run(commandCtx.editor),
      // Block insertion lives in the toolbar's "More" overflow, and is the body
      // of the slash menu and the block context menu.
      surfaces: { context: "primary", slash: "primary", toolbar: "more" },
    }),
  );
}

export function buildCommandRegistry(
  ctx: CommandContext,
): readonly EditorCommand[] {
  return [...STATIC_COMMANDS, ...insertCommands(ctx)];
}

// ---------------------------------------------------------------------------
// Selectors.
// ---------------------------------------------------------------------------

/** Available commands present on `surface` (optionally filtered by placement). */
export function surfaceCommands(
  ctx: CommandContext,
  surface: CommandSurface,
  placement?: CommandPlacement,
): readonly EditorCommand[] {
  return buildCommandRegistry(ctx).filter(
    (command) =>
      command.isAvailable(ctx) &&
      command.surfaces[surface] !== undefined &&
      (placement === undefined || command.surfaces[surface] === placement),
  );
}

export type CommandGroupSegment = {
  readonly group: CommandGroup;
  readonly commands: readonly EditorCommand[];
};

/** Surface commands bucketed by group in render order, dropping empty groups. */
export function groupedSurfaceCommands(
  ctx: CommandContext,
  surface: CommandSurface,
  placement?: CommandPlacement,
): readonly CommandGroupSegment[] {
  const commands = surfaceCommands(ctx, surface, placement);
  return COMMAND_GROUP_ORDER.map((group) => ({
    commands: commands.filter((command) => command.group === group),
    group,
  })).filter((segment) => segment.commands.length > 0);
}

export function slashCommands(ctx: CommandContext): readonly EditorCommand[] {
  return surfaceCommands(ctx, "slash");
}

export function contextCommands(ctx: CommandContext): readonly EditorCommand[] {
  return surfaceCommands(ctx, "context");
}

// ---------------------------------------------------------------------------
// Selection-state reader (consolidates the duplicated selection reads).
// ---------------------------------------------------------------------------

export type SelectionState = {
  readonly blockKind: BlockKind;
  readonly capability: BlockCapability;
  readonly activeFormats: ReadonlySet<TextFormatType>;
  readonly activeAlign: ElementFormatType;
  readonly hasSelectedText: boolean;
  readonly selectedText: string;
};

export const EMPTY_SELECTION_STATE: SelectionState = {
  activeAlign: "",
  activeFormats: new Set(),
  blockKind: "paragraph",
  capability: capabilityFor("paragraph"),
  hasSelectedText: false,
  selectedText: "",
};

/**
 * Read the selection-derived fields for a command context. Must run inside an
 * `editor.read` / `editorState.read`. Falls back to the empty paragraph state
 * when there is no range selection (e.g. a block widget holds focus).
 */
export function $readSelectionState(): SelectionState {
  const live = $getSelection();
  if (!$isRangeSelection(live)) return EMPTY_SELECTION_STATE;
  const selection = $clampRangeSelectionToText(live.clone());
  const selectedText = selection.getTextContent();
  const hasSelectedText =
    !selection.isCollapsed() && selectedText.trim().length > 0;
  const blockKind = selectionBlockKind(selection);
  const activeFormats = new Set(
    INLINE_TEXT_ACTIONS.filter(({ format }) => selection.hasFormat(format)).map(
      ({ format }) => format,
    ),
  );
  const anchor = selection.anchor.getNode();
  const element =
    anchor.getKey() === "root"
      ? anchor
      : (anchor.getTopLevelElement() ?? anchor);
  return {
    activeAlign: $isElementNode(element) ? element.getFormatType() : "",
    activeFormats,
    blockKind,
    capability: capabilityFor(blockKind),
    hasSelectedText,
    selectedText,
  };
}

/**
 * Build a full `CommandContext` from the live selection. Must run inside an
 * `editor.read` / `editorState.read`. `canFormat` defaults to "has selected text"
 * — the flyout/context menu only appear over a selection; the toolbar passes its
 * own focus-tracked flag instead.
 */
export function $readCommandContext(input: {
  readonly editor: LexicalEditor;
  readonly allowedNodes: readonly string[];
  readonly bindings: RichTextEditorBindings;
  readonly canFormat?: boolean;
  readonly canUndo?: boolean;
  readonly canRedo?: boolean;
}): CommandContext {
  const state = $readSelectionState();
  return {
    ...state,
    allowedNodes: input.allowedNodes,
    bindings: input.bindings,
    canFormat: input.canFormat ?? state.hasSelectedText,
    canRedo: input.canRedo ?? false,
    canUndo: input.canUndo ?? false,
    editor: input.editor,
  };
}
