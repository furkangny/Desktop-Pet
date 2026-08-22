import type { BehaviorContext, Direction, PetNeeds, PetPersonality, PetSnapshot, PetState } from './types';

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

// Group ambient states by the silhouette/expression family they read as, so the
// director avoids playing two visually similar clips back to back.
const AMBIENT_FAMILY: Partial<Record<PetState, string>> = {
  IDLE: 'calm', CONTENT: 'calm', OBSERVING: 'scan', CURIOUS: 'scan',
  FIDGETING: 'fidget', STRETCHING: 'stretch', PLAYING: 'play', SLEEPING: 'rest',
  GROOMING: 'care', TIRED: 'rest', ANGRY: 'sharp'
};
const AMBIENT_COOLDOWN = 22_000;

export class DigitalPetBrain {
  private state: PetState = 'IDLE';
  private direction: Direction = 1;
  private lookDirection: number | null = null;
  private temporaryUntil = 0;
  private temporaryInterruptible = false;
  private nextAmbientDecisionAt = 0;
  private settleUntil = 0;
  private ambientHistory: PetState[] = [];
  private familyHistory: string[] = [];
  private cooldownUntil: Partial<Record<PetState, number>> = {};
  private gazeUntil = 0;
  private nextGazeAt = 0;
  private wasAway = false;
  private startedAt = Date.now();
  private shakeTimes: number[] = [];

  constructor(
    private needs: PetNeeds,
    private personality: PetPersonality,
    private readonly random: () => number = Math.random
  ) {
    this.needs = { ...needs };
    this.personality = { ...personality };
  }

  get snapshot(): PetSnapshot {
    return {
      state: this.state,
      direction: this.direction,
      lookDirection: this.lookDirection,
      needs: { ...this.needs },
      personality: { ...this.personality }
    };
  }

  tick(deltaMs: number, context: BehaviorContext): PetSnapshot {
    this.decayNeeds(deltaMs, context.now);
    const now = context.now.getTime();
    if (this.state === 'DRAGGED' || (now < this.temporaryUntil && !this.temporaryInterruptible)) return this.snapshot;

    if (this.state === 'SLEEPING' && now >= this.temporaryUntil) {
      return this.wake(now);
    }
    if (context.userIdleMs >= 5 * 60_000) {
      this.wasAway = true;
      this.enter('SLEEPING');
      return this.snapshot;
    }
    if (this.wasAway) {
      this.wasAway = false;
      this.needs.social = clamp(this.needs.social + 3);
      return this.temporary('GREETING', now, 2_800);
    }
    if (context.isMoving) {
      this.lookDirection = null;
      this.enter('WALKING');
      return this.snapshot;
    }
    const cursorIsClose = context.cursorDistance <= 150;
    const cursorIsNearby = context.cursorDistance <= 420;
    if (cursorIsNearby && context.lookDirection !== null && (cursorIsClose || now < this.gazeUntil || now >= this.nextGazeAt)) {
      if (now >= this.gazeUntil) {
        this.gazeUntil = now + 1_200 + this.random() * 2_400;
        this.nextGazeAt = this.gazeUntil + 2_000 + this.random() * 6_000;
      }
      this.lookDirection = context.lookDirection;
      this.enter('LOOKING');
      return this.snapshot;
    }
    if (now < this.temporaryUntil && this.temporaryInterruptible) return this.snapshot;
    this.temporaryInterruptible = false;
    if (now < this.settleUntil && !context.isMoving) {
      this.lookDirection = null;
      this.enter('IDLE');
      return this.snapshot;
    }

    this.lookDirection = null;
    if (now >= this.nextAmbientDecisionAt) {
      this.chooseAmbientState(context.now, now);
      this.nextAmbientDecisionAt = now + 5_000 + this.random() * 11_000;
    }
    return this.snapshot;
  }

  face(direction: Direction): void { this.direction = direction; }

  startDragging(now = Date.now()): PetSnapshot {
    this.temporaryUntil = now;
    this.enter('DRAGGED');
    return this.snapshot;
  }

