// @vitest-environment jsdom
/**
 * Insights / Statistics pane (docs/027 §9.4): the pure text-stats calculator and the
 * pane that renders the live document index back, including selection-scoped counts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  type DocumentIndex,
  type EditorStore,
} from "../../packages/editor/src/core";
import { createDocumentIndexStore } from "../../packages/editor/src/view/controllers/document-index-store";
import {
  buildCommandContext,
  computeToolbarLayout,
  getSidePanel,
  registerBuiltInBlockTypes,
  type CommandContext,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { registerBuiltInMarks } from "../../packages/editor/src/view/render";
import { registerBuiltInNodeViews } from "../../packages/editor/src/view/nodes";
import {
  computeTextStats,
  joinIndexText,
  StatisticsPane,
} from "../../packages/editor/src/view/chrome/panes";
import { registerBuiltInCommands } from "../../packages/editor/src/view/chrome";
import { DocumentIndexProvider } from "../../packages/editor/src/view/document-index";

beforeAll(() => {
  registerBuiltInMarks();
  registerBuiltInBlockTypes();
  registerBuiltInNodeViews();
  registerBuiltInCommands();
});

const CAPS: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: false,
  review: false,
};

function storeOf(text: string): EditorStore {
  const allocator = createIdAllocator("idco_client_insights");
  const node = makeTextNode({
    content: allocator.createTextSlice(text),
    id: allocator.createNodeId(),
    type: "paragraph",
  });
  return createEditorStore({
    allocator,
    snapshot: {
      body: { blocks: { [node.id]: node }, order: [node.id] },
      settings: {},
      version: 1,
    },
  });
}

describe("computeTextStats (docs/027 §9.4)", () => {
  it("counts words, characters, and sentences", () => {
    const s = computeTextStats("Hello world. This is fine!");
    expect(s.words).toBe(5);
    expect(s.characters).toBe("Hello world. This is fine!".length);
    expect(s.charactersNoSpaces).toBe(22);
    expect(s.sentences).toBe(2);
  });

  it("is zero for empty/whitespace text and withholds readability below threshold", () => {
    const empty = computeTextStats("   \n  ");
    expect(empty.words).toBe(0);
    expect(empty.sentences).toBe(0);
    expect(empty.readingMinutes).toBe(0);
    expect(empty.readability).toBeNull();
    // A short sentence is below the readability word threshold.
    expect(computeTextStats("Too short to score.").readability).toBeNull();
  });

  it("produces a clamped Flesch estimate once there is enough text", () => {
    const prose =
      "The cat sat on the mat. The dog ran in the park. Birds sing every single morning here. It was a calm and quiet day for everyone around.";
    const s = computeTextStats(prose);
    expect(s.readability).not.toBeNull();
    expect(s.readability!).toBeGreaterThanOrEqual(0);
    expect(s.readability!).toBeLessThanOrEqual(100);
  });

  it("rounds reading time to whole minutes, at least 1 for any text", () => {
    expect(computeTextStats("one two three").readingMinutes).toBe(1);
    const long = computeTextStats(
      Array.from({ length: 600 }, () => "w").join(" "),
    );
    expect(long.readingMinutes).toBe(3);
  });

  it("joinIndexText concatenates entry texts", () => {
    expect(joinIndexText([{ text: "a b" }, { text: "c" }])).toBe("a b\nc");
  });
});

describe("Insights pane registration (docs/027 §9.4 / §7.7)", () => {
  it("registers the Insights side panel", () => {
    expect(getSidePanel("insights")?.title).toBe("Insights");
  });

  it("places the Insights command in the Review tab, making Review appear", () => {
    const layout = computeToolbarLayout(
      buildCommandContext(storeOf("x"), CAPS),
    );
    const review = layout.tabs.find((t) => t.id === "review");
    expect(review).toBeDefined();
    const ids = review!.slots.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain("review.insights");
  });
});

describe("StatisticsPane render (docs/027 §9.4)", () => {
  const index: DocumentIndex = {
    collections: {},
    comments: [],
    text: [
      { id: "p1" as never, text: "alpha beta gamma", type: "paragraph" },
      { id: "p2" as never, text: "delta", type: "paragraph" },
    ],
    toc: [
      { anchor: "h", id: "h" as never, level: 1, slug: "h", text: "Heading" },
    ],
  };

  function renderPane(ctx: CommandContext) {
    return render(
      <DocumentIndexProvider store={createDocumentIndexStore(index)}>
        <StatisticsPane ctx={ctx} />
      </DocumentIndexProvider>,
    );
  }

  it("renders whole-document counts from the live index", () => {
    const { container } = renderPane(buildCommandContext(storeOf("x"), CAPS));
    const text = container.textContent ?? "";
    // 4 words across the two text entries; 1 heading.
    expect(text).toContain("Words");
    expect(container.querySelector("[data-engine-statistics]")).not.toBeNull();
    // Word value (4) appears; reading time floors to 1 min for any text.
    expect(text).toContain("4");
    expect(text).toContain("1 min");
  });

  it("shows a selection section only when text is selected", () => {
    const base = buildCommandContext(storeOf("x"), CAPS);
    const withSel: CommandContext = {
      ...base,
      selection: {
        ...base.selection,
        hasSelection: true,
        selectedText: "two words",
      },
    };
    const { getByText, queryByText, rerender } = render(
      <DocumentIndexProvider store={createDocumentIndexStore(index)}>
        <StatisticsPane ctx={withSel} />
      </DocumentIndexProvider>,
    );
    expect(getByText("Selection")).toBeTruthy();

    rerender(
      <DocumentIndexProvider store={createDocumentIndexStore(index)}>
        <StatisticsPane ctx={base} />
      </DocumentIndexProvider>,
    );
    expect(queryByText("Selection")).toBeNull();
  });
});
