/**
 * View-layer command registry (docs/024 §5.2) — the surface-neutral command SPI.
 *
 * This started life as the toolbar-action registry (docs/023 §5.2): the descriptor
 * for a control that is not already a mark/block-type/insert, carrying its own
 * store-command wiring (`run`/`isActive`) or its own focused body (`render`). docs/024
 * generalizes it *off* "toolbar": a `Command` is a control that any command surface —
 * the ribbon, the right-click context menu, the selection flyout, the slash menu —
 * can project, and it declares the surfaces it lives on with a per-surface placement
 * (`surfaces`, the one shape change from docs/023's `ToolbarSurface[]`). The file was
 * renamed `toolbar-action-registry.ts → command-registry.ts` because keeping the
 * toolbar name on generalized code would be exactly the lie the consolidation removes
 * (docs/024 §5.8/§6.5).
 *
 * The command is pure *behavior + identity*. It declares which surfaces it targets
 * and a fixed `group` for cross-surface ordering (docs/024 §5.6), but it does not
 * know which surface is rendering it, nor pixels — the ribbon's tab/slot arrangement
 * lives in `toolbar-layout.ts`, the flat surfaces' grouped-list projection in
 * `command-surface.ts`, and the renderers in `chrome/surfaces/*`. This split is the
 * §6.1 decision: a descriptor never carries cross-surface arrangement. (We keep
 * `slot` on the command for its ribbon home — a control that exists *only* as a
 * ribbon item has an obvious home — while marks/block-types, which exist independent
 * of any surface, are placed by the layout config / by-kind defaults instead.)
 *
 * Registration is idempotent by `id` (a re-import / HMR replaces rather than
 * throwing), matching `registerMark`/`registerBlockType`. Built-in commands are
 * registered through `registerBuiltInCommands()` (`chrome/surfaces/command-builtins`),
 * wired into the view orchestrator (`react-view`) alongside the node/mark/block
 * registrars; see docs/023 §5.2/§9 for why that explicit call — not a bare
 * module-load side effect — is what keeps the package `sideEffects: false` safe.
 */
import type { ReactNode } from "react";
import type { EditorStore, NodeId, TextMarkKind } from "../../core";
import type { CommandGroup } from "./command-surface";

/** The four control shapes a command can take (docs/023 §5.2). */
export type CommandKind = "toggle" | "button" | "dropdown" | "popover";

/**
 * The surfaces a command may project onto (docs/024 §5.1). docs/023 reserved
 * `ribbon`/`flyout`/`contextMenu`; docs/024 adds `slash` and makes every one of
 * them a real consumer. A command appears on a surface by declaring it in
 * `surfaces`; a surface never grows a per-command branch (docs/024 §4/§6.1).
 */
export type CommandSurface = "ribbon" | "contextMenu" | "flyout" | "slash";

/**
 * Where a command sits on a surface (docs/024 §5.2): `primary` renders inline / in
 * the main list; `more` tucks into the surface's overflow ("More") submenu (and the
 * slash menu treats it as lower-rank in the filtered list). The placement is
 * per-surface, so the same command can be primary on one surface and overflow on
 * another (a table insert: ribbon `primary`, context-menu `more`).
 */
export type CommandPlacement = "primary" | "more";

/**
 * Live selection facts derived once per surface resolve (docs/023 §5.3), so command
 * predicates are a pure function of model state, never an ad-hoc DOM read. Computed
 * from `store.query` under the surface's existing selection+commit subscription, so
 * they stay live with no new machinery. These must be *real* (not the legacy
 * hardcoded `hasSelectedText: false`) because selection-scoped commands — comment,
 * AI-on-selection, the flyout's apply-to-selection — depend on them.
 */
export type ToolbarSelectionFacts = {
  /** A non-collapsed text range exists. */
  readonly hasSelection: boolean;
  /** The selected run text, "" when collapsed or non-text. */
  readonly selectedText: string;
  /** The active text-leaf block type, or null off a text leaf. */
  readonly blockType: string | null;
  /** The marks active at the caret/over the selection. */
  readonly activeMarks: ReadonlySet<TextMarkKind>;
  /** The caret sits inside an object/structural scope (a cell, a callout). */
  readonly inObject: boolean;
};

/**
 * Per-deployment capability flags (docs/023 §5.6). Computed once from the editor's
 * props/bindings, NOT from document content, so the surface set is stable, not
 * shimmering (docs/023 §9 "capability shimmer"). First release: `insertTable` is
 * the only true non-Home capability; `media`/`review`/`ai` are false so their tabs
 * resolve empty and are dropped. Open index signature so a host can gate its own
 * tabs/commands on its own keys.
 */
