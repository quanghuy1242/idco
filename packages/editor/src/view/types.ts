/**
 * Shared internal view types (docs/017 §3.1).
 *
 * These cross several view modules (the shell, the selection overlay, the text
 * block, the per-block controller), so they live here rather than in any one of
 * them — that is what lets the modules import from each other without a cycle.
 * The public API types (OwnedModelEditorViewProps/Handle/Diagnostics) stay in
 * react-view; these are the engine-internal contracts.
 */
import type { NodeId } from "../core";

export type EditContextLike = EventTarget & {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  updateText(rangeStart: number, rangeEnd: number, text: string): void;
  updateSelection(start: number, end: number): void;
  /** IME bounds feedback (docs/010 §7.4, Phase 7 AC4); present on both backends. */
  updateControlBounds?(controlBounds: DOMRect): void;
  updateSelectionBounds?(selectionBounds: DOMRect): void;
  updateCharacterBounds?(rangeStart: number, characterBounds: DOMRect[]): void;
};

/** One IME composition format range (docs/010 Phase 7 AC5: preedit underline). */
export type TextFormatLike = {
  readonly rangeStart: number;
  readonly rangeEnd: number;
  readonly underlineStyle?: string;
  readonly underlineThickness?: string;
};

export type TextFormatUpdateEventLike = Event & {
  getTextFormats(): readonly TextFormatLike[];
};

export type CharacterBoundsUpdateEventLike = Event & {
  readonly rangeStart: number;
  readonly rangeEnd: number;
};

/** The last IME bounds fed to the active EditContext, for diagnostics (AC4). */
export type ImeBoundsSnapshot = {
  readonly control: SerializedRect;
  readonly selection: SerializedRect;
  readonly characterCount: number;
  readonly firstCharacter: SerializedRect | null;
};

export type SerializedRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type EditContextConstructor = new (init?: {
  text?: string;
  selectionStart?: number;
  selectionEnd?: number;
}) => EditContextLike;

export type MaybePolyfilledEditContextConstructor = EditContextConstructor & {
  readonly isIdcoPolyfill?: boolean;
};

export type TextBlockController = {
  readonly editContext: EditContextLike;
  readonly backend: "native" | "polyfill";
  readonly destroy: () => void;
};

export type RenderRegistry = {
  readonly blockRefs: Map<NodeId, HTMLElement>;
  readonly inputBackends: Map<NodeId, "native" | "polyfill">;
  readonly renderCounts: Map<NodeId, number>;
  /** Mounted live object-editor surfaces; the slot is capped at one (AC2). */
  readonly objectEditors: Set<NodeId>;
  selectionOverlayRenderCount: number;
  selectionRectCount: number;
  /** Last IME bounds fed to the active leaf's EditContext (AC4 diagnostics). */
  imeBounds: ImeBoundsSnapshot | null;
  /** True during a pointer drag; suppresses IME bounds feeding (autoscroll). */
  dragging: boolean;
};
