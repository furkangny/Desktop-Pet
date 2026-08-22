import { disable, enable } from '@tauri-apps/plugin-autostart';
import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PetAudioEngine } from './audio';
import type { DesktopWindow } from './desktopWindow';
import { PET_MANIFESTS } from './petCatalog';
import { SpriteRenderer } from './spriteRenderer';
import { DATA_CHANNEL, acceptRemotePetData, addAlarm, addNote, addReminder, loadPetData, removeItem, replaceItem, saveSettings } from './storage';
import type { AlarmItem, DataChannelMessage, OrganizerItem, PetAction, PetId, PetSettings, ReminderItem } from './types';

const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing manager element: ${selector}`);
  return element;
};
const formatDate = (value: string): string => new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const toLocalInput = (date: Date): string => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
const statusLabel: Record<string, string> = { pending: 'Bekliyor', snoozed: 'Ertelendi', completed: 'Tamamlandı', dismissed: 'Kapalı', missed: 'Kaçırıldı' };

const createButton = (label: string, action: () => Promise<void>): HTMLButtonElement => {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'small-button'; button.textContent = label;
  button.addEventListener('click', () => { button.disabled = true; void action().finally(() => { button.disabled = false; }); });
  return button;
};

const createItemCard = (item: OrganizerItem, rerender: () => void, editItem: (item: OrganizerItem) => void): HTMLElement => {
  const card = document.createElement('article'); card.className = 'item-card';
  const heading = document.createElement('div'); heading.className = 'item-heading';
  const title = document.createElement('strong'); title.textContent = item.type === 'alarm' ? item.label : item.title; heading.append(title);
  const meta = document.createElement('span');
  if (item.type === 'note') meta.textContent = formatDate(item.createdAt);
  else if (item.type === 'alarm' && item.schedule === 'daily') meta.textContent = `Her gün ${new Date(item.scheduledAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} · ${statusLabel[item.status]}`;
  else meta.textContent = `${formatDate(item.scheduledAt)} · ${statusLabel[item.status]}`;
  heading.append(meta); card.append(heading);
  const details = item.type === 'note' ? item.body : item.type === 'reminder' ? item.details : '';
  if (details) { const paragraph = document.createElement('p'); paragraph.textContent = details; card.append(paragraph); }
  const actions = document.createElement('div'); actions.className = 'item-actions';
  if (item.type === 'reminder') actions.append(createButton(item.status === 'completed' ? 'Geri al' : 'Tamamlandı', async () => {
    await replaceItem({ ...item, status: item.status === 'completed' ? 'pending' : 'completed', occurrenceKey: item.status === 'completed' ? null : item.occurrenceKey } satisfies ReminderItem); rerender();
  }));
  if (item.type === 'alarm') actions.append(createButton(item.enabled ? 'Kapat' : 'Aç', async () => {
    await replaceItem({ ...item, enabled: !item.enabled, status: item.enabled ? 'dismissed' : 'pending', occurrenceKey: item.enabled ? item.occurrenceKey : null } satisfies AlarmItem); rerender();
  }));
  actions.append(createButton('Düzenle', async () => { editItem(item); }));
  actions.append(createButton('Sil', async () => { await removeItem(item.id); rerender(); })); card.append(actions);
  if (item.type !== 'note' && (item.status === 'completed' || item.status === 'dismissed' || item.status === 'missed')) card.dataset.muted = 'true';
  return card;
};

export const initializeManager = async (desktop: DesktopWindow): Promise<void> => {
  document.body.classList.add('manager-window'); required<HTMLElement>('#manager').hidden = false; required<HTMLElement>('#app').hidden = true;
  await desktop.hideInsteadOfClose();
  const noteForm = required<HTMLFormElement>('#note-form'); const reminderForm = required<HTMLFormElement>('#reminder-form');
  const alarmForm = required<HTMLFormElement>('#alarm-form'); const petForm = required<HTMLFormElement>('#pet-form');
  const previewAudio = new PetAudioEngine(loadPetData().settings.audio);
  const previewRenderer = new SpriteRenderer(required<HTMLElement>('#settings-pet-sprite'));
  let settingsDirty = false;
  let previewFrame = 0;
  const resetOrganizerForm = (kind: 'note' | 'reminder' | 'alarm'): void => {
    const form = kind === 'note' ? noteForm : kind === 'reminder' ? reminderForm : alarmForm;
    form.reset(); (form.elements.namedItem('id') as HTMLInputElement).value = '';
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.textContent = kind === 'note' ? 'Notu kaydet' : kind === 'reminder' ? 'Hatırlatıcı ekle' : 'Alarm kur';
    const cancel = form.querySelector<HTMLButtonElement>('[data-edit-cancel]');
    if (cancel) cancel.hidden = true;
  };
  const editOrganizerItem = (item: OrganizerItem): void => {
    if (item.type === 'note') {
      activateTab('notes'); (noteForm.elements.namedItem('id') as HTMLInputElement).value = item.id;
      (noteForm.elements.namedItem('title') as HTMLInputElement).value = item.title; (noteForm.elements.namedItem('body') as HTMLTextAreaElement).value = item.body;
      noteForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent = 'Notu güncelle'; noteForm.querySelector<HTMLButtonElement>('[data-edit-cancel]')!.hidden = false; noteForm.scrollIntoView({ block: 'start' }); return;
    }
    if (item.type === 'reminder') {
      activateTab('reminders'); (reminderForm.elements.namedItem('id') as HTMLInputElement).value = item.id;
      (reminderForm.elements.namedItem('title') as HTMLInputElement).value = item.title; (reminderForm.elements.namedItem('details') as HTMLTextAreaElement).value = item.details;
      (reminderForm.elements.namedItem('scheduledAt') as HTMLInputElement).value = toLocalInput(new Date(item.snoozedUntil ?? item.scheduledAt));
      reminderForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent = 'Hatırlatıcıyı güncelle'; reminderForm.querySelector<HTMLButtonElement>('[data-edit-cancel]')!.hidden = false; reminderForm.scrollIntoView({ block: 'start' }); return;
    }
    activateTab('alarms'); (alarmForm.elements.namedItem('id') as HTMLInputElement).value = item.id;
    (alarmForm.elements.namedItem('label') as HTMLInputElement).value = item.label; (alarmForm.elements.namedItem('schedule') as HTMLSelectElement).value = item.schedule;
    (alarmForm.elements.namedItem('scheduledAt') as HTMLInputElement).value = toLocalInput(new Date(item.snoozedUntil ?? item.scheduledAt));
    alarmForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.textContent = 'Alarmı güncelle'; alarmForm.querySelector<HTMLButtonElement>('[data-edit-cancel]')!.hidden = false; alarmForm.scrollIntoView({ block: 'start' });
  };

  const updatePreview = (): void => {
    const form = new FormData(petForm);
    const petId = (String(form.get('petId') || loadPetData().settings.petId)) as PetId;
    const size = (String(form.get('petSize') || loadPetData().settings.petSize)) as PetSettings['petSize'];
    const manifest = PET_MANIFESTS[petId];
    previewRenderer.setPet(petId, size === 'large' ? 'medium' : size === 'tiny' ? 'small' : size);
    required<HTMLElement>('#settings-preview-name').textContent = manifest.displayName;
    required<HTMLElement>('#settings-preview-description').textContent = manifest.description;
  };
  const renderLists = (): void => {
    const data = loadPetData(); required<HTMLElement>('#manager-title').textContent = data.settings.name;
    const lists = { note: required<HTMLElement>('#notes-list'), reminder: required<HTMLElement>('#reminders-list'), alarm: required<HTMLElement>('#alarms-list') };
    Object.values(lists).forEach((list) => list.replaceChildren());
    [...data.items].sort((a, b) => new Date(b.type === 'note' ? b.createdAt : b.scheduledAt).getTime() - new Date(a.type === 'note' ? a.createdAt : a.scheduledAt).getTime()).forEach((item) => lists[item.type].append(createItemCard(item, renderLists, editOrganizerItem)));
  };
  const hydrateSettings = (): void => {
    const data = loadPetData();
    (petForm.elements.namedItem('name') as HTMLInputElement).value = data.settings.name;
    (petForm.elements.namedItem('petSize') as HTMLSelectElement).value = data.settings.petSize;
    (petForm.elements.namedItem('movementLevel') as HTMLSelectElement).value = data.settings.movementLevel;
    const petRadio = petForm.querySelector<HTMLInputElement>(`input[name="petId"][value="${data.settings.petId}"]`); if (petRadio) petRadio.checked = true;
    const modeRadio = petForm.querySelector<HTMLInputElement>(`input[name="movementMode"][value="${data.settings.movementMode}"]`); if (modeRadio) modeRadio.checked = true;
    (petForm.elements.namedItem('autostart') as HTMLInputElement).checked = data.settings.autostart;
    (petForm.elements.namedItem('reducedMotion') as HTMLInputElement).checked = data.settings.reducedMotion;
    (petForm.elements.namedItem('muted') as HTMLInputElement).checked = data.settings.audio.muted;
    (['interactionEnabled', 'reminderEnabled', 'alarmEnabled', 'voiceEnabled'] as const).forEach((name) => {
      (petForm.elements.namedItem(name) as HTMLInputElement).checked = data.settings.audio[name];
    });
    (petForm.elements.namedItem('snoozeMinutes') as HTMLSelectElement).value = String(data.settings.audio.snoozeMinutes);
    previewAudio.update(data.settings.audio);
    (['masterVolume', 'interactionVolume', 'reminderVolume', 'alarmVolume', 'voiceVolume'] as const).forEach((name) => {
      const input = petForm.elements.namedItem(name) as HTMLInputElement; input.value = String(data.settings.audio[name]);
      const output = petForm.querySelector<HTMLOutputElement>(`[data-volume="${name}"]`); if (output) output.value = `%${input.value}`;
    });
    settingsDirty = false;
    petForm.dataset.dirty = 'false';
    updatePreview();
  };
  const render = (forceSettings = false): void => { renderLists(); if (forceSettings || !settingsDirty) hydrateSettings(); };
  const markDirty = (): void => {
    settingsDirty = true; petForm.dataset.dirty = 'true';
    required<HTMLElement>('#settings-status').textContent = 'Kaydedilmemiş değişiklikler var.';
    updatePreview();
  };

  const activateTab = (target: string): void => {
    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === target)));
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => { panel.hidden = panel.dataset.panel !== target; });
  };
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((tab) => tab.addEventListener('click', () => activateTab(tab.dataset.tab ?? 'notes')));
  petForm.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => input.addEventListener('input', () => {
    const output = petForm.querySelector<HTMLOutputElement>(`[data-volume="${input.name}"]`); if (output) output.value = `%${input.value}`;
  }));
  petForm.addEventListener('input', markDirty);
  petForm.addEventListener('change', markDirty);
  required<HTMLButtonElement>('#settings-reset').addEventListener('click', () => { hydrateSettings(); required<HTMLElement>('#settings-status').textContent = ''; });
  petForm.querySelectorAll<HTMLButtonElement>('[data-sound-test]').forEach((button) => button.addEventListener('click', () => {
    const form = new FormData(petForm); const current = loadPetData().settings.audio;
    previewAudio.update({ ...current,
      muted: form.get('muted') === 'on', interactionEnabled: form.get('interactionEnabled') === 'on', reminderEnabled: form.get('reminderEnabled') === 'on', alarmEnabled: form.get('alarmEnabled') === 'on', voiceEnabled: form.get('voiceEnabled') === 'on',
      masterVolume: Number(form.get('masterVolume')), interactionVolume: Number(form.get('interactionVolume')), reminderVolume: Number(form.get('reminderVolume')), alarmVolume: Number(form.get('alarmVolume')), voiceVolume: Number(form.get('voiceVolume'))
    });
    const test = button.dataset.soundTest;
    if (test === 'interaction') previewAudio.playInteraction();
    else if (test === 'reminder') previewAudio.playReminder();
    else if (test === 'alarm') { previewAudio.startAlarm(); window.setTimeout(() => previewAudio.stopAlarm(), 3_000); }
    else if (test === 'voice') previewAudio.speak('Merhaba! Hazır mısın?', String(form.get('petId')) as PetId);
    else previewAudio.stopAlarm();
  }));
  petForm.querySelectorAll<HTMLButtonElement>('[data-pet-command]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.petCommand as PetAction;
    if (desktop.isNative()) void emitTo('main', 'pet-action', { action });
    else window.dispatchEvent(new CustomEvent('manager-pet-action', { detail: { action } }));
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-edit-cancel]').forEach((button) => button.addEventListener('click', () => resetOrganizerForm(button.dataset.editCancel as 'note' | 'reminder' | 'alarm')));
  noteForm.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
    const form = new FormData(noteForm); const id = String(form.get('id') || '');
    if (id) {
      const current = loadPetData().items.find((item): item is Extract<OrganizerItem, { type: 'note' }> => item.id === id && item.type === 'note');
      if (current) await replaceItem({ ...current, title: String(form.get('title')).trim(), body: String(form.get('body')).trim() });
    } else await addNote(String(form.get('title')).trim(), String(form.get('body')).trim());
    resetOrganizerForm('note'); renderLists();
  })(); });
  reminderForm.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
    const form = new FormData(reminderForm); const id = String(form.get('id') || ''); const scheduledAt = new Date(String(form.get('scheduledAt'))).toISOString();
    if (id) {
      const current = loadPetData().items.find((item): item is ReminderItem => item.id === id && item.type === 'reminder');
      if (current) await replaceItem({ ...current, title: String(form.get('title')).trim(), details: String(form.get('details')).trim(), scheduledAt, status: 'pending', snoozedUntil: null, occurrenceKey: null });
    } else await addReminder(String(form.get('title')).trim(), String(form.get('details')).trim(), scheduledAt);
    resetOrganizerForm('reminder'); renderLists();
  })(); });
  alarmForm.addEventListener('submit', (event) => { event.preventDefault(); void (async () => {
    const form = new FormData(alarmForm); const id = String(form.get('id') || ''); const scheduledAt = new Date(String(form.get('scheduledAt'))).toISOString();
    if (id) {
      const current = loadPetData().items.find((item): item is AlarmItem => item.id === id && item.type === 'alarm');
      if (current) await replaceItem({ ...current, label: String(form.get('label')).trim(), schedule: form.get('schedule') === 'daily' ? 'daily' : 'once', scheduledAt, enabled: true, status: 'pending', snoozedUntil: null, occurrenceKey: null });
    } else await addAlarm(String(form.get('label')).trim(), form.get('schedule') === 'daily' ? 'daily' : 'once', scheduledAt);
    resetOrganizerForm('alarm'); renderLists();
  })(); });
  petForm.addEventListener('submit', (event) => {
    event.preventDefault(); void (async () => {
    const form = new FormData(petForm); const current = loadPetData().settings;
    const submit = petForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    const previousLabel = submit?.textContent ?? 'Ayarları kaydet';
    if (submit) { submit.disabled = true; submit.textContent = 'Kaydediliyor'; }
    const settings: PetSettings = {
      ...current, name: String(form.get('name')).trim() || 'Dost', petId: String(form.get('petId')) as PetId,
      petSize: String(form.get('petSize')) as PetSettings['petSize'], movementMode: String(form.get('movementMode')) as PetSettings['movementMode'],
      movementLevel: String(form.get('movementLevel')) as PetSettings['movementLevel'], autostart: form.get('autostart') === 'on', reducedMotion: form.get('reducedMotion') === 'on',
      pinnedCorner: form.get('movementMode') === 'pinned' ? current.pinnedCorner : null,
      audio: { ...current.audio, muted: form.get('muted') === 'on', interactionEnabled: form.get('interactionEnabled') === 'on', reminderEnabled: form.get('reminderEnabled') === 'on', alarmEnabled: form.get('alarmEnabled') === 'on', voiceEnabled: form.get('voiceEnabled') === 'on', snoozeMinutes: Number(form.get('snoozeMinutes')) as 5 | 10 | 15, masterVolume: Number(form.get('masterVolume')), interactionVolume: Number(form.get('interactionVolume')), reminderVolume: Number(form.get('reminderVolume')), alarmVolume: Number(form.get('alarmVolume')), voiceVolume: Number(form.get('voiceVolume')) }
    };
    await saveSettings(settings);
    settingsDirty = false;
    if (desktop.isNative()) void (settings.autostart ? enable() : disable()).catch(() => undefined);
    if (submit) { submit.disabled = false; submit.textContent = 'Kaydedildi'; window.setTimeout(() => { submit.textContent = previousLabel; }, 900); }
    render(true);
    required<HTMLElement>('#settings-status').textContent = 'Ayarlar canlı pete uygulandı.';
    })().catch(() => {
      const submit = petForm.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit) { submit.disabled = false; submit.textContent = 'Tekrar dene'; }
      required<HTMLElement>('#settings-status').textContent = 'Ayarlar kaydedilemedi. Tekrar deneyin.';
    });
  });
  required<HTMLButtonElement>('#manager-close').addEventListener('click', () => {
    if (desktop.isNative()) void desktop.hideCurrent();
    else { required<HTMLElement>('#manager').hidden = true; required<HTMLElement>('#app').hidden = false; document.body.classList.remove('manager-window'); }
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') void desktop.hideCurrent(); });
  const now = Date.now();
  (reminderForm.elements.namedItem('scheduledAt') as HTMLInputElement).value = toLocalInput(new Date(now + 10 * 60_000));
  (alarmForm.elements.namedItem('scheduledAt') as HTMLInputElement).value = toLocalInput(new Date(now + 60 * 60_000));
  const channel = new BroadcastChannel(DATA_CHANNEL);
  channel.addEventListener('message', (message) => {
    const payload = message.data as DataChannelMessage;
    if ('data' in payload && payload.data) acceptRemotePetData(payload.data);
    if (payload.type === 'due' && payload.event) { const alert = required<HTMLElement>('#manager-alert'); alert.textContent = `${payload.event.kind === 'alarm' ? 'Alarm' : 'Hatırlatma'}: ${payload.event.title}`; alert.hidden = false; activateTab(payload.event.kind === 'alarm' ? 'alarms' : 'reminders'); }
    render();
  });
  window.addEventListener('storage', () => render()); render(true);
  if (desktop.isNative()) await getCurrentWindow().listen('pet-data-updated', ({ payload }) => { acceptRemotePetData(payload); render(); });
  const animatePreview = (now: number): void => {
    previewRenderer.setState('IDLE', 1, null); previewRenderer.render(now); previewFrame = requestAnimationFrame(animatePreview);
  };
  previewFrame = requestAnimationFrame(animatePreview);
  window.addEventListener('beforeunload', () => cancelAnimationFrame(previewFrame));
};
