export interface Vector2 {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export type Direction = -1 | 1;
export type MovementLevel = 'calm' | 'normal' | 'active';
export type MovementMode = 'pinned' | 'hybrid' | 'roam';
export type PetSize = 'tiny' | 'small' | 'medium' | 'large';
export type PinnedCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type PetId = 'tiny-robot' | 'tiny-astronaut' | 'pixel-cat';
export type VoiceProfile = 'droid' | 'cat';

export type PetState =
  | 'IDLE'
  | 'LOOKING'
  | 'GREETING'
  | 'CURIOUS'
  | 'OBSERVING'
  | 'FIDGETING'
  | 'STRETCHING'
  | 'CONTENT'
  | 'GROOMING'
  | 'TIRED'
  | 'ANGRY'
  | 'PLAYING'
  | 'DANCING'
  | 'SLEEPING'
  | 'FOCUSED'
  | 'ALERTING'
  | 'STARTLED'
  | 'DIZZY'
  | 'CELEBRATING'
  | 'DRAGGED'
  | 'FALLING'
  | 'WALKING';

export interface PetNeeds {
  energy: number;
  social: number;
  fun: number;
  curiosity: number;
  comfort: number;
}

export interface PetPersonality {
  playfulness: number;
  sociability: number;
  curiosity: number;
  calmness: number;
}

export interface PetMemory {
  lastInteractionAt: string | null;
  lastSeenAt: string | null;
  lastGreetingDate: string | null;
  totalInteractions: number;
  activityCounts: Record<string, number>;
}

export interface AudioSettings {
  masterVolume: number;
  interactionVolume: number;
  reminderVolume: number;
  alarmVolume: number;
  voiceVolume: number;
  muted: boolean;
  interactionEnabled: boolean;
  reminderEnabled: boolean;
  alarmEnabled: boolean;
  voiceEnabled: boolean;
  snoozeMinutes: 5 | 10 | 15;
}

export interface PetSettings {
  name: string;
  petId: PetId;
  petSize: PetSize;
  movementMode: MovementMode;
  movementLevel: MovementLevel;
  monitorId: string | null;
  pinnedCorner: PinnedCorner | null;
  autostart: boolean;
  reducedMotion: boolean;
  audio: AudioSettings;
}

export type OrganizerStatus =
  | 'pending'
  | 'snoozed'
  | 'completed'
  | 'dismissed'
  | 'missed';

export interface NoteItem {
  id: string;
  type: 'note';
  title: string;
  body: string;
  createdAt: string;
  pinned: boolean;
}

export interface ReminderItem {
  id: string;
  type: 'reminder';
  title: string;
  details: string;
  scheduledAt: string;
  status: OrganizerStatus;
  snoozedUntil: string | null;
  lastTriggeredAt: string | null;
  occurrenceKey: string | null;
}

export interface AlarmItem {
  id: string;
  type: 'alarm';
  label: string;
  schedule: 'once' | 'daily';
  scheduledAt: string;
  enabled: boolean;
  status: OrganizerStatus;
  snoozedUntil: string | null;
  lastTriggeredAt: string | null;
  occurrenceKey: string | null;
}

export type OrganizerItem = NoteItem | ReminderItem | AlarmItem;

export interface PetData {
  version: 2;
  revision: number;
  hidden: boolean;
  settings: PetSettings;
  position: Vector2 | null;
  homePosition: Vector2 | null;
  needs: PetNeeds;
  personality: PetPersonality;
  memory: PetMemory;
  items: OrganizerItem[];
}

export interface BehaviorContext {
  now: Date;
  userIdleMs: number;
  cursorDistance: number;
  lookDirection: number | null;
  isMoving: boolean;
}

export interface PetSnapshot {
  state: PetState;
  direction: Direction;
  lookDirection: number | null;
  needs: PetNeeds;
  personality: PetPersonality;
}

export interface PetManifest {
  id: PetId;
  displayName: string;
  description: string;
  spriteVersionNumber: 2;
  spritesheetPath: string;
  cellWidth: 192;
  cellHeight: 208;
  columns: 8;
  rows: 11;
  voiceProfile: VoiceProfile;
}

export interface DueEvent {
  id: string;
  kind: 'reminder' | 'alarm';
  title: string;
  details: string;
  scheduledAt: string;
}

export type PopoverMessage =
  | { type: 'menu'; movementMode: MovementMode; petName: string }
  | { type: 'alert'; event: DueEvent }
  | { type: 'speech'; message: string; tone?: 'neutral' | 'positive' | 'quiet'; duration?: number; action?: 'undo-pin'; actionLabel?: string };

export interface BubbleMessage {
  id: string;
  text: string;
  tone?: 'neutral' | 'positive' | 'quiet';
  duration?: number;
  anchor: Vector2;
  petSize: number;
  workArea: Bounds;
  action?: 'undo-pin';
  actionLabel?: string;
}

export interface BubbleFollow {
  id: string;
  anchor: Vector2;
  petSize: number;
  workArea: Bounds;
}

export interface BubbleVisibility {
  id: string;
  visible: boolean;
}

export type PetAction =
  | 'toggle-pin'
  | 'dance'
  | 'sleep'
  | 'focus'
  | 'add-note'
  | 'open-manager'
  | 'hide-pet'
  | 'undo-pin'
  | 'dismiss-alert'
  | 'snooze-alert';

export type DataChannelMessage =
  | { type: 'updated'; revision: number; data: PetData }
  | { type: 'due'; event: DueEvent }
  | { type: 'alert-resolved'; id: string; action: 'dismiss' | 'snooze'; revision?: number; data?: PetData };
