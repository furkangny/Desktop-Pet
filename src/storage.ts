import { invoke } from '@tauri-apps/api/core';
import { load, type Store } from '@tauri-apps/plugin-store';
import type { AlarmItem, DataChannelMessage, NoteItem, OrganizerItem, PetData, PetSettings, ReminderItem, Vector2 } from './types';

const V1_KEY = 'connected-desktop-pet-data-v1';
const V2_KEY = 'connected-desktop-pet-data-v2';
const STORE_FILE = 'pet-data-v2.json';
const STORE_KEY = 'pet-data';
export const DATA_CHANNEL = 'connected-desktop-pet-data';

let nativeStore: Store | null = null;
let persistQueue = Promise.resolve();
const isNative = (): boolean => '__TAURI_INTERNALS__' in window;
const clamp = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
const localDayKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const broadcast = (message: DataChannelMessage): void => {
  const channel = new BroadcastChannel(DATA_CHANNEL);
  channel.postMessage(message);
  channel.close();
};

export const createDefaultData = (): PetData => ({
  version: 2,
  revision: 1,
  hidden: false,
  settings: {
    name: 'Dost', petId: 'tiny-robot', petSize: 'medium', movementMode: 'hybrid', movementLevel: 'normal',
    monitorId: null, pinnedCorner: null, autostart: true,
    reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
    audio: {
      masterVolume: 65, interactionVolume: 35, reminderVolume: 55, alarmVolume: 80, voiceVolume: 48,
      muted: false, interactionEnabled: true, reminderEnabled: true, alarmEnabled: true, voiceEnabled: true, snoozeMinutes: 5
    }
  },
  position: null,
  homePosition: null,
  needs: { energy: 76, social: 72, fun: 70, curiosity: 74, comfort: 80 },
  personality: { playfulness: 62, sociability: 58, curiosity: 72, calmness: 55 },
  memory: { lastInteractionAt: null, lastSeenAt: null, lastGreetingDate: null, totalInteractions: 0, activityCounts: {} },
  items: []
});

const migrateItem = (item: Record<string, unknown>): OrganizerItem | null => {
  if (item.type === 'note') return { id: String(item.id), type: 'note', title: String(item.title ?? ''), body: String(item.body ?? ''), createdAt: String(item.createdAt ?? new Date().toISOString()), pinned: Boolean(item.pinned) };
  if (item.type === 'reminder') return {
    id: String(item.id), type: 'reminder', title: String(item.title ?? ''), details: String(item.details ?? ''), scheduledAt: String(item.scheduledAt),
    status: item.completed ? 'completed' : 'pending', snoozedUntil: null,
    lastTriggeredAt: typeof item.notifiedAt === 'string' ? item.notifiedAt : null,
    occurrenceKey: typeof item.notifiedAt === 'string' ? item.notifiedAt : null
  };
  if (item.type === 'alarm') return {
    id: String(item.id), type: 'alarm', label: String(item.label ?? ''), schedule: item.schedule === 'daily' ? 'daily' : 'once',
    scheduledAt: String(item.scheduledAt), enabled: item.enabled !== false, status: item.enabled === false ? 'dismissed' : 'pending',
    snoozedUntil: null, lastTriggeredAt: null, occurrenceKey: typeof item.lastTriggeredKey === 'string' ? item.lastTriggeredKey : null
  };
  return null;
};

