// @vitest-environment jsdom
/**
 * Overlay authority engine (docs/029 §4/§7, R1-A unit suite). Proves the *model*: the pure
 * reconcile + co-slot + mode-stack + reconciliation + suppression transforms, and the
 * ownership registry — without React or a layout engine. The DOM/render/hook concerns are
 * covered by `engine-overlay-layer.test.tsx`; positioning by `engine-overlay-positioning`.
 */
import { describe, expect, it } from "vitest";
import type { NodeId } from "../../packages/editor/src/core";
import type { CommandContext } from "../../packages/editor/src/view/spi";
import {
  createOwnershipRegistry,
  dismissAllState,
  dismissSurface,
  effectiveFocusMode,
  EMPTY_AUTHORITY_STATE,
  focusModeOwnsFocus,
  openExplicit,
  popPanel,
  pushPanel,
  reconcileAuthority,
  resolveEnvelopes,
  type AuthorityState,
  type OverlayContributor,
  type OverlayPanel,
} from "../../packages/editor/src/view/spi";

const ctx = {} as CommandContext;

/** Build a contributor with the required fields, spreading optional overrides. */
function contributor(
  over: Partial<OverlayContributor> &
    Pick<OverlayContributor, "id" | "target" | "contentKind" | "focusMode">,
): OverlayContributor {
  return { ...over };
}

const lookupFrom =
  (...cs: OverlayContributor[]) =>
  (id: string) =>
    cs.find((c) => c.id === id);

describe("overlay authority — co-slot (docs/029 §7.3)", () => {
  it("co-slots compatible actions contributors into one envelope, in registration order", () => {
    const clip = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "clip",
      target: "selection",
      when: () => true,
    });
    const fmt = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "fmt",
      target: "selection",
      when: () => true,
    });
    const state = reconcileAuthority(EMPTY_AUTHORITY_STATE, {
      contributors: [clip, fmt],
      ctx,
      ready: { selection: true },
      signatures: { selection: "sig" },
    });
    expect(state.open).toHaveLength(1);
    expect(state.open[0]!.target).toBe("selection");
    expect(state.open[0]!.rootContributorIds).toEqual(["clip", "fmt"]);

    const envelopes = resolveEnvelopes(state, lookupFrom(clip, fmt));
    expect(envelopes[0]!.slots.map((s) => s.id)).toEqual(["clip", "fmt"]);
    expect(envelopes[0]!.contentKind).toBe("actions");
    expect(envelopes[0]!.focusMode).toBe("transparent");
  });

  it("arbitrates incompatible content-kinds on one target by priority, never merging", () => {
    const slash = contributor({
      contentKind: "menu",
      focusMode: "transparent",
      id: "slash",
      priority: 1,
      target: "caret",
      when: () => true,
    });
    const paste = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "paste",
      priority: 0,
      target: "caret",
      when: () => true,
    });
    const state = reconcileAuthority(EMPTY_AUTHORITY_STATE, {
      contributors: [slash, paste],
      ctx,
      signatures: { caret: "c1" },
    });
    expect(state.open).toHaveLength(1);
    expect(state.open[0]!.rootContributorIds).toEqual(["slash"]);
  });
});

describe("overlay authority — arbitration (docs/029 §7.3 text-flow exclusivity)", () => {
  it("keeps only the highest-rank text-flow target when several would open", () => {
    const flyout = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "flyout",
      target: "selection",
      when: () => true,
    });
    const menu = contributor({
      contentKind: "menu",
      focusMode: "taking",
      id: "menu",
      target: "point",
    });
    let state = openExplicit(
      EMPTY_AUTHORITY_STATE,
      { kind: "point", x: 1, y: 2 },
      "menu",
      "point",
    );
    state = reconcileAuthority(state, {
      contributors: [flyout, menu],
      ctx,
      ready: { selection: true },
      signatures: { selection: "s1" },
    });
    expect(state.open.map((o) => o.target)).toEqual(["point"]);
  });

  it("lets non-text-flow targets coexist with the text-flow winner", () => {
    const flyout = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "flyout",
      target: "selection",
      when: () => true,
    });
    const cell = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "cell",
      target: "cell",
    });
    let state = openExplicit(
      EMPTY_AUTHORITY_STATE,
      { cellId: "x" as NodeId, kind: "cell" },
      "cell",
      "cell",
    );
    state = reconcileAuthority(state, {
      contributors: [flyout, cell],
      ctx,
      ready: { selection: true },
      signatures: { selection: "s1" },
    });
    expect(state.open.map((o) => o.target).sort()).toEqual([
      "cell",
      "selection",
    ]);
  });
});