  releaseWithThrow(speed: number, now = Date.now()): PetSnapshot {
    this.needs.energy = clamp(this.needs.energy - Math.min(4, speed / 380));
    this.needs.fun = clamp(this.needs.fun + Math.min(5, speed / 300));
    return speed > 900 ? this.temporary('DIZZY', now, 2_300) : this.temporary('CURIOUS', now, 900);
  }

  click(now = Date.now()): PetSnapshot {
    this.needs.social = clamp(this.needs.social + 1.5);
    this.adapt('sociability', 0.12);
    return this.temporary('CURIOUS', now, 900);
  }

  doubleClick(now = Date.now()): PetSnapshot {
    this.needs.social = clamp(this.needs.social + 4);
    this.needs.comfort = clamp(this.needs.comfort + 2);
    this.adapt('sociability', 0.2);
    return this.temporary('GREETING', now, 2_200);
  }

  rapidClick(now = Date.now()): PetSnapshot {
    this.needs.curiosity = clamp(this.needs.curiosity + 2);
    return this.temporary('STARTLED', now, 1_500);
  }

  pet(now = Date.now()): PetSnapshot {
    this.needs.social = clamp(this.needs.social + 5);
    this.needs.comfort = clamp(this.needs.comfort + 5);
    this.adapt('calmness', 0.18);
    return this.temporary('CELEBRATING', now, 1_900);
  }

  shake(now = Date.now()): PetSnapshot {
    this.shakeTimes = [...this.shakeTimes.filter((time) => now - time < 18_000), now];
    this.needs.fun = clamp(this.needs.fun - (this.shakeTimes.length >= 3 ? 6 : 2));
    this.needs.comfort = clamp(this.needs.comfort - 4);
    if (this.shakeTimes.length >= 3) return this.temporary('ANGRY', now, 4_200);
    return this.temporary('DIZZY', now, 3_600);
  }

  bump(now = Date.now()): PetSnapshot {
    this.needs.comfort = clamp(this.needs.comfort - 5);
    this.needs.energy = clamp(this.needs.energy - 2);
    return this.shake(now);
  }

  activity(activity: 'dance', now = Date.now()): PetSnapshot {
    this.needs.fun = clamp(this.needs.fun + 10);
    this.needs.curiosity = clamp(this.needs.curiosity + 4);
    this.needs.energy = clamp(this.needs.energy - 2);
    this.adapt('sociability', 0.25);
    this.settleUntil = now + 8_000 + this.random() * 17_000;
    return this.temporary('DANCING', now, 4_200);
  }

  focus(now = Date.now()): PetSnapshot { this.settleUntil = 0; return this.temporary('FOCUSED', now, 25 * 60_000); }
  sleep(now = Date.now()): PetSnapshot { return this.temporary('SLEEPING', now, 20 * 60_000); }
  wake(now = Date.now()): PetSnapshot {
    this.needs.energy = clamp(this.needs.energy + 2);
    this.needs.comfort = clamp(this.needs.comfort + 1);
    return this.temporary('STRETCHING', now, 2_400);
  }
  alert(kind: 'reminder' | 'alarm', now = Date.now()): PetSnapshot {
    return this.temporary('ALERTING', now, kind === 'alarm' ? 10 * 60_000 : 20_000);
  }
  clearTemporary(): void { this.temporaryUntil = 0; this.temporaryInterruptible = false; this.enter('IDLE'); }

  private enter(state: PetState): void { this.state = state; }
  private temporary(state: PetState, now: number, durationMs: number): PetSnapshot {
    this.enter(state);
    this.temporaryUntil = now + durationMs;
    this.temporaryInterruptible = false;
    return this.snapshot;
  }

  private decayNeeds(deltaMs: number, now: Date): void {
    const minutes = deltaMs / 60_000;
    const nightFactor = now.getHours() >= 23 || now.getHours() < 7 ? 0.45 : 1;
    this.needs.energy = clamp(this.needs.energy - minutes * 0.025 * nightFactor);
    this.needs.social = clamp(this.needs.social - minutes * 0.018);
    this.needs.fun = clamp(this.needs.fun - minutes * 0.022);
    this.needs.curiosity = clamp(this.needs.curiosity - minutes * 0.012);
    this.needs.comfort = clamp(this.needs.comfort - minutes * 0.008);
  }

