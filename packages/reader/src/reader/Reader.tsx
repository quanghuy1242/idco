/**
 * The published read tier (docs/015 §4.5, docs/028 §4.4). A React **Server Component** — no
 * `"use client"`, no hooks, no client imports — that renders a **native**
 * `EditorDocumentSnapshot` through the shared resting dispatch (`renderRestingDocument`),
 * the same dispatch the editor's `RestingDocument` delegates to, so the editor preview and
 * the published page cannot drift (docs/028 §1). It does not speak the Lexical-compat
 * shape; a host still on Lexical-shaped persistence converts at its own edge with the
 * editor's `compat → snapshot` adapter and passes the snapshot in (docs/028 §4.4).
 *
 * Virtualization is `content-visibility` only (docs/015 §5): each top-level render unit
 * carries `content-visibility: auto` with a `contain-intrinsic-size` estimate, so the
 * browser skips offscreen layout/paint while keeping every block in the DOM (native
 * find/select/copy/deep-link keep working). No JS windowing — deliberately (§5.5).
 *
 * Interactivity is opt-in: pass `renderIsland` (from `@quanghuy1242/idco-reader/islands`)
 * and island-eligible nodes (code highlighting, TOC scroll-spy) gain a hydration boundary;
 * omit it and the page is fully static. The typography contract ships once as a
 * server-rendered `<style>`, so the reader brings its own `.rt-*` appearance.
 */
import type { CSSProperties, ReactNode } from "react";
import { normalizeTocSettings } from "@quanghuy1242/idco-lib";
import { RichTextArticle, RichTextTocLayout, RichTextTocRail } from "../l1";
import { RICH_TEXT_TYPOGRAPHY_CSS } from "../l1/typography";
import {
  bodyNodes,
  groupListRuns,
  renderUnit,
  tocEntries,
  type ReaderRenderUnit,
} from "./render";
import type { ReaderObjectNode, ReaderOptions, ReaderSnapshot } from "./types";

/** Per-unit `contain-intrinsic-size` height estimate (docs/015 §5.3) — server-derived. */
function intrinsicHeight(unit: ReaderRenderUnit): string {
  if (unit.kind === "list") {
    return `${Math.max(3, unit.items.length * 1.8)}rem`;
  }
  const node = unit.node;
  if (node.kind === "text") {
    return node.type === "heading" ? "3rem" : "4rem";
  }
  if (node.kind === "object") {
    switch (node.type) {
      case "media":
      case "embed":
        return "20rem";
      case "code":
      case "code-block":
      case "table-of-contents":
        return "10rem";
      case "divider":
        return "1.5rem";
      default:
        return "4rem";
    }
  }
  if (node.type === "table") return "12rem";
  if (node.type === "callout" || node.type === "quote") return "6rem";
  return "4rem";
}

/** The content-visibility wrapper style for one top-level unit. */
function unitVisibilityStyle(unit: ReaderRenderUnit): CSSProperties {
  return {
    // `auto` lets the browser remember the real rendered height once seen, so the estimate
    // only matters before first paint of that unit (docs/015 §5.3).
    containIntrinsicHeight: `auto ${intrinsicHeight(unit)}`,
    contentVisibility: "auto",
  };
}

/** A heading unit (for the extra top margin the CV wrapper would otherwise eat). */
function isHeadingUnit(unit: ReaderRenderUnit): boolean {
  return (
    unit.kind === "single" &&
    unit.node.kind === "text" &&
    unit.node.type === "heading"
  );
}

/** Find the first `placement: "aside"` TOC object, if any. */
function asideToc(snapshot: ReaderSnapshot): ReaderObjectNode | undefined {
  for (const node of bodyNodes(snapshot)) {
    if (
      node.kind === "object" &&
      node.type === "table-of-contents" &&
      normalizeTocSettings(
        (node.baked?.payload ?? {}) as Record<string, unknown>,
      ).placement === "aside"
    ) {
      return node;
    }
  }
  return undefined;
}

export function Reader({
  value,
  ...options
}: ReaderOptions & { readonly value: ReaderSnapshot }): ReactNode {
  const snapshot = value;
  if (!snapshot?.body?.order) return null;
  const units = groupListRuns(bodyNodes(snapshot), snapshot);

  const content = (
    <>
      <style>{RICH_TEXT_TYPOGRAPHY_CSS}</style>
      <RichTextArticle>
        {units.map((unit, index) => (
          <div
            // The content-visibility wrapper means the article's `>h2` sibling-margin
            // selectors no longer reach a heading, so the extra top space is applied here.
            className={index > 0 && isHeadingUnit(unit) ? "mt-3" : undefined}
            data-rt-block=""
            key={`root.${index}`}
            style={unitVisibilityStyle(unit)}
          >
            {renderUnit(unit, snapshot, options, `root.${index}`)}
          </div>
        ))}
      </RichTextArticle>
    </>
  );

  // A `placement: "aside"` TOC renders as a sticky side rail beside the article at lg+ (its
  // in-flow node renders the inline copy hidden at lg+ by the dispatch's `aside` variant).
  // `forceInlineToc` (the rail-less editor preview) keeps the TOC inline and skips the rail.
  const aside = options.forceInlineToc ? undefined : asideToc(snapshot);
  if (!aside) return content;
  const settings = normalizeTocSettings(
    (aside.baked?.payload ?? {}) as Record<string, unknown>,
  );
  return (
    <RichTextTocLayout
      rail={
        <RichTextTocRail
          entries={tocEntries(
            snapshot,
            (aside.baked?.payload ?? {}) as Record<string, unknown>,
          )}
          style={settings.style}
          title={settings.title}
        />
      }
      side={settings.side}
    >
      {content}
    </RichTextTocLayout>
  );
}
