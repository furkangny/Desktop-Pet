import type { Bounds, MovementLevel, MovementMode, PetId, PinnedCorner, Vector2 } from './types';

const profiles: Record<MovementLevel, { speed: number; acceleration: number }> = {
  calm: { speed: 46, acceleration: 105 }, normal: { speed: 72, acceleration: 165 }, active: { speed: 104, acceleration: 230 }
};
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const distance = (a: Vector2, b: Vector2): number => Math.hypot(a.x - b.x, a.y - b.y);

export interface CornerSnap { corner: PinnedCorner; position: Vector2; }
export type LocomotionPhase = 'resting' | 'anticipating' | 'walking' | 'returning' | 'settling' | 'dropping' | 'leaping' | 'climbing' | 'hovering';
interface SpatialTarget extends Vector2 { z: number; kind: 'ground' | 'perch' | 'climb' | 'hover'; }
export interface SpatialPose {
  depth: number;
  scale: number;
  lift: number;
  bank: number;
  tiltX: number;
  tiltY: number;
  shadowScale: number;
  shadowOpacity: number;
  airborne: boolean;
}

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
  private target: SpatialTarget | null = null;
  private home: Vector2 | null = null;
  private phase: LocomotionPhase = 'resting';
  private patrolEndsAt = 0;
  private nextPatrolAt = 0;
  private roamRestUntil = 0;
  private phaseUntil = 0;
  private travelled = 0;
  private gaitMultiplier = 1;
  private depth = .55;
  private depthVelocity = 0;
  private routeLength = 1;
  private pose: SpatialPose = { depth: .55, scale: 1, lift: 0, bank: 0, tiltX: 0, tiltY: 0, shadowScale: 1, shadowOpacity: .24, airborne: false };

  constructor(private readonly random: () => number = Math.random) {}
  reset(now = Date.now()): void {
    this.velocity.x = 0; this.velocity.y = 0; this.depthVelocity = 0; this.target = null; this.phase = 'resting';
    this.depth = .55; this.pose = { depth: .55, scale: 1, lift: 0, bank: 0, tiltX: 0, tiltY: 0, shadowScale: 1, shadowOpacity: .24, airborne: false };
    this.roamRestUntil = 0; this.phaseUntil = 0; this.nextPatrolAt = now + this.randomPatrolDelay();
  }
  setHome(home: Vector2): void { this.home = { ...home }; }
  isMoving(): boolean { return Math.hypot(this.velocity.x, this.velocity.y) > 4; }
  debugTarget(): Vector2 | null { return this.target ? { x: Math.round(this.target.x), y: Math.round(this.target.y) } : null; }
  get locomotionPhase(): LocomotionPhase { return this.phase; }
  get travelDistance(): number { return this.travelled; }
  get spatialPose(): SpatialPose { return { ...this.pose }; }

  update(position: Vector2, bounds: Bounds, mode: MovementMode, level: MovementLevel, reducedMotion: boolean, deltaSeconds: number, now: number, petId: PetId = 'tiny-robot'): Vector2 {
    if (!this.home) this.home = { ...position };
    if (reducedMotion || mode === 'pinned') { this.pose = { depth: .55, scale: 1, lift: 0, bank: 0, tiltX: 0, tiltY: 0, shadowScale: 1, shadowOpacity: .24, airborne: false }; return this.stop(position); }
    if (mode === 'hybrid') {
      const next = this.updateHybrid(position, bounds, level, deltaSeconds, now);
      this.pose = { depth: .55, scale: 1, lift: 0, bank: clamp(this.velocity.x / 28, -5, 5), tiltX: 0, tiltY: 0, shadowScale: 1, shadowOpacity: .24, airborne: false };
      return next;
    }
    return this.updateSpatialRoam(position, bounds, level, deltaSeconds, now, petId);
  }

  private updateSpatialRoam(position: Vector2, bounds: Bounds, level: MovementLevel, deltaSeconds: number, now: number, petId: PetId): Vector2 {
    if (this.phase === 'settling') {
      this.updatePose(petId, 0);
      if (now < this.phaseUntil) return this.stop(position);
      this.phase = 'resting'; this.roamRestUntil = now + 700 + this.random() * 2_800;
    }
    if (this.phase === 'resting' && now < this.roamRestUntil) { this.updatePose(petId, 0); return this.stop(position); }
    if (!this.target) {
      this.target = this.chooseSpatialTarget(position, bounds, petId);
      this.routeLength = Math.max(1, distance(position, this.target));
      this.gaitMultiplier = this.random() > .76 ? 1.42 : .76 + this.random() * .42;
      this.phase = 'anticipating'; this.phaseUntil = now + 260 + this.random() * 620;
      this.updatePose(petId, 0); return this.stop(position);
    }
    if (this.phase === 'anticipating') {
      if (now < this.phaseUntil) { this.updatePose(petId, 0); return this.stop(position); }
      this.phase = this.target.kind === 'hover' ? 'hovering' : this.target.kind === 'climb' ? 'climbing' : this.target.kind === 'perch' ? 'leaping' : 'walking';
    }
    const remaining = distance(position, this.target);
    if (remaining < 9) {
      const arrived = { x: this.target.x, y: this.target.y };
      this.depth = this.target.z; this.depthVelocity = 0; this.target = null;
      this.phase = 'settling'; this.phaseUntil = now + 420 + this.random() * 1_100; this.updatePose(petId, 1);
      return this.stop(arrived);
    }
    const progress = clamp(1 - remaining / this.routeLength, 0, 1);
    const next = this.steer3d(position, bounds, level, deltaSeconds);
    this.updatePose(petId, progress);
    return next;
  }

  private updateHybrid(position: Vector2, bounds: Bounds, level: MovementLevel, deltaSeconds: number, now: number): Vector2 {
    if (this.nextPatrolAt === 0) this.nextPatrolAt = now + this.randomPatrolDelay();
    if (this.phase === 'resting' && now >= this.nextPatrolAt) {
      this.phase = 'walking'; this.gaitMultiplier = this.random() > .8 ? 1.35 : .82 + this.random() * .32; this.patrolEndsAt = now + 8_000 + this.random() * 17_000; this.target = { ...this.chooseTarget(this.home!, bounds, 70, 240), z: this.depth, kind: 'ground' };
    }
    if (this.phase === 'resting') return this.stop(position);
    if (this.phase === 'walking' && (now >= this.patrolEndsAt || distance(position, this.home!) >= 238)) { this.phase = 'returning'; this.target = { ...this.home!, z: this.depth, kind: 'ground' }; }
    if (this.phase === 'returning' && distance(position, this.home!) < 5) {
      this.phase = 'resting'; this.nextPatrolAt = now + this.randomPatrolDelay(); this.target = null; return this.stop(this.home!);
    }
    if (this.phase === 'walking' && this.target && distance(position, this.target) < 16) this.target = { ...this.chooseTarget(this.home!, bounds, 45, 240), z: this.depth, kind: 'ground' };
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
  private steer3d(position: Vector2, bounds: Bounds, level: MovementLevel, deltaSeconds: number): Vector2 {
    const next = this.steer2d(position, bounds, level, deltaSeconds);
    const targetDepth = this.target?.z ?? this.depth;
    const desiredDepthVelocity = clamp((targetDepth - this.depth) * 2.6, -.58, .58);
    const maxDepthChange = 1.4 * deltaSeconds;
    this.depthVelocity += clamp(desiredDepthVelocity - this.depthVelocity, -maxDepthChange, maxDepthChange);
    this.depth = clamp(this.depth + this.depthVelocity * deltaSeconds, 0, 1);
    return next;
  }
  private chooseSpatialTarget(origin: Vector2, bounds: Bounds, petId: PetId): SpatialTarget {
    const insetX = Math.min(34, Math.max(8, (bounds.maxX - bounds.minX) * .025));
    const insetY = Math.min(30, Math.max(8, (bounds.maxY - bounds.minY) * .035));
    const x = bounds.minX + insetX + this.random() * Math.max(1, bounds.maxX - bounds.minX - insetX * 2);
    const depth = .08 + this.random() * .9;
    if (petId !== 'pixel-cat') {
      const y = bounds.minY + insetY + this.random() * Math.max(1, bounds.maxY - bounds.minY - insetY * 2);
      return { x, y, z: depth, kind: 'hover' };
    }
    const choice = this.random();
    if (choice < .42) return { x, y: bounds.maxY, z: .58 + this.random() * .42, kind: Math.abs(origin.y - bounds.maxY) > 30 ? 'perch' : 'ground' };
    if (choice < .78) {
      const y = bounds.minY + (bounds.maxY - bounds.minY) * (.18 + this.random() * .58);
      return { x, y, z: depth, kind: 'perch' };
    }
    const sideX = this.random() < .5 ? bounds.minX + insetX : bounds.maxX - insetX;
    const y = bounds.minY + insetY + this.random() * Math.max(1, (bounds.maxY - bounds.minY) * .72);
    return { x: sideX, y, z: depth, kind: 'climb' };
  }
  private updatePose(petId: PetId, progress: number): void {
    const moving = this.isMoving();
    const robotHover = petId !== 'pixel-cat' && (this.phase === 'hovering' || moving);
    const catAirborne = petId === 'pixel-cat' && (this.phase === 'leaping' || this.phase === 'climbing') && moving;
    const arc = catAirborne ? Math.sin(clamp(progress, 0, 1) * Math.PI) : 0;
    const hover = robotHover ? 5 + Math.sin((this.travelled + this.depth * 90) / 22) * 2.4 : 0;
    const lift = -(arc * 18 + hover);
    const velocityBank = clamp(this.velocity.x / 24, -8, 8);
    const depthScale = .76 + this.depth * .3;
    this.pose = {
      depth: this.depth,
      scale: depthScale,
      lift,
      bank: moving ? velocityBank : 0,
      tiltX: moving ? clamp(-this.velocity.y / 18, -9, 9) : 0,
      tiltY: moving ? clamp(this.depthVelocity * 18 + this.velocity.x / 42, -10, 10) : 0,
      shadowScale: clamp(depthScale * (1 - arc * .34), .5, 1.12),
      shadowOpacity: clamp(.12 + this.depth * .18 - arc * .09, .07, .3),
      airborne: robotHover || catAirborne
    };
  }
  private chooseTarget(origin: Vector2, bounds: Bounds, minRadius: number, maxRadius: number): Vector2 {
    const angle = this.random() * Math.PI * 2; const radius = minRadius + this.random() * (maxRadius - minRadius);
    return { x: clamp(origin.x + Math.cos(angle) * radius, bounds.minX + 8, bounds.maxX - 8), y: clamp(origin.y + Math.sin(angle) * radius, bounds.minY + 8, bounds.maxY - 8) };
  }
  private randomPatrolDelay(): number { return 3 * 60_000 + this.random() * 5 * 60_000; }
}
