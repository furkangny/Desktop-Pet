import { PET_MANIFESTS, PET_PIXEL_SIZE } from './petCatalog';
import type { Direction, PetId, PetSize, PetState } from './types';

const pixelCatSleepSprite = new URL('../assets/pet-state/pixel-cat-sleep.png', import.meta.url).href;

type LoopMode = 'loop' | 'ping-pong' | 'hold' | 'sparse-loop';
interface ClipDefinition {
  row: number;
  sequence: number[];
  frameMs: number;
  loopMode: LoopMode;
  sparseHoldMs?: number;
}

const stateClips: Record<PetState, ClipDefinition[]> = {
  IDLE: [
    { row: 0, sequence: [0, 1, 0, 2, 0], frameMs: 330, loopMode: 'sparse-loop', sparseHoldMs: 2_200 },
    { row: 0, sequence: [0, 0, 3, 0], frameMs: 420, loopMode: 'sparse-loop', sparseHoldMs: 2_800 },
    { row: 8, sequence: [0, 2, 0], frameMs: 520, loopMode: 'sparse-loop', sparseHoldMs: 2_500 }
  ],
  LOOKING: [{ row: 9, sequence: [0], frameMs: 180, loopMode: 'hold' }],
  WALKING: [{ row: 1, sequence: [0, 1, 2, 3, 4, 5, 6, 7], frameMs: 118, loopMode: 'loop' }],
  GREETING: [{ row: 3, sequence: [0, 1, 2, 3, 2, 1, 0], frameMs: 170, loopMode: 'hold' }],
  CURIOUS: [{ row: 8, sequence: [0, 2, 3, 2, 0], frameMs: 230, loopMode: 'ping-pong' }],
  OBSERVING: [
    { row: 8, sequence: [0, 2, 3, 2, 0], frameMs: 360, loopMode: 'hold' },
    { row: 8, sequence: [0, 5, 0, 2, 0], frameMs: 420, loopMode: 'hold' }
  ],
  FIDGETING: [
    { row: 6, sequence: [0, 1, 2, 1, 0], frameMs: 280, loopMode: 'hold' },
    { row: 6, sequence: [0, 4, 5, 4, 0], frameMs: 300, loopMode: 'hold' }
  ],
  STRETCHING: [{ row: 4, sequence: [0, 1, 2, 3, 2, 1, 0], frameMs: 210, loopMode: 'hold' }],
  CONTENT: [
    { row: 0, sequence: [0, 3, 3, 0], frameMs: 420, loopMode: 'hold' },
    { row: 8, sequence: [0, 1, 1, 0], frameMs: 440, loopMode: 'hold' }
  ],
  GROOMING: [
    { row: 6, sequence: [0, 2, 3, 2, 0, 4, 5, 4], frameMs: 230, loopMode: 'ping-pong' },
    { row: 8, sequence: [0, 1, 0, 2, 0], frameMs: 260, loopMode: 'sparse-loop', sparseHoldMs: 1_000 }
  ],
  TIRED: [
    { row: 8, sequence: [4, 0, 4, 0], frameMs: 540, loopMode: 'sparse-loop', sparseHoldMs: 1_600 },
    { row: 4, sequence: [0, 1, 2, 1, 0], frameMs: 320, loopMode: 'hold' }
  ],
  ANGRY: [{ row: 7, sequence: [3, 2, 3, 1, 3], frameMs: 150, loopMode: 'ping-pong' }],
  PLAYING: [{ row: 7, sequence: [0, 1, 2, 3, 4, 5, 4, 2, 0], frameMs: 145, loopMode: 'hold' }],
  DANCING: [
    { row: 7, sequence: [0, 1, 2, 3, 5, 3, 2, 1], frameMs: 145, loopMode: 'ping-pong' }
  ],
  SLEEPING: [{ row: 8, sequence: [4], frameMs: 1_000, loopMode: 'hold' }],
  FOCUSED: [{ row: 0, sequence: [0, 0, 1, 0, 0, 2, 0], frameMs: 620, loopMode: 'sparse-loop', sparseHoldMs: 3_600 }],
  ALERTING: [{ row: 6, sequence: [0, 1, 2, 3, 4, 5, 4, 3], frameMs: 145, loopMode: 'loop' }],
  STARTLED: [{ row: 7, sequence: [0, 3, 3, 2, 0], frameMs: 150, loopMode: 'hold' }],
  DIZZY: [{ row: 7, sequence: [1, 3, 2, 3, 1, 0], frameMs: 180, loopMode: 'ping-pong' }],
  CELEBRATING: [{ row: 8, sequence: [0, 1, 3, 1, 0], frameMs: 180, loopMode: 'ping-pong' }],
  DRAGGED: [{ row: 4, sequence: [1, 2, 3, 2], frameMs: 170, loopMode: 'ping-pong' }],
  FALLING: [{ row: 4, sequence: [1, 2, 3], frameMs: 130, loopMode: 'hold' }]
};

