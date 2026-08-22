import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sampleRate = 44_100;
const pcm16 = (samples) => {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + samples.length * 2, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + index * 2));
  return buffer;
};
const silence = (seconds) => Array(Math.round(sampleRate * seconds)).fill(0);
const tone = (frequency, seconds, gain = .42) => {
  const length = Math.round(sampleRate * seconds);
  return Array.from({ length }, (_, index) => {
    const attack = Math.min(1, index / (sampleRate * .012)); const release = Math.min(1, (length - index) / (sampleRate * .045));
    return Math.sin(2 * Math.PI * frequency * index / sampleRate) * gain * attack * release;
  });
};
const mix = (...tracks) => Array.from({ length: Math.max(...tracks.map((track) => track.length)) }, (_, index) => tracks.reduce((sum, track) => sum + (track[index] ?? 0), 0));

const output = join(process.cwd(), 'public', 'sounds'); mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'interaction.wav'), pcm16([...tone(820, .055, .24), ...tone(1040, .04, .16)]));
writeFileSync(join(output, 'reminder.wav'), pcm16([...tone(523.25, .16, .3), ...silence(.05), ...tone(659.25, .16, .28), ...silence(.05), ...tone(783.99, .26, .3)]));
const high = mix(tone(740, .34, .27), tone(880, .34, .2)); const low = mix(tone(620, .34, .27), tone(760, .34, .2));
writeFileSync(join(output, 'alarm.wav'), pcm16([...high, ...silence(.12), ...low, ...silence(.12), ...high, ...silence(.5)]));
