import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PARAGRAPHS_1000 =
  "packages-editor--rich-text-editor--large-document-paragraphs1000";
const PARAGRAPHS_5000 =
  "packages-editor--rich-text-editor--large-document-paragraphs5000";
const MIXED_BOOK =
  "packages-editor--rich-text-editor--large-document-mixed-book";
const SEARCH_AND_TOC =
  "packages-editor--rich-text-editor--large-document-search-and-toc";

type LargeDocumentSnapshot = {
  readonly activeSectionId: string | null;
  readonly blockCount: number;
  readonly measuredHeightCount: number;
  readonly renderedSectionCount: number;
  readonly sectionCount: number;
  readonly totalHeight: number;
};

test.use({ trace: "off" });

test("large document shell bounds rendered sections for 1000 and 5000 blocks", async ({
  page,
}, testInfo) => {
  const oneThousand = await measureLargeStory(page, PARAGRAPHS_1000);
  const fiveThousand = await measureLargeStory(page, PARAGRAPHS_5000);
  const report = {
    recordedAt: new Date().toISOString(),
    oneThousand,
    fiveThousand,
  };
  await writeReport("large-document-load.json", report, testInfo);

  expect(oneThousand.blockCount).toBe(1000);
  expect(fiveThousand.blockCount).toBe(5000);
  expect(oneThousand.renderedSectionCount).toBeLessThan(
    oneThousand.sectionCount,
  );
  expect(fiveThousand.renderedSectionCount).toBeLessThan(
    fiveThousand.sectionCount,
  );
  expect(fiveThousand.domNodes).toBeLessThan(2000);
});

test("large document shell scrolls without accumulating rendered sections", async ({
  page,
}, testInfo) => {
  await openStory(page, PARAGRAPHS_5000);
  const top = await readSnapshot(page);
  const mid = await scrollToRatio(page, 0.5);
  const bottom = await scrollToRatio(page, 1);
  const backTop = await scrollToRatio(page, 0);
  const report = { backTop, bottom, mid, top };
  await writeReport("large-document-scroll.json", report, testInfo);

  expect(mid.renderedSectionCount).toBeLessThan(top.sectionCount * 0.25);
  expect(bottom.renderedSectionCount).toBeLessThan(top.sectionCount * 0.25);
  expect(backTop.renderedSectionCount).toBeLessThan(top.sectionCount * 0.25);
  expect(await shellScrollTop(page)).toBeLessThan(8);
});

test("large document shell activates, types, commits, searches, and navigates TOC", async ({
  page,
}, testInfo) => {
  await openStory(page, MIXED_BOOK);
  await scrollToRatio(page, 0.35);
  await clickFirstViewportSection(page);
  const editor = page.getByRole("textbox", {
    name: /large document mixed book/i,
  });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" production-grade edit");
  await page.locator("[data-large-document-shell]").evaluate((element) => {
    const scroller = element as HTMLElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(350);
  await page.getByRole("textbox", { name: /search document/i }).click();
  await page
    .getByRole("textbox", { name: /search document/i })
    .fill("production-grade edit");
  await expect
    .poll(() =>
      page.getByRole("button", { name: /production-grade edit/i }).count(),
    )
    .toBeGreaterThan(0);

  await openStory(page, SEARCH_AND_TOC);
  await page
    .getByRole("textbox", { name: /search document/i })
    .fill("Search marker 120");
  await page
    .getByRole("button", { name: /Search marker 120/i })
    .first()
    .click();
  await expect(
    page.getByRole("textbox", { name: /search and toc/i }),
  ).toBeVisible();
  await expect.poll(() => selectedText(page)).toBe("Search marker 120");
  const activeAfterSearch = await readSnapshot(page);

  await page.getByRole("button", { exact: true, name: "Chapter 2" }).click();
  await page.waitForTimeout(250);
  const tocScrollTop = await shellScrollTop(page);
  await writeReport(
    "large-document-interactions.json",
    { activeAfterSearch, tocScrollTop },
    testInfo,
  );

  expect(activeAfterSearch.activeSectionId).not.toBeNull();
  expect(tocScrollTop).toBeGreaterThan(0);
});

async function measureLargeStory(page: Page, story: string) {
  const startedAt = Date.now();
  await openStory(page, story);
  const snapshot = await readSnapshot(page);
  return {
    ...snapshot,
    domNodes: await page.locator("*").count(),
    readyMs: Date.now() - startedAt,
  };
}

async function openStory(page: Page, story: string): Promise<void> {
  await page.goto(`/?story=${story}`, { waitUntil: "commit" });
  await page
    .locator("[data-large-document-shell]")
    .waitFor({ state: "visible" });
  await expect
    .poll(() => readSnapshot(page).then((snapshot) => snapshot.sectionCount))
    .toBeGreaterThan(0);
}

async function readSnapshot(page: Page): Promise<LargeDocumentSnapshot> {
  return page.evaluate(() => {
    const snapshot = window["__IDCO_LARGE_DOC__"];
    if (!snapshot) throw new Error("Missing large-document diagnostics");
    return snapshot;
  });
}

async function scrollToRatio(
  page: Page,
  ratio: number,
): Promise<LargeDocumentSnapshot> {
  await page
    .locator("[data-large-document-shell]")
    .evaluate((element, nextRatio) => {
      const scroller = element as HTMLElement;
      scroller.scrollTop =
        (scroller.scrollHeight - scroller.clientHeight) * nextRatio;
    }, ratio);
  await page.waitForTimeout(350);
  return readSnapshot(page);
}

async function shellScrollTop(page: Page): Promise<number> {
  return page
    .locator("[data-large-document-shell]")
    .evaluate((element) => Math.round((element as HTMLElement).scrollTop));
}

async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? "");
}

async function clickFirstViewportSection(page: Page): Promise<void> {
  const index = await page
    .locator("[data-large-document-shell]")
    .evaluate((element) => {
      const shell = element.getBoundingClientRect();
      const sections = Array.from(
        element.querySelectorAll<HTMLElement>("[data-section-id]"),
      );
      return sections.findIndex((section) => {
        const rect = section.getBoundingClientRect();
        return rect.bottom > shell.top + 48 && rect.top < shell.bottom - 48;
      });
    });
  expect(index).toBeGreaterThanOrEqual(0);
  await page
    .locator("[data-section-id]")
    .nth(index)
    .click({ position: { x: 24, y: 24 } });
}

async function writeReport(
  filename: string,
  report: unknown,
  testInfo: TestInfo,
): Promise<void> {
  const reportDir =
    process.env.EDITOR_PERF_REPORT_DIR ??
    join(process.cwd(), "test-results", "editor-perf");
  await mkdir(reportDir, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(reportDir, filename), json);
  await writeFile(testInfo.outputPath(filename), json);
}
