// DaisyUI 5: https://daisyui.com/components/input/

import {
  RichTextTableOfContents,
  NavIcon,
  type RichTextTableOfContentsStyle,
} from "@quanghuy1242/idco-ui";
import {
  collectRichTextTocEntries,
  normalizeTocSettings,
  type RichTextDocument,
  type RichTextTocNumbering,
  type RichTextTocPlacement,
  type RichTextTocSide,
  type RichTextTocStyle,
} from "@quanghuy1242/idco-lib";
import { useEffect, useMemo, useState } from "react";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Input as AriaInput,
  Label as AriaLabel,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
  TextField as AriaTextField,
} from "react-aria-components";
import {
  normalizeTableOfContentsNode,
  normalizeDocument,
} from "../model/normalize";
import type { RichTextEditorNode } from "../model/schema";
import { BlockShell } from "./base";
import { ChromeButton } from "./chrome";
import {
  defineDecoratorBlock,
  type DecoratorBlockProps,
} from "./decorator-block";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

type TocOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly icon?: string;
};

type TocLevelValue = "1" | "2" | "3" | "4" | "5" | "6";

const levelOptions: readonly TocOption<TocLevelValue>[] = [
  { label: "H1", value: "1" },
  { label: "H2", value: "2" },
  { label: "H3", value: "3" },
  { label: "H4", value: "4" },
  { label: "H5", value: "5" },
  { label: "H6", value: "6" },
];

const numberingOptions: readonly TocOption<RichTextTocNumbering>[] = [
  { icon: "List", label: "Plain", value: "none" },
  { icon: "ListOrdered", label: "Numbered", value: "decimal" },
];

const styleOptions: readonly TocOption<RichTextTocStyle>[] = [
  { icon: "ScrollText", label: "Panel", value: "panel" },
  { icon: "List", label: "Plain", value: "plain" },
  { icon: "Rows3", label: "Compact", value: "compact" },
];

const placementOptions: readonly TocOption<RichTextTocPlacement>[] = [
  { icon: "Pilcrow", label: "Inline", value: "inline" },
  { icon: "Columns3", label: "Side rail", value: "aside" },
];

const sideOptions: readonly TocOption<RichTextTocSide>[] = [
  { icon: "AlignLeft", label: "Left", value: "left" },
  { icon: "AlignRight", label: "Right", value: "right" },
];

export const TableOfContentsNode = defineDecoratorBlock({
  Editor: TableOfContentsEditor,
  normalize: normalizeTableOfContentsNode,
  type: "table-of-contents",
});

function TableOfContentsEditor({
  node,
  nodeKey,
  update: updateNode,
}: DecoratorBlockProps) {
  const [editor] = useLexicalComposerContext();
  const settings = normalizeTocSettings(node);
  const [document, setDocument] = useState<RichTextDocument>(() =>
    normalizeDocument(editor.getEditorState().toJSON()),
  );

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        setDocument(normalizeDocument(editorState.toJSON()));
      }),
    [editor],
  );

  const entries = useMemo(
    () => collectRichTextTocEntries(document, settings),
    [document, settings],
  );

  function updateMinLevel(value: TocLevelValue) {
    const minLevel = Number(value);
    updateNode({
      maxLevel: Math.max(minLevel, settings.maxLevel),
      minLevel,
    });
  }

  function updateMaxLevel(value: TocLevelValue) {
    const maxLevel = Number(value);
    updateNode({
      maxLevel,
      minLevel: Math.min(settings.minLevel, maxLevel),
    });
  }

  const settingsButton = (
    <TableOfContentsSettingsButton
      settings={settings}
      updateMaxLevel={updateMaxLevel}
      updateMinLevel={updateMinLevel}
      updateNode={updateNode}
    />
  );

  // When pinned to a side rail, the entries render in the shell-owned rail
  // outside the editable region (see TableOfContentsRailPlugin). In flow we keep
  // a compact placeholder so the node stays selectable, configurable, and
  // removable, and the author can see where it lives and switch it back inline.
  if (settings.placement === "aside") {
    return (
      <BlockShell
        icon="Columns3"
        label="Table of contents"
        nodeKey={nodeKey}
        actions={settingsButton}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-base-content/70">
          <span>
            Pinned to a sticky{" "}
            <span className="font-medium text-base-content">
              {settings.side}
            </span>{" "}
            side rail.
          </span>
          <button
            type="button"
            className="link link-primary"
            onClick={() => updateNode({ placement: "inline" })}
          >
            Show inline instead
          </button>
        </div>
      </BlockShell>
    );
  }

  return (
    <BlockShell
      icon="ScrollText"
      label="Table of contents"
      nodeKey={nodeKey}
      actions={settingsButton}
    >
      <RichTextTableOfContents
        entries={entries}
        style={settings.style as RichTextTableOfContentsStyle}
        title={settings.title}
      />
    </BlockShell>
  );
}

