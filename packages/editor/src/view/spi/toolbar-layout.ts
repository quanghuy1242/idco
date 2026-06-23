/**
 * View-layer toolbar layout — Layer 2 of the toolbar SPI (docs/023 §5.1/§5.5).
 *
 * Layer 1 is the descriptor registries (marks, block types, node inserts, and the
 * `command-registry`); Layer 3 is the `EditorToolbar` renderer. This file is
 * the layer between: the *product surface*. It owns
 *
 * - the tab / slot model (`ToolbarTab`, `ToolbarSlot`) and their registries, so a
 *   host adds a tab or a group by registration, not by editing the renderer;
 * - the placement model (`ToolbarItem`) that maps registry descriptors into slots;
 * - `computeToolbarLayout`, a **pure, DOM-free** function (docs/023 §5.5) that
 *   resolves tabs → slots → items against the registries and the live context,
 *   applies capability gating, drops empty slots/tabs, and returns a fully ordered
 *   structure the renderer walks blind.
 *
 * The hard rule (docs/023 §5.1): the renderer holds zero command/layout knowledge;
 * all of it flows as data from here. That is what makes the toolbar pluggable.
 *
 * Placement model note (docs/023 §5.2/§5.4/§6.1): a `Command` declares its
 * own home `slot` (it exists only as a toolbar control, so it has an obvious home),
 * while marks / block-types / inserts — which exist independent of the toolbar — are
 * placed by `ToolbarItem` entries in the layout config. An explicit `action`
 * `ToolbarItem` may still re-place a registered action into a different slot; when
 * it does, that placement wins and the action is not also drawn from its own slot
 * (so a host can rearrange a built-in without it appearing twice).
 *
 * `computeToolbarLayout` stays orchestrator-internal (deep-imported by the renderer
 * and tests), mirroring `listOverlayStructuralViews`/`listTabHandlers` (note.md
 * W1/VP6); the registration functions and descriptor types are the host API
 * (docs/023 §5.8).
 */
import type { ReactNode } from "react";
import type { EditorStore, TextMarkKind } from "../../core";
import { getMark, listMarks, type MarkDefinition } from "./mark-registry";
import { listInsertableStructuralNodes } from "./structural-view";
import {
  getNodeView,
  listInsertableNodes,
  type NodeViewResourceConfigField,
} from "./node-view";
import { getDataSource } from "./data-source-registry";
import {
  commandTargetsSurface,
  getCommand,
  listCommands,
  type Command,
  type CommandContext,
} from "./command-registry";

/**
 * A toolbar tab — the top-level task grouping (docs/023 §5.4). Tabs render in
 * registration order (the registry is insertion-ordered): a host's tab appears
 * after the built-ins because it registers later — no explicit order number.
 */
export type ToolbarTab = {
  readonly id: string;
  readonly label: string;
  /** Hidden entirely when this returns false (e.g. no AI provider). */
  isAvailable?(ctx: CommandContext): boolean;
};

/**
 * A slot — a labelled group of controls (docs/023 §5.4). Usually bound to a tab
 * (`tab`), so it shows only when that tab is active. A `persistent` slot is instead
 * tab-independent and always visible, rendered in the tab strip (not the active
 * tab's command row): the global "quick access" zone for document-wide controls —
 * undo/redo (`"start"`, left of the tabs, the QAT position) and find (`"end"`, the
 * right). This is the SPI analogue of the Microsoft Quick Access Toolbar: a control
 * that applies regardless of the current task does not belong to a task tab.
 */
