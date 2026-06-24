/**
 * The side-panel dock — the editor-chrome host for workspace panes (docs/027 §8).
 *
 * One region, docked to one side, showing the registered, available panes as tabs
 * with exactly one pane visible at a time (docs/027 §8.1). Not split panes: the
 * paginated book layout's width budget makes two simultaneous columns crowd the page,
 * so tabs give switching without spending width (docs/027 §8.1, decision D5). The dock
 * is *generic chrome*: it reads `listSidePanels()`, gates each by `isAvailable`, and
 * renders the active one's `render(...)` — it holds zero knowledge of Outline /
 * Comments / Glossary, exactly as the ribbon holds none of its commands (docs/027 §8.2).
 *
 * Editor chrome, not host layout (docs/027 §8.4): the dock is edit-mode-only, a sibling
 * of the document surface in `owned-model-editor`, never mounted inside the virtual
 * scroller — so opening/closing it only changes the surface's width, which the virtual
 * window already treats as a resize, and it cannot corrupt offset measurement
 * (docs/027 §8.3, docs/025). On a narrow viewport it stops being a column and becomes an
 * overlay sheet (`@idco/ui` `Drawer`) with the same tabs (docs/027 §8.3), reusing the
 * shared `useIsMobile` breakpoint the ribbon uses.
 *
 * It is fed the same off-thread document index the block tree consumes (a shared
 * `MutableDocumentIndexStore` threaded down from `owned-model-editor`), wrapped here in
 * a `DocumentIndexProvider` so a pane's `useDocumentIndex()` resolves against the one
 * live index rather than a second worker round-trip (docs/027 §2.2 — one pipeline).
 */
import { Button, Drawer, Tabs } from "@quanghuy1242/idco-ui";
import type { EditorStore, NodeId } from "../../../core";
import {
  buildCommandContext,
  listSidePanels,
  type PanelHost,
  type ToolbarCapabilities,
} from "../../spi";
import { DocumentIndexProvider } from "../../document-index";
import type { MutableDocumentIndexStore } from "../../controllers/document-index-store";
import { useStoreVersion } from "./use-store-version";
import { useIsMobile } from "./use-is-mobile";

export type SidePanelDockProps = {
  readonly store: EditorStore;
  /** The same capability set the ribbon/flat surfaces use, for pane `isAvailable`. */
  readonly capabilities: ToolbarCapabilities;
  /** The dock seam a pane's actions / nested commands resolve against. */
  readonly panelHost: PanelHost;
  /** Whether the dock is shown; closed renders nothing so the surface is full width. */
  readonly open: boolean;
  /** The pane the dock shows; falls back to the first available pane when stale/null. */
  readonly activeId: string | null;
  /** Switch the active pane (a tab click). */
  readonly onSelect: (id: string) => void;
  /** Close the dock (the header X, the Drawer backdrop, a pane's done). */
  readonly onClose: () => void;
  /** The engine's scroll-to-block, handed to panes for jump-to-anchor (docs/027 §9). */
  readonly reveal: (id: NodeId) => void;
  /** The shared live document index the block tree also reads (docs/027 §2.2). */
  readonly indexStore: MutableDocumentIndexStore;
};

export function SidePanelDock(props: SidePanelDockProps) {
  const {
    store,
    capabilities,
    panelHost,
    open,
    activeId,
    onSelect,
    onClose,
    reveal,
    indexStore,
  } = props;
  // Re-resolve pane availability on every selection/commit so a pane that gates on
  // model state (or on a source registered after mount) lights up live, the same
  // subscription the ribbon uses (docs/027 §7.7 — the registry is the truth).
  useStoreVersion(store);
  const isMobile = useIsMobile();
  const ctx = buildCommandContext(store, capabilities, panelHost);
  const panels = listSidePanels().filter(
    (panel) => panel.isAvailable?.(ctx) ?? true,
  );

  // Nothing to dock, or the author has it closed: render nothing. The closed dock
  // costs no layout (the surface reclaims the full width) — open/closed is the dock's
  // only persistent state besides the active id (docs/027 §8.5).
  if (!open || panels.length === 0) return null;

  const active = panels.find((panel) => panel.id === activeId) ?? panels[0]!;
  const tabItems = panels.map((panel) => ({
    id: panel.id,
    label: panel.title,
  }));

  const body = (
    <DocumentIndexProvider revealNode={reveal} store={indexStore}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-1 border-b border-base-300 px-2 py-1">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <Tabs
              ariaLabel="Document panels"
              items={tabItems}
              onSelectionChange={onSelect}
              selectedKey={active.id}
              size="sm"
              variant="border"
            />
          </div>
          <Button
            ariaLabel="Close panel"
            iconName="X"
            onClick={onClose}
            size="sm"
            square
            tooltip="Close"
            variant="ghost"
          />
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          data-engine-side-panel={active.id}
        >
          {active.render({ close: onClose, ctx, reveal, store })}
        </div>
      </div>
    </DocumentIndexProvider>
  );

  // Narrow viewport: an overlay sheet with the same tabs/panes (docs/027 §8.3). The
  // Drawer owns its own dismissal (backdrop / Esc), routed back to `onClose`.
  if (isMobile) {
    return (
      <Drawer
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        open
        side="right"
        title={active.title}
      >
        {body}
      </Drawer>
    );
  }

  // Wide viewport: a side column, a sibling of the scroller so it only narrows the
  // surface's width (docs/027 §8.3/§8.4). `shrink-0` keeps its width fixed.
  return (
    <aside
      aria-label="Document panels"
      className="flex w-80 shrink-0 flex-col border-l border-base-300 bg-base-100"
      data-engine-side-panel-dock=""
    >
      {body}
    </aside>
  );
}
