import { expect, test } from "vitest";

/**
 * SSR / DOM-less import safety (note.md §5.4, D1).
 *
 * content-api reported that importing `@idco/editor` into an SSR module graph
 * crashed the render. Isolated: importing the package barrels at module-load is
 * SSR-safe — the editor is a client-only *render*, not a client-only *import*, so
 * the correct consumer pattern is a dynamic import with `ssr: false`, not a code
 * change here. This test is the regression guard for that property: it runs in a
 * node environment (see `vitest.ssr.config.ts`) where `window`/`document` do not
 * exist, so any new module-load-time DOM/EditContext access would throw here
 * before it ever reached a consumer's server. Keep all three barrels covered: a
 * consumer's SSR graph transitively imports the editor, which pulls in reader,
 * ui, and lib.
 */
test("idco barrels import in a DOM-less (SSR) module graph without throwing", async () => {
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");

  const editor = await import("@quanghuy1242/idco-editor");
  const reader = await import("@quanghuy1242/idco-reader");
  const ui = await import("@quanghuy1242/idco-ui");
  const lib = await import("@quanghuy1242/idco-lib");

  // A representative export from each barrel resolved — the module graph evaluated.
  expect(editor.OwnedModelEditor).toBeDefined();
  expect(editor.createEditorStore).toBeDefined();
  expect(reader).toBeDefined();
  expect(ui).toBeDefined();
  expect(lib).toBeDefined();
});

/**
 * D2 (note.md §5.5): `CodeEditor` pins `globalThis.Prism` and registers the extra
 * grammar packs onto it. The bug content-api hit is workerd-specific (prismjs's own
 * global detection fails there, so the packs throw `ReferenceError: Prism is not
 * defined`); it does not reproduce in this node env (prismjs resolves `_self` to
 * `globalThis` here). This guards the contract the fix makes runtime-independent:
 * importing the package pins the global and the extra grammars are registered on it.
 */
test("CodeEditor pins globalThis.Prism with the extra grammar packs registered", async () => {
  await import("@quanghuy1242/idco-ui/code-editor");
  const prism = (
    globalThis as { Prism?: { languages?: Record<string, unknown> } }
  ).Prism;
  expect(prism).toBeDefined();
  expect(prism?.languages?.json).toBeDefined();
  expect(prism?.languages?.typescript).toBeDefined();
  expect(prism?.languages?.python).toBeDefined();
});