export type ToolbarSlot = {
  /** Dotted id "tab.group", e.g. "home.text", "insert.tables", "global.history". */
  readonly id: string;
  /** The tab this slot belongs to; omit for a `persistent` slot. */
  readonly tab?: string;
  /** Render this slot in the persistent tab-strip zone (left/right), not a tab. */
  readonly persistent?: "start" | "end";
  /** Optional group label for dense/mobile presentation. */
  readonly label?: string;
  /**
   * How this slot's controls present (note.md "Decision: the knob lives on the slot").
   * `"icon"` (default) is the dense icon-only run with hover tooltips; `"labelled"`
   * renders icon + text statically; `"auto"` renders labelled and, under desktop width
   * pressure, collapses its lowest-priority collapsible controls into a trailing
   * overflow menu (mobile falls back to horizontal scroll). The renderer reads this
   * blind — a host flips one group from `icon` to `auto` without touching the renderer.
   */
  readonly display?: "icon" | "labelled" | "auto";
};

/**
 * A placement that maps a registry source into a slot (docs/023 §5.4). The layout
 * walks these. `mark` places one format mark; `marks` auto-expands the whole
 * toolbar-mark group from the registry (so registering a new toolbar mark makes it
 * appear with no config edit — preserving the pre-SPI auto-projection contract);
 * `blockType` is the single chooser control; `insert` projects one node's insert
 * affordance; `action` re-places a registered action; `component` is the escape
 * hatch for arbitrary host React when no descriptor kind fits.
 */
export type ToolbarItem =
  | {
      readonly kind: "mark";
      readonly markKind: TextMarkKind;
      readonly slot: string;
    }
  | { readonly kind: "marks"; readonly slot: string }
  | {
      readonly kind: "blockType";
      readonly slot: string;
    }
  | {
      readonly kind: "insert";
      readonly nodeType: string;
      readonly slot: string;
    }
  | {
      // Auto-expand every registered insertable (structural + object) as individual
      // insert controls, excluding any node types already placed elsewhere (e.g. the
      // table, which has its own dimension-picker action). Like `marks`, this keeps
      // the pre-SPI auto-projection contract: registering a node makes it appear in
      // Insert with no config edit (docs/023 §5.4 — the generic insert projection).
      readonly kind: "inserts";
      readonly slot: string;
      readonly exclude?: readonly string[];
    }
  | {
      readonly kind: "action";
      readonly actionId: string;
      readonly slot: string;
    }
  | {
      readonly kind: "component";
      readonly id: string;
      readonly slot: string;
      render(ctx: CommandContext): ReactNode;
    };

/**
 * The arrangement of non-action placements plus optional hidden ids (docs/023
 * §6.3). Tabs and slots come from their registries; this config carries the item
 * placements (the marks group, the block-type chooser, any host component) and a
 * `hiddenIds` set a host uses to drop a built-in tab/slot/action/item by id. A host
 * supplies a replacement config through the `EditorToolbar.layout` prop; omitting it
 * uses `DEFAULT_TOOLBAR_LAYOUT` so zero-config consumers get the designed surface.
 */
export type ToolbarLayoutConfig = {
  readonly items: readonly ToolbarItem[];
  /** Ids (tab/slot/action/item) to remove from the resolved layout. */
  readonly hiddenIds?: readonly string[];
  /** Preferred initial tab; falls back to the first resolved tab. */
  readonly defaultTab?: string;
};

// --- Tab + slot registries (the host extension surface, docs/023 §5.8) ---------

const TABS = new Map<string, ToolbarTab>();
const SLOTS = new Map<string, ToolbarSlot>();

/** Register a toolbar tab. Idempotent by id. */
export function registerToolbarTab(tab: ToolbarTab): void {
  TABS.set(tab.id, tab);
}

/** Every registered tab, in registration order. */
export function listToolbarTabs(): readonly ToolbarTab[] {
  return [...TABS.values()];
}

/** Remove a registered tab (host teardown / test cleanup). */
export function unregisterToolbarTab(id: string): void {
  TABS.delete(id);
}

/** Register a toolbar slot. Idempotent by id. */
export function registerToolbarSlot(slot: ToolbarSlot): void {
  SLOTS.set(slot.id, slot);
}

/** Every registered slot, in registration order. */
export function listToolbarSlots(): readonly ToolbarSlot[] {
  return [...SLOTS.values()];
}