describe("overlay authority — suppression (docs/029 §7.2)", () => {
  it("suppresses a dismissed ambient surface until its anchor signature changes", () => {
    const flyout = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "flyout",
      target: "selection",
      when: () => true,
    });
    const input = (sig: string) =>
      ({
        contributors: [flyout],
        ctx,
        ready: { selection: true },
        signatures: { selection: sig },
      }) as const;

    let state = reconcileAuthority(EMPTY_AUTHORITY_STATE, input("A"));
    expect(state.open).toHaveLength(1);

    state = dismissSurface(state, "selection", "A");
    expect(state.open).toHaveLength(0);
    expect(state.suppressed.selection).toBe("A");

    state = reconcileAuthority(state, input("A"));
    expect(state.open).toHaveLength(0); // same anchor → stays suppressed

    state = reconcileAuthority(state, input("B"));
    expect(state.open).toHaveLength(1); // anchor changed → re-raises
  });
});

describe("overlay authority — mode stack (docs/029 §4.5)", () => {
  const flyout = contributor({
    contentKind: "actions",
    focusMode: "transparent",
    id: "flyout",
    target: "selection",
    when: () => true,
  });
  const panel: OverlayPanel = {
    contentKind: "form",
    focusMode: "taking",
    id: "link",
    render: () => null,
  };

  it("push flips effective focus mode; dismiss pops one level before closing", () => {
    let state = reconcileAuthority(EMPTY_AUTHORITY_STATE, {
      contributors: [flyout],
      ctx,
      ready: { selection: true },
      signatures: { selection: "A" },
    });
    state = pushPanel(state, "selection", panel);
    expect(state.open[0]!.modeStack).toHaveLength(1);
    expect(effectiveFocusMode(state.open[0]!, lookupFrom(flyout))).toBe(
      "taking",
    );

    state = dismissSurface(state, "selection", "A");
    expect(state.open).toHaveLength(1); // popped one, surface stays
    expect(state.open[0]!.modeStack).toHaveLength(0);

    state = dismissSurface(state, "selection", "A");
    expect(state.open).toHaveLength(0); // root dismiss closes
  });

  it("pop is a no-op at the root", () => {
    let state = reconcileAuthority(EMPTY_AUTHORITY_STATE, {
      contributors: [flyout],
      ctx,
      ready: { selection: true },
      signatures: { selection: "A" },
    });
    state = popPanel(state, "selection");
    expect(state.open).toHaveLength(1);
    expect(state.open[0]!.modeStack).toHaveLength(0);
  });
});

describe("overlay authority — reconciliation survive (docs/029 §7.2)", () => {
  it("keeps a focus-taking surface whose content vanished; drops a transparent one", () => {
    let takingOn = true;
    const blockForm = contributor({
      ambientAnchor: () => ({ blockId: "b1" as NodeId, kind: "block" }),
      contentKind: "form",
      focusMode: "taking",
      id: "cfg",
      target: "block",
      when: () => takingOn,
    });
    let state = reconcileAuthority(EMPTY_AUTHORITY_STATE, {
      contributors: [blockForm],
      ctx,
      signatures: {},
    });
    expect(state.open).toHaveLength(1);
    takingOn = false; // content vanishes this frame
    state = reconcileAuthority(state, {
      contributors: [blockForm],
      ctx,
      signatures: {},
    });
    expect(state.open).toHaveLength(1); // taking survives the transient vanish

    let barOn = true;
    const bar = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "bar",
      target: "selection",
      when: () => barOn,
    });
    let s2 = reconcileAuthority(EMPTY_AUTHORITY_STATE, {
      contributors: [bar],
      ctx,
      ready: { selection: true },
      signatures: { selection: "A" },
    });
    expect(s2.open).toHaveLength(1);
    barOn = false;
    s2 = reconcileAuthority(s2, {
      contributors: [bar],
      ctx,
      ready: { selection: true },
      signatures: { selection: "A" },
    });
    expect(s2.open).toHaveLength(0); // transparent is dropped
  });
});

describe("overlay authority — explicit persistence (docs/029 §7.2)", () => {
  it("keeps an explicitly-opened transparent surface across reconciles until dismissed", () => {
    const cell = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "cell",
      target: "cell",
    });
    let state = openExplicit(
      EMPTY_AUTHORITY_STATE,
      { cellId: "x" as NodeId, kind: "cell" },
      "cell",
      "cell",
    );
    state = reconcileAuthority(state, {
      contributors: [cell],
      ctx,
      signatures: {},
    });
    expect(state.open.map((o) => o.target)).toContain("cell");
    // A second reconcile (no ambient `when`) does not drop it — explicit persists.
    state = reconcileAuthority(state, {
      contributors: [cell],
      ctx,
      signatures: {},
    });
    expect(state.open.map((o) => o.target)).toContain("cell");

    state = dismissSurface(state, "cell", null);
    state = reconcileAuthority(state, {
      contributors: [cell],
      ctx,
      signatures: {},
    });
    expect(state.open.map((o) => o.target)).not.toContain("cell");
  });
});

describe("overlay authority — dismissAll (docs/029 coordinator parity)", () => {
  it("closes every surface and records text-flow suppression", () => {
    const flyout = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "flyout",
      target: "selection",
      when: () => true,
    });
    let state = reconcileAuthority(EMPTY_AUTHORITY_STATE, {
      contributors: [flyout],
      ctx,
      ready: { selection: true },
      signatures: { selection: "A" },
    });
    state = dismissAllState(state, { selection: "A" });
    expect(state.open).toHaveLength(0);
    expect(state.suppressed.selection).toBe("A");
  });
});

