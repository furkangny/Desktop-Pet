import type { Bounds, Vector2 } from './types';

export type BubbleSide = 'above' | 'below';

export interface BubblePlacement {
  position: Vector2;
  side: BubbleSide;
  tailX: number;
}

const GAP = 10;
const MARGIN = 6;
const TAIL_MARGIN = 18;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Pure placement math shared by the initial show and every follow update. */
export const calculateBubblePlacement = (
  anchor: Vector2,
  petSize: number,
  bubbleSize: { width: number; height: number },
  workArea: Bounds
): BubblePlacement => {
  const petCenterX = anchor.x + petSize / 2;
  const x = clamp(
    petCenterX - bubbleSize.width / 2,
    workArea.minX + MARGIN,
    workArea.maxX - bubbleSize.width - MARGIN
  );

  let side: BubbleSide = 'above';
  let y = anchor.y - bubbleSize.height - GAP;
  if (y < workArea.minY + MARGIN) {
    side = 'below';
    y = anchor.y + petSize + GAP;
  }
  y = clamp(y, workArea.minY + MARGIN, workArea.maxY - bubbleSize.height - MARGIN);

  return {
    position: { x, y },
    side,
    tailX: clamp(petCenterX - x, TAIL_MARGIN, bubbleSize.width - TAIL_MARGIN)
  };
};
