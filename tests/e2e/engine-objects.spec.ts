import { expect, test, type Page } from "@playwright/test";

/**
 * docs/010 Phase 6 — heavy objects + bake, driven as real interaction against
 * the mixed-book story. Covers: baked-at-rest with no editor instance (AC1),
 * the one-live-object slot (AC2), the no-drift property between resting and
 * active (AC3), edit → re-bake including the recoverable invalid case (AC4),
 * the text-caret suspend/resume on activation (AC5), and the off-thread
 * bake/index worker round-trip (AC6).
 */
const STORY = "engine--owned-model--phase6-mixed-book";
const API = "__IDCO_ENGINE_VIEW_API__";
const SHOTS = "test-results/phase6";

type ObjectDiag = {
  type: string;
  status: string;
  state: "resting" | "live";
  hasBaked: boolean;
};

type Diag = {
  order: string[];
  objects: Record<string, ObjectDiag>;
  activeObjectId: string | null;
  activeNodeId: string | null;
  liveObjectEditorCount: number;
  selection: { type: string } | null;
  documentIndex: { toc: { text: string }[]; text: { text: string }[] } | null;
  indexFromWorker: boolean;
  workerRoundTrips: number;
};

async function diag(page: Page): Promise<Diag> {
  return page.evaluate((key) => {
    const api = (
      window as unknown as Record<string, { diagnostics: () => Diag }>
    )[key];
    return api.diagnostics();
  }, API);
}

async function open(page: Page): Promise<void> {
  await page.goto(`/?story=${STORY}`, { waitUntil: "commit" });
  await page.locator("[data-engine-view-root]").waitFor({ state: "visible" });
  await page
    .locator('[data-engine-object-baked="code"]')
    .first()
    .waitFor({ state: "visible" });
}

function objectId(d: Diag, type: string): string {
  const id = Object.keys(d.objects).find(
    (key) => d.objects[key]!.type === type,
  );
  if (!id) throw new Error(`no ${type} object in diagnostics`);
  return id;
}

test("AC1 heavy objects rest as baked snapshots with no editor instance", async ({
  page,
}) => {
  await open(page);
  const d = await diag(page);
  expect(d.liveObjectEditorCount).toBe(0);
  expect(await page.locator("[data-engine-object-editor]").count()).toBe(0);
  const codeId = objectId(d, "code-block");
  expect(d.objects[codeId]!.state).toBe("resting");
  expect(d.objects[codeId]!.hasBaked).toBe(true);
  await expect(
    page.locator('[data-engine-object-baked="code"]').first(),
  ).toContainText("function greet");
  await page
    .locator("[data-engine-view-root]")
    .screenshot({ path: `${SHOTS}/rest.png` });
});

test("AC2 only one object is live at a time", async ({ page }) => {
  await open(page);
  const start = await diag(page);
  const codeId = objectId(start, "code-block");
  const mediaId = objectId(start, "media");

  await page.locator(`[data-engine-block-id="${codeId}"]`).click();
  let d = await diag(page);
  expect(d.activeObjectId).toBe(codeId);
  expect(d.liveObjectEditorCount).toBe(1);
  expect(await page.locator("[data-engine-object-editor]").count()).toBe(1);

  // Activating media commits + deactivates code first; still exactly one live.
  await page.locator(`[data-engine-block-id="${mediaId}"]`).click();
  d = await diag(page);
  expect(d.activeObjectId).toBe(mediaId);
  expect(d.objects[codeId]!.state).toBe("resting");
  expect(d.liveObjectEditorCount).toBe(1);
  expect(await page.locator("[data-engine-object-editor]").count()).toBe(1);
});

