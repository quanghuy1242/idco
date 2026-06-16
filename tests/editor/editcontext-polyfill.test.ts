// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  EditContext,
  install,
  releaseForcedInstall,
} from "../../packages/editor/src/owned-model/vendor/editcontext-polyfill";

function nativeCtor() {}

describe("vendored editcontext polyfill", () => {
  it("loads and exposes install and EditContext", () => {
    expect(typeof install).toBe("function");
    expect(typeof EditContext).toBe("function");
  });

  it("installs onto a target lacking EditContext", () => {
    const target: Record<string, unknown> = {};
    const result = install({ target });

    expect(result).toEqual({ installed: true, native: false });
    expect(target.EditContext).toBe(EditContext);
  });

  it("leaves a native EditContext in place unless forced", () => {
    const target: Record<string, unknown> = { EditContext: nativeCtor };

    expect(install({ target })).toEqual({ installed: false, native: true });
    expect(target.EditContext).toBe(nativeCtor);

    expect(install({ force: true, target })).toEqual({
      installed: true,
      native: true,
    });
    expect(target.EditContext).toBe(EditContext);
  });

  it("does not patch document Selection while installing the API polyfill", () => {
    const originalAddRange = Selection.prototype.addRange;
    const originalRemoveAllRanges = Selection.prototype.removeAllRanges;

    install({ force: true });
    try {
      expect(Selection.prototype.addRange).toBe(originalAddRange);
      expect(Selection.prototype.removeAllRanges).toBe(originalRemoveAllRanges);
    } finally {
      releaseForcedInstall();
    }
  });

  it("owns a text buffer and selection decoupled from the DOM", () => {
    const ctx = new EditContext({
      text: "abcdef",
      selectionStart: 2,
      selectionEnd: 2,
    });
    expect(ctx.text).toBe("abcdef");
    expect(ctx.selectionStart).toBe(2);
    expect(ctx.selectionEnd).toBe(2);

    ctx.updateText(2, 4, "XY");
    expect(ctx.text).toBe("abXYef");

    ctx.updateSelection(1, 5);
    expect(ctx.selectionStart).toBe(1);
    expect(ctx.selectionEnd).toBe(5);

    // Out-of-range offsets clamp to the buffer length.
    ctx.updateSelection(99, 99);
    expect(ctx.selectionEnd).toBe(ctx.text.length);
  });
});