export type ToolbarCapabilities = {
  readonly insertTable: boolean;
  readonly media: boolean;
  readonly review: boolean;
  readonly ai: boolean;
  readonly [key: string]: boolean;
};

/**
 * The live scope a command is resolved against (docs/024 §5.4). Derived once per
 * resolve from `scopePath`/`activeScope`/`store.activeObjectId` (`core/commands/shared`):
 * the container chain enclosing the selection, innermost-first, plus quick-dispatch
 * fields. A command's `isAvailable` and a node's `contributeCommands` read this to
 * decide whether they apply to *where the caret is* without re-walking the model.
 */
export type CommandScope = {
  /** Root-first container chain enclosing the selection (`scopePath`). */
  readonly path: readonly NodeId[];
  /** The innermost container id (last of `path`), or the body root. */
  readonly innermost: NodeId;
  /** The innermost container's node kind, for quick dispatch. */
  readonly innermostKind: "structural" | "object" | "root";
  /** The active object id (`store.activeObjectId`), or null. */
  readonly activeObject: NodeId | null;
};

/** What every command predicate, `run`, and `contributeCommands` receives (docs/024 §5.4). */
export type CommandContext = {
  readonly store: EditorStore;
  readonly selection: ToolbarSelectionFacts;
  readonly scope: CommandScope;
  readonly capabilities: ToolbarCapabilities;
};

/** A `dropdown`/`popover` command's render context adds the dismiss handle. */
export type CommandRenderContext = CommandContext & {
  /** Close the popover/menu (the renderer wires it + returns focus to the editor). */
  readonly close: () => void;
};

/**
 * One surface command that is not a mark/block-type/insert (docs/024 §5.2). It
 * declares its identity, the surfaces it lives on (`surfaces`), its fixed ordering
 * `group`, and either a `run` (toggle/button) or a `render` (dropdown/popover body).
 */
export type Command = {
  /** Stable id, unique across commands; the layout/hide key and the test handle. */
  readonly id: string;
  readonly kind: CommandKind;
  readonly label: string;
  /** Registered lucide icon name (`nav-icons` registry). */
  readonly icon: string;
  /** Fixed group for ordering across surfaces (docs/024 §5.6). */
  readonly group: CommandGroup;
  /** Fuzzy-search terms; the slash menu's primary filter signal. */
  readonly keywords?: readonly string[];
  /** Per-surface placement; an absent surface key means "not shown there". */
  readonly surfaces: Partial<Record<CommandSurface, CommandPlacement>>;
  /**
   * The ribbon slot this command lands in, e.g. "home.lists" (docs/023 §5.4).
   * Position within the slot (and within its `group` on the flat surfaces) is
   * registration order — register later to appear later; there is no order number.
   */
  readonly slot?: string;
  /** Lower collapses sooner under width pressure (docs/023 §6.4); default 0. */
  readonly responsivePriority?: number;
  /** Toggle highlight state; read through the store, never the DOM. */
  isActive?(ctx: CommandContext): boolean;
  /**
   * Visible but greyed for the current selection/capability. Distinct from
   * `isAvailable`, which removes the command entirely (provenance gates
   * availability, docs/023 §4.9); the two are different author meanings and must
   * not be merged.
   */
  isDisabled?(ctx: CommandContext): boolean;
  /** Whether the command exists at all for this context (`false` removes it). */
  isAvailable?(ctx: CommandContext): boolean;
  /**
   * For `toggle`/`button`: the store mutation to run on press. Declared `void` so a
   * sync `store.command(...)` (which returns a transaction) and an `async` body (the
   * edit-ops' clipboard paste, which reads the clipboard before dispatching) are both
   * assignable; the surface hosts fire it and-forget — the model selection survives
   * the surface's focus, so a late async dispatch still lands correctly (docs/024 §7.1).
   */
  run?(ctx: CommandContext): void;
  /** For `dropdown`/`popover`: the focused body (React Aria + DaisyUI). */
  render?(ctx: CommandRenderContext): ReactNode;
};

const COMMANDS = new Map<string, Command>();

/** Register a command. Idempotent by id (re-import / HMR replaces). */
export function registerCommand(command: Command): void {
  COMMANDS.set(command.id, command);
}

/** The command for an id, or undefined (unregistered). */
export function getCommand(id: string): Command | undefined {
  return COMMANDS.get(id);
}

/** Every registered command, in registration order. */
export function listCommands(): readonly Command[] {
  return [...COMMANDS.values()];
}

/** Remove a registered command (host teardown / test cleanup). */
export function unregisterCommand(id: string): void {
  COMMANDS.delete(id);
}

/** Whether a command targets a surface (docs/024 §5.2 — an absent key means no). */
export function commandTargetsSurface(
  command: Command,
  surface: CommandSurface,
): boolean {
  return command.surfaces[surface] !== undefined;
}
