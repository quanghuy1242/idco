import {
  Menu,
  MenuItem,
  MenuTrigger,
  NavIcon,
  Text,
} from "@quanghuy1242/idco-ui";
import {
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import {
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  INSERT_TABLE_COMMAND,
} from "@lexical/table";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  BLUR_COMMAND,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  FORMAT_ELEMENT_COMMAND,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
  type ElementFormatType,
  type TextFormatType,
} from "lexical";
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Button as AriaButton,
  Toolbar as AriaToolbar,
} from "react-aria-components";
import { capabilityFor, type BlockKind } from "../model/capabilities";
import { paragraphNode } from "../model/normalize";
import { canUse, type RichTextEditorNode } from "../model/schema";
import {
  INSERT_RICH_TEXT_NODE_COMMAND,
  RichTextEditorBindingsContext,
} from "../nodes";
import { CommentButton } from "../toolbar/comment-button";
import { GlossaryButton } from "../toolbar/glossary-button";
import { LinkButton } from "../toolbar/link-button";
import { ToolbarButton, ToolbarDivider } from "../toolbar/toolbar-button";

const blockStyleOptions: readonly {
  readonly id: "paragraph" | HeadingTagType | "quote";
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

const inlineFormats: readonly {
  readonly format: TextFormatType;
  readonly icon: string;
  readonly label: string;
}[] = [
  { format: "bold", icon: "Bold", label: "Bold" },
  { format: "italic", icon: "Italic", label: "Italic" },
  { format: "underline", icon: "Underline", label: "Underline" },
  { format: "strikethrough", icon: "Strikethrough", label: "Strikethrough" },
  { format: "code", icon: "Code", label: "Inline code" },
];

const alignmentOptions: readonly {
  readonly value: Exclude<ElementFormatType, "" | "start" | "end">;
  readonly icon: string;
  readonly label: string;
}[] = [
  { icon: "AlignLeft", label: "Align left", value: "left" },
  { icon: "AlignCenter", label: "Align center", value: "center" },
  { icon: "AlignRight", label: "Align right", value: "right" },
  { icon: "AlignJustify", label: "Justify", value: "justify" },
];

export const starterNodes: readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly node: RichTextEditorNode;
}[] = [
  {
    icon: "Pilcrow",
    id: "paragraph",
    label: "Paragraph",
    node: paragraphNode(""),
  },
  {
    icon: "Heading2",
    id: "heading",
    label: "Heading",
    node: {
      children: [{ text: "Heading", type: "text" }],
      tag: "h2",
      type: "heading",
    },
  },
  {
    icon: "Info",
    id: "callout",
    label: "Callout",
    node: {
      children: [{ text: "Callout", type: "text" }],
      tone: "info",
      type: "callout",
    },
  },
  {
    icon: "Code",
    id: "code-block",
    label: "Code",
    node: {
      language: "ts",
      text: "const value = true;",
      type: "code-block",
    },
  },
  {
    icon: "Globe",
    id: "embed",
    label: "Embed",
    node: { type: "embed", url: "https://example.com" },
  },
  {
    icon: "Image",
    id: "media",
    label: "Media",
    node: { alt: "", caption: "", mediaId: "", type: "media" },
  },
  {
    icon: "Link2",
    id: "post-ref",
    label: "Post Ref",
    node: { postId: "", title: "Referenced post", type: "post-ref" },
  },
];

export function canInsertStarterNode(
  item: (typeof starterNodes)[number],
  bindings: {
    readonly mediaLibrary?: unknown;
    readonly onUploadMedia?: unknown;
    readonly postLibrary?: unknown;
  },
): boolean {
  if (item.node.type === "media") {
    return Boolean(bindings.mediaLibrary || bindings.onUploadMedia);
  }
  if (item.node.type === "post-ref") {
    return Boolean(bindings.postLibrary);
  }
  return true;
}

