import type { Bounds, MovementLevel, MovementMode, PinnedCorner, Vector2 } from './types';

const profiles: Record<MovementLevel, { speed: number; acceleration: number }> = {
  calm: { speed: 46, acceleration: 105 }, normal: { speed: 72, acceleration: 165 }, active: { speed: 104, acceleration: 230 }
};
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const distance = (a: Vector2, b: Vector2): number => Math.hypot(a.x - b.x, a.y - b.y);

export interface CornerSnap { corner: PinnedCorner; position: Vector2; }
export type LocomotionPhase = 'resting' | 'anticipating' | 'walking' | 'returning' | 'settling' | 'dropping';

export const getCornerSnap = (position: Vector2, bounds: Bounds, threshold = 72): CornerSnap | null => {
  const candidates: CornerSnap[] = [
    { corner: 'top-left', position: { x: bounds.minX, y: bounds.minY } }, { corner: 'top-right', position: { x: bounds.maxX, y: bounds.minY } },
    { corner: 'bottom-left', position: { x: bounds.minX, y: bounds.maxY } }, { corner: 'bottom-right', position: { x: bounds.maxX, y: bounds.maxY } }
  ];
  const closest = candidates.sort((left, right) => distance(position, left.position) - distance(position, right.position))[0];
  return closest && distance(position, closest.position) <= threshold ? closest : null;
};

export class MovementController {
  readonly velocity: Vector2 = { x: 0, y: 0 };
  private target: Vector2 | null = null;
  private home: Vector2 | null = null;
  private phase: LocomotionPhase = 'resting';
  private patrolEndsAt = 0;
  private nextPatrolAt = 0;
  private roamRestUntil = 0;
  private phaseUntil = 0;
  private travelled = 0;
  private gaitMultiplier = 1;

  constructor(private readonly random: () => number = Math.random) {}
  reset(now = Date.now()): void {
    this.velocity.x = 0; this.velocity.y = 0; this.target = null; this.phase = 'resting';
    this.roamRestUntil = 0; this.phaseUntil = 0; this.nextPatrolAt = now + this.randomPatrolDelay();
  }
  setHome(home: Vector2): void { this.home = { ...home }; }
  isMoving(): boolean { return Math.hypot(this.velocity.x, this.velocity.y) > 4; }
  debugTarget(): Vector2 | null { return this.target ? { x: Math.round(this.target.x), y: Math.round(this.target.y) } : null; }
  get locomotionPhase(): LocomotionPhase { return this.phase; }
  get travelDistance(): number { return this.travelled; }

  update(position: Vector2, bounds: Bounds, mode: MovementMode, level: MovementLevel, reducedMotion: boolean, deltaSeconds: number, now: number): Vector2 {
    if (!this.home) this.home = { ...position };
    if (reducedMotion || mode === 'pinned') return this.stop(position);
    if (mode === 'hybrid') return this.updateHybrid(position, bounds, level, deltaSeconds, now);
    return this.updateGroundRoam(position, bounds, level, deltaSeconds, now);
  }

  private updateGroundRoam(position: Vector2, bounds: Bounds, level: MovementLevel, deltaSeconds: number, now: number): Vector2 {
    const floor = bounds.maxY;
    if (position.y < floor - 1) {
      this.phase = 'dropping'; this.target = null; this.velocity.x *= Math.max(0, 1 - deltaSeconds * 6); this.velocity.y = Math.min(540, this.velocity.y + 780 * deltaSeconds);
      const y = Math.min(floor, position.y + this.velocity.y * deltaSeconds);
      if (y >= floor) { this.velocity.y = 0; this.phase = 'settling'; this.phaseUntil = now + 420; }
      return { x: clamp(position.x + this.velocity.x * deltaSeconds, bounds.minX, bounds.maxX), y };
    }
    if (this.phase === 'dropping') { this.phase = 'settling'; this.phaseUntil = now + 420; }
    if (this.phase === 'settling') {
      if (now < this.phaseUntil) return this.stop({ x: position.x, y: floor });
      this.phase = 'resting'; this.roamRestUntil = now + 650 + this.random() * 1_700;
    }
    if (this.phase === 'resting' && now < this.roamRestUntil) return this.stop({ x: position.x, y: floor });
    if (!this.target) {
      this.target = this.chooseGroundTarget(position, bounds); this.gaitMultiplier = this.random() > .72 ? 1.55 : .78 + this.random() * .38; this.phase = 'anticipating'; this.phaseUntil = now + 320 + this.random() * 520;
      return this.stop({ x: position.x, y: floor });
    }
    if (this.phase === 'anticipating') {
      if (now < this.phaseUntil) return this.stop({ x: position.x, y: floor });
      this.phase = 'walking';
    }
    const remaining = Math.abs(this.target.x - position.x);
    if (remaining < 7) {
      const arrived = { x: this.target.x, y: floor }; this.target = null; this.phase = 'settling'; this.phaseUntil = now + 380 + this.random() * 520;
      return this.stop(arrived);
    }
    const profile = profiles[level]; const direction = Math.sign(this.target.x - position.x) || 1;
    const arrival = clamp(remaining / 88, .18, 1); const desired = direction * profile.speed * this.gaitMultiplier * arrival;
    const maxChange = profile.acceleration * (this.gaitMultiplier > 1.2 ? 1.25 : 1) * deltaSeconds; this.velocity.x += clamp(desired - this.velocity.x, -maxChange, maxChange); this.velocity.y = 0;
    const nextX = clamp(position.x + this.velocity.x * deltaSeconds, bounds.minX, bounds.maxX); this.travelled += Math.abs(nextX - position.x);
    return { x: nextX, y: floor };
  }