/** Remove a registered slot (host teardown / test cleanup). */
export function unregisterToolbarSlot(id: string): void {
  SLOTS.delete(id);
}

// --- Resolved layout (what the renderer consumes) -----------------------------

/**
 * One normalized item ready to render (docs/023 §5.5). The renderer switches on
 * `kind` and never reaches back into a registry: `mark` carries the resolved
 * definition + live `active`; `blockType` signals the chooser (which reads the
 * block-type registry + current selection itself); `insert` carries a normalized
 * dispatch; `action` carries the action + live `active`/`disabled`; `component`
 * carries its render. `priority` drives responsive collapse order (docs/023 §6.4).
 */
type ResolvedItemBase = {
  /** Responsive-collapse rank (lower collapses sooner, docs/023 §6.4); not a sort key. */
  readonly priority: number;
  /**
   * How this item behaves when its `auto` slot runs out of room (note.md §b — derived
   * per kind, pure + testable, not host config). `"menu-item"` collapses cleanly into a
   * flat overflow `MenuItem` (mark / insert / button action). `"keep-inline"` never
   * leaves the row — a popover/dropdown trigger (a popover-inside-a-menu is awkward),
   * the wide block-type chooser, or an opaque host `component` that cannot become a
   * MenuItem; it always reserves its inline width. `"submenu"` is reserved for a future
   * popover-as-submenu collapse and is not emitted yet.
   */
  readonly collapsible: "menu-item" | "keep-inline" | "submenu";
};

export type ResolvedToolbarItem =
  | (ResolvedItemBase & {
      readonly kind: "mark";
      readonly id: string;
      readonly mark: MarkDefinition;
      readonly active: boolean;
      readonly disabled: boolean;
    })
  | (ResolvedItemBase & {
      readonly kind: "blockType";
      readonly id: string;
      readonly disabled: boolean;
    })
  | (ResolvedItemBase & {
      readonly kind: "insert";
      readonly id: string;
      readonly label: string;
      readonly icon: string;
      readonly disabled: boolean;
      run(store: EditorStore): void;
    })
  | (ResolvedItemBase & {
      readonly kind: "action";
      readonly id: string;
      readonly action: Command;
      readonly active: boolean;
      readonly disabled: boolean;
    })
  | (ResolvedItemBase & {
      readonly kind: "component";
      readonly id: string;
      render(ctx: CommandContext): ReactNode;
    });

export type ResolvedToolbarSlot = {
  readonly id: string;
  readonly label?: string;
  /** Carried from `ToolbarSlot.display` (default "icon") so the renderer reads it blind. */
  readonly display: "icon" | "labelled" | "auto";
  readonly items: readonly ResolvedToolbarItem[];
};

export type ResolvedToolbarTab = {
  readonly id: string;
  readonly label: string;
  readonly slots: readonly ResolvedToolbarSlot[];
};

export type ResolvedToolbarLayout = {
  readonly tabs: readonly ResolvedToolbarTab[];
  readonly defaultTab: string;
  /**
   * Persistent (tab-independent) slots rendered in the tab strip, always visible:
   * `start` left of the tabs (the QAT — undo/redo), `end` to the right (find). The
   * renderer paints these around the tab strip, never in the active tab's command
   * row (docs/023 §7.1).
   */
  readonly persistentStart: readonly ResolvedToolbarSlot[];
  readonly persistentEnd: readonly ResolvedToolbarSlot[];
};

/** A stable id for a config item, used for ordering ties and `hiddenIds`. */
function itemId(item: ToolbarItem): string {
  switch (item.kind) {
    case "mark":
      return `mark:${item.markKind}`;
    case "marks":
      return "marks";
    case "blockType":
      return "blockType";
    case "insert":
      return `insert:${item.nodeType}`;
    case "inserts":
      return "inserts";
    case "action":
      return item.actionId;
    case "component":
      return item.id;
  }
}

