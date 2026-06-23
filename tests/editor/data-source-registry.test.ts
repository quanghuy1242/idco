/**
 * docs/026 §6.1 / §14.1 / RB-1 — the host data-source registry.
 *
 * Proves the one host-facing extension point: register-by-id, idempotent
 * replacement, registration-order listing, and the absent lookup that provenance
 * gating relies on (docs/026 §9). Pure module-singleton behaviour, no DOM.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ResourceSource } from "@idco/ui";
import {
  getDataSource,
  listDataSources,
  registerDataSource,
  unregisterDataSource,
} from "../../packages/editor/src/view/spi/data-source-registry";

const syncSource = (
  items: readonly { id: string; label: string }[],
): ResourceSource => ({ items: [...items], mode: "sync" });

afterEach(() => {
  // The registry is a module singleton; drop everything between cases.
  for (const source of listDataSources()) unregisterDataSource(source.id);
});

describe("data-source registry (docs/026 §6.1)", () => {
  it("registers and looks a source up by id", () => {
    registerDataSource({ id: "posts", load: syncSource([]) });
    expect(getDataSource("posts")?.id).toBe("posts");
  });

  it("returns undefined for an unregistered id (the provenance lookup)", () => {
    expect(getDataSource("missing")).toBeUndefined();
  });

  it("is idempotent by id — a re-register replaces rather than throwing", () => {
    registerDataSource({
      id: "posts",
      load: syncSource([{ id: "a", label: "A" }]),
    });
    registerDataSource({
      id: "posts",
      load: syncSource([{ id: "b", label: "B" }]),
    });
    expect(listDataSources()).toHaveLength(1);
    const load = getDataSource("posts")?.load;
    if (load?.mode !== "sync") throw new Error("expected a sync source");
    expect(load.items.map((item) => item.id)).toEqual(["b"]);
  });

  it("lists sources in registration (insertion) order", () => {
    registerDataSource({ id: "posts", load: syncSource([]) });
    registerDataSource({ id: "media", load: syncSource([]) });
    registerDataSource({ id: "authors", load: syncSource([]) });
    expect(listDataSources().map((s) => s.id)).toEqual([
      "posts",
      "media",
      "authors",
    ]);
  });

  it("declares all four capability slots as optional (load-only is valid)", () => {
    // A source with only `load` is the common Phase 1 case; resolve/renderPicker/
    // upload are absent without a type error (docs/026 §4.4).
    registerDataSource({ id: "posts", load: syncSource([]) });
    const source = getDataSource("posts");
    expect(source?.resolve).toBeUndefined();
    expect(source?.renderPicker).toBeUndefined();
    expect(source?.upload).toBeUndefined();
  });
});
