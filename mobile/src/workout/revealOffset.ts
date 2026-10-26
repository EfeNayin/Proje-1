/**
 * Distance kept between the revealed panel and the edge of the visible area. On iOS
 * the number pads show a floating "Done" key just above the keyboard, over the foot
 * of the scroll area; this keeps the panel's action button clear of it.
 */
export const REVEAL_MARGIN = 56;

type RevealInput = {
  /** Panel edges measured from the top of the scroll content. */
  targetTop: number;
  targetBottom: number;
  /** Current scroll offset and the height of the visible (keyboard-shrunk) area. */
  offset: number;
  viewportHeight: number;
  margin?: number;
};

/**
 * Scroll offset that brings an entry panel, and with it its action button, into
 * the visible area, or null when it is already fully visible. The bottom edge
 * wins when the panel is taller than the visible area: the action at its foot
 * is what has to stay reachable.
 */
export function revealOffset({
  targetTop,
  targetBottom,
  offset,
  viewportHeight,
  margin = REVEAL_MARGIN,
}: RevealInput): number | null {
  if (viewportHeight <= 0) return null;
  if (targetBottom + margin > offset + viewportHeight) {
    return Math.max(0, targetBottom + margin - viewportHeight);
  }
  if (targetTop - margin < offset) return Math.max(0, targetTop - margin);
  return null;
}
