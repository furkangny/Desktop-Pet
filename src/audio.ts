import { PET_MANIFESTS } from './petCatalog';
import type { AudioSettings, PetId } from './types';

type Channel = 'interaction' | 'reminder' | 'alarm';
export type PetSoundCue = 'click' | 'pet' | 'dance' | 'sleep' | 'wake' | 'focus' | 'shake' | 'bump' | 'startle' | 'land' | 'talk' | 'happy' | 'annoyed';
const paths: Record<Channel, string> = { interaction: '/sounds/interaction.wav', reminder: '/sounds/reminder.wav', alarm: '/sounds/alarm.wav' };
const catSleepSound = new URL('../assets/cat_voice/kedi_pet_uyku_modu_sesi.mp3', import.meta.url).href;
const catReactionSound = new URL('../assets/cat_voice/kedi_pet_sallanma_sesi.mp3', import.meta.url).href;

export class PetAudioEngine {
  private settings: AudioSettings;
  private alarm: HTMLAudioElement | null = null;
  private alarmStopTimer: number | null = null;
  private context: AudioContext | null = null;
  private voiceGeneration = 0;
  private catVoice: HTMLAudioElement | null = null;

  constructor(settings: AudioSettings) { this.settings = { ...settings }; }
  update(settings: AudioSettings): void {
    this.settings = { ...settings };
    if (settings.muted) { this.stopAlarm(); this.stopCatVoice(); this.voiceGeneration += 1; }
  }
  playInteraction(cue: PetSoundCue = 'click', petId?: PetId): void {
    if (petId) this.playCue(cue, petId);
    else void this.play('interaction');
  }
  playReminder(): void { void this.play('reminder'); }
  playFootstep(petId: PetId): void {
    if (!this.canPlay('interaction')) return;
    const context = this.audioContext();
    void context.resume().then(() => {
      const now = context.currentTime; const osc = context.createOscillator(); const gain = context.createGain();
      osc.type = petId === 'pixel-cat' ? 'sine' : 'square'; osc.frequency.setValueAtTime(petId === 'pixel-cat' ? 105 : 155, now); osc.frequency.exponentialRampToValueAtTime(62, now + .045);
      gain.gain.setValueAtTime(this.volume('interaction') * .045, now); gain.gain.exponentialRampToValueAtTime(.0001, now + .05); osc.connect(gain); gain.connect(context.destination); osc.start(now); osc.stop(now + .055);
    }).catch(() => undefined);
  }
  speak(text: string, petId: PetId): void {
    if (!this.canVoice() || !text.trim()) return;
    const generation = ++this.voiceGeneration; const context = this.audioContext();
    void context.resume().then(() => {
      if (generation !== this.voiceGeneration) return;
      if (PET_MANIFESTS[petId].voiceProfile === 'cat') this.playCatAsset('talk');
      else this.droidChatter(context, text, petId === 'tiny-astronaut' ? .82 : 1);
    }).catch(() => undefined);
  }
  playReaction(kind: 'shake' | 'startle' | 'land' | 'bump' | 'annoyed' | 'wake' | 'sleep' | 'focus' | 'happy', petId: PetId): void {
    if (!this.canVoice()) return;
    this.playCue(kind, petId);
  }
  playCue(cue: PetSoundCue, petId: PetId): void {
    if (!this.canVoice()) return;
    if (petId === 'pixel-cat') { this.playCatAsset(cue); return; }
    const context = this.audioContext();
    void context.resume().then(() => {
      const now = context.currentTime;
      const scale = petId === 'tiny-astronaut' ? .82 : 1;
      if (cue === 'sleep') { this.droidSweep(context, now, 340 * scale, 120 * scale, .55, 'triangle'); return; }
      if (cue === 'wake') { this.droidSweep(context, now, 180 * scale, 520 * scale, .48, 'triangle'); return; }
      if (cue === 'focus') { this.droidSequence(context, now, [360, 470, 590, 470].map((v) => v * scale), .055); return; }
      if (cue === 'dance' || cue === 'happy') { this.droidSequence(context, now, [420, 620, 520, 760, 610].map((v) => v * scale), .06); return; }
      if (cue === 'bump' || cue === 'shake' || cue === 'annoyed') {
        this.droidSequence(context, now, [760, 210, 680, 160].map((v) => v * scale), .07, cue === 'annoyed' ? 'sawtooth' : 'square');
        return;
      }
      if (cue === 'startle') { this.droidSequence(context, now, [920, 540, 860].map((v) => v * scale), .045); return; }
      if (cue === 'land') { this.droidSweep(context, now, 260 * scale, 110 * scale, .16, 'square'); return; }
      this.droidSequence(context, now, [390, 520].map((v) => v * scale), .045);
    }).catch(() => undefined);
  }
  startAlarm(): void {
    if (!this.canPlay('alarm')) return;
    this.stopAlarm(); this.alarm = new Audio(paths.alarm); this.alarm.loop = true; this.alarm.volume = this.volume('alarm');
    void this.alarm.play().catch(() => undefined); this.alarmStopTimer = window.setTimeout(() => this.stopAlarm(), 10 * 60_000);
  }
  stopAlarm(): void {
    if (this.alarmStopTimer !== null) window.clearTimeout(this.alarmStopTimer);
    this.alarmStopTimer = null; this.alarm?.pause(); if (this.alarm) this.alarm.currentTime = 0; this.alarm = null;
  }