  private chooseAmbientState(now: Date, nowMs: number): void {
    const isNight = now.getHours() >= 23 || now.getHours() < 7;
    const longSessionFatigue = nowMs - this.startedAt > 45 * 60_000 ? 18 : nowMs - this.startedAt > 20 * 60_000 ? 8 : 0;
    const candidates: Array<{ state: PetState; weight: number; duration: [number, number] }> = [
      { state: 'IDLE', weight: 28 + this.personality.calmness * 0.2, duration: [1_500, 3_800] },
      { state: 'OBSERVING', weight: 18 + this.personality.curiosity * 0.22, duration: [2_000, 4_600] },
      { state: 'CONTENT', weight: 12 + this.needs.comfort * 0.14, duration: [1_800, 3_600] },
      { state: 'FIDGETING', weight: isNight ? 3 : 10 + this.personality.playfulness * 0.12, duration: [1_400, 3_000] },
      { state: 'STRETCHING', weight: isNight ? 2 : 8 + (100 - this.needs.energy) * 0.08, duration: [1_600, 2_800] },
      { state: 'CURIOUS', weight: 7 + (100 - this.needs.curiosity) * 0.12, duration: [1_400, 2_700] },
      { state: 'PLAYING', weight: isNight ? 1 : 4 + this.needs.fun * 0.06, duration: [1_800, 3_400] }
    ];
    if (this.needs.energy < 46 || longSessionFatigue > 0) candidates.push({ state: 'TIRED', weight: 8 + longSessionFatigue + (46 - this.needs.energy) * 0.16, duration: [2_200, 5_800] });
    if (this.needs.energy < 30 || isNight) candidates.push({ state: 'SLEEPING', weight: isNight ? 22 : 10 + longSessionFatigue, duration: [12_000, 38_000] });
    if (this.needs.fun < 34 && !isNight) candidates.push({ state: 'PLAYING', weight: 9 + this.personality.playfulness * 0.1, duration: [1_800, 3_200] });
    if (this.needs.comfort > 54 && !isNight) candidates.push({ state: 'GROOMING', weight: 8, duration: [2_400, 4_800] });
    const recentStates = new Set([this.state, ...this.ambientHistory.slice(-4)]);
    const recentFamilies = new Set(this.familyHistory.slice(-2));
    const offCooldown = candidates.filter((candidate) => nowMs >= (this.cooldownUntil[candidate.state] ?? 0));
    const freshState = offCooldown.filter((candidate) => !recentStates.has(candidate.state));
    const freshFamily = freshState.filter((candidate) => !recentFamilies.has(AMBIENT_FAMILY[candidate.state] ?? candidate.state));
    const pool = freshFamily.length ? freshFamily : freshState.length ? freshState : offCooldown.length ? offCooldown : candidates;
    const total = pool.reduce((sum, candidate) => sum + candidate.weight, 0);
    let roll = this.random() * total;
    const selected = pool.find((candidate) => (roll -= candidate.weight) <= 0) ?? pool[pool.length - 1];
    this.enter(selected.state);
    this.temporaryUntil = nowMs + selected.duration[0] + this.random() * (selected.duration[1] - selected.duration[0]);
    this.temporaryInterruptible = true;
    this.settleUntil = this.temporaryUntil + 4_000 + this.random() * 12_000;
    this.cooldownUntil[selected.state] = nowMs + AMBIENT_COOLDOWN;
    this.ambientHistory = [...this.ambientHistory, selected.state].slice(-5);
    this.familyHistory = [...this.familyHistory, AMBIENT_FAMILY[selected.state] ?? selected.state].slice(-4);
  }

  private adapt(trait: keyof PetPersonality, amount: number): void {
    this.personality[trait] = clamp(this.personality[trait] + Math.min(0.35, amount));
  }
}
