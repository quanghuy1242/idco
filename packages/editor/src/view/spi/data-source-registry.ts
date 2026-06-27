/**
 * Host data-source registry (docs/026 §6.1, §14.1) — the single host-facing
 * extension point for the host-backed records that reference blocks project.
 *
 * Why this lives in `view/spi` and not `core/`: a `DataSource` carries
 * `renderPicker` (returns React) and `load` (feeds the React picker), so it is a
 * view-layer concern. The framework-free `core/` half of a reference block is its
 * `NodeDefinition.bake`, which consumes only the block's own `data.snapshot`
 * (plain JSON) and never the source — so `core/` stays product-neutral and
 * worker-safe and never imports this registry (docs/026 §14.1). All imports here
 * are type-only, so nothing is added to the runtime graph.
 *
 * Shape: this mirrors the sibling SPI registries (`node-view.ts`,
 * `command-registry.ts`) — a module-level singleton, register-by-id, idempotent so
 * an HMR reload or a test re-import replaces rather than throws, and
 * `listDataSources` returns registration order (docs/026 — ordering is insertion
 * order, never an explicit index).
 *
 * A `DataSource` declares up to four capabilities, every one optional (docs/026
 * §4.4): `load` (browse/search — the `@idco/ui` `ResourceSource` union),
 * `resolve` (refresh one record by ref — SWR, docs/026 §7.2), `renderPicker` (the
 * host's own pick surface, docs/026 §6.4), and `upload` (create-then-reference,
 * docs/026 §7.1). Phase 1 wires only `load`; the other three slots are declared
 * now so the SPI shape is fixed from day one — optionality must not be retrofitted
 * (docs/026 §4.4, §10), since adding a capability after the type ships as required
 * would break every registered source.
 *
 * @categoryDefault Host Data Source SPI
 */
import type { ReactNode } from "react";
import type { ResourceOption, ResourceSource } from "@quanghuy1242/idco-ui";

/** Props the engine passes to a host-supplied pick surface (docs/026 §6.4). */
export type DataSourcePickerProps = {
  /** Commit the chosen record; the engine runs the block's `toData` over it. */
  readonly onChoose: (option: ResourceOption) => void;
  /** Dismiss without choosing; for a choose-first insert this rolls back (§7.1). */
  readonly onCancel: () => void;
  /** The current query text, when the engine has one to seed the surface. */
  readonly query?: string;
};

/**
 * One host data source, joined to reference blocks by `id` (docs/026 §5, §6.1).
 * The deployment owns this; it returns domain-agnostic `ResourceOption`s and
 * knows nothing about blocks.
 */
export type DataSource = {
  readonly id: string;
  /**
   * Browse/search the collection — the `@idco/ui` `ResourceSource` union
   * (`sync` / `async` / cursor-`paginated`), so the host owns paging and a large
   * collection never ships whole (docs/026 §4.4, §6.1). Absent for paste-a-ref
   * sources such as embed. Phase 1 drives the default picker from this.
   */
  readonly load?: ResourceSource;
  /**
   * Refresh one record's projection by ref (stale-while-revalidate, docs/026
   * §7.2). Engine-only; no UI counterpart. Absent for browse-only sources.
   * Wired in Phase 2.
   */
  readonly resolve?: (
    ref: string,
    signal: AbortSignal,
  ) => Promise<ResourceOption | null>;
  /**
   * The host's own pick surface (its media-library modal); the engine delegates
   * to it instead of the default ComboBox when present, owning only the overlay
   * container (docs/026 §6.4). Wired in Phase 4.
   */
  readonly renderPicker?: (props: DataSourcePickerProps) => ReactNode;
  /**
   * Create a record then reference it (upload-as-create, docs/026 §7.1); folds in
   * the old `uploadImage` prop. Wired in Phase 3.
   */
  readonly upload?: (
    file: File,
    signal: AbortSignal,
  ) => Promise<ResourceOption>;
};

const DATA_SOURCES = new Map<string, DataSource>();

/**
 * Register a host data source. Idempotent by `id` (a re-import or HMR reload
 * replaces rather than throwing), matching the other SPI registries so
 * module-load and test re-registration are safe.
 */
export function registerDataSource(source: DataSource): void {
  DATA_SOURCES.set(source.id, source);
}

/**
 * The source for an id, or undefined when no deployment registered it — the
 * lookup provenance gating uses to hide a reference block whose source is absent
 * (docs/026 §9).
 */
export function getDataSource(id: string): DataSource | undefined {
  return DATA_SOURCES.get(id);
}

/** Every registered source, in registration (insertion) order (docs/026 §6.1). */
export function listDataSources(): readonly DataSource[] {
  return [...DATA_SOURCES.values()];
}

/**
 * Drop a registration. Mirrors `unregisterGlobalNodeDefinition`; used by tests to
 * keep the module singleton clean between cases.
 */
export function unregisterDataSource(id: string): void {
  DATA_SOURCES.delete(id);
}
