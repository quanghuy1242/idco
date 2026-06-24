// DaisyUI 5: https://daisyui.com/components/menu/ + select

/**
 * The built-in `table-of-contents` node view (docs/016 §10, docs/020 §7.2).
 *
 * Unlike the legacy decorator (which read the whole Lexical state from inside the
 * node), this view is *scoped*: it never reaches across the document. It consumes
 * the whole-document heading rollup through the read-side SPI (`useDocumentIndex`),
 * which the bake worker computes off-thread in the editor and the reader builds
 * synchronously from its snapshot. The view's only job is *projection*: filter the
 * index's flat `toc` by the node's min/max level, compute nesting depth + optional
 * numbering, and render the list. Heading anchors come from `TocEntry.anchor`
 * (NodeId, or a pinned `attrs.anchorId`), the same id the heading element renders
 * (`headingAnchor`), so a `#${anchor}` link always lands.
 *
 * Placement:
 * - `inline` — the list renders in the flow.
 * - `aside`  — in the editor the list moves to a floating rail (`renderOverlay`,
 *   one per document, serving the first aside TOC) and the in-flow node is a
 *   compact marker; in the reader (no rail, no `revealNode`) the list stays inline
 *   so it is never lost.
 *
 * Settings (title, levels, numbering, style, placement, side) edit through the
 * node's `renderLive` popover (the chrome gear), committing `set-object-data`.
 */
import { useCallback, useEffect, useMemo } from "react";
import { Input, NavIcon } from "@quanghuy1242/idco-ui";
import {
  Button as AriaButton,
  Label as AriaLabel,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
  Select as AriaSelect,
  SelectValue as AriaSelectValue,
} from "react-aria-components";
import { type JsonValue, type NodeId, type TocEntry } from "../../core";
import { type NodeView, type NodeViewLiveArgs } from "../spi";
import { asRecord, currentObjectRecord, stringField } from "../object-data";
import { useDocumentIndex, useDocumentReveal } from "../document-index";

type TocNumbering = "none" | "decimal";
type TocStyle = "panel" | "plain" | "compact";

type TocSettings = {
  readonly title: string;
  readonly minLevel: number;
  readonly maxLevel: number;
  readonly numbering: TocNumbering;
  readonly style: TocStyle;
};

/** One projected, ready-to-render TOC item (depth + numbering applied). */
type TocItem = {
  readonly id: NodeId;
  readonly href: string;
  readonly text: string;
  readonly depth: number;
  readonly number?: string;
};

