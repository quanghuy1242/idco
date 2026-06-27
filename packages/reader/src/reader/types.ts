/**
 * Reader pipeline types (docs/028 §4.1). Server-safe: plain data shapes + function types,
 * no React runtime, no client imports. The reader renders the **native**
 * `EditorDocumentSnapshot` (`{ body: { order, blocks }, settings, collections? }`) — never
 * the Lexical-compat projection (docs/028 §4.4). The shapes below are intentionally
 * structurally compatible with the editor's `EditorDocumentSnapshot`/`EditorNode` (wide
 * `unknown` payloads) so the editor can pass its snapshot straight in, while the reader
 * stays free of any editor import (the editor depends on the reader, not the reverse).
 *
 * @categoryDefault Server Reader
 */
import type { ReactNode } from "react";
import type { ReaderTextContent, ReaderTextMark } from "./model";

/** A node's free-form attributes (snapshot-compatible with the editor's `JsonObject`). */
export type ReaderAttrs = Readonly<Record<string, unknown>>;

/** A baked object snapshot (snapshot-compatible with core `BakedSnapshot`). */
export type ReaderBaked = { readonly kind: string; readonly payload: unknown };

/** A text leaf (paragraph/heading/listitem/quote). */
export type ReaderTextNode = {
  readonly kind: "text";
  readonly id: string;
  readonly type: string;
  readonly content: ReaderTextContent;
  readonly marks: readonly ReaderTextMark[];
  readonly attrs?: ReaderAttrs;
};

/** A heavy object (media/embed/post-ref/code/toc/divider/custom). */
export type ReaderObjectNode = {
  readonly kind: "object";
  readonly id: string;
  readonly type: string;
  readonly data: unknown;
  readonly baked?: ReaderBaked;
  readonly status?: string;
  readonly attrs?: ReaderAttrs;
};

/** A structural container (callout/list/listitem/quote/table family/custom). */
export type ReaderStructuralNode = {
  readonly kind: "structural";
  readonly id: string;
  readonly type: string;
  readonly children: readonly string[];
  readonly attrs?: ReaderAttrs;
};

/** Any body block: a text leaf, a heavy object, or a structural container. */
export type ReaderBlockNode =
  | ReaderTextNode
  | ReaderObjectNode
  | ReaderStructuralNode;

/** The native document snapshot the reader renders (compatible with `EditorDocumentSnapshot`). */
export type ReaderSnapshot = {
  readonly body: {
    readonly order: readonly string[];
    readonly blocks: Readonly<Record<string, ReaderBlockNode>>;
  };
  readonly settings?: ReaderAttrs;
  readonly collections?: Readonly<
    Record<string, readonly Readonly<Record<string, unknown>>[]>
  >;
};

/**
 * The island seam (docs/015 §6.3, §7.3). The server `<Reader>` calls this for each
 * island-eligible node; a static-only consumer omits it and the reader stays pure server
 * (it never imports the client island graph). An interactive consumer passes the renderer
 * from `@quanghuy1242/idco-reader/islands`, which wraps the static output in a hydration
 * boundary. Returning `null` (or omitting the option) leaves the node static.
 */
export type IslandRenderer = (args: {
  readonly kind: string;
  readonly data: unknown;
  readonly children: ReactNode;
}) => ReactNode;

/** A host render override for an object type the reader has no built-in for (custom nodes). */
export type ReaderObjectRenderer = (node: ReaderObjectNode) => ReactNode;

/** A host render override for a structural type the reader has no built-in for. */
export type ReaderStructuralRenderer = (
  node: ReaderStructuralNode,
  children: ReactNode,
) => ReactNode;

/** The render options that tune a `<Reader>` pass: host resolvers, embed allowlist, and island opt-in. */
export type ReaderOptions = {
  /** Resolve a media object to a fresh src/alt/caption (default: render its baked snapshot). */
  readonly resolveMedia?: (node: ReaderObjectNode) => {
    readonly src: string;
    readonly alt?: string;
    readonly caption?: string;
  } | null;
  /** Resolve a post-ref object to a fresh href/label (default: render its baked snapshot). */
  readonly resolvePost?: (node: ReaderObjectNode) => {
    readonly href: string;
    readonly label: string;
  } | null;
  /** Allowlist of embeddable iframe hostnames; off-allowlist embeds fall back to a link. */
  readonly allowedEmbedDomains?: readonly string[];
  /** Per-type render override for a custom object the reader has no built-in for. */
  readonly objectRenderers?: Readonly<Record<string, ReaderObjectRenderer>>;
  /** Per-type render override for a custom structural container. */
  readonly structuralRenderers?: Readonly<
    Record<string, ReaderStructuralRenderer>
  >;
  /** Opt-in island mounting (docs/015 §6); omit for a fully static, zero-JS reader. */
  readonly renderIsland?: IslandRenderer;
  /**
   * Render every TOC inline, with no sticky side rail (docs/028 §4.4). The editor's in-app
   * preview (`RestingDocument`) sets this: it has no rail column, so an `aside` TOC must
   * stay in the flow rather than hide itself at `lg+` waiting for a rail that never comes.
   */
  readonly forceInlineToc?: boolean;
};
