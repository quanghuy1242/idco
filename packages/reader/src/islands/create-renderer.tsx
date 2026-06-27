"use client";

/**
 * `createIslandRenderer` (docs/015 §6.3, §7.3) — the bridge a consumer passes to
 * `<Reader renderIsland={...}>` to turn on interactivity. It lives in the `./islands`
 * (client) entry, so a static-only consumer that never imports it keeps the server graph
 * free of island code. For each island-eligible node the server already rendered, it wraps
 * the static output in an `IslandBoundary` plus the registered island's `Interactive`
 * enhancement. A kind with no registered island falls through to the static output.
 *
 * @categoryDefault Islands
 */
import type { IslandRenderer } from "../reader/types";
import type { ReactNode } from "react";
import { IslandBoundary } from "./boundary";
import { getReaderIsland } from "./registry";

/**
 * Builds the `renderIsland` bridge that turns on interactivity for a `<Reader>`.
 *
 * For each island-eligible node it wraps the server's static output in an `IslandBoundary`
 * plus the registered island's enhancement; a kind with no island stays static.
 *
 * @category Islands
 * @example
 * <Reader value={snapshot} renderIsland={createIslandRenderer()} />
 */
export function createIslandRenderer(): IslandRenderer {
  return ({ kind, data, children }): ReactNode => {
    const island = getReaderIsland(kind);
    if (!island) return children;
    const Interactive = island.Interactive;
    // `enhanced` is only mounted once the boundary's hydrate policy fires, so the
    // Interactive component's hooks run in their own client render, never during this
    // server-side wrap (docs/015 §6.3).
    return (
      <IslandBoundary
        enhanced={<Interactive data={data}>{children}</Interactive>}
        hydrate={island.hydrate}
      >
        {children}
      </IslandBoundary>
    );
  };
}