/** Normalize one registered insert (structural or object) into a dispatch + label. */
function resolveInsert(
  nodeType: string,
): { label: string; icon: string; run: (store: EditorStore) => void } | null {
  const structural = listInsertableStructuralNodes().find(
    (view) => view.type === nodeType,
  );
  if (structural) {
    return {
      icon: structural.insert.icon ?? "Plus",
      label: structural.insert.label,
      run: (store) => store.command(structural.insert.createCommand()),
    };
  }
  const object = listInsertableNodes().find((view) => view.type === nodeType);
  if (object && getNodeView(nodeType)) {
    const resourceField = object.configFields?.find(
      (field): field is NodeViewResourceConfigField =>
        field.kind === "resource",
    );
    // Provenance gating (docs/026 §9): a reference block whose source is not
    // registered is hidden from the ribbon insert too (a null action is skipped).
    if (resourceField && !getDataSource(resourceField.source)) return null;
    return {
      icon: object.insert.icon ?? "Plus",
      label: object.insert.label,
      run: (store) => {
        store.command({
          data: object.insert.createData(),
          objectType: object.type,
          type: "insert-object",
        });
        // Choose-first (docs/026 §7.1): open the picker, roll back on cancel.
        if (resourceField) {
          const sel = store.selection;
          if (sel?.type === "node") store.beginProvisionalInsert(sel.node);
        }
      },
    };
  }
  return null;
}

/** Resolve a registered action into its render-ready item, or null if unavailable. */
function resolveAction(
  action: Command,
  ctx: CommandContext,
): ResolvedToolbarItem | null {
  // Provenance gates availability (docs/023 §4.9): an unavailable action is removed
  // from the layout entirely, so an empty slot/tab around it can be dropped.
  if (action.isAvailable && !action.isAvailable(ctx)) return null;
  if (!commandTargetsSurface(action, "ribbon")) return null;
  return {
    action,
    active: action.isActive?.(ctx) ?? false,
    // A popover/dropdown action keeps its trigger inline (a popover nested in a menu is
    // awkward, note.md §b); a plain toggle/button action collapses to a flat MenuItem.
    collapsible:
      action.kind === "popover" || action.kind === "dropdown"
        ? "keep-inline"
        : "menu-item",
    disabled: action.isDisabled?.(ctx) ?? false,
    id: action.id,
    kind: "action",
    priority: action.responsivePriority ?? 0,
  };
}

/**
 * Whether inline format marks have anything to apply to (note.md §2 — the `disabled`
 * field was plumbed but hardcoded false). A mark / the block-type chooser is greyed
 * when the selection is not on a text leaf (`blockType === null`, e.g. an object is
 * selected), so the control reflects the selection instead of looking live with no
 * effect. Code-block-specific gating is a deliberate follow-up, not done here.
 */
function textControlsDisabled(ctx: CommandContext): boolean {
  return ctx.selection.blockType === null;
}