export const normalizePetData = (value: unknown): PetData => {
  const defaults = createDefaultData();
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Record<string, unknown>;
  const settings = (raw.settings ?? {}) as Record<string, unknown>;
  const audio = (settings.audio ?? {}) as Record<string, unknown>;
  const needs = (raw.needs ?? {}) as Record<string, unknown>;
  const personality = (raw.personality ?? {}) as Record<string, unknown>;
  const memory = (raw.memory ?? {}) as Record<string, unknown>;
  const position = raw.position as Vector2 | null;
  const legacyVisual = String(settings.visual ?? '');
  const petId = ['tiny-robot', 'tiny-astronaut', 'pixel-cat'].includes(String(settings.petId)) ? settings.petId as PetSettings['petId'] : legacyVisual.includes('🐈') ? 'pixel-cat' : 'tiny-robot';
  const pinnedCorner = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(String(settings.pinnedCorner)) ? settings.pinnedCorner as PetSettings['pinnedCorner'] : null;

  return {
    version: 2,
    revision: Number(raw.revision) > 0 ? Number(raw.revision) : defaults.revision,
    hidden: Boolean(raw.hidden),
    settings: {
      ...defaults.settings,
      name: typeof settings.name === 'string' ? settings.name : defaults.settings.name,
      petId,
      petSize: ['tiny', 'small', 'medium', 'large'].includes(String(settings.petSize)) ? settings.petSize as PetSettings['petSize'] : 'medium',
      movementMode: ['pinned', 'hybrid', 'roam'].includes(String(settings.movementMode)) ? settings.movementMode as PetSettings['movementMode'] : 'hybrid',
      movementLevel: ['calm', 'normal', 'active'].includes(String(settings.movementLevel)) ? settings.movementLevel as PetSettings['movementLevel'] : 'normal',
      monitorId: typeof settings.monitorId === 'string' ? settings.monitorId : null,
      pinnedCorner,
      autostart: settings.autostart !== false,
      reducedMotion: Boolean(settings.reducedMotion ?? defaults.settings.reducedMotion),
      audio: {
        ...defaults.settings.audio,
        masterVolume: clamp(audio.masterVolume, 65), interactionVolume: clamp(audio.interactionVolume, 35),
        reminderVolume: clamp(audio.reminderVolume, 55), alarmVolume: clamp(audio.alarmVolume, 80), voiceVolume: clamp(audio.voiceVolume, 48),
        muted: Boolean(audio.muted), interactionEnabled: audio.interactionEnabled !== false,
        reminderEnabled: audio.reminderEnabled !== false, alarmEnabled: audio.alarmEnabled !== false, voiceEnabled: audio.voiceEnabled !== false,
        snoozeMinutes: audio.snoozeMinutes === 10 || audio.snoozeMinutes === 15 ? audio.snoozeMinutes : 5
      }
    },
    position: position && Number.isFinite(position.x) && Number.isFinite(position.y) ? position : null,
    homePosition: raw.homePosition && typeof raw.homePosition === 'object' ? raw.homePosition as Vector2 : position ?? null,
    needs: { energy: clamp(needs.energy, 76), social: clamp(needs.social, 72), fun: clamp(needs.fun, 70), curiosity: clamp(needs.curiosity, 74), comfort: clamp(needs.comfort, 80) },
    personality: { playfulness: clamp(personality.playfulness, 62), sociability: clamp(personality.sociability, 58), curiosity: clamp(personality.curiosity, 72), calmness: clamp(personality.calmness, 55) },
    memory: {
      lastInteractionAt: typeof memory.lastInteractionAt === 'string' ? memory.lastInteractionAt : null,
      lastSeenAt: typeof memory.lastSeenAt === 'string' ? memory.lastSeenAt : null,
      lastGreetingDate: typeof memory.lastGreetingDate === 'string' ? memory.lastGreetingDate : null,
      totalInteractions: Number(memory.totalInteractions) || 0,
      activityCounts: memory.activityCounts && typeof memory.activityCounts === 'object' ? memory.activityCounts as Record<string, number> : {}
    },
    items: Array.isArray(raw.items) ? raw.items.map((item) => migrateItem(item as Record<string, unknown>)).filter((item): item is OrganizerItem => item !== null) : []
  };
};

export const initializeStorage = async (): Promise<PetData> => {
  const cached = localStorage.getItem(V2_KEY) ?? localStorage.getItem(V1_KEY);
  const localData = normalizePetData(cached ? JSON.parse(cached) : null);
  if (!isNative()) {
    localStorage.setItem(V2_KEY, JSON.stringify(localData));
    return localData;
  }
  nativeStore = await load(STORE_FILE, { autoSave: 120 });
  const stored = await nativeStore.get<PetData>(STORE_KEY);
  const data = stored ? normalizePetData(stored) : localData;
  localStorage.setItem(V2_KEY, JSON.stringify(data));
  await nativeStore.set(STORE_KEY, data);
  await nativeStore.save();
  return data;
};

export const syncFromNativeStore = async (): Promise<PetData> => {
  if (!nativeStore) return loadPetData();
  const stored = await nativeStore.get<PetData>(STORE_KEY);
  const data = normalizePetData(stored);
  localStorage.setItem(V2_KEY, JSON.stringify(data));
  return data;
};

export const acceptRemotePetData = (value: unknown): PetData => {
  const incoming = normalizePetData(value);
  const current = loadPetData();
  if (incoming.revision >= current.revision) {
    localStorage.setItem(V2_KEY, JSON.stringify(incoming));
    return incoming;
  }
  return current;
};

export const loadPetData = (): PetData => {
  try {
    const raw = localStorage.getItem(V2_KEY) ?? localStorage.getItem(V1_KEY);
    return normalizePetData(raw ? JSON.parse(raw) : null);
  } catch { return createDefaultData(); }
};

export const savePetData = (data: PetData): Promise<PetData> => {
  const currentRevision = loadPetData().revision;
  const normalized = normalizePetData(data);
  normalized.revision = Math.max(currentRevision, normalized.revision) + 1;
  localStorage.setItem(V2_KEY, JSON.stringify(normalized));
  const pending = persistQueue.then(async () => {
    const saved = isNative()
      ? normalizePetData(await invoke<PetData>('save_pet_data', { data: normalized }))
      : normalized;
    if (!isNative() && nativeStore) { await nativeStore.set(STORE_KEY, saved); await nativeStore.save(); }
    localStorage.setItem(V2_KEY, JSON.stringify(saved));
    broadcast({ type: 'updated', revision: saved.revision, data: saved });
    return saved;
  });
  persistQueue = pending.then(() => undefined, () => undefined);
  return pending;
};

export const updatePetData = (update: (current: PetData) => PetData): PetData => {
  const next = normalizePetData(update(loadPetData())); void savePetData(next).catch(() => undefined); return next;
};

