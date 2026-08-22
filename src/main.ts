import './styles.css';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { PetAudioEngine } from './audio';
import { initializeBubble } from './bubble';
import { DesktopWindow } from './desktopWindow';
import { initializeManager } from './manager';
import { classifyDragGesture } from './gestures';
import { getCornerSnap, MovementController } from './movement';
import { DigitalPetBrain } from './petBrain';
import { PET_WINDOW_SIZE } from './petCatalog';
import { initializePopover } from './popover';
import { createBody, isBodySettled, stepPhysics } from './physics';
import { checkDueEvents } from './scheduler';
import { resolvePassiveSpeech, SLEEP_INDICATOR_DURATION_MS } from './speechIndicator';
import { SpriteRenderer } from './spriteRenderer';
import { DATA_CHANNEL, acceptRemotePetData, acknowledgeOrganizerItem, initializeStorage, loadPetData, savePosition, saveSettings, setPetHidden, syncFromNativeStore, updatePetData } from './storage';
import type { BubbleVisibility, DataChannelMessage, DueEvent, PetAction, PetSettings, PetSnapshot, Vector2 } from './types';

const desktop = new DesktopWindow();
const required = <T extends Element>(selector: string): T => document.querySelector<T>(selector) ?? (() => { throw new Error(`Missing element: ${selector}`); })();
const clampTo = (position: Vector2, min: Vector2, max: Vector2): Vector2 => ({ x: Math.max(min.x, Math.min(max.x, position.x)), y: Math.max(min.y, Math.min(max.y, position.y)) });

const notify = async (event: DueEvent): Promise<void> => {
  if (!desktop.isNative()) return;
  let granted = await isPermissionGranted();
  if (!granted) granted = await requestPermission() === 'granted';
  if (granted) sendNotification({ title: event.kind === 'alarm' ? `Alarm: ${event.title}` : event.title, body: event.details, sound: event.kind === 'alarm' ? 'alarm.wav' : 'reminder.wav' });
};

const notifyPetHidden = async (): Promise<void> => {
  if (!desktop.isNative()) return;
  let granted = await isPermissionGranted();
  if (!granted) granted = await requestPermission() === 'granted';
  if (granted) sendNotification({ title: 'Pet arka planda', body: 'Geri getirmek için Windows sistem tepsisindeki pet simgesine sağ tıklayıp “Peti göster”i seç.' });
};