/** Resolve one config item against the registries + context; null drops it. */
function resolveConfigItem(
  item: ToolbarItem,
  ctx: CommandContext,
): ResolvedToolbarItem[] {
  // Config items carry no responsive priority (priority 0), unlike actions which
  // set their own `responsivePriority`. In-slot position is registration/array
  // order (no explicit sort key), so a host appends by registering later.
  switch (item.kind) {
    case "mark": {
      const mark = getMark(item.markKind);
      if (!mark?.toolbar) return [];
      return [
        {
          active:
            ctx.store.query({ mark: item.markKind, type: "is-mark-active" }) ===
            true,
          collapsible: "menu-item",
          disabled: textControlsDisabled(ctx),
          id: `mark:${item.markKind}`,
          kind: "mark",
          mark,
          priority: 0,
        },
      ];
    }
    case "marks":
      // Auto-expand the whole toolbar-mark group from the registry, in registration
      // order (equal `order` + a stable sort preserves it), so a host that registers
      // a new toolbar mark sees it appear with no config edit (docs/023 §5.4).
      return listMarks()
        .filter((mark) => mark.toolbar)
        .map((mark) => ({
          active:
            ctx.store.query({ mark: mark.kind, type: "is-mark-active" }) ===
            true,
          collapsible: "menu-item" as const,
          disabled: textControlsDisabled(ctx),
          id: `mark:${mark.kind}`,
          kind: "mark" as const,
          mark,
          priority: 0,
        }));
    case "blockType":
      return [
        {
          collapsible: "keep-inline",
          disabled: textControlsDisabled(ctx),
          id: "blockType",
          kind: "blockType",
          priority: 0,
        },
      ];
    case "insert": {
      const insert = resolveInsert(item.nodeType);
      if (!insert) return [];
      return [
        {
          collapsible: "menu-item",
          disabled: false,
          icon: insert.icon,
          id: `insert:${item.nodeType}`,
          kind: "insert",
          label: insert.label,
          priority: 0,
          run: insert.run,
        },
      ];
    }
    case "inserts": {
      const exclude = new Set(item.exclude ?? []);
      const types = [
        ...listInsertableStructuralNodes().map((view) => view.type),
        ...listInsertableNodes().map((view) => view.type),
      ];
      const out: ResolvedToolbarItem[] = [];
      for (const nodeType of types) {
        if (exclude.has(nodeType)) continue;
        const insert = resolveInsert(nodeType);
        if (!insert) continue;
        out.push({
          collapsible: "menu-item",
          disabled: false,
          icon: insert.icon,
          id: `insert:${nodeType}`,
          kind: "insert",
          label: insert.label,
          priority: 0,
          run: insert.run,
        });
      }
      return out;
    }
    case "action": {
      const action = getCommand(item.actionId);
      if (!action) return [];
      const resolved = resolveAction(action, ctx);
      return resolved ? [resolved] : [];
    }
    case "component":
      return [
        {
          collapsible: "keep-inline",
          id: item.id,
          kind: "component",
          priority: 0,
          render: item.render,
        },
      ];
  }
}

/**
 * Resolve the ordered, gated layout (docs/023 §5.5). Pure and DOM-free: given the
 * context (store + selection facts + capabilities) and a config, it walks the
 * registered tabs and slots, resolves every placement against its registry, drops
 * unavailable items and now-empty slots/tabs, and keeps everything in
 * declaration/registration order (no explicit sort key). This is the unit-testable
 * heart of the SPI — a feature's appearance is asserted by calling this, no DOM.
 */
