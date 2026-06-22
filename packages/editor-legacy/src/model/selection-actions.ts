import { $isListNode } from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type Point,
  type RangeSelection,
  type TextFormatType,
} from "lexical";
import {
  capabilityFor,
  type BlockCapability,
  type BlockKind,
} from "./capabilities";
import { canUse } from "./schema";
import type { RichTextEditorBindings } from "../nodes";

export type InlineTextActionId =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "code";

export type TextSelectionActionId =
  | InlineTextActionId
  | "link"
  | "glossary"
  | "comment"
  | "indent"
  | "outdent";

export type TextSelectionContext = {
  readonly activeFormats: ReadonlySet<TextFormatType>;
  readonly blockKind: BlockKind;
  readonly canComment: boolean;
  readonly canFormatText: boolean;
  readonly canGlossary: boolean;
  readonly canIndent: boolean;
  readonly canLink: boolean;
  readonly capability: BlockCapability;
  readonly hasSelectedText: boolean;
  readonly selectedText: string;
};

export type TextSelectionAction = {
  readonly format?: TextFormatType;
  readonly group: "format" | "insert" | "layout";
  readonly icon: string;
  readonly id: TextSelectionActionId;
  readonly isActive: boolean;
  readonly isEnabled: boolean;
  readonly label: string;
};

export const INLINE_TEXT_ACTIONS: readonly {
  readonly format: TextFormatType;
  readonly icon: string;
  readonly id: InlineTextActionId;
  readonly label: string;
}[] = [
  { format: "bold", icon: "Bold", id: "bold", label: "Bold" },
  { format: "italic", icon: "Italic", id: "italic", label: "Italic" },
  {
    format: "underline",
    icon: "Underline",
    id: "underline",
    label: "Underline",
  },
  {
    format: "strikethrough",
    icon: "Strikethrough",
    id: "strikethrough",
    label: "Strikethrough",
  },
  { format: "code", icon: "Code", id: "code", label: "Inline code" },
];

export function selectionBlockKind(selection: RangeSelection): BlockKind {
  const anchor = selection.anchor.getNode();
  const element =
    anchor.getKey() === "root"
      ? anchor
      : (anchor.getTopLevelElement() ?? anchor);
  if ($isListNode(element)) {
    const listType = element.getListType();
    if (listType === "number") return "number";
    if (listType === "check") return "check";
    return "bullet";
  }
  if ($isHeadingNode(element)) return element.getTag();
  if ($isQuoteNode(element)) return "quote";
  return "paragraph";
}

/**
 * Resolve a range selection's *element* endpoints to text positions, clamping
 * each toward the other endpoint. A triple-click (or shift-select) that ends at
 * a block boundary next to a decorator node lands an endpoint as an element
 * point on the root — e.g. selecting the heading "Chapter one" that is followed
 * by a table-of-contents block yields `anchor: text@0 → focus: root@1`. Lexical
 * reports `getTextContent()` as "" for such a range (and its own
 * `$normalizeSelection` resolves *forward* into the decorator, then gives up),
 * so the selection looks empty even though real text is highlighted. Clamping
 * the element endpoint back to the adjacent text block makes text reads correct
 * and keeps format/comment ops on the intended text. Mutates and returns the
 * passed selection — call with a `.clone()`.
 */
export function $clampRangeSelectionToText(
  selection: RangeSelection,
): RangeSelection {
  const anchorFirst = selection.anchor.isBefore(selection.focus);
  // The end point clamps to a text *end*; the start point clamps to a text start.
  $clampPointToText(selection.anchor, !anchorFirst);
  $clampPointToText(selection.focus, anchorFirst);
  return selection;
}

function $clampPointToText(point: Point, toEnd: boolean): void {
  while (point.type === "element") {
    const node = point.getNode();
    if (!$isElementNode(node)) break;
    // For an end point at `root@offset`, the meaningful child is the one *before*
    // the offset (the block the selection actually covers); for a start point it
    // is the child *at* the offset.
    const child = toEnd
      ? node.getChildAtIndex(point.offset - 1)
      : node.getChildAtIndex(point.offset);
    if ($isTextNode(child)) {
      point.set(child.getKey(), toEnd ? child.getTextContentSize() : 0, "text");
      return;
    }
    if ($isElementNode(child)) {
      point.set(child.getKey(), toEnd ? child.getChildrenSize() : 0, "element");
      continue;
    }
    // child is a decorator / line-break / missing — cannot descend to text.
    break;
  }
}

export function readTextSelectionContext({
  allowedNodes,
  bindings,
}: {
  readonly allowedNodes: readonly string[];
  readonly bindings?: Pick<RichTextEditorBindings, "onComment">;
}): TextSelectionContext | null {
  const live = $getSelection();
  if (!$isRangeSelection(live)) return null;
  const selection = $clampRangeSelectionToText(live.clone());
  const selectedText = selection.getTextContent();
  const hasSelectedText =
    !selection.isCollapsed() && selectedText.trim().length > 0;
  const blockKind = selectionBlockKind(selection);
  const capability = capabilityFor(blockKind);
  const textAllowed = canUse("text", allowedNodes);
  const canFormatText = textAllowed && hasSelectedText;
  return {
    activeFormats: new Set(
      INLINE_TEXT_ACTIONS.filter(({ format }) =>
        selection.hasFormat(format),
      ).map(({ format }) => format),
    ),
    blockKind,
    canComment:
      canFormatText &&
      canUse("mark", allowedNodes) &&
      Boolean(bindings?.onComment),
    canFormatText,
    canGlossary: canFormatText && canUse("glossary", allowedNodes),
    canIndent: canFormatText && capability.canIndent,
    canLink: canFormatText && canUse("link", allowedNodes),
    capability,
    hasSelectedText,
    selectedText,
  };
}

export function textSelectionActions(
  context: TextSelectionContext | null,
): readonly TextSelectionAction[] {
  if (!context?.hasSelectedText) return [];
  const formatActions = INLINE_TEXT_ACTIONS.map(
    ({ format, icon, id, label }): TextSelectionAction => ({
      format,
      group: "format",
      icon,
      id,
      isActive: context.activeFormats.has(format),
      isEnabled:
        context.canFormatText && context.capability.inlineFormats.has(format),
      label,
    }),
  );
  const insertActions: readonly TextSelectionAction[] = [
    {
      group: "insert",
      icon: "Link",
      id: "link",
      isActive: false,
      isEnabled: context.canLink,
      label: "Link",
    },
    {
      group: "insert",
      icon: "BookA",
      id: "glossary",
      isActive: false,
      isEnabled: context.canGlossary,
      label: "Glossary term",
    },
    {
      group: "insert",
      icon: "MessageSquare",
      id: "comment",
      isActive: false,
      isEnabled: context.canComment,
      label: "Comment",
    },
  ];
  const layoutActions: readonly TextSelectionAction[] = [
    {
      group: "layout",
      icon: "IndentDecrease",
      id: "outdent",
      isActive: false,
      isEnabled: context.canIndent,
      label: "Outdent",
    },
    {
      group: "layout",
      icon: "IndentIncrease",
      id: "indent",
      isActive: false,
      isEnabled: context.canIndent,
      label: "Indent",
    },
  ];
  return [...formatActions, ...layoutActions, ...insertActions];
}

export function enabledTextSelectionActions(
  context: TextSelectionContext | null,
): readonly TextSelectionAction[] {
  return textSelectionActions(context).filter((action) => action.isEnabled);
}
