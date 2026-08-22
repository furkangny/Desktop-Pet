import { emitTo } from '@tauri-apps/api/event';
import { LogicalPosition, LogicalSize, getCurrentWindow } from '@tauri-apps/api/window';
import type { DesktopWindow } from './desktopWindow';
import { calculateBubblePlacement, type BubbleSide } from './bubblePlacement';
import type { Bounds, BubbleFollow, BubbleMessage, PetAction, Vector2 } from './types';

const required = <T extends Element>(selector: string): T =>
  document.querySelector<T>(selector) ?? (() => { throw new Error(`Missing bubble element: ${selector}`); })();

const MIN_W = 140;
const MAX_W = 220;
const MIN_H = 44;
const MAX_H = 92;
const ACTION_MAX_H = 128;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

// The bubble runs in its own tiny transparent window. It sizes itself to the
// message, points a tail at the pet, flips at screen edges, stays click-through
// for ordinary lines and fades out on its own.
export const initializeBubble = async (desktop: DesktopWindow): Promise<void> => {
  document.body.classList.add('bubble-window');
  const root = required<HTMLElement>('#bubble'); root.hidden = false;
  required<HTMLElement>('#app').hidden = true;
  const bodyEl = required<HTMLElement>('.bubble-body');
  const textEl = required<HTMLElement>('#bubble-text');
  const actionEl = required<HTMLButtonElement>('#bubble-action');
  const appWindow = getCurrentWindow();
  let hideTimer: number | null = null;
  let fadeTimer: number | null = null;
  let currentAction: PetAction | null = null;
  let currentId: string | null = null;
  let bubbleSize = { width: MIN_W, height: MIN_H };
  let lastPosition: Vector2 | null = null;
  let lastSide: BubbleSide | null = null;
  let showQueue = Promise.resolve();
  let placementQueue = Promise.resolve();

  const clearTimer = (): void => {
    if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
    if (fadeTimer !== null) { clearTimeout(fadeTimer); fadeTimer = null; }
  };
  const dismiss = (): void => {
    const dismissedId = currentId;
    clearTimer(); root.dataset.leaving = 'true';
    fadeTimer = window.setTimeout(() => {
      fadeTimer = null;
      if (!dismissedId || currentId !== dismissedId) return;
      root.dataset.leaving = 'false'; currentId = null; lastPosition = null; lastSide = null;
      void appWindow.hide().then(() => emitTo('main', 'bubble-visibility', { id: dismissedId, visible: false }));
    }, 190);
  };

  const place = async (anchor: Vector2, petSize: number, workArea: Bounds, ease = false): Promise<void> => {
    const target = calculateBubblePlacement(anchor, petSize, bubbleSize, workArea);
    const previous = lastPosition;
    const position = ease && previous && lastSide === target.side
      ? { x: previous.x + (target.position.x - previous.x) * .55, y: previous.y + (target.position.y - previous.y) * .55 }
      : target.position;
    root.dataset.placement = target.side;
    root.style.setProperty('--tail-x', `${clamp(anchor.x + petSize / 2 - position.x, 18, bubbleSize.width - 18)}px`);
    await appWindow.setPosition(new LogicalPosition(position.x, position.y));
    lastPosition = position; lastSide = target.side;
  };

  const show = async (message: BubbleMessage): Promise<void> => {
    clearTimer();
    currentId = message.id;
    const interactive = Boolean(message.action);
    root.dataset.leaving = 'false';
    root.dataset.measuring = 'true';
    root.dataset.tone = message.tone ?? 'neutral';
    textEl.textContent = message.text;
    currentAction = message.action ?? null;
    actionEl.hidden = !interactive;
    actionEl.textContent = message.actionLabel ?? '';

    // Grow to the widest viewport, then show the window (invisible) so the webview
    // lays out and can be measured — a hidden webview may not run rAF at all.
    await appWindow.setSize(new LogicalSize(MAX_W, interactive ? ACTION_MAX_H : MAX_H));
    await appWindow.setIgnoreCursorEvents(true);
    await appWindow.show();
    const rect = bodyEl.getBoundingClientRect();
    const width = clamp(Math.ceil(rect.width) + 4, MIN_W, MAX_W);
    const height = clamp(Math.ceil(rect.height) + 14, MIN_H, interactive ? ACTION_MAX_H : MAX_H);
    bubbleSize = { width, height };
    await appWindow.setSize(new LogicalSize(width, height));

    lastPosition = null; lastSide = null;
    await place(message.anchor, message.petSize, message.workArea);
    await appWindow.setIgnoreCursorEvents(!interactive);
    root.dataset.measuring = 'false';
    await emitTo('main', 'bubble-visibility', { id: message.id, visible: true });

    const linger = interactive ? Math.max(4_200, message.duration ?? 5_000) : clamp(message.duration ?? 2_600, 1_800, 6_000);
    hideTimer = window.setTimeout(dismiss, linger);
  };

  actionEl.addEventListener('click', () => {
    if (currentAction) void emitTo('main', 'pet-action', { action: currentAction });
    dismiss();
  });

  await appWindow.listen<BubbleMessage>('bubble-message', ({ payload }) => {
    showQueue = showQueue.then(() => show(payload));
  });
  await appWindow.listen<BubbleFollow>('bubble-follow', ({ payload }) => {
    if (payload.id !== currentId || root.dataset.leaving === 'true') return;
    placementQueue = placementQueue.then(() => place(payload.anchor, payload.petSize, payload.workArea, true));
  });
};