export function computeToolbarLayout(
  ctx: CommandContext,
  config: ToolbarLayoutConfig = DEFAULT_TOOLBAR_LAYOUT,
): ResolvedToolbarLayout {
  const hidden = new Set(config.hiddenIds ?? []);

  // Actions explicitly placed by an `action` config item are drawn from that
  // placement, not also from their own `slot`, so a re-placed built-in never doubles.
  const explicitlyPlacedActionIds = new Set(
    config.items
      .filter((item) => item.kind === "action")
      .map((item) => (item as { actionId: string }).actionId),
  );

  const itemsBySlot = new Map<string, ToolbarItem[]>();
  for (const item of config.items) {
    if (hidden.has(itemId(item))) continue;
    const bucket = itemsBySlot.get(item.slot) ?? [];
    bucket.push(item);
    itemsBySlot.set(item.slot, bucket);
  }

  // Resolve one slot's items in order: config placements first (in config-array
  // order), then self-placed registered actions (in registration order). There is
  // no explicit sort key — in-slot order is the order items were declared/registered
  // (docs/023 §5.4); a host appends a control by registering it later. null when the
  // slot ends up empty so the caller can drop it.
  const resolveSlot = (slot: ToolbarSlot): ResolvedToolbarSlot | null => {
    const resolved: ResolvedToolbarItem[] = [];
    for (const item of itemsBySlot.get(slot.id) ?? []) {
      resolved.push(...resolveConfigItem(item, ctx));
    }
    // Registered actions whose own slot is this one, except those an `action`
    // item already placed (here or elsewhere) and any hidden by id.
    for (const action of listCommands()) {
      if (action.slot !== slot.id) continue;
      if (hidden.has(action.id)) continue;
      if (explicitlyPlacedActionIds.has(action.id)) continue;
      const item = resolveAction(action, ctx);
      if (item) resolved.push(item);
    }
    // `hiddenIds` also drops an individual auto-projected member — a single mark
    // (`mark:bold`) or insertable (`insert:media`) from the `marks`/`inserts`
    // group expansions — not just whole config items / actions, so a host can hide
    // one without dropping the group.
    const visible = resolved.filter((item) => !hidden.has(item.id));
    return visible.length > 0
      ? {
          display: slot.display ?? "icon",
          id: slot.id,
          items: visible,
          label: slot.label,
        }
      : null;
  };

  // Persistent (tab-independent) slots: resolved once and rendered in the tab strip,
  // split by side, in slot-registration order. A `persistent` slot ignores `tab`
  // (docs/023 §7.1).
  const persistentSlots = (side: "start" | "end"): ResolvedToolbarSlot[] =>
    listToolbarSlots()
      .filter((slot) => slot.persistent === side && !hidden.has(slot.id))
      .map(resolveSlot)
      .filter((slot): slot is ResolvedToolbarSlot => slot !== null);
  const persistentStart = persistentSlots("start");
  const persistentEnd = persistentSlots("end");

  // Tabs and their slots render in registration order (the registries are
  // insertion-ordered), so built-ins keep their authored sequence and a host tab
  // appends after them.
  const tabs = listToolbarTabs()
    .filter((tab) => !hidden.has(tab.id))
    .filter((tab) => tab.isAvailable?.(ctx) ?? true);

  const resolvedTabs: ResolvedToolbarTab[] = [];
  for (const tab of tabs) {
    const resolvedSlots = listToolbarSlots()
      .filter(
        (slot) =>
          slot.tab === tab.id && !slot.persistent && !hidden.has(slot.id),
      )
      .map(resolveSlot)
      .filter((slot): slot is ResolvedToolbarSlot => slot !== null);

    if (resolvedSlots.length > 0) {
      resolvedTabs.push({ id: tab.id, label: tab.label, slots: resolvedSlots });
    }
  }

  const present = new Set(resolvedTabs.map((tab) => tab.id));
  const defaultTab =
    config.defaultTab && present.has(config.defaultTab)
      ? config.defaultTab
      : (resolvedTabs[0]?.id ?? "");

  return { defaultTab, persistentEnd, persistentStart, tabs: resolvedTabs };
}

/**
 * The built-in arrangement (docs/023 §6.3/§7). It places only the auto-projected
 * groups: the block-type chooser in `home.text` and the format-mark group in
 * `home.format`. Every other built-in control (undo/redo, lists, indent, link, the
 * table picker) is a registered `Command` that self-places via its `slot`, so
 * it does not need a config entry here. The tabs and slots themselves are registered
 * by `registerBuiltInCommands` (`chrome/surfaces/command-builtins`).
 *
 * Insert places the Table dimension-picker action (via its `slot`) plus an `inserts`
 * projection of every *other* registered insertable (callout, code, media, embed,
 * divider, TOC, post-ref, and any host node) into `insert.blocks`. The doc's §7.2
 * "Insert ships only Table" assumed the other insertables stayed reachable through a
 * pre-existing path; in the owned engine the toolbar *was* that path, so projecting
 * them here is what keeps them reachable rather than orphaning seven block types —
 * and it uses the SPI's own insert projection, so a newly registered node still
 * appears with no config edit.
 */
export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayoutConfig = {
  defaultTab: "home",
  items: [
    { kind: "blockType", slot: "home.text" },
    { kind: "marks", slot: "home.format" },
    { exclude: ["table"], kind: "inserts", slot: "insert.blocks" },
  ],
};