const clipFrame = (clip: ClipDefinition, elapsedMs: number): number => {
  if (clip.loopMode === 'hold') return clip.sequence[Math.min(clip.sequence.length - 1, Math.floor(elapsedMs / clip.frameMs))];
  if (clip.loopMode === 'sparse-loop') {
    const cycleMs = clip.sequence.length * clip.frameMs + (clip.sparseHoldMs ?? 0);
    const position = elapsedMs % cycleMs;
    if (position >= clip.sequence.length * clip.frameMs) return clip.sequence[0];
    return clip.sequence[Math.floor(position / clip.frameMs)];
  }
  const sequence = clip.loopMode === 'ping-pong' && clip.sequence.length > 2
    ? [...clip.sequence, ...clip.sequence.slice(1, -1).reverse()]
    : clip.sequence;
  return sequence[Math.floor(elapsedMs / clip.frameMs) % sequence.length];
};

export const resolveSpriteFrame = (state: PetState, direction: Direction, lookDirection: number | null, elapsedMs: number, variant = 0, walkDistance = 0): { row: number; frame: number } => {
  const clips = stateClips[state];
  const clip = clips[variant % clips.length];
  let row = clip.row;
  let frame = clipFrame(clip, elapsedMs);
  if (state === 'LOOKING' && lookDirection !== null) {
    const normalized = ((lookDirection % 16) + 16) % 16;
    row = normalized < 8 ? 9 : 10;
    frame = normalized % 8;
  } else if (state === 'WALKING') { row = direction === 1 ? 1 : 2; frame = Math.floor(Math.max(0, walkDistance) / 7.5) % 8; }
  return { row, frame };
};

export const resolvePetSpriteFrame = (petId: PetId, state: PetState, direction: Direction, lookDirection: number | null, elapsedMs: number, variant = 0, walkDistance = 0): { row: number; frame: number } => {
  if (state === 'SLEEPING') return { row: 8, frame: 4 };
  if (state === 'FOCUSED') return { row: 8, frame: 1 };
  return resolveSpriteFrame(state, direction, lookDirection, elapsedMs, variant, walkDistance);
};

export const usesDedicatedCatSleepSprite = (petId: PetId, state: PetState): boolean => petId === 'pixel-cat' && state === 'SLEEPING';

export class SpriteRenderer {
  private petId: PetId = 'tiny-robot';
  private state: PetState = 'IDLE';
  private stateStartedAt = performance.now();
  private direction: Direction = 1;
  private lookDirection: number | null = null;
  private variant = 0;
  private previousVariant = -1;
  private walkDistance = 0;
  private motionSeed = Math.random() * Math.PI * 2;

  constructor(private readonly element: HTMLElement) {}

