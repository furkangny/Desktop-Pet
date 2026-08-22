import { loadPetData, savePetData } from './storage';
import type { AlarmItem, DueEvent, OrganizerItem, ReminderItem } from './types';

export const localDayKey = (date: Date): string => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const occurrenceKeyFor = (item: AlarmItem | ReminderItem, now: Date): string => item.type === 'alarm' && item.schedule === 'daily' ? `${item.id}:${localDayKey(now)}` : `${item.id}:${item.snoozedUntil ?? item.scheduledAt}`;
const dueAt = (item: AlarmItem | ReminderItem): Date => new Date(item.snoozedUntil ?? item.scheduledAt);
const isDailyAlarmDue = (item: AlarmItem, now: Date): boolean => {
  const scheduled = new Date(item.scheduledAt); const candidate = new Date(now);
  candidate.setHours(scheduled.getHours(), scheduled.getMinutes(), 0, 0);
  return now >= candidate;
};

export const collectDueEvents = (items: OrganizerItem[], now = new Date()): { items: OrganizerItem[]; due: DueEvent[] } => {
  const due: DueEvent[] = [];
  const nextItems = items.map((item): OrganizerItem => {
    if (item.type === 'note' || item.status === 'completed' || item.status === 'dismissed' || item.status === 'missed') return item;
    if (item.type === 'alarm' && !item.enabled) return item;
    const shouldTrigger = item.snoozedUntil
      ? dueAt(item) <= now
      : item.type === 'alarm' && item.schedule === 'daily'
        ? isDailyAlarmDue(item, now)
        : dueAt(item) <= now;
    const occurrenceKey = occurrenceKeyFor(item, now);
    if (!shouldTrigger || item.occurrenceKey === occurrenceKey) return item;
    due.push({ id: item.id, kind: item.type, title: item.type === 'alarm' ? item.label : item.title, details: item.type === 'alarm' ? 'Alarm zamanı' : item.details, scheduledAt: dueAt(item).toISOString() });
    if (item.type === 'reminder') {
      return { ...item, status: 'pending', snoozedUntil: null, lastTriggeredAt: now.toISOString(), occurrenceKey } satisfies ReminderItem;
    }
    return { ...item, status: 'pending', snoozedUntil: null, lastTriggeredAt: now.toISOString(), occurrenceKey, enabled: item.schedule === 'daily' } satisfies AlarmItem;
  });
  return { items: nextItems, due };
};

export const checkDueEvents = (now = new Date()): DueEvent[] => {
  const data = loadPetData(); const result = collectDueEvents(data.items, now);
  if (result.due.length > 0) savePetData({ ...data, items: result.items });
  return result.due;
};
