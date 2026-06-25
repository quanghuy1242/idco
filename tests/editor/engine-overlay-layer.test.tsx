// @vitest-environment jsdom
/**
 * Overlay layer + authority hook integration (docs/029 §4.7D / §7.1, R1-A + R1-C). Proves
 * the wiring end to end without a migrated surface: opening a focus-taking `form` contributor
 * (1) renders an envelope through the transform-free portal layer, (2) autofocuses the form's
 * field (the focus policy that replaces `useAutoFocusWithin`), and (3) drives the focus-
 * reclaim seam (`store.isReclaimSuspended()` goes true while the form owns focus, false on
 * dismissal). This is Phase-1 infra exercised in isolation; the live editor still uses the
 * old coordinator (nothing user-visible changed).
 */
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEditorStore,
  createIdAllocator,
  makeTextNode,
  type EditorStore,
} from "../../packages/editor/src/core";
import {
  clearOverlayContributors,
  registerOverlay,
  useOverlayAuthority,
  type OverlayAuthority,
  type ToolbarCapabilities,
} from "../../packages/editor/src/view/spi";
import { OverlayLayer } from "../../packages/editor/src/view/chrome/surfaces";

const CAPS: ToolbarCapabilities = {
  ai: false,
  insertTable: true,
  media: false,
  review: false,
};

function freshStore(): EditorStore {
  const allocator = createIdAllocator("idco_client_overlay_layer");
  const node = makeTextNode({
    content: allocator.createTextSlice("hello world"),
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

function Harness(props: {
  readonly store: EditorStore;
  readonly authorityRef: { current: OverlayAuthority | null };
}) {
  const authority = useOverlayAuthority(props.store, CAPS, {
    focusEditor: () => {},
  });
  props.authorityRef.current = authority;
  return <OverlayLayer authority={authority} store={props.store} />;
}

describe("overlay layer + authority (docs/029 §4.7D / §7.1)", () => {
  beforeEach(() => {
    clearOverlayContributors();
    registerOverlay({
      contentKind: "form",
      focusMode: "taking",
      id: "point.form",
      render: () => <input aria-label="field" data-testid="field" />,
      target: "point",
    });
  });
  afterEach(() => clearOverlayContributors());

  it("opens a form envelope, autofocuses its field, and drives the reclaim seam", async () => {
    const store = freshStore();
    const authorityRef: { current: OverlayAuthority | null } = {
      current: null,
    };
    render(<Harness authorityRef={authorityRef} store={store} />);

    // The transform-free portal layer is mounted.
    await waitFor(() =>
      expect(
        document.querySelector("[data-engine-overlay-layer]"),
      ).not.toBeNull(),
    );
    expect(store.isReclaimSuspended()).toBe(false);

    act(() => {
      authorityRef.current!.open({ kind: "point", x: 20, y: 30 }, "point.form");
    });

    // The envelope renders through the portal...
    await waitFor(() =>
      expect(
        document.querySelector('[data-engine-overlay="point"]'),
      ).not.toBeNull(),
    );
    // ...its field is autofocused (the focus policy that replaces useAutoFocusWithin)...
    await waitFor(() =>
      expect(
        (document.activeElement as HTMLElement | null)?.getAttribute(
          "data-testid",
        ),
      ).toBe("field"),
    );
    // ...and the focus-reclaim seam is suspended while the taking form owns focus.
    await waitFor(() => expect(store.isReclaimSuspended()).toBe(true));

    act(() => {
      authorityRef.current!.dismiss("point");
    });

    await waitFor(() =>
      expect(
        document.querySelector('[data-engine-overlay="point"]'),
      ).toBeNull(),
    );
    await waitFor(() => expect(store.isReclaimSuspended()).toBe(false));
  });
});