  private audioContext(): AudioContext { this.context ??= new AudioContext(); return this.context; }
  private async play(channel: Exclude<Channel, 'alarm'>): Promise<void> {
    if (!this.canPlay(channel)) return;
    const audio = new Audio(paths[channel]); audio.volume = this.volume(channel); await audio.play().catch(() => undefined);
  }
  private canPlay(channel: Channel): boolean { return !this.settings.muted && this.settings[`${channel}Enabled`]; }
  private canVoice(): boolean { return !this.settings.muted && this.settings.voiceEnabled && this.settings.masterVolume > 0 && this.settings.voiceVolume > 0; }
  private volume(channel: Channel): number { return this.settings.masterVolume / 100 * this.settings[`${channel}Volume`] / 100; }
  private voiceGain(): number { return Math.max(.0001, this.settings.masterVolume / 100 * this.settings.voiceVolume / 100 * .2); }
  private voiceVolume(): number { return Math.max(0, Math.min(1, this.settings.masterVolume / 100 * this.settings.voiceVolume / 100)); }

  private playCatAsset(cue: PetSoundCue): void {
    this.stopCatVoice();
    const audio = new Audio(cue === 'sleep' ? catSleepSound : catReactionSound);
    this.catVoice = audio;
    audio.volume = this.voiceVolume();
    audio.addEventListener('ended', () => { if (this.catVoice === audio) this.catVoice = null; }, { once: true });
    void audio.play().catch(() => { if (this.catVoice === audio) this.catVoice = null; });
  }

  private stopCatVoice(): void {
    if (!this.catVoice) return;
    this.catVoice.pause();
    this.catVoice.currentTime = 0;
    this.catVoice = null;
  }

  private droidSweep(context: AudioContext, now: number, from: number, to: number, length: number, type: OscillatorType): void {
    const gain = context.createGain(); const osc = context.createOscillator(); const filter = context.createBiquadFilter();
    osc.type = type; filter.type = 'bandpass'; filter.frequency.value = 1_050; filter.Q.value = 3;
    gain.gain.setValueAtTime(.0001, now); gain.gain.exponentialRampToValueAtTime(this.voiceGain() * .82, now + .018); gain.gain.exponentialRampToValueAtTime(.0001, now + length);
    osc.frequency.setValueAtTime(from, now); osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), now + length);
    osc.connect(filter); filter.connect(gain); gain.connect(context.destination); osc.start(now); osc.stop(now + length + .02);
  }

  private droidSequence(context: AudioContext, now: number, notes: number[], step: number, type: OscillatorType = 'triangle'): void {
    notes.forEach((note, index) => {
      const at = now + index * step; const osc = context.createOscillator(); const gain = context.createGain();
      osc.type = type; osc.frequency.setValueAtTime(note, at); osc.frequency.exponentialRampToValueAtTime(Math.max(40, note * .86), at + step * .82);
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(this.voiceGain() * .72, at + .008); gain.gain.exponentialRampToValueAtTime(.0001, at + step * .95);
      osc.connect(gain); gain.connect(context.destination); osc.start(at); osc.stop(at + step);
    });
  }

  private droidChatter(context: AudioContext, text: string, pitchScale: number): void {
    const chars = [...text].filter((char) => char.trim()).slice(0, 46);
    const start = context.currentTime + .015; const question = text.trim().endsWith('?'); const gainLevel = this.voiceGain();
    chars.forEach((char, index) => {
      const code = char.codePointAt(0) ?? 65; const at = start + index * (.045 + (code % 4) * .012); const length = .035 + (code % 5) * .009;
      const contour = question ? 1 + index / Math.max(1, chars.length) * .22 : 1.12 - index / Math.max(1, chars.length) * .16;
      const carrier = context.createOscillator(); const mod = context.createOscillator(); const modGain = context.createGain(); const gain = context.createGain(); const filter = context.createBiquadFilter();
      carrier.type = index % 3 === 0 ? 'square' : 'triangle'; filter.type = 'bandpass'; filter.frequency.value = 1_250 + (code % 9) * 95; filter.Q.value = 2.4;
      carrier.frequency.setValueAtTime((300 + (code % 13) * 31) * pitchScale * contour, at); carrier.frequency.exponentialRampToValueAtTime((360 + (code % 11) * 28) * pitchScale * contour, at + length);
      mod.frequency.value = 36 + code % 27; modGain.gain.value = 42 + code % 35; mod.connect(modGain); modGain.connect(carrier.frequency);
      gain.gain.setValueAtTime(.0001, at); gain.gain.exponentialRampToValueAtTime(gainLevel, at + .006); gain.gain.exponentialRampToValueAtTime(.0001, at + length);
      carrier.connect(filter); filter.connect(gain); gain.connect(context.destination); carrier.start(at); mod.start(at); carrier.stop(at + length + .01); mod.stop(at + length + .01);
    });
  }

}
