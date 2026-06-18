import { Text } from "@quanghuy1242/idco-ui";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  BLUR_COMMAND,
  CAN_REDO_COMMAND,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_LOW,
  FOCUS_COMMAND,
  type ElementFormatType,
  type TextFormatType,
} from "lexical";
import {
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Toolbar as AriaToolbar } from "react-aria-components";
import { capabilityFor, type BlockKind } from "../model/capabilities";
import {
  $readSelectionState,
  availableBlockStyles,
  COMMAND_GROUP_ORDER,
  groupedSurfaceCommands,
  type CommandContext,
  type EditorCommand,
} from "../model/commands";
import { canUse } from "../model/schema";
import { RichTextEditorBindingsContext } from "../nodes";
import { BlockStyleControl } from "../toolbar/block-style-control";
import { CommandButtonGroup } from "../toolbar/command-button-group";
import { CommentButton } from "../toolbar/comment-button";
import { GlossaryButton } from "../toolbar/glossary-button";
import { LinkButton } from "../toolbar/link-button";
import { MoreMenu } from "../toolbar/more-menu";
import { ToolbarDivider } from "../toolbar/toolbar-button";
import { registerEditorUpdateListener } from "./editor-performance";

const editorControlSurfaceSelector = [
  "[data-editor-selection-flyout]",
  "[data-editor-selection-action-popover]",
  "[data-editor-context-menu]",
  "[data-editor-slash-menu]",
].join(",");

function isEditorControlTarget(
  target: EventTarget | null,
  toolbar: HTMLElement | null,
): boolean {
  if (!(target instanceof Node)) return false;
  if (toolbar?.contains(target)) return true;
  return (
    target instanceof Element &&
    Boolean(target.closest(editorControlSurfaceSelector))
  );
}

function sameFormatSet(
  a: ReadonlySet<TextFormatType>,
  b: ReadonlySet<TextFormatType>,
): boolean {
  if (a.size !== b.size) return false;
  for (const format of b) if (!a.has(format)) return false;
  return true;
}

// Memoized: the toolbar lives inside the controlled editor, which re-renders on
// every keystroke. Its props are stable, so memo keeps the React Aria
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
  const [activeFormats, setActiveFormats] = useState<
    ReadonlySet<TextFormatType>
  >(new Set());
  const [activeAlign, setActiveAlign] = useState<ElementFormatType>("");
  // Formatting targets the editable text; it does not apply while a block widget
  // (callout/code/media) holds focus, so the controls disable themselves there.
  const [canFormat, setCanFormat] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const refreshToolbar = useCallback(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    setCanFormat(true);
    const state = $readSelectionState();
    // Refreshed on every editor update (including each keystroke); bail out when
    // the active formats are unchanged so a fresh Set is not a new reference that
    // re-renders the whole toolbar on every edit.
    setActiveFormats((prev) =>
      sameFormatSet(prev, state.activeFormats) ? prev : state.activeFormats,
    );
    setBlockKind(state.blockKind);
    setActiveAlign(state.activeAlign);
  }, []);

  useEffect(
    () =>
      mergeRegister(
        registerEditorUpdateListener(
          editor,
          {
            budgetMs: 5,
            cost: "reads selection state and updates toolbar active/disabled affordances",
            frequency: "after editor updates while toolbar is mounted",
            label: "toolbar selection state",
            lane: "frame",
            priority: "high",
          },
          ({ editorState }) => editorState.read(refreshToolbar),
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
            if (!isEditorControlTarget(next, toolbarRef.current)) {
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
  const focusEditor = useCallback(() => editor.focus(), [editor]);
  // Menus steal focus to the trigger on close; refocus the editor next frame to win.
  const focusEditorAfterMenu = useCallback(
    () => requestAnimationFrame(() => editor.focus()),
    [editor],
  );

  const ctx = useMemo<CommandContext>(
    () => ({
      activeAlign,
      activeFormats,
      allowedNodes,
      bindings,
      blockKind,
      canFormat,
      canRedo,
      canUndo,
      capability: capabilityFor(blockKind),
      editor,
      hasSelectedText: false,
      selectedText: "",
    }),
    [
      activeAlign,
      activeFormats,
      allowedNodes,
      bindings,
      blockKind,
      canFormat,
      canRedo,
      canUndo,
      editor,
    ],
  );

  const runCommand = useCallback(
    (command: EditorCommand) => {
      command.run(ctx);
      focusEditor();
    },
    [ctx, focusEditor],
  );

  const runMoreCommand = useCallback(
    (command: EditorCommand) => {
      command.run(ctx);
      onMenuOpen(false);
      focusEditorAfterMenu();
    },
    [ctx, focusEditorAfterMenu, onMenuOpen],
  );

  const textAllowed = canUse("text", allowedNodes);
  const hasBlockStyles = availableBlockStyles(allowedNodes).length > 1;
  const primaryByGroup = new Map(
    groupedSurfaceCommands(ctx, "toolbar", "primary").map((segment) => [
      segment.group,
      segment.commands,
    ]),
  );
  const hasMore = groupedSurfaceCommands(ctx, "toolbar", "more").length > 0;

  // Build the inline segments in group order; widget-shaped groups (block style,
  // annotate) render their own controls, the rest render as button groups.
  const segments: { readonly key: string; readonly node: React.ReactNode }[] =
    [];
  for (const group of COMMAND_GROUP_ORDER) {
    if (group === "blockStyle") {
      if (hasBlockStyles) {
        segments.push({
          key: group,
          node: (
            <BlockStyleControl
              ctx={ctx}
              isDisabled={!canFormat}
              onApplied={focusEditorAfterMenu}
            />
          ),
        });
      }
    } else if (group === "annotate") {
      // Annotate controls operate on the live selection; show them whenever text
      // is allowed (each disables itself until the selection supports it).
      if (textAllowed) {
        segments.push({
          key: group,
          node: (
            <div className="flex items-center gap-1">
              <LinkButton isDisabled={!canFormat} />
              <GlossaryButton isDisabled={!canFormat} />
              <CommentButton isDisabled={!canFormat} />
            </div>
          ),
        });
      }
    } else {
      const commands = primaryByGroup.get(group);
      if (commands && commands.length > 0) {
        segments.push({
          key: group,
          node: (
            <CommandButtonGroup
              commands={commands}
              ctx={ctx}
              onRun={runCommand}
            />
          ),
        });
      }
    }
  }

  return (
    <AriaToolbar
      ref={toolbarRef}
      aria-label={`${label} formatting`}
      className="flex flex-wrap items-center gap-1 border-b border-base-300 bg-base-200 px-2 py-2"
    >
      {segments.map((segment, index) => (
        <Fragment key={segment.key}>
          {index > 0 ? <ToolbarDivider /> : null}
          {segment.node}
        </Fragment>
      ))}

      {hasMore ? (
        <>
          {segments.length > 0 ? <ToolbarDivider /> : null}
          <MoreMenu
            ctx={ctx}
            isOpen={menuOpen}
            label={label}
            onOpenChange={onMenuOpen}
            onRun={runMoreCommand}
          />
        </>
      ) : null}

      {!textAllowed ? (
        <Text variant="caption">Text nodes disabled by allowlist</Text>
      ) : null}
    </AriaToolbar>
  );
});
