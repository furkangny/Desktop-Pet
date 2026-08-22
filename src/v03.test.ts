import { describe, expect, it } from 'vitest';
import { calculateBubblePlacement } from './bubblePlacement';
import { classifyDragGesture } from './gestures';
import { getCornerSnap, MovementController } from './movement';
import { DigitalPetBrain } from './petBrain';
import { createBody, stepPhysics } from './physics';
import { PET_PIXEL_SIZE, PET_WINDOW_SIZE } from './petCatalog';
import { collectDueEvents } from './scheduler';
import { resolvePetSpriteFrame, resolveSpriteFrame, usesDedicatedCatSleepSprite } from './spriteRenderer';
import { normalizePetData, resolveOrganizerItems } from './storage';
import type { AlarmItem, Bounds, ReminderItem } from './types';

const bounds: Bounds = { minX: 0, maxX: 900, minY: 0, maxY: 600 };
const alarm = (overrides: Partial<AlarmItem> = {}): AlarmItem => ({
  id: 'alarm-1', type: 'alarm', label: 'Uyan', schedule: 'daily', scheduledAt: '2026-08-22T08:00:00+03:00',
  enabled: true, status: 'pending', snoozedUntil: null, lastTriggeredAt: null, occurrenceKey: null, ...overrides
});

describe('v1 to v2 migration', () => {
  it('preserves organizer data and maps the legacy cat to pixel-cat', () => {
    const migrated = normalizePetData({
      settings: { name: 'Mino', visual: '\u{1F408}', movementLevel: 'active' }, position: { x: 42, y: 84 },
      items: [{ id: 'n1', type: 'note', title: 'Fikir', body: 'Yaz', createdAt: '2026-08-22T09:00:00Z' }]
    });
    expect(migrated.version).toBe(2); expect(migrated.settings.petId).toBe('pixel-cat');
    expect(migrated.position).toEqual({ x: 42, y: 84 }); expect(migrated.items[0].type).toBe('note');
  });
  it('accepts the compact tiny size and keeps legacy sizes valid', () => {
    expect(normalizePetData({ settings: { petSize: 'tiny' } }).settings.petSize).toBe('tiny');
    expect(normalizePetData({ settings: { petSize: 'small' } }).settings.petSize).toBe('small');
    expect(PET_PIXEL_SIZE.tiny).toBe(64);
    expect(PET_WINDOW_SIZE.tiny).toBeLessThan(PET_WINDOW_SIZE.small);
  });
  it('fills v0.4 hidden and voice defaults while dropping deleted game memory', () => {
    const migrated = normalizePetData({ settings: { audio: {} }, memory: { favoriteActivity: 'rhythm' } });
    expect(migrated.hidden).toBe(false); expect(migrated.settings.audio.voiceEnabled).toBe(true); expect(migrated.settings.audio.voiceVolume).toBe(48);
    expect('favoriteActivity' in migrated.memory).toBe(false); expect('gameHighScore' in migrated.memory).toBe(false);
  });
});

describe('scheduler occurrence rules', () => {
  it('fires a daily alarm only once for a local date', () => {
    const now = new Date('2026-08-22T09:00:00+03:00'); const first = collectDueEvents([alarm()], now);
    expect(first.due).toHaveLength(1); expect(collectDueEvents(first.items, now).due).toHaveLength(0);
  });
  it('honors snooze and catches a late one-time reminder after sleep', () => {
    const snoozed = alarm({ status: 'snoozed', snoozedUntil: '2026-08-22T09:05:00+03:00' });
    expect(collectDueEvents([snoozed], new Date('2026-08-22T09:04:59+03:00')).due).toHaveLength(0);
    expect(collectDueEvents([snoozed], new Date('2026-08-22T09:05:01+03:00')).due).toHaveLength(1);
    const reminder: ReminderItem = { id: 'r1', type: 'reminder', title: 'Ara', details: '', scheduledAt: '2026-08-22T08:00:00+03:00', status: 'pending', snoozedUntil: null, lastTriggeredAt: null, occurrenceKey: null };
    const late = collectDueEvents([reminder], new Date('2026-08-22T10:00:00+03:00'));
    expect(late.due).toHaveLength(1); expect(collectDueEvents(late.items, new Date('2026-08-22T10:01:00+03:00')).due).toHaveLength(0);
  });
  it('dismisses a snoozed daily alarm for the current date without disabling tomorrow', () => {
    const now = new Date('2026-08-22T09:30:00+03:00');
    const [dismissed] = resolveOrganizerItems([alarm({ occurrenceKey: 'alarm-1:2026-08-22T09:05:00+03:00' })], 'alarm-1', 'dismiss', 5, now) as AlarmItem[];
    expect(dismissed.enabled).toBe(true);
    expect(dismissed.status).toBe('pending');
    expect(dismissed.occurrenceKey).toBe('alarm-1:2026-08-22');
    expect(collectDueEvents([dismissed], new Date('2026-08-22T10:00:00+03:00')).due).toHaveLength(0);
    expect(collectDueEvents([dismissed], new Date('2026-08-23T09:00:00+03:00')).due).toHaveLength(1);
  });
});

