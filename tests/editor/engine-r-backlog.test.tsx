// @vitest-environment jsdom

/**
 * R3 (note.md §5.9) — `resolveViewStyle` folds `chromeless`/`fillHeight` into one
 * typed surface style across both render paths, with the caller's `style` winning.
 *
 * The R2 empty-document placeholder is painted in the overlay from live layout
 * (block rects + the model), so its behaviour — shows on an empty doc, clears on
 * input, survives select-all+Delete, neutral (non-heading) style — is covered by
 * the Playwright spec (tests/e2e/engine-r-backlog.spec.ts), which has real
 * geometry; jsdom has none. The click-empty→caret-at-end half of R3 lives there too.
 */
import { describe, expect, it } from "vitest";
import { resolveViewStyle } from "../../packages/editor/src/view/styles";

describe("R3 resolveViewStyle", () => {
  it("keeps the card chrome by default (non-chromeless)", () => {
    const style = resolveViewStyle({
      chromeless: false,
      fillHeight: false,
      viewportHeight: 480,
      virtualize: false,
    });
    expect(style.border).toBeTruthy();
    expect(style.borderRadius).toBeTruthy();
    expect(style.maxWidth).toBeTruthy();
  });

  it("strips border/radius/max-width cap when chromeless", () => {
    const style = resolveViewStyle({
      chromeless: true,
      fillHeight: false,
      viewportHeight: 480,
      virtualize: false,
    });
    expect(style.border).toBeUndefined();
    expect(style.borderRadius).toBeUndefined();
    expect(style.maxWidth).toBeUndefined();
    // Prose essentials still present.
    expect(style.fontFamily).toBeTruthy();
    expect(style.lineHeight).toBeTruthy();
  });

  it("uses a fixed scroller height + content inset on the virtualized path", () => {
    const style = resolveViewStyle({
      chromeless: false,
      fillHeight: false,
      viewportHeight: 320,
      virtualize: true,
    });
    expect(style.height).toBe(320);
    expect(style.overflowAnchor).toBe("none");
    expect(style.overflowY).toBe("auto");
    // The virtualized scroller insets its content like the non-virtualized path
    // (was `padding: 0`, which jammed text against the edge — note.md §5.9 follow-up).
    expect(style.padding).toBe(16);
  });

  it("fills height: 100% on the virtualized path when fillHeight", () => {
    const style = resolveViewStyle({
      chromeless: true,
      fillHeight: true,
      viewportHeight: 320,
      virtualize: true,
    });
    expect(style.height).toBe("100%");
  });

  it("fills minHeight: 100% on the non-virtualized path when fillHeight", () => {
    const style = resolveViewStyle({
      chromeless: true,
      fillHeight: true,
      viewportHeight: 480,
      virtualize: false,
    });
    expect(style.minHeight).toBe("100%");
    expect(style.height).toBeUndefined();
  });

  it("lets the caller's explicit style win (the back-compat escape hatch)", () => {
    const style = resolveViewStyle({
      chromeless: false,
      fillHeight: false,
      style: { border: "none", maxWidth: "none" },
      viewportHeight: 480,
      virtualize: false,
    });
    expect(style.border).toBe("none");
    expect(style.maxWidth).toBe("none");
  });
});