describe("ownership registry — containment by ownership (docs/029 §7.4)", () => {
  it("answers isWithin / isWithinSurface across parent→child overlays", () => {
    const reg = createOwnershipRegistry();
    const parent = document.createElement("div");
    const child = document.createElement("div");
    const insideParent = document.createElement("span");
    const insideChild = document.createElement("span");
    parent.appendChild(insideParent);
    child.appendChild(insideChild);
    document.body.append(parent, child);
    reg.register("p", parent, null);
    reg.register("c", child, "p"); // child overlay owned by p

    expect(reg.isWithin(insideParent)).toBe(true);
    expect(reg.isWithinSurface("p", insideParent)).toBe(true);
    // The child is a descendant overlay of p, so a press in it is "within p".
    expect(reg.isWithinSurface("p", insideChild)).toBe(true);
    // But the parent's content is not within the child surface.
    expect(reg.isWithinSurface("c", insideParent)).toBe(false);

    const outside = document.createElement("span");
    document.body.append(outside);
    expect(reg.isWithin(outside)).toBe(false);

    reg.unregister("p");
    expect(reg.isWithin(insideParent)).toBe(false);
  });
});

describe("overlay authority — sticky focus-mode (docs/029 §4.2/R1-G)", () => {
  it("focusModeOwnsFocus is true for taking + sticky, false for transparent", () => {
    expect(focusModeOwnsFocus("transparent")).toBe(false);
    expect(focusModeOwnsFocus("taking")).toBe(true);
    expect(focusModeOwnsFocus("sticky")).toBe(true);
  });

  it("a sticky surface survives a frame with no candidate (like taking, unlike transparent)", () => {
    const sticky = contributor({
      contentKind: "form",
      focusMode: "sticky",
      id: "find",
      target: "point",
    });
    // Previously open (e.g. opened via openStickyForm), with no live candidate this frame and
    // no explicit request: the survive step keeps it because it owns focus.
    const prev: AuthorityState = {
      explicit: [],
      open: [
        {
          anchor: { kind: "point", x: 10, y: 10 },
          modeStack: [],
          rootContributorIds: ["find"],
          target: "point",
        },
      ],
      suppressed: {},
    };
    const next = reconcileAuthority(prev, {
      contributors: [sticky],
      ctx,
      signatures: {},
    });
    expect(next.open.map((o) => o.target)).toEqual(["point"]);

    // A transparent surface in the same position is dropped (its close is model-driven).
    const transparentPrev: AuthorityState = {
      ...prev,
      open: [{ ...prev.open[0]!, rootContributorIds: ["bar"] }],
    };
    const bar = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "bar",
      target: "point",
    });
    const droppedNext = reconcileAuthority(transparentPrev, {
      contributors: [bar],
      ctx,
      signatures: {},
    });
    expect(droppedNext.open).toHaveLength(0);
  });
});

describe("overlay authority — taking off-flow suppresses the selection bar (docs/029 §3b)", () => {
  const selectionBar = contributor({
    contentKind: "actions",
    focusMode: "transparent",
    id: "selection.bar",
    target: "selection",
    when: () => true,
  });

  it("a taking mark form suppresses the transparent selection bar over the same span", () => {
    // The link form is an explicit `mark` taking surface; the selection bar is ambient on the
    // (link-range) selection. Both would otherwise be open — §3b drops the transparent bar.
    const linkForm = contributor({
      contentKind: "form",
      focusMode: "taking",
      id: "mark.link",
      match: (p) => p.kind === "link",
      target: "mark",
    });
    const opened = openExplicit(
      EMPTY_AUTHORITY_STATE,
      { kind: "mark", markId: "m1", nodeId: "n1" as NodeId },
      "mark.link",
      "mark",
    );
    const next = reconcileAuthority(opened, {
      contributors: [selectionBar, linkForm],
      ctx,
      ready: { selection: true },
      signatures: { selection: "n1:0-n1:4" },
    });
    expect(next.open.map((o) => o.target).sort()).toEqual(["mark"]);
  });

  it("a transparent off-flow surface does NOT suppress the selection bar", () => {
    // The cell `…` is transparent, so a cell surface coexists with the format bar (no §3b).
    const cell = contributor({
      contentKind: "actions",
      focusMode: "transparent",
      id: "cell.actions",
      target: "cell",
    });
    const opened = openExplicit(
      EMPTY_AUTHORITY_STATE,
      { kind: "cell", cellId: "c1" as NodeId },
      "cell.actions",
      "cell",
    );
    const next = reconcileAuthority(opened, {
      contributors: [selectionBar, cell],
      ctx,
      ready: { selection: true },
      signatures: { selection: "n1:0-n1:4" },
    });
    expect(next.open.map((o) => o.target).sort()).toEqual([
      "cell",
      "selection",
    ]);
  });
});