// Memoized: the toolbar lives inside the controlled editor, which re-renders on
// every keystroke. Its props are stable, so memo keeps the 20+ React Aria
// buttons/tooltips from reconciling on each edit; it still updates itself from
// its own selection listener when the active block/format actually changes.
export const LexicalToolbar = memo(function LexicalToolbar({
  allowedNodes,
  label,
  menuOpen,
  onMenuOpen,
}: {
  readonly allowedNodes: readonly string[];
  readonly label: string;
  readonly menuOpen: boolean;
  readonly onMenuOpen: (open: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const bindings = useContext(RichTextEditorBindingsContext);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [blockKind, setBlockKind] = useState<BlockKind>("paragraph");
  const [activeFormats, setActiveFormats] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [activeAlign, setActiveAlign] = useState<ElementFormatType>("");
  // Formatting targets the editable text; it does not apply while a block widget
  // (callout/code/media) holds focus, so the controls disable themselves there.
  const [canFormat, setCanFormat] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [inTable, setInTable] = useState(false);

  const refreshToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    setInTable(
      $getTableCellNodeFromLexicalNode(selection.anchor.getNode()) !== null,
    );
    // Refreshed on every editor update (including each keystroke), so bail out
    // when the active formats are unchanged — a fresh Set would otherwise be a
    // new reference and re-render the whole toolbar on every edit.
    const nextFormats = inlineFormats
      .filter(({ format }) => selection.hasFormat(format))
      .map(({ format }) => format);
    setActiveFormats((prev) =>
      prev.size === nextFormats.length && nextFormats.every((f) => prev.has(f))
        ? prev
        : new Set(nextFormats),
    );
    const anchor = selection.anchor.getNode();
    const element =
      anchor.getKey() === "root"
        ? anchor
        : (anchor.getTopLevelElement() ?? anchor);
    if ($isListNode(element)) {
      const listType = element.getListType();
      setBlockKind(
        listType === "number"
          ? "number"
          : listType === "check"
            ? "check"
            : "bullet",
      );
    } else if ($isHeadingNode(element)) {
      setBlockKind(element.getTag());
    } else if ($isQuoteNode(element)) {
      setBlockKind("quote");
    } else {
      setBlockKind("paragraph");
    }
    setActiveAlign($isElementNode(element) ? element.getFormatType() : "");
  }, []);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) =>
          editorState.read(refreshToolbar),
        ),
        editor.registerCommand(
          FOCUS_COMMAND,
          () => {
            setCanFormat(true);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          BLUR_COMMAND,
          (event) => {
            // Keep controls enabled when focus moves to the toolbar itself
            // (clicking a format button), but disable them for block widgets.
            const next = event.relatedTarget;
            if (
              !(next instanceof Node) ||
              !toolbarRef.current?.contains(next)
            ) {
              setCanFormat(false);
            }
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_UNDO_COMMAND,
          (payload) => {
            setCanUndo(payload);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
        editor.registerCommand(
          CAN_REDO_COMMAND,
          (payload) => {
            setCanRedo(payload);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor, refreshToolbar],
  );

  // Return focus to the editor after a toolbar action so the caret/selection survives.
  const focusEditor = () => editor.focus();
  // Menus steal focus to the trigger on close; refocus the editor on the next frame to win.
  const focusEditorAfterMenu = () =>
    requestAnimationFrame(() => editor.focus());

  const applyFormat = (format: TextFormatType) => {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    focusEditor();
  };

  const applyAlignment = (value: ElementFormatType) => {
    editor.dispatchCommand(FORMAT_ELEMENT_COMMAND, value);
    focusEditor();
  };

  const applyHistory = (command: typeof UNDO_COMMAND | typeof REDO_COMMAND) => {
    editor.dispatchCommand(command, undefined);
    focusEditor();
  };

  const applyBlockStyle = (id: "paragraph" | HeadingTagType | "quote") => {
    // Exiting a list needs the list command; $setBlocksType alone leaves orphan list wrappers.
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
        $setBlocksType(selection, () => $createHeadingNode(id));
      }
    });
    setStyleOpen(false);
    focusEditorAfterMenu();
  };

  const toggleList = (kind: "bullet" | "number") => {
    if (blockKind === kind) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(
        kind === "bullet"
          ? INSERT_UNORDERED_LIST_COMMAND
          : INSERT_ORDERED_LIST_COMMAND,
        undefined,
      );
    }
    focusEditor();
  };

  const toggleChecklist = () => {
    // Toggle off when already a check list; otherwise REMOVE_LIST first so a
    // bullet/numbered list converts cleanly instead of nesting.
    if (blockKind === "check") {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    } else {
      editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
    }
    focusEditor();
  };

  const insertNode = (node: RichTextEditorNode) => {
    editor.dispatchCommand(INSERT_RICH_TEXT_NODE_COMMAND, node);
    onMenuOpen(false);
    focusEditorAfterMenu();
  };

  const insertTable = () => {
    editor.dispatchCommand(INSERT_TABLE_COMMAND, {
      columns: "3",
      includeHeaders: true,
      rows: "3",
    });
    onMenuOpen(false);
    focusEditorAfterMenu();
  };

  const runTableAction = (action: () => void) => {
    editor.update(action);
    focusEditor();
  };

  const capability = capabilityFor(blockKind);
  const textAllowed = canUse("text", allowedNodes);
  const styleChoices = blockStyleOptions.filter(
    (option) =>
      option.id === "paragraph" ||
      (option.node === "heading" && canUse("heading", allowedNodes)) ||
      (option.node === "quote" && canUse("quote", allowedNodes)),
  );
  const currentStyle =
    styleChoices.find((option) => option.id === blockKind) ?? styleChoices[0];
  const menuItems = starterNodes.filter(
    (item) =>
      canUse(item.node.type, allowedNodes) &&
      canInsertStarterNode(item, bindings),
  );

  return (
    <AriaToolbar
      ref={toolbarRef}
      aria-label={`${label} formatting`}
      className="flex flex-wrap items-center gap-1 border-b border-base-300 bg-base-200 px-2 py-2"
    >
      <div className="flex items-center gap-1">
        <ToolbarButton
          icon="Undo2"
          label="Undo"
          isDisabled={!canUndo}
          onPress={() => applyHistory(UNDO_COMMAND)}
        />
        <ToolbarButton
          icon="Redo2"
          label="Redo"
          isDisabled={!canRedo}
          onPress={() => applyHistory(REDO_COMMAND)}
        />
      </div>

      <ToolbarDivider />

      {styleChoices.length > 1 ? (
        <MenuTrigger
          isOpen={styleOpen}
          onOpenChange={setStyleOpen}
          placement="bottom start"
        >
          <AriaButton
            aria-label="Text style"
            isDisabled={!canFormat}
            className="btn btn-sm btn-ghost w-40 justify-start gap-2"
          >
            <NavIcon name={currentStyle.icon} />
            <span className="flex-1 truncate text-left">
              {currentStyle.label}
            </span>
            <NavIcon name="ChevronDown" />
          </AriaButton>
          <Menu aria-label="Text style" className="w-56">
            {styleChoices.map((option) => (
              <MenuItem
                key={option.id}
                id={option.id}
                textValue={option.label}
                onAction={() => applyBlockStyle(option.id)}
              >
                <span className="flex items-center gap-3">
                  <NavIcon name={option.icon} />
                  <span className={`leading-tight ${option.preview}`}>
                    {option.label}
                  </span>
                </span>
              </MenuItem>
            ))}
          </Menu>
        </MenuTrigger>
      ) : null}

      {textAllowed ? (
        <>
          <ToolbarDivider />
          <div className="flex items-center gap-1">
            {inlineFormats.map(({ format, icon, label: formatLabel }) => (
              <ToolbarButton
                key={format}
                icon={icon}
                label={formatLabel}
                isActive={activeFormats.has(format)}
                isDisabled={!canFormat || !capability.inlineFormats.has(format)}
                onPress={() => applyFormat(format)}
              />
            ))}
          </div>
        </>
      ) : null}

      {textAllowed ? (
        <>
          <ToolbarDivider />
          <div className="flex items-center gap-1">
            {alignmentOptions.map(({ value, icon, label: alignLabel }) => (
              <ToolbarButton
                key={value}
                icon={icon}
                label={alignLabel}
                isActive={activeAlign === value}
                isDisabled={!canFormat || !capability.canAlign}
                onPress={() => applyAlignment(value)}
              />
            ))}
          </div>
        </>
      ) : null}

      {canUse("list", allowedNodes) ? (
        <>
          <ToolbarDivider />
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon="List"
              label="Bullet list"
              isActive={blockKind === "bullet"}
              isDisabled={!canFormat}
              onPress={() => toggleList("bullet")}
            />
            <ToolbarButton
              icon="ListOrdered"
              label="Numbered list"
              isActive={blockKind === "number"}
              isDisabled={!canFormat}
              onPress={() => toggleList("number")}
            />
            <ToolbarButton
              icon="ListChecks"
              label="Check list"
              isActive={blockKind === "check"}
              isDisabled={!canFormat}
              onPress={toggleChecklist}
            />
          </div>
        </>
      ) : null}

      {textAllowed ? (
        <>
          <ToolbarDivider />
          <div className="flex items-center gap-1">
            <LinkButton isDisabled={!canFormat} />
            <GlossaryButton isDisabled={!canFormat} />
            <CommentButton isDisabled={!canFormat} />
          </div>
        </>
      ) : null}

      {inTable ? (
        <>
          <ToolbarDivider />
          {/* Row/column inserts are hover affordances on the table itself
              (TableControlsPlugin); the toolbar keeps only the deletes. */}
          <div className="flex items-center gap-1">
            <ToolbarButton
              icon="Minus"
              label="Delete row"
              onPress={() => runTableAction($deleteTableRowAtSelection)}
            />
            <ToolbarButton
              icon="Trash2"
              label="Delete column"
              onPress={() => runTableAction($deleteTableColumnAtSelection)}
            />
          </div>
        </>
      ) : null}

      {menuItems.length > 0 || canUse("table", allowedNodes) ? (
        <>
          <ToolbarDivider />
          <MenuTrigger
            isOpen={menuOpen}
            onOpenChange={onMenuOpen}
            placement="bottom start"
          >
            <AriaButton
              aria-label="Insert block"
              className={`btn btn-sm gap-1.5 ${menuOpen ? "btn-primary" : "btn-ghost"}`}
            >
              <NavIcon name="Plus" />
              <span>Insert</span>
            </AriaButton>
            <Menu aria-label={`${label} insert block`} className="w-56">
              {menuItems.map((item) => (
                <MenuItem
                  key={item.id}
                  id={item.id}
                  textValue={item.label}
                  onAction={() => insertNode(item.node)}
                >
                  <span className="flex items-center gap-2.5">
                    <NavIcon name={item.icon} />
                    {item.label}
                  </span>
                </MenuItem>
              ))}
              {canUse("table", allowedNodes) ? (
                <MenuItem id="table" textValue="Table" onAction={insertTable}>
                  <span className="flex items-center gap-2.5">
                    <NavIcon name="Table" />
                    Table
                  </span>
                </MenuItem>
              ) : null}
            </Menu>
          </MenuTrigger>
        </>
      ) : null}

      {!textAllowed ? (
        <Text variant="caption">Text nodes disabled by allowlist</Text>
      ) : null}
    </AriaToolbar>
  );
});
