export interface DragGestureMetrics {
  durationMs: number;
  reversals: number;
  peakSpeed: number;
  totalDx: number;
  totalDy: number;
}

export type DragGesture = 'shake' | 'pet' | 'throw' | 'tap';

export const classifyDragGesture = (metrics: DragGestureMetrics, releaseSpeed: number): DragGesture => {
  const horizontalRatio = metrics.totalDx / Math.max(1, metrics.totalDy);
  if (metrics.durationMs <= 1_250 && metrics.reversals >= 3 && metrics.peakSpeed >= 380 && metrics.totalDx >= 105 && horizontalRatio >= 1.35) return 'shake';
  if (metrics.durationMs >= 260 && metrics.reversals >= 1 && metrics.peakSpeed < 380 && metrics.totalDx >= 55 && horizontalRatio >= 1.7) return 'pet';
  if (releaseSpeed >= 900) return 'throw';
  return 'tap';
};