const numberField = (
  record: Record<string, JsonValue>,
  key: string,
  fallback: number,
): number => {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const clampLevel = (value: number): number =>
  Math.min(6, Math.max(1, Math.round(value)));

/**
 * Read a settings record into a normalized, clamped shape. Tolerates the legacy
 * `style: "default"` (→ panel) and keeps `minLevel <= maxLevel`. Title falls back
 * to a default only for *display*; the settings input reads the raw stored value
 * so an author can clear it.
 */
function normalizeTocSettings(record: Record<string, JsonValue>): TocSettings {
  const a = clampLevel(numberField(record, "minLevel", 1));
  const b = clampLevel(numberField(record, "maxLevel", 3));
  const style = stringField(record, "style");
  return {
    maxLevel: Math.max(a, b),
    minLevel: Math.min(a, b),
    numbering:
      stringField(record, "numbering") === "decimal" ? "decimal" : "none",
    style:
      style === "plain" ? "plain" : style === "compact" ? "compact" : "panel",
    title: stringField(record, "title") || "On this page",
  };
}

/**
 * Project the flat index TOC into a nested, optionally-numbered list filtered to
 * the configured level window. This is the per-document client-side projection the
 * legacy `processTocHeading` did, run over the index rollup instead of a tree walk
 * (docs §discussion): depth comes from a running level stack, the decimal number
 * from per-depth counters that reset when the stack pops past their depth.
 */
function projectTocEntries(
  toc: readonly TocEntry[],
  settings: TocSettings,
): TocItem[] {
  const stack: number[] = [];
  const counters: number[] = [];
  const items: TocItem[] = [];
  for (const entry of toc) {
    if (entry.level < settings.minLevel || entry.level > settings.maxLevel) {
      continue;
    }
    while (stack.length > 0 && (stack[stack.length - 1] ?? 0) >= entry.level) {
      stack.pop();
    }
    const depth = stack.length;
    stack.push(entry.level);
    // Truncating to depth+1 drops deeper counters, so a sibling at a shallower
    // depth restarts the deeper numbering at 1 the next time it descends.
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;
    items.push({
      depth,
      href: `#${entry.anchor}`,
      id: entry.id,
      number:
        settings.numbering === "decimal"
          ? counters.slice(0, depth + 1).join(".")
          : undefined,
      text: entry.text.trim() || "Untitled section",
    });
  }
  return items;
}

const STYLE_CLASS: Record<TocStyle, string> = {
  compact: "rounded-box bg-base-200/40 p-2 text-sm",
  panel: "rounded-box border border-base-300 bg-base-200/40 p-3",
  plain: "p-1",
};

/** The link list shared by the inline render, the reader render, and the rail. */
function TocList(props: {
  readonly entries: readonly TocItem[];
  readonly reveal: ((id: NodeId) => void) | undefined;
}) {
  const { entries, reveal } = props;
  if (entries.length === 0) {
    return (
      <div className="text-sm text-base-content/60">
        No headings to list yet.
      </div>
    );
  }
  return (
    <ul className="m-0 list-none p-0">
      {entries.map((item) => (
        <li
          key={item.id}
          style={{ paddingInlineStart: `${item.depth * 0.9}rem` }}
        >
          <a
            className="inline-flex gap-1 py-0.5 text-sm text-base-content/80 no-underline hover:text-base-content hover:underline"
            href={item.href}
            // In the editor, navigate through the engine so a windowed-out heading
            // is scrolled to (a plain `#hash` cannot reach an unmounted block); in
            // the reader (`reveal` undefined) the native fragment link works.
            onClick={
              reveal
                ? (event) => {
                    event.preventDefault();
                    reveal(item.id);
                  }
                : undefined
            }
          >
            {item.number ? (
              <span className="text-base-content/50">{item.number}</span>
            ) : null}
            <span>{item.text}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The resting render: live list from the index, projected by the node's settings. */
function TocRestingView(props: {
  readonly payload: Record<string, JsonValue>;
}) {
  const settings = normalizeTocSettings(props.payload);
  const index = useDocumentIndex();
  const reveal = useDocumentReveal();
  const entries = useMemo(
    () => projectTocEntries(index?.toc ?? [], settings),
    [index, settings.minLevel, settings.maxLevel, settings.numbering],
  );

  return (
    <nav
      aria-label={settings.title || "Table of contents"}
      className={STYLE_CLASS[settings.style]}
      data-engine-object-baked="table-of-contents"
    >
      {settings.title ? (
        <div className="mb-1 text-sm font-semibold text-base-content">
          {settings.title}
        </div>
      ) : null}
      <TocList entries={entries} reveal={reveal} />
    </nav>
  );
}

type TocOption<T extends string> = {
  readonly value: T;
  readonly label: string;
  readonly icon?: string;
};

type LevelValue = "1" | "2" | "3" | "4" | "5" | "6";

const levelOptions: readonly TocOption<LevelValue>[] = [
  { label: "H1", value: "1" },
  { label: "H2", value: "2" },
  { label: "H3", value: "3" },
  { label: "H4", value: "4" },
  { label: "H5", value: "5" },
  { label: "H6", value: "6" },
];
const numberingOptions: readonly TocOption<TocNumbering>[] = [
  { icon: "List", label: "Plain", value: "none" },
  { icon: "ListOrdered", label: "Numbered", value: "decimal" },
];
const styleOptions: readonly TocOption<TocStyle>[] = [
  { icon: "ScrollText", label: "Panel", value: "panel" },
  { icon: "List", label: "Plain", value: "plain" },
  { icon: "Rows3", label: "Compact", value: "compact" },
];

/** A small React Aria select styled with DaisyUI, ported from the legacy node. */
function TocSettingsSelect<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly TocOption<T>[];
  readonly onChange: (value: T) => void;
}) {
  const { label, value, options, onChange } = props;
  return (
    <AriaSelect
      aria-label={label}
      className="grid gap-1"
      onSelectionChange={(key) => onChange(String(key) as T)}
      selectedKey={value}
    >
      <AriaLabel className="text-xs font-medium text-base-content/70">
        {label}
      </AriaLabel>
      <AriaButton className="select select-sm select-bordered flex w-full items-center justify-between gap-2 bg-none">
        <span className="min-w-0 flex-1 truncate text-left">
          <AriaSelectValue />
        </span>
        <NavIcon name="ChevronDown" />
      </AriaButton>
      <AriaPopover className="z-50 w-(--trigger-width) overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-lg">
        <AriaListBox className="menu menu-sm max-h-60 w-full overflow-auto p-1">
          {options.map((option) => (
            <AriaListBoxItem
              className="cursor-pointer rounded px-2 py-1.5 text-sm outline-none data-[focused]:bg-base-200 data-[selected]:font-medium"
              id={option.value}
              key={option.value}
              textValue={option.label}
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

/** The settings popover (the gear's `renderLive`), committing `set-object-data`. */
function TocSettingsSurface(props: NodeViewLiveArgs) {
  const { node, store, registerObjectEditor } = props;
  const id = node.id;
  useEffect(() => {
    registerObjectEditor(id, true);
    return () => registerObjectEditor(id, false);
  }, [id, registerObjectEditor]);

  const record = asRecord(node.data);
  const settings = normalizeTocSettings(record);
  const rawTitle = stringField(record, "title");

  const patch = useCallback(
    (next: Record<string, JsonValue>) => {
      const current = currentObjectRecord(store, id);
      store.command({
        data: { ...current, ...next },
        node: id,
        type: "set-object-data",
      });
    },
    [id, store],
  );

  return (
    <div
      className="grid w-72 gap-3"
      data-engine-object-editor="table-of-contents"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-base-content">
        <NavIcon name="ScrollText" />
        Table of contents
      </div>
      <label className="grid gap-1">
        <span className="text-xs font-medium text-base-content/70">Title</span>
        <Input
          ariaLabel="Title"
          onChange={(title) => patch({ title })}
          size="sm"
          value={rawTitle}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <TocSettingsSelect
          label="Min level"
          onChange={(value) => {
            const minLevel = clampLevel(Number(value));
            patch({
              maxLevel: Math.max(minLevel, settings.maxLevel),
              minLevel,
            });
          }}
          options={levelOptions}
          value={String(settings.minLevel) as LevelValue}
        />
        <TocSettingsSelect
          label="Max level"
          onChange={(value) => {
            const maxLevel = clampLevel(Number(value));
            patch({
              maxLevel,
              minLevel: Math.min(settings.minLevel, maxLevel),
            });
          }}
          options={levelOptions}
          value={String(settings.maxLevel) as LevelValue}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <TocSettingsSelect
          label="Style"
          onChange={(style) => patch({ style })}
          options={styleOptions}
          value={settings.style}
        />
        <TocSettingsSelect
          label="Numbering"
          onChange={(numbering) => patch({ numbering })}
          options={numberingOptions}
          value={settings.numbering}
        />
      </div>
    </div>
  );
}

export const tableOfContentsView: NodeView = {
  ariaLabel: "Table of contents",
  chromeMeta: { icon: "ScrollText", label: "Contents" },
  insert: {
    createData: () => ({
      maxLevel: 3,
      minLevel: 1,
      numbering: "none",
      style: "panel",
      title: "On this page",
    }),
    group: "Blocks",
    icon: "ScrollText",
    keywords: ["toc", "contents", "outline", "headings"],
    label: "Table of contents",
  },
  liveMode: "popover",
  renderLive: (args) => <TocSettingsSurface {...args} />,
  renderResting: ({ baked }) => (
    <TocRestingView payload={asRecord(baked.payload)} />
  ),
  schemaGroup: "toc",
  type: "table-of-contents",
};