export const updatePetDataAsync = async (update: (current: PetData) => PetData): Promise<PetData> => {
  const current = isNative() ? await syncFromNativeStore() : loadPetData();
  return savePetData(normalizePetData(update(current)));
};

export const savePosition = (position: Vector2, asHome = false): void => {
  updatePetData((current) => ({ ...current, position: { ...position }, homePosition: asHome ? { ...position } : current.homePosition }));
};
export const saveSettings = async (settings: PetSettings): Promise<PetData> => {
  if (!isNative()) return updatePetDataAsync((current) => ({ ...current, settings }));
  const data = normalizePetData(await invoke<PetData>('update_pet_settings', { settings }));
  localStorage.setItem(V2_KEY, JSON.stringify(data));
  broadcast({ type: 'updated', revision: data.revision, data });
  return data;
};

export const setPetHidden = async (hidden: boolean): Promise<PetData> => {
  if (isNative()) {
    const data = normalizePetData(await invoke<PetData>('set_pet_hidden', { hidden }));
    localStorage.setItem(V2_KEY, JSON.stringify(data));
    broadcast({ type: 'updated', revision: data.revision, data });
    return data;
  }
  return updatePetDataAsync((current) => ({ ...current, hidden }));
};

const mutateOrganizer = async (action: 'add' | 'replace' | 'remove', item?: OrganizerItem, id?: string): Promise<PetData> => {
  if (isNative()) {
    const data = normalizePetData(await invoke<PetData>('mutate_organizer_item', { action, item: item ?? null, id: id ?? null }));
    localStorage.setItem(V2_KEY, JSON.stringify(data));
    broadcast({ type: 'updated', revision: data.revision, data });
    return data;
  }
  return updatePetDataAsync((current) => {
    if (action === 'add' && item) return { ...current, items: [item, ...current.items] };
    if (action === 'replace' && item) return { ...current, items: current.items.map((candidate) => candidate.id === item.id ? item : candidate) };
    return { ...current, items: current.items.filter((candidate) => candidate.id !== id) };
  });
};

export const addNote = async (title: string, body: string): Promise<NoteItem> => {
  const note: NoteItem = { id: crypto.randomUUID(), type: 'note', title, body, createdAt: new Date().toISOString(), pinned: false };
  await mutateOrganizer('add', note); return note;
};

export const addReminder = async (title: string, details: string, scheduledAt: string): Promise<ReminderItem> => {
  const reminder: ReminderItem = { id: crypto.randomUUID(), type: 'reminder', title, details, scheduledAt, status: 'pending', snoozedUntil: null, lastTriggeredAt: null, occurrenceKey: null };
  await mutateOrganizer('add', reminder); return reminder;
};

export const addAlarm = async (label: string, schedule: AlarmItem['schedule'], scheduledAt: string): Promise<AlarmItem> => {
  const alarm: AlarmItem = { id: crypto.randomUUID(), type: 'alarm', label, schedule, scheduledAt, enabled: true, status: 'pending', snoozedUntil: null, lastTriggeredAt: null, occurrenceKey: null };
  await mutateOrganizer('add', alarm); return alarm;
};

export const removeItem = async (id: string): Promise<void> => { await mutateOrganizer('remove', undefined, id); };
export const replaceItem = async (replacement: OrganizerItem): Promise<void> => { await mutateOrganizer('replace', replacement); };

export const resolveOrganizerItems = (items: OrganizerItem[], id: string, action: 'dismiss' | 'snooze', minutes = 5, now = new Date()): OrganizerItem[] => items.map((item) => {
  if (item.id !== id || item.type === 'note') return item;
  if (action === 'snooze') return { ...item, status: 'snoozed', snoozedUntil: new Date(now.getTime() + minutes * 60_000).toISOString(), occurrenceKey: null };
  if (item.type === 'reminder') return { ...item, status: 'completed', snoozedUntil: null };
  return item.schedule === 'daily'
    ? { ...item, status: 'pending', enabled: true, snoozedUntil: null, occurrenceKey: `${item.id}:${localDayKey(now)}` }
    : { ...item, status: 'dismissed', enabled: false, snoozedUntil: null };
});

export const snoozeItem = (id: string, minutes: number): void => {
  updatePetData((current) => ({ ...current, items: resolveOrganizerItems(current.items, id, 'snooze', minutes) }));
};

export const dismissItem = (id: string): void => {
  updatePetData((current) => ({ ...current, items: resolveOrganizerItems(current.items, id, 'dismiss') }));
};

export const acknowledgeOrganizerItem = async (id: string, action: 'dismiss' | 'snooze', snoozeMinutes = 5): Promise<PetData> => {
  if (isNative()) {
    const data = normalizePetData(await invoke<PetData>('acknowledge_organizer_item', { id, action, snoozeMinutes }));
    localStorage.setItem(V2_KEY, JSON.stringify(data));
    broadcast({ type: 'alert-resolved', id, action, revision: data.revision, data });
    return data;
  }
  return updatePetDataAsync((current) => ({ ...current, items: resolveOrganizerItems(current.items, id, action, snoozeMinutes) }));
};