  private updateHybrid(position: Vector2, bounds: Bounds, level: MovementLevel, deltaSeconds: number, now: number): Vector2 {
    if (this.nextPatrolAt === 0) this.nextPatrolAt = now + this.randomPatrolDelay();
    if (this.phase === 'resting' && now >= this.nextPatrolAt) {
      this.phase = 'walking'; this.gaitMultiplier = this.random() > .8 ? 1.35 : .82 + this.random() * .32; this.patrolEndsAt = now + 8_000 + this.random() * 17_000; this.target = this.chooseTarget(this.home!, bounds, 70, 240);
    }
    if (this.phase === 'resting') return this.stop(position);
    if (this.phase === 'walking' && (now >= this.patrolEndsAt || distance(position, this.home!) >= 238)) { this.phase = 'returning'; this.target = { ...this.home! }; }
    if (this.phase === 'returning' && distance(position, this.home!) < 5) {
      this.phase = 'resting'; this.nextPatrolAt = now + this.randomPatrolDelay(); this.target = null; return this.stop(this.home!);
    }
    if (this.phase === 'walking' && this.target && distance(position, this.target) < 16) this.target = this.chooseTarget(this.home!, bounds, 45, 240);
    return this.steer2d(position, bounds, level, deltaSeconds);
  }

  private stop(position: Vector2): Vector2 { this.velocity.x = 0; this.velocity.y = 0; return { ...position }; }
  private steer2d(position: Vector2, bounds: Bounds, level: MovementLevel, deltaSeconds: number): Vector2 {
    const target = this.target ?? position; const dx = target.x - position.x; const dy = target.y - position.y; const remaining = Math.max(1, Math.hypot(dx, dy)); const profile = profiles[level];
    const arrival = clamp(remaining / 80, .24, 1); const desired = { x: dx / remaining * profile.speed * this.gaitMultiplier * arrival, y: dy / remaining * profile.speed * this.gaitMultiplier * arrival };
    const change = { x: desired.x - this.velocity.x, y: desired.y - this.velocity.y }; const changeLength = Math.max(1, Math.hypot(change.x, change.y)); const scale = Math.min(1, profile.acceleration * deltaSeconds / changeLength);
    this.velocity.x += change.x * scale; this.velocity.y += change.y * scale;
    const next = { x: clamp(position.x + this.velocity.x * deltaSeconds, bounds.minX, bounds.maxX), y: clamp(position.y + this.velocity.y * deltaSeconds, bounds.minY, bounds.maxY) };
    this.travelled += distance(position, next); return next;
  }
  private chooseGroundTarget(origin: Vector2, bounds: Bounds): Vector2 {
    const availableLeft = origin.x - bounds.minX; const availableRight = bounds.maxX - origin.x;
    const preferRight = availableRight < 150 ? false : availableLeft < 150 ? true : this.random() >= .5;
    const room = preferRight ? availableRight : availableLeft; const distanceToWalk = Math.min(room - 8, 150 + this.random() * Math.min(620, Math.max(0, room - 158)));
    return { x: clamp(origin.x + (preferRight ? 1 : -1) * Math.max(80, distanceToWalk), bounds.minX + 8, bounds.maxX - 8), y: bounds.maxY };
  }
  private chooseTarget(origin: Vector2, bounds: Bounds, minRadius: number, maxRadius: number): Vector2 {
    const angle = this.random() * Math.PI * 2; const radius = minRadius + this.random() * (maxRadius - minRadius);
    return { x: clamp(origin.x + Math.cos(angle) * radius, bounds.minX + 8, bounds.maxX - 8), y: clamp(origin.y + Math.sin(angle) * radius, bounds.minY + 8, bounds.maxY - 8) };
  }
  private randomPatrolDelay(): number { return 3 * 60_000 + this.random() * 5 * 60_000; }
}