describe('movement and pinning', () => {
  it('snaps only inside the 72 px corner radius', () => {
    expect(getCornerSnap({ x: 40, y: 40 }, bounds)?.corner).toBe('top-left');
    expect(getCornerSnap({ x: 160, y: 120 }, bounds)).toBeNull();
  });
  it('returns to its recorded home after a hybrid patrol', () => {
    const movement = new MovementController(() => 0.5); const home = { x: 500, y: 350 }; movement.setHome(home); movement.reset(0);
    let position = { ...home }; let now = 330_001;
    for (let index = 0; index < 1_400; index += 1) { position = movement.update(position, bounds, 'hybrid', 'normal', false, .05, now); now += 50; }
    expect(Math.hypot(position.x - home.x, position.y - home.y)).toBeLessThan(6);
  });
  it('drops to the desktop floor, then walks horizontally through several destinations', () => {
    const seeded = (seed: number): (() => number) => { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
    const movement = new MovementController(seeded(7)); const start = { x: 120, y: 120 };
    movement.setHome(start); movement.reset(0);
    let position = { ...start }; let now = 0; let movedEarly = false; let movedX = false; let reachedFloor = false; let floatedAfterFloor = false;
    const targets = new Set<string>();
    for (let index = 0; index < 1_400; index += 1) {
      const next = movement.update(position, bounds, 'roam', 'normal', false, .05, now);
      if (Math.abs(next.x - position.x) > 0.5) movedX = true;
      if (Math.abs(next.y - bounds.maxY) < .01) reachedFloor = true;
      if (reachedFloor && Math.abs(next.y - bounds.maxY) > .01) floatedAfterFloor = true;
      if (now <= 8_000 && Math.hypot(next.x - start.x, next.y - start.y) > 12) movedEarly = true;
      const target = movement.debugTarget(); if (target) targets.add(`${target.x},${target.y}`);
      position = next; now += 50;
    }
    expect(movedEarly).toBe(true);
    expect(movedX).toBe(true); expect(reachedFloor).toBe(true); expect(floatedAfterFloor).toBe(false);
    expect(targets.size).toBeGreaterThanOrEqual(3);
  });
  it('freezes roam locomotion when reduced motion is enabled', () => {
    const movement = new MovementController(() => 0.37); let position = { x: 200, y: 200 };
    for (let index = 0; index < 200; index += 1) position = movement.update(position, bounds, 'roam', 'normal', true, .05, index * 50);
    expect(position).toEqual({ x: 200, y: 200 });
    expect(movement.isMoving()).toBe(false);
  });
});

describe('speech bubble placement', () => {
  const workArea: Bounds = { minX: 0, minY: 0, maxX: 1_000, maxY: 700 };
  const bubbleSize = { width: 200, height: 84 };

  it('stays centered over a moving pet in open space', () => {
    const first = calculateBubblePlacement({ x: 200, y: 300 }, 112, bubbleSize, workArea);
    const moved = calculateBubblePlacement({ x: 420, y: 300 }, 112, bubbleSize, workArea);
    expect(first.side).toBe('above');
    expect(moved.position.x - first.position.x).toBe(220);
    expect(moved.tailX).toBe(100);
  });

  it('clamps at horizontal edges while keeping the tail pointed at the pet', () => {
    const left = calculateBubblePlacement({ x: 0, y: 300 }, 112, bubbleSize, workArea);
    const right = calculateBubblePlacement({ x: 888, y: 300 }, 112, bubbleSize, workArea);
    expect(left.position.x).toBe(6); expect(left.tailX).toBe(50);
    expect(right.position.x).toBe(794); expect(right.tailX).toBe(150);
  });

  it('flips below the pet near the top edge and remains inside the work area', () => {
    const placement = calculateBubblePlacement({ x: 400, y: 2 }, 112, bubbleSize, workArea);
    expect(placement.side).toBe('below');
    expect(placement.position.y).toBe(124);
  });
});

describe('physical gestures', () => {
  it('distinguishes rapid shaking from a slow petting stroke', () => {
    expect(classifyDragGesture({ durationMs: 620, reversals: 5, peakSpeed: 980, totalDx: 180, totalDy: 28 }, 120)).toBe('shake');
    expect(classifyDragGesture({ durationMs: 900, reversals: 2, peakSpeed: 260, totalDx: 92, totalDy: 18 }, 20)).toBe('pet');
  });
  it('does not mistake a fast diagonal throw for shaking', () => {
    expect(classifyDragGesture({ durationMs: 400, reversals: 1, peakSpeed: 1_400, totalDx: 130, totalDy: 150 }, 1_200)).toBe('throw');
  });
});

describe('throw physics reactions', () => {
  it('reports edge impacts so thrown pets can react like a shake', () => {
    const body = createBody({ x: 895, y: 300 }); body.velocity = { x: 1_200, y: 0 };
    const result = stepPhysics(body, bounds, .05);
    expect(result.hitHorizontal).toBe(-1);
    expect(body.position.x).toBe(bounds.maxX);
    expect(body.velocity.x).toBeLessThan(0);
  });

  it('reports vertical impacts at the desktop floor and ceiling', () => {
    const body = createBody({ x: 450, y: 598 }); body.velocity = { x: 0, y: 500 };
    expect(stepPhysics(body, bounds, .05).hitVertical).toBe(-1);
    body.position.y = 1; body.velocity.y = -500;
    expect(stepPhysics(body, bounds, .05).hitVertical).toBe(1);
  });
});

describe('behavior and sprite mapping', () => {
  it('sleeps after five idle minutes and stretches when awakened', () => {
    const brain = new DigitalPetBrain({ energy: 80, social: 70, fun: 70, curiosity: 70, comfort: 80 }, { playfulness: 60, sociability: 60, curiosity: 60, calmness: 60 }, () => .9);
    expect(brain.tick(16, { now: new Date('2026-08-22T12:00:00Z'), userIdleMs: 300_000, cursorDistance: 999, lookDirection: null, isMoving: false }).state).toBe('SLEEPING');
    expect(brain.wake(new Date('2026-08-22T12:00:01Z').getTime()).state).toBe('STRETCHING');
  });
  it('maps walking and all 16 look directions to the atlas contract', () => {
    expect(resolveSpriteFrame('WALKING', 1, null, 0)).toEqual({ row: 1, frame: 0 });
    expect(resolveSpriteFrame('WALKING', -1, null, 0)).toEqual({ row: 2, frame: 0 });
    expect(resolveSpriteFrame('LOOKING', 1, 0, 0)).toEqual({ row: 9, frame: 0 });
    expect(resolveSpriteFrame('LOOKING', 1, 15, 0)).toEqual({ row: 10, frame: 7 });
  });
  it('advances walking contact frames from distance rather than elapsed time', () => {
    expect(resolveSpriteFrame('WALKING', 1, null, 99_000, 0, 0).frame).toBe(0);
    expect(resolveSpriteFrame('WALKING', 1, null, 0, 0, 30).frame).toBe(4);
  });
  it('keeps focus calm and avoids the old dance/focus row collision', () => {
    expect(resolvePetSpriteFrame('tiny-robot', 'FOCUSED', 1, null, 0)).toEqual({ row: 8, frame: 1 });
    expect(resolvePetSpriteFrame('tiny-astronaut', 'FOCUSED', 1, null, 0)).toEqual({ row: 8, frame: 1 });
    expect(resolvePetSpriteFrame('pixel-cat', 'FOCUSED', 1, null, 0)).toEqual({ row: 8, frame: 1 });
  });
  it('uses a closed-eye sleep pose and dedicated calm micro-behaviors', () => {
    expect(resolveSpriteFrame('SLEEPING', 1, null, 0)).toEqual({ row: 8, frame: 4 });
    expect(resolvePetSpriteFrame('pixel-cat', 'SLEEPING', 1, null, 0)).toEqual({ row: 8, frame: 4 });
    expect(resolvePetSpriteFrame('tiny-astronaut', 'SLEEPING', 1, null, 0)).toEqual({ row: 8, frame: 4 });
    expect(usesDedicatedCatSleepSprite('pixel-cat', 'SLEEPING')).toBe(true);
    expect(usesDedicatedCatSleepSprite('pixel-cat', 'FOCUSED')).toBe(false);
    expect(usesDedicatedCatSleepSprite('tiny-robot', 'SLEEPING')).toBe(false);
    expect(resolveSpriteFrame('OBSERVING', 1, null, 500).row).toBe(8);
    expect(resolveSpriteFrame('FIDGETING', 1, null, 500).row).toBe(6);
    expect(resolveSpriteFrame('STRETCHING', 1, null, 500).row).toBe(4);
    expect(resolveSpriteFrame('GROOMING', 1, null, 500).row).toBe(6);
    expect(resolveSpriteFrame('TIRED', 1, null, 500).row).toBe(8);
    expect(resolveSpriteFrame('ANGRY', 1, null, 500).row).toBe(7);
  });
  it('keeps dancing on filled atlas cells so the pet does not blink away', () => {
    const frames = new Set<number>();
    for (let elapsed = 0; elapsed < 2_400; elapsed += 120) frames.add(resolveSpriteFrame('DANCING', 1, null, elapsed).frame);
    expect([...frames].sort()).toEqual([0, 1, 2, 3, 5]);
  });
  it('takes gaze breaks unless the cursor is very close', () => {
    const brain = new DigitalPetBrain({ energy: 80, social: 70, fun: 70, curiosity: 70, comfort: 80 }, { playfulness: 60, sociability: 60, curiosity: 60, calmness: 60 }, () => .5);
    expect(brain.tick(16, { now: new Date(1_000), userIdleMs: 0, cursorDistance: 300, lookDirection: 4, isMoving: false }).state).toBe('LOOKING');
    expect(brain.tick(16, { now: new Date(5_000), userIdleMs: 0, cursorDistance: 300, lookDirection: 4, isMoving: false }).state).not.toBe('LOOKING');
    expect(brain.tick(16, { now: new Date(5_100), userIdleMs: 0, cursorDistance: 100, lookDirection: 4, isMoving: false }).state).toBe('LOOKING');
  });
  it('keeps the distance-phased walking clip active while the cursor is nearby', () => {
    const brain = new DigitalPetBrain({ energy: 80, social: 70, fun: 70, curiosity: 70, comfort: 80 }, { playfulness: 60, sociability: 60, curiosity: 60, calmness: 60 }, () => .5);
    expect(brain.tick(16, { now: new Date(1_000), userIdleMs: 0, cursorDistance: 80, lookDirection: 4, isMoving: true }).state).toBe('WALKING');
  });
  it('director rotates ambient clips without repeating a pose back to back', () => {
    const seeded = (seed: number): (() => number) => { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; };
    const brain = new DigitalPetBrain({ energy: 76, social: 72, fun: 70, curiosity: 74, comfort: 80 }, { playfulness: 60, sociability: 58, curiosity: 72, calmness: 55 }, seeded(5));
    const base = new Date(2026, 7, 22, 14, 0, 0).getTime();
    const states: string[] = [];
    for (let i = 1; i <= 24; i += 1) {
      states.push(brain.tick(16, { now: new Date(base + i * 60_000), userIdleMs: 60_000, cursorDistance: 999, lookDirection: null, isMoving: false }).state);
    }
    let consecutiveRepeat = false;
    for (let i = 1; i < states.length; i += 1) if (states[i] === states[i - 1]) consecutiveRepeat = true;
    expect(consecutiveRepeat).toBe(false);
    expect(new Set(states).size).toBeGreaterThanOrEqual(4);
  });
  it('gets angry after repeated shakes and settles after active dance', () => {
    const brain = new DigitalPetBrain({ energy: 80, social: 70, fun: 20, curiosity: 20, comfort: 80 }, { playfulness: 100, sociability: 60, curiosity: 100, calmness: 20 }, () => .05);
    expect(brain.shake(1_000).state).toBe('DIZZY');
    expect(brain.shake(2_000).state).toBe('DIZZY');
    expect(brain.shake(3_000).state).toBe('ANGRY');
    expect(brain.activity('dance', 10_000).state).toBe('DANCING');
    expect(brain.tick(16, { now: new Date(13_500), userIdleMs: 0, cursorDistance: 999, lookDirection: null, isMoving: false }).state).toBe('DANCING');
    expect(brain.tick(16, { now: new Date(15_000), userIdleMs: 0, cursorDistance: 999, lookDirection: null, isMoving: false }).state).toBe('IDLE');
  });
});
