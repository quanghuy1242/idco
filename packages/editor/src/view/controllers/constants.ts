/**
 * Tunable constants shared by the editor view orchestrator and its controllers
 * (docs/020 §4.3). Lifted verbatim from `react-view.tsx` so each controller reads
 * the same value without re-declaring it.
 */

// Keys the root gap handler treats as a gap walk (docs/019 §4.10). Arrows step
// across atoms / descend / escape; Home/End jump to the scope's first/last slot.
export const GAP_NAV_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
]);

export const DEFAULT_VIEWPORT_HEIGHT = 480;
export const DEFAULT_OVERSCAN = 4;
export const DEFAULT_BLOCK_ESTIMATE = 40;
export const AUTOSCROLL_STEP_PX = 12;
// Lead the caret keeps from the viewport edge when keyboard movement scrolls it
// into view (~one line). Small enough that each line-move scrolls about one
// line, not a whole block. Trivially promotable to a prop if a knob is wanted.
export const CARET_REVEAL_MARGIN_PX = 24;
// PageUp/PageDown fall-back scroll distance when no caret line sits at the edge
// (docs/018 §2.4). A touch under one viewport keeps a little overlap for context.
export const PAGE_SCROLL_FRACTION = 0.9;
// A still-held touch this long becomes a word-select (vs a tap); a pre-threshold
// drag becomes a scroll. Matches the platform long-press feel.
export const TOUCH_LONG_PRESS_MS = 450;
// Movement before the long-press fires that reclassifies the gesture as a scroll.
export const TOUCH_MOVE_CANCEL_PX = 10;
// After long-press has selected text, require a deliberate move before extending
// the range. Without this post-long-press slop, normal finger drift during the
// hold turns into a range drag, which feels too light compared with native text.
export const TOUCH_SELECTION_DRAG_START_PX = 18;
// Grip drags should start sooner than long-press drags, but still not jump from
// the tiny movement caused by touching the handle.
export const TOUCH_HANDLE_DRAG_START_PX = 8;
// Hit slop around the collapsed caret for the native-style "hold caret -> Paste"
// gesture. The caret is engine-painted and very thin, so this intentionally
// targets the line around it rather than the one-pixel bar.
export const TOUCH_CARET_HIT_SLOP_X = 24;
export const TOUCH_CARET_HIT_SLOP_Y = 30;
// How far above the fingertip a grip drag hit-tests, so the resolved point lands
// on the selected line instead of under the finger/grip covering it.
export const HANDLE_TOUCH_LIFT_PX = 28;
