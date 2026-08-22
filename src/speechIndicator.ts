import type { PetState } from './types';

export const SLEEP_INDICATOR_DURATION_MS = 3_500;

export const resolvePassiveSpeech = (state: PetState, now: number, sleepIndicatorUntil: number): string => {
  if (state === 'SLEEPING') return now < sleepIndicatorUntil ? 'zZ' : '';
  if (state === 'CURIOUS') return '?';
  if (state === 'ALERTING') return '!';
  return '';
};
