import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { DesktopWindow } from './desktopWindow';
import { loadPetData } from './storage';
import type { DueEvent, PetAction, PopoverMessage } from './types';

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing popover element: ${selector}`);
  return element;
};

export const initializePopover = async (desktop: DesktopWindow): Promise<void> => {
  document.body.classList.add('popover-window');
  required<HTMLElement>('#popover').hidden = false;
  required<HTMLElement>('#app').hidden = true;
  let currentEvent: DueEvent | null = null;
  let speechTimer: number | null = null;

  const render = (message: PopoverMessage): void => {
    const menu = required<HTMLElement>('#quick-menu');
    const alert = required<HTMLElement>('#alert-popover');
    const speech = required<HTMLElement>('#speech-popover');
    if (speechTimer !== null) { clearTimeout(speechTimer); speechTimer = null; }
    menu.hidden = message.type !== 'menu';
    alert.hidden = message.type !== 'alert';
    speech.hidden = message.type !== 'speech';
    if (message.type === 'menu') {
      const pin = required<HTMLButtonElement>('[data-action="toggle-pin"]');
      required<HTMLElement>('#quick-pet-name').textContent = message.petName;
      required<HTMLElement>('[data-action="toggle-pin"] [data-action-label]').textContent = message.movementMode === 'pinned' ? 'Serbest bırak' : 'Buraya sabitle';
      currentEvent = null;
      return;
    }
    if (message.type === 'speech') {
      currentEvent = null;
      speech.dataset.tone = message.tone ?? 'neutral';
      required<HTMLElement>('#speech-message').textContent = message.message;
      const action = required<HTMLButtonElement>('#speech-action');
      action.hidden = !message.action; action.dataset.action = message.action ?? ''; action.textContent = message.actionLabel ?? '';
      speechTimer = window.setTimeout(() => void desktop.hideCurrent(), message.duration ?? 2_800);
      return;
    }
    currentEvent = message.event;
    required<HTMLElement>('#alert-kind').textContent = message.event.kind === 'alarm' ? 'ALARM' : 'HATIRLATMA';
    required<HTMLElement>('#alert-title').textContent = message.event.title;
    required<HTMLElement>('#alert-details').textContent = message.event.details;
    required<HTMLButtonElement>('#alert-snooze').textContent = `${loadPetData().settings.audio.snoozeMinutes} dk ertele`;
  };

  const send = async (action: PetAction, extra: Record<string, unknown> = {}): Promise<void> => {
    if (desktop.isNative()) await emitTo('main', 'pet-action', { action, eventId: currentEvent?.id, ...extra });
    else window.dispatchEvent(new CustomEvent('pet-action', { detail: { action, eventId: currentEvent?.id, ...extra } }));
  };
  const resolveAlert = async (action: 'dismiss' | 'snooze', minutes?: number): Promise<void> => {
    if (!currentEvent) return;
    if (desktop.isNative()) await emitTo('main', 'pet-action', { action: action === 'snooze' ? 'snooze-alert' : 'dismiss-alert', eventId: currentEvent.id, minutes });
    else window.dispatchEvent(new CustomEvent('pet-action', { detail: { action: action === 'snooze' ? 'snooze-alert' : 'dismiss-alert', eventId: currentEvent.id, minutes } }));
  };

  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
    button.addEventListener('click', () => { if (!button.dataset.action) return; void send(button.dataset.action as PetAction); void desktop.hideCurrent(); });
  });
  required<HTMLButtonElement>('#speech-action').addEventListener('click', (event) => {
    const action = (event.currentTarget as HTMLButtonElement).dataset.action as PetAction | undefined;
    if (action) void send(action); void desktop.hideCurrent();
  });
  required<HTMLButtonElement>('#alert-done').addEventListener('click', () => { void resolveAlert('dismiss').finally(() => desktop.hideCurrent()); });
  required<HTMLButtonElement>('#alert-snooze').addEventListener('click', () => { void resolveAlert('snooze', loadPetData().settings.audio.snoozeMinutes).finally(() => desktop.hideCurrent()); });
  required<HTMLButtonElement>('#alert-open').addEventListener('click', () => { void send('open-manager'); void desktop.hideCurrent(); });
  required<HTMLButtonElement>('#popover-close').addEventListener('click', () => void desktop.hideCurrent());
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') void desktop.hideCurrent(); });
  if (desktop.isNative()) await getCurrentWindow().listen<PopoverMessage>('popover-message', ({ payload }) => render(payload));
};