test("AC3 the object box does not drift between resting and active", async ({
  page,
}) => {
  await open(page);
  const codeId = objectId(await diag(page), "code-block");
  const block = page.locator(`[data-engine-block-id="${codeId}"]`);
  const resting = (await block.boundingBox())!;

  await block.click();
  await page
    .locator('[data-engine-object-editor="code"]')
    .waitFor({ state: "visible" });
  const active = (await block.boundingBox())!;

  expect(Math.abs(active.x - resting.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(active.y - resting.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(active.width - resting.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(active.height - resting.height)).toBeLessThanOrEqual(2);
});

test("AC4 editing an object re-bakes it; an unbakeable edit is recoverable", async ({
  page,
}) => {
  await open(page);
  const codeId = objectId(await diag(page), "code-block");

  await page.locator(`[data-engine-block-id="${codeId}"]`).click();
  const editor = page.locator('[data-engine-object-editor="code"]');
  await editor.waitFor({ state: "visible" });
  await editor.fill("const edited = 42;");
  await page.keyboard.press("Escape");

  // Back at rest, the baked snapshot reflects the new source.
  await expect(
    page.locator('[data-engine-object-baked="code"]').first(),
  ).toContainText("const edited = 42;");
  const afterEdit = await diag(page);
  expect(afterEdit.objects[codeId]!.status).toBe("ready");

  // The compatibility projection carries the new code text (G1 / AC4).
  const compatText = await page.evaluate((key) => {
    const api = (
      window as unknown as Record<
        string,
        {
          getEditorHandle: () => {
            getDocument: () => {
              root: { children: { type: string; text?: string }[] };
            };
          };
        }
      >
    )[key];
    const doc = api.getEditorHandle().getDocument();
    return doc.root.children.find((c) => c.type === "code-block")?.text ?? "";
  }, API);
  expect(compatText).toBe("const edited = 42;");

  // Clearing the media source produces a recoverable invalid object, not a crash.
  const mediaId = objectId(afterEdit, "media");
  await page.locator(`[data-engine-block-id="${mediaId}"]`).click();
  await page
    .locator('[data-engine-config-field="src"]')
    .waitFor({ state: "visible" });
  await page.locator('[data-engine-config-field="src"]').fill("");
  await expect
    .poll(async () => (await diag(page)).objects[mediaId]!.status)
    .toBe("invalid");
  // The object is still present and selectable, not dropped.
  await expect(
    page.locator(`[data-engine-block-id="${mediaId}"]`),
  ).toBeVisible();
});

test("AC5 the text caret suspends on activation and resumes on deactivation", async ({
  page,
}) => {
  await open(page);
  const d = await diag(page);
  const codeId = objectId(d, "code-block");
  const firstTextId = d.order.find((id) => !d.objects[id])!;

  // Put a text caret first.
  await page.locator(`[data-engine-block-id="${firstTextId}"]`).click();
  await expect
    .poll(async () => (await diag(page)).selection?.type)
    .toBe("text");

  // Activating the object suspends the text caret: selection becomes node-atomic
  // and DOM focus moves to the object's own surface (ending any composition).
  await page.locator(`[data-engine-block-id="${codeId}"]`).click();
  let after = await diag(page);
  expect(after.selection?.type).toBe("node");
  expect(after.activeObjectId).toBe(codeId);
  expect(
    await page.evaluate(() =>
      document.activeElement?.getAttribute("data-engine-object-editor"),
    ),
  ).toBe("code");

  // Deactivating resumes text editing: a click back in text gives a text caret.
  await page.keyboard.press("Escape");
  await page.locator(`[data-engine-block-id="${firstTextId}"]`).click();
  after = await diag(page);
  expect(after.activeObjectId).toBeNull();
  expect(after.selection?.type).toBe("text");
});

test("AC6 a pure-compute index runs in the worker (round-trip, off main thread)", async ({
  page,
}) => {
  await open(page);
  await expect
    .poll(async () => (await diag(page)).documentIndex !== null, {
      timeout: 10_000,
    })
    .toBe(true);
  const d = await diag(page);
  expect(d.indexFromWorker).toBe(true);
  expect(d.workerRoundTrips).toBeGreaterThanOrEqual(1);
  // Two headings in the mixed-book document feed the TOC.
  expect(d.documentIndex!.toc.length).toBeGreaterThanOrEqual(2);
  expect(d.documentIndex!.toc.map((entry) => entry.text)).toContain(
    "Second section",
  );
});

test("the live code editor keeps a visible native caret and selection", async ({
  page,
}) => {
  // Regression guard: the Phase 7 caret/::selection suppression must not leak
  // into a live object editor's <textarea> (it is a real input that needs its
  // own caret/selection). Activate the code block and assert its caret-color is
  // not the engine's transparent suppression, while the surface root still is.
  await open(page);
  const codeId = objectId(await diag(page), "code-block");
  await page.locator(`[data-engine-block-id="${codeId}"]`).click();
  const editor = page.locator('[data-engine-object-editor="code"]');
  await editor.waitFor({ state: "visible" });
  const caretColor = await editor.evaluate(
    (el) => getComputedStyle(el).caretColor,
  );
  expect(caretColor.replace(/\s/g, "")).not.toBe("rgba(0,0,0,0)");
  // ...while the engine's own text blocks still suppress their native caret (AC6).
  const textCaret = await page
    .locator("[data-engine-text-id]")
    .first()
    .evaluate((el) => getComputedStyle(el).caretColor);
  expect(textCaret.replace(/\s/g, "")).toBe("rgba(0,0,0,0)");
});
