import { expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom does not implement scrollIntoView; the engine view calls it when
// revealing a block (e.g. find-in-page navigation). A no-op keeps view tests
// running while the real scroll geometry is proven by the engine e2e.
const noopScrollIntoView = (): void => {};
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = noopScrollIntoView;
}

// React Aria's load-more sentinel (ListBoxLoadMoreItem) constructs an
// IntersectionObserver, which jsdom does not implement.
globalThis.IntersectionObserver = class IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;