  setPet(petId: PetId, size: PetSize): void {
    this.petId = petId;
    const manifest = PET_MANIFESTS[petId];
    const pixels = PET_PIXEL_SIZE[size];
    this.element.style.width = `${pixels}px`;
    this.element.style.height = `${Math.round((pixels * manifest.cellHeight) / manifest.cellWidth)}px`;
    this.element.style.backgroundImage = `url('${manifest.spritesheetPath}')`;
    this.element.style.backgroundSize = '800% 1100%';
    this.element.style.backgroundPosition = '0% 0%';
    this.element.dataset.petId = petId;
  }

  setState(state: PetState, direction: Direction, lookDirection: number | null): void {
    if (this.state !== state) {
      this.state = state;
      this.stateStartedAt = performance.now();
      const count = stateClips[state].length;
      this.variant = count <= 1 ? 0 : (this.previousVariant + 1 + Math.floor(Math.random() * (count - 1))) % count;
      this.previousVariant = this.variant;
    }
    this.direction = direction;
    this.lookDirection = lookDirection;
  }

  setWalkDistance(distance: number): void { this.walkDistance = distance; }

  render(now: number): void {
    const elapsed = now - this.stateStartedAt;
    const { row, frame } = resolvePetSpriteFrame(this.petId, this.state, this.direction, this.lookDirection, elapsed, this.variant, this.walkDistance);

    const dedicatedCatSleep = usesDedicatedCatSleepSprite(this.petId, this.state);
    if (dedicatedCatSleep) {
      this.element.style.backgroundImage = `url('${pixelCatSleepSprite}')`;
      this.element.style.backgroundSize = 'contain';
      this.element.style.backgroundPosition = 'center';
    } else {
      this.element.style.backgroundImage = `url('${PET_MANIFESTS[this.petId].spritesheetPath}')`;
      this.element.style.backgroundSize = '800% 1100%';
      this.element.style.backgroundPosition = `${(frame / 7) * 100}% ${(row / 10) * 100}%`;
    }
    this.element.dataset.state = this.state.toLowerCase();
    const gait = this.walkDistance / 7.5 * Math.PI;
    const idleTime = now / 1_000 + this.motionSeed;
    const sleepLean = this.state === 'SLEEPING' ? (this.petId === 'pixel-cat' ? 0 : 82) : 0;
    const groomLean = this.state === 'GROOMING' ? Math.sin(idleTime * 5.8) * 4.5 - 3 : 0;
    const tiredDrop = this.state === 'TIRED' ? 4 + Math.sin(idleTime * 1.5) * 1.2 : 0;
    const sleepOffset = this.petId === 'pixel-cat' ? 5 : -3;
    const bob = this.state === 'WALKING' ? -Math.abs(Math.sin(gait)) * 3.2 : this.state === 'SLEEPING' ? Math.sin(idleTime * 1.7) * .45 + sleepOffset : Math.sin(idleTime * 2.05) * 1.1 + tiredDrop;
    const sway = this.state === 'WALKING' ? Math.sin(gait) * 2.1 : Math.sin(idleTime * .73) * 1.15;
    const sleepSquash = this.petId === 'pixel-cat' ? .018 : .08;
    const squash = this.state === 'WALKING' ? Math.abs(Math.cos(gait)) * .025 : this.state === 'SLEEPING' ? sleepSquash : this.state === 'FOCUSED' ? .035 : .008 + Math.sin(idleTime * 1.13) * .005;
    const dizzy = this.state === 'DIZZY' ? Math.sin(now / 45) * 13 : this.state === 'ANGRY' ? Math.sin(now / 72) * 6 : 0;
    const dance = this.state === 'DANCING' ? ` translateX(${(Math.sin(idleTime * 7) * 2.5).toFixed(2)}px)` : '';
    this.element.style.transform = `translateY(${bob.toFixed(2)}px)${dance} rotate(${(sway + dizzy + sleepLean + groomLean).toFixed(2)}deg) scale(${(1 + squash).toFixed(3)}, ${(1 - squash).toFixed(3)})`;
  }
}