const runPet = async (): Promise<void> => {
  const pet = required<HTMLButtonElement>('#pet'); const sprite = required<HTMLElement>('#pet-sprite'); const speech = required<HTMLElement>('#speech');
  let data = loadPetData(); let settings = data.settings;
  await desktop.initialize(PET_WINDOW_SIZE[settings.petSize]);
  const bounds = await desktop.refreshBounds();
  const initialPosition = data.position ?? { x: bounds.minX + 80, y: bounds.maxY };
  const body = createBody(initialPosition); const movement = new MovementController(); const brain = new DigitalPetBrain(data.needs, data.personality);
  const renderer = new SpriteRenderer(sprite); const audio = new PetAudioEngine(settings.audio);
  movement.setHome(data.homePosition ?? initialPosition); movement.reset();
  let position = { ...initialPosition }; let lastFrame = performance.now(); let lastSave = lastFrame; let lastDiag = 0; let lastPresence = { cursor: { x: 0, y: 0 }, idleMs: 0, localHour: new Date().getHours() };
  let throwing = false; let speechUntil = 0; let clickTimes: number[] = []; let activeAlert: DueEvent | null = null; let alarmMissTimer: number | null = null;
  let managerInitialized = false;
  let undoPin: { settings: PetSettings; home: Vector2 | null } | null = null;
  let undoPinTimer: number | null = null;
  let reactionTimer: number | null = null; let lastStepIndex = -1;
  let sleepIndicatorUntil = 0;
  let bubbleSequence = 0; let activeBubbleId: string | null = null; let lastBubbleFollowAt = 0; let lastBubbleAnchor: Vector2 | null = null;
  let drag: null | { pointerId: number; offset: Vector2; last: Vector2; lastAt: number; startedAt: number; velocity: Vector2; moved: boolean; totalDx: number; totalDy: number; reversals: number; peakSpeed: number; lastDx: number; wasSleeping: boolean } = null;
  let lastSnapshotState = brain.snapshot.state;
  let lastImpactAt = 0;

  const showSpeech = (message: string, duration = 2200, tone: 'neutral' | 'positive' | 'quiet' = 'neutral', action?: 'undo-pin', actionLabel?: string, vocalize = true): void => {
    const isLong = message.length > 3;
    speech.textContent = desktop.isNative() ? (isLong ? '' : message) : message;
    speechUntil = performance.now() + duration;
    if (vocalize) audio.speak(message, settings.petId);
    if (desktop.isNative() && isLong) {
      const id = `${Date.now()}-${++bubbleSequence}`;
      void desktop.showBubble({ id, text: message, tone, duration, anchor: position, petSize: desktop.getSize(), workArea: desktop.getWorkArea(), action, actionLabel });
    }
  };
  const setPosition = (next: Vector2): void => {
    const b = desktop.getBounds(); position = clampTo(next, { x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }); body.position = { ...position };
    if (desktop.isNative()) void desktop.setPosition(position); else { document.documentElement.style.setProperty('--preview-x', `${position.x}px`); document.documentElement.style.setProperty('--preview-y', `${position.y}px`); }
  };
  const persistBrain = (): void => {
    const snapshot = brain.snapshot;
    updatePetData((current) => ({ ...current, needs: snapshot.needs, personality: snapshot.personality, memory: { ...current.memory, lastSeenAt: new Date().toISOString() } }));
  };
  const recordInteraction = (activity?: string): void => {
    updatePetData((current) => {
      const counts = { ...current.memory.activityCounts };
      if (activity) counts[activity] = (counts[activity] ?? 0) + 1;
      return { ...current, memory: { ...current.memory, lastInteractionAt: new Date().toISOString(), totalInteractions: current.memory.totalInteractions + 1, activityCounts: counts } };
    });
  };
  const settingsSignature = (value: PetSettings): string => JSON.stringify([value.name, value.petId, value.petSize, value.movementMode, value.movementLevel, value.reducedMotion, value.audio]);
  let lastSignature = '';
  const announceMovementMode = (): void => {
    if (settings.reducedMotion && settings.movementMode !== 'pinned') { showSpeech('Hareketi azalt açık — gezinmek için ayarlardan kapat.', 4_600, 'quiet'); return; }
    const line = settings.movementMode === 'pinned' ? 'Burada kalıyorum.' : settings.movementMode === 'roam' ? 'Masaüstünde geziniyorum!' : 'Ara sıra kısa turlara çıkarım.';
    showSpeech(line, 5_600, 'positive');
  };
  const applySettings = async (incoming?: unknown, announce = false): Promise<void> => {
    const previousMode = settings.movementMode; const previousReduced = settings.reducedMotion; const previousPetId = settings.petId;
    data = incoming ? acceptRemotePetData(incoming) : desktop.isNative() ? await syncFromNativeStore() : loadPetData();
    const previousSize = settings.petSize; settings = data.settings; audio.update(settings.audio);
    movement.setHome(data.homePosition ?? position);
    const signature = settingsSignature(settings);
    if (signature !== lastSignature) {
      lastSignature = signature;
      document.documentElement.style.setProperty('--pet-window-size', `${PET_WINDOW_SIZE[settings.petSize]}px`);
      renderer.setPet(settings.petId, settings.petSize); pet.dataset.petId = settings.petId; pet.ariaLabel = `${settings.name}, masaüstü peti`; pet.title = `${settings.name} - sağ tıkla hızlı menü`;
      if (previousSize !== settings.petSize) await desktop.resize(PET_WINDOW_SIZE[settings.petSize]);
    }
    const modeChanged = settings.movementMode !== previousMode; const reducedChanged = settings.reducedMotion !== previousReduced;
    if (modeChanged || settings.petId !== previousPetId) movement.reset();
    if (announce && (modeChanged || reducedChanged)) announceMovementMode();
  };
  const applySnapshot = (snapshot: PetSnapshot, now: number): void => {
    const locomotion = movement.locomotionPhase;
    const isSpatialTravel = settings.movementMode === 'roam' && (locomotion === 'leaping' || locomotion === 'climbing' || locomotion === 'hovering');
    const visualState = isSpatialTravel && snapshot.state === 'WALKING' ? 'FALLING' : snapshot.state;
    pet.dataset.state = snapshot.state.toLowerCase(); pet.dataset.locomotion = locomotion; pet.dataset.direction = snapshot.direction === 1 ? 'right' : 'left'; renderer.setWalkDistance(movement.travelDistance); renderer.setState(visualState, snapshot.direction, snapshot.lookDirection); renderer.render(now);
    if (snapshot.state !== lastSnapshotState) {
      if (snapshot.state === 'SLEEPING') sleepIndicatorUntil = now + SLEEP_INDICATOR_DURATION_MS;
      else if (lastSnapshotState === 'SLEEPING') sleepIndicatorUntil = 0;
      if (snapshot.state === 'GROOMING') audio.playReaction('happy', settings.petId);
      else if (snapshot.state === 'TIRED') audio.playReaction('sleep', settings.petId);
      else if (snapshot.state === 'PLAYING') audio.playReaction('happy', settings.petId);
      else if (snapshot.state === 'ANGRY') audio.playReaction('annoyed', settings.petId);
      lastSnapshotState = snapshot.state;
    }
    if (now >= speechUntil) speech.textContent = resolvePassiveSpeech(snapshot.state, now, sleepIndicatorUntil);
  };
  const lookDirection = (): { distance: number; direction: number } => {
    const center = { x: position.x + desktop.getSize() / 2, y: position.y + desktop.getSize() / 2 };
    const dx = lastPresence.cursor.x - center.x; const dy = lastPresence.cursor.y - center.y;
    const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    return { distance: Math.hypot(dx, dy), direction: Math.round(degrees / 22.5) % 16 };
  };

  const showInlinePopover = (message: 'menu' | 'alert'): void => {
    const popoverHeight = message === 'menu' ? 300 : 240;
    const popover = required<HTMLElement>('#popover'); popover.hidden = false; popover.style.position = 'fixed'; popover.style.left = `${Math.min(innerWidth - 228, Math.max(8, position.x + desktop.getSize() + 8))}px`; popover.style.top = `${Math.min(innerHeight - popoverHeight - 8, Math.max(8, position.y - 30))}px`; popover.style.width = '220px'; popover.style.height = `${popoverHeight}px`;
    required<HTMLElement>('#quick-menu').hidden = message !== 'menu'; required<HTMLElement>('#alert-popover').hidden = message !== 'alert';
  };
  const showAlert = async (event: DueEvent): Promise<void> => {
    activeAlert = event; brain.alert(event.kind); showSpeech(event.kind === 'alarm' ? 'ALARM!' : 'Hatırlatma!', 12_000);
    if (event.kind === 'alarm') { audio.startAlarm(); if (alarmMissTimer !== null) clearTimeout(alarmMissTimer); alarmMissTimer = window.setTimeout(() => { if (!activeAlert || activeAlert.id !== event.id) return; audio.stopAlarm(); updatePetData((current) => ({ ...current, items: current.items.map((item) => item.id === event.id && item.type !== 'note' ? { ...item, status: 'missed' } : item) })); void notify(event); activeAlert = null; }, 10 * 60_000); }
    else audio.playReminder();
    new BroadcastChannel(DATA_CHANNEL).postMessage({ type: 'due', event });
    if (!(await desktop.showPopover({ type: 'alert', event }, position))) {
      required<HTMLElement>('#alert-kind').textContent = event.kind === 'alarm' ? 'ALARM' : 'HATIRLATMA'; required<HTMLElement>('#alert-title').textContent = event.title; required<HTMLElement>('#alert-details').textContent = event.details; showInlinePopover('alert');
    }
    if (document.hidden) void notify(event);
  };
  const openManager = async (): Promise<void> => {
    if (await desktop.showManager()) return;
    if (!managerInitialized) { managerInitialized = true; await initializeManager(desktop); return; }
    document.body.classList.add('manager-window'); required<HTMLElement>('#manager').hidden = false; required<HTMLElement>('#app').hidden = true;
  };
  const handleAction = async (payload: { action: PetAction; eventId?: string; minutes?: number }): Promise<void> => {
    switch (payload.action) {
      case 'toggle-pin': {
        const nextMode = settings.movementMode === 'pinned' ? 'hybrid' : 'pinned'; settings = { ...settings, movementMode: nextMode, pinnedCorner: nextMode === 'pinned' ? settings.pinnedCorner : null }; await saveSettings(settings); movement.setHome(position); showSpeech(nextMode === 'pinned' ? 'Buradayım.' : 'Kısa turlara hazırım.'); break;
      }
      case 'dance': brain.activity('dance'); recordInteraction('dance'); audio.playInteraction('dance', settings.petId); break;
      case 'sleep': brain.sleep(); audio.playReaction('sleep', settings.petId); speech.textContent = ''; speechUntil = 0; break;
      case 'focus': brain.focus(); audio.playReaction('focus', settings.petId); showSpeech('Sessizce yanındayım.', 2200, 'quiet', undefined, undefined, false); break;
      case 'add-note': case 'open-manager': await openManager(); break;
      case 'hide-pet': {
        await notifyPetHidden(); data = await setPetHidden(true); await desktop.hideCurrent(); break;
      }
      case 'undo-pin': {
        if (!undoPin) break;
        settings = undoPin.settings; await saveSettings(settings);
        if (undoPin.home) movement.setHome(undoPin.home);
        await savePosition(position, false); undoPin = null;
        if (undoPinTimer !== null) { clearTimeout(undoPinTimer); undoPinTimer = null; }
        showSpeech('Sabitleme geri alındı.', 2200, 'quiet'); break;
      }
      case 'dismiss-alert':
      case 'snooze-alert': {
        const id = payload.eventId ?? activeAlert?.id;
        if (!id) break;
        audio.stopAlarm(); brain.clearTemporary(); activeAlert = null; if (alarmMissTimer !== null) { clearTimeout(alarmMissTimer); alarmMissTimer = null; }
        data = await acknowledgeOrganizerItem(id, payload.action === 'snooze-alert' ? 'snooze' : 'dismiss', payload.minutes ?? settings.audio.snoozeMinutes);
        break;
      }
    }
  };

  pet.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return; event.preventDefault(); pet.setPointerCapture(event.pointerId); movement.reset(); throwing = false;
    const startedAt = performance.now();
    drag = { pointerId: event.pointerId, offset: { x: event.screenX - position.x, y: event.screenY - position.y }, last: { x: event.screenX, y: event.screenY }, lastAt: startedAt, startedAt, velocity: { x: 0, y: 0 }, moved: false, totalDx: 0, totalDy: 0, reversals: 0, peakSpeed: 0, lastDx: 0, wasSleeping: brain.snapshot.state === 'SLEEPING' };
    brain.startDragging();
  });
  pet.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return; event.preventDefault(); const now = performance.now(); const seconds = Math.max(.001, (now - drag.lastAt) / 1000); const dx = event.screenX - drag.last.x; const dy = event.screenY - drag.last.y;
    drag.velocity = { x: dx / seconds, y: dy / seconds }; drag.totalDx += Math.abs(dx); drag.totalDy += Math.abs(dy); drag.peakSpeed = Math.max(drag.peakSpeed, Math.hypot(drag.velocity.x, drag.velocity.y));
    if (drag.lastDx && Math.sign(dx) !== Math.sign(drag.lastDx) && Math.abs(dx) > 2) drag.reversals += 1; if (Math.abs(dx) > 2) drag.lastDx = dx;
    drag.last = { x: event.screenX, y: event.screenY }; drag.lastAt = now; drag.moved ||= drag.totalDx + drag.totalDy > 8; setPosition({ x: event.screenX - drag.offset.x, y: event.screenY - drag.offset.y });
  });
  pet.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return; pet.releasePointerCapture(event.pointerId); const currentDrag = drag; drag = null; const speed = Math.hypot(currentDrag.velocity.x, currentDrag.velocity.y); const now = Date.now();
    const gesture = classifyDragGesture({ durationMs: performance.now() - currentDrag.startedAt, reversals: currentDrag.reversals, peakSpeed: currentDrag.peakSpeed, totalDx: currentDrag.totalDx, totalDy: currentDrag.totalDy }, speed);
    if (gesture === 'shake') {
      throwing = false; body.velocity = { x: 0, y: 0 }; brain.shake(now); recordInteraction('shake'); audio.playReaction('shake', settings.petId); pet.dataset.reaction = 'shake';
      if (reactionTimer !== null) clearTimeout(reactionTimer); reactionTimer = window.setTimeout(() => { delete pet.dataset.reaction; reactionTimer = null; }, 3_600);
      showSpeech('Dünya dönüyor… biraz yavaş!', 3_400, 'quiet', undefined, undefined, false);
    }
    else if (currentDrag.wasSleeping) { brain.wake(now); recordInteraction('wake'); audio.playReaction('wake', settings.petId); speech.textContent = ''; speechUntil = 0; }
    else if (gesture === 'pet') { brain.pet(now); recordInteraction('pet'); audio.playInteraction('pet', settings.petId); showSpeech('Bunu sevdim.', 2200, 'positive', undefined, undefined, false); }
    else if (!currentDrag.moved || speed < 35) { clickTimes = [...clickTimes.filter((time) => now - time < 900), now]; if (clickTimes.length >= 4) { brain.rapidClick(now); audio.playReaction('startle', settings.petId); } else if (clickTimes.length >= 2 && now - clickTimes.at(-2)! < 360) { brain.doubleClick(now); audio.playReaction('happy', settings.petId); } else { brain.click(now); audio.playInteraction('click', settings.petId); } recordInteraction('click'); }
    else { body.velocity = { ...currentDrag.velocity }; throwing = gesture === 'throw'; brain.releaseWithThrow(speed, now); }
    const snap = gesture === 'shake' ? null : getCornerSnap(position, desktop.getBounds());
    if (snap) { void (async () => {
      undoPin = { settings: { ...settings }, home: data.homePosition }; setPosition(snap.position);
      settings = { ...settings, movementMode: 'pinned', pinnedCorner: snap.corner };
      await saveSettings(settings); await savePosition(snap.position, true); movement.setHome(snap.position);
      if (undoPinTimer !== null) clearTimeout(undoPinTimer);
      undoPinTimer = window.setTimeout(() => { undoPin = null; undoPinTimer = null; }, 5_000);
    })(); }
    else savePosition(position, true);
  });
  pet.addEventListener('pointercancel', () => { drag = null; throwing = false; brain.releaseWithThrow(0); });
  pet.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (desktop.isNative()) { void desktop.showPopover({ type: 'menu', movementMode: settings.movementMode, petName: settings.name }, position); return; }
    required<HTMLElement>('#quick-pet-name').textContent = settings.name;
    required<HTMLElement>('[data-action="toggle-pin"] [data-action-label]').textContent = settings.movementMode === 'pinned' ? 'Serbest bırak' : 'Buraya sabitle';
    showInlinePopover('menu');
  });
  required<HTMLButtonElement>('#popover-close').addEventListener('click', () => { required<HTMLElement>('#popover').hidden = true; });
  document.querySelectorAll<HTMLButtonElement>('#quick-menu [data-action]').forEach((button) => button.addEventListener('click', () => { void handleAction({ action: button.dataset.action as PetAction }); required<HTMLElement>('#popover').hidden = true; }));
  window.addEventListener('manager-pet-action', (event) => { void handleAction((event as CustomEvent<{ action: PetAction }>).detail); });
  required<HTMLButtonElement>('#alert-done').addEventListener('click', () => { if (activeAlert) void handleAction({ action: 'dismiss-alert', eventId: activeAlert.id }); required<HTMLElement>('#popover').hidden = true; });
  required<HTMLButtonElement>('#alert-snooze').addEventListener('click', () => { if (activeAlert) void handleAction({ action: 'snooze-alert', eventId: activeAlert.id, minutes: settings.audio.snoozeMinutes }); required<HTMLElement>('#popover').hidden = true; });
  required<HTMLButtonElement>('#alert-open').addEventListener('click', () => void openManager());

  const resolveActiveAlert = (id: string, incoming?: unknown): void => {
    if (activeAlert?.id === id) {
      audio.stopAlarm(); brain.clearTemporary(); activeAlert = null;
      if (alarmMissTimer !== null) { clearTimeout(alarmMissTimer); alarmMissTimer = null; }
    }
    if (incoming) void applySettings(incoming);
  };
  const channel = new BroadcastChannel(DATA_CHANNEL);
  channel.addEventListener('message', (message) => {
    const payload = message.data as DataChannelMessage;
    if (payload.type === 'alert-resolved') resolveActiveAlert(payload.id, payload.data);
    else if (payload.type === 'updated') void applySettings(payload.data, true);
  });
  window.addEventListener('storage', () => void applySettings());
  if (desktop.isNative()) {
    await getCurrentWindow().listen('pet-data-updated', ({ payload }) => void applySettings(payload, true));
    await getCurrentWindow().listen<{ action: PetAction; eventId?: string; minutes?: number }>('pet-action', ({ payload }) => void handleAction(payload));
    await getCurrentWindow().listen<{ id: string; action: 'dismiss' | 'snooze'; data?: unknown }>('alert-resolved', ({ payload }) => resolveActiveAlert(payload.id, payload.data));
    await getCurrentWindow().listen<DueEvent>('scheduler-due', ({ payload }) => { void syncFromNativeStore().then(() => showAlert(payload)); });
    await getCurrentWindow().listen('tray-toggle-mute', () => {
      const current = loadPetData().settings;
      void saveSettings({ ...current, audio: { ...current.audio, muted: !current.audio.muted } });
      void applySettings();
    });
    await getCurrentWindow().listen<BubbleVisibility>('bubble-visibility', ({ payload }) => {
      if (payload.visible) {
        activeBubbleId = payload.id; lastBubbleAnchor = { ...position }; lastBubbleFollowAt = performance.now();
      } else if (activeBubbleId === payload.id) {
        activeBubbleId = null; lastBubbleAnchor = null;
      }
    });
    if (settings.autostart && !(await isEnabled())) await enable().catch(() => undefined);
  }
  window.setInterval(() => { void desktop.presence().then((presence) => { lastPresence = presence; }); }, 250);
  if (!desktop.isNative()) window.setInterval(() => { checkDueEvents().forEach((event) => void showAlert(event)); }, 1_000);
  window.setInterval(persistBrain, 60_000);
  window.addEventListener('beforeunload', () => { savePosition(position); persistBrain(); });

  await applySettings(); setPosition(initialPosition);
  if (desktop.isNative() && data.hidden) { await notifyPetHidden(); await desktop.hideCurrent(); }
  const animate = (now: number): void => {
    const deltaMs = Math.min(48, now - lastFrame); lastFrame = now;
    if (!drag && throwing) {
      const result = stepPhysics(body, desktop.getBounds(), deltaMs / 1000); setPosition(body.position);
      if (Math.abs(body.velocity.x) > 8) brain.face(body.velocity.x > 0 ? 1 : -1);
      if ((result.hitHorizontal || result.hitVertical) && Date.now() - lastImpactAt > 450) {
        lastImpactAt = Date.now(); brain.bump(lastImpactAt); recordInteraction('bump'); audio.playReaction('bump', settings.petId); pet.dataset.reaction = 'shake';
        if (reactionTimer !== null) clearTimeout(reactionTimer); reactionTimer = window.setTimeout(() => { delete pet.dataset.reaction; reactionTimer = null; }, 3_600);
      }
      if (result.landed && isBodySettled(body)) { throwing = false; body.velocity = { x: 0, y: 0 }; savePosition(position, true); movement.setHome(position); audio.playReaction('land', settings.petId); }
    }
    else if (!drag) {
      const next = movement.update(position, desktop.getBounds(), settings.movementMode, settings.movementLevel, settings.reducedMotion, deltaMs / 1000, Date.now(), settings.petId); setPosition(next);
      const target = movement.debugTarget(); if (movement.locomotionPhase === 'anticipating' && target) brain.face(target.x > position.x ? 1 : -1); else if (Math.abs(movement.velocity.x) > 5) brain.face(movement.velocity.x > 0 ? 1 : -1);
      const stepIndex = Math.floor(movement.travelDistance / 7.5); if (movement.isMoving() && movement.locomotionPhase === 'walking' && stepIndex !== lastStepIndex && stepIndex % 4 === 0) audio.playFootstep(settings.petId); lastStepIndex = stepIndex;
    }
    const look = lookDirection(); const snapshot = brain.tick(deltaMs, { now: new Date(), userIdleMs: lastPresence.idleMs, cursorDistance: look.distance, lookDirection: look.direction, isMoving: movement.isMoving() || throwing });
    const spatial = movement.spatialPose;
    pet.style.setProperty('--motion-angle', `${Math.max(-9, Math.min(9, (throwing ? body.velocity.x / 16 : spatial.bank)))}deg`);
    pet.style.setProperty('--depth-scale', drag || throwing ? '1' : spatial.scale.toFixed(3));
    pet.style.setProperty('--spatial-lift', drag || throwing ? '0px' : `${spatial.lift.toFixed(2)}px`);
    pet.style.setProperty('--tilt-x', drag || throwing ? '0deg' : `${spatial.tiltX.toFixed(2)}deg`);
    pet.style.setProperty('--tilt-y', drag || throwing ? '0deg' : `${spatial.tiltY.toFixed(2)}deg`);
    pet.style.setProperty('--shadow-scale', (drag || throwing ? 1 : spatial.shadowScale).toFixed(3));
    pet.style.setProperty('--shadow-opacity', (drag || throwing ? .24 : spatial.shadowOpacity).toFixed(3));
    pet.dataset.airborne = !drag && !throwing && spatial.airborne ? 'true' : 'false';
    applySnapshot(snapshot, now);
    if (activeBubbleId && now - lastBubbleFollowAt >= 50 && (!lastBubbleAnchor || Math.hypot(position.x - lastBubbleAnchor.x, position.y - lastBubbleAnchor.y) >= 2)) {
      lastBubbleFollowAt = now; lastBubbleAnchor = { ...position };
      void desktop.followBubble({ id: activeBubbleId, anchor: position, petSize: desktop.getSize(), workArea: desktop.getWorkArea() });
    }
    if (!drag && now - lastSave > 4_000) { savePosition(position); lastSave = now; }
    if (now - lastDiag > 1_000 && localStorage.getItem('petDiag') === '1') {
      lastDiag = now; const b = desktop.getBounds();
      console.info('[petDiag]', { mode: settings.movementMode, reduced: settings.reducedMotion, bounds: b, pos: { x: Math.round(position.x), y: Math.round(position.y) }, target: movement.debugTarget(), depth: Number(spatial.depth.toFixed(2)), phase: movement.locomotionPhase, vel: { x: Math.round(movement.velocity.x), y: Math.round(movement.velocity.y) }, moving: movement.isMoving(), throwing });
    }
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
};

const bootstrap = async (): Promise<void> => {
  await initializeStorage();
  const label = desktop.getLabel();
  if (label === 'assistant') return initializeManager(desktop);
  if (label === 'popover') return initializePopover(desktop);
  if (label === 'bubble') return initializeBubble(desktop);
  return runPet();
};

void bootstrap();