function TableOfContentsSettingsButton({
  settings,
  updateMaxLevel,
  updateMinLevel,
  updateNode,
}: {
  readonly settings: ReturnType<typeof normalizeTocSettings>;
  readonly updateMaxLevel: (value: TocLevelValue) => void;
  readonly updateMinLevel: (value: TocLevelValue) => void;
  readonly updateNode: (patch: Partial<RichTextEditorNode>) => void;
}) {
  return (
    <AriaDialogTrigger>
      <ChromeButton icon="Settings" label="Table of contents settings" />
      <AriaPopover
        placement="bottom end"
        offset={8}
        className="popover-panel z-[60] w-80 data-[entering]:animate-popover-in data-[exiting]:animate-popover-out"
      >
        <AriaDialog
          aria-label="Table of contents settings"
          className="grid gap-3 p-2 outline-none"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
            <NavIcon name="ScrollText" />
            Table of contents
          </div>
          <AriaTextField
            value={settings.title}
            onChange={(title) => updateNode({ title })}
            className="grid gap-1"
          >
            <AriaLabel className="text-xs font-medium text-base-content/70">
              Title
            </AriaLabel>
            <AriaInput className="input input-sm input-bordered w-full" />
          </AriaTextField>
          <div className="grid grid-cols-2 gap-2">
            <TocSettingsSelect
              label="Minimum heading level"
              value={String(settings.minLevel) as TocLevelValue}
              options={levelOptions}
              onChange={updateMinLevel}
            />
            <TocSettingsSelect
              label="Maximum heading level"
              value={String(settings.maxLevel) as TocLevelValue}
              options={levelOptions}
              onChange={updateMaxLevel}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TocSettingsSelect
              label="Numbering"
              value={settings.numbering}
              options={numberingOptions}
              onChange={(numbering) => updateNode({ numbering })}
            />
            <TocSettingsSelect
              label="Style"
              value={settings.style}
              options={styleOptions}
              onChange={(style) => updateNode({ style })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <TocSettingsSelect
              label="Placement"
              value={settings.placement}
              options={placementOptions}
              onChange={(placement) => updateNode({ placement })}
            />
            {settings.placement === "aside" ? (
              <TocSettingsSelect
                label="Rail side"
                value={settings.side}
                options={sideOptions}
                onChange={(side) => updateNode({ side })}
              />
            ) : null}
          </div>
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>
  );
}

function TocSettingsSelect<T extends string>({
  label,
  onChange,
  options,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: T) => void;
  readonly options: readonly TocOption<T>[];
  readonly value: T;
}) {
  return (
    <AriaSelect
      aria-label={label}
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key) as T)}
      className="grid gap-1"
    >
      <AriaLabel className="text-xs font-medium text-base-content/70">
        {label}
      </AriaLabel>
      <AriaButton className="select select-sm select-bordered flex w-full items-center gap-2 bg-none">
        <span className="min-w-0 flex-1 truncate text-left">
          <AriaSelectValue />
        </span>
        <NavIcon name="ChevronDown" variant="timeline" />
      </AriaButton>
      <AriaPopover className="z-[70] w-(--trigger-width) data-[entering]:animate-popover-in data-[exiting]:animate-popover-out">
        <AriaListBox className="menu menu-sm popover-panel max-h-60 w-full overflow-auto">
          {options.map((option) => (
            <AriaListBoxItem
              key={option.value}
              id={option.value}
              textValue={option.label}
              className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none hover:bg-base-200 data-[focused]:bg-base-200 data-[selected]:font-medium"
            >
              <span className="flex items-center gap-2">
                {option.icon ? <NavIcon name={option.icon} /> : null}
                {option.label}
              </span>
            </AriaListBoxItem>
          ))}
        </AriaListBox>
      </AriaPopover>
    </AriaSelect>
  );
}
