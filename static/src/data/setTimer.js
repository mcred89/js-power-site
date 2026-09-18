import { getTimerElapsedMs as getSetTimerElapsedMs } from './elapsedTimer';
import { DEFAULT_SET_TIMER_INTERVAL_MS, isValidSetTimerInterval } from './setTimerInterval';

export { getSetTimerElapsedMs, DEFAULT_SET_TIMER_INTERVAL_MS, isValidSetTimerInterval };
export const SET_TIMER_READY_MS = 10000;

export const getSetTimerTiming = (timer, now = Date.now()) => {
  const elapsedMs = getSetTimerElapsedMs(timer, now);
  if (elapsedMs < SET_TIMER_READY_MS) return { phase: 'ready', remainingMs: SET_TIMER_READY_MS - elapsedMs };
  const intervalMs = isValidSetTimerInterval(timer?.intervalMs) ? timer.intervalMs : DEFAULT_SET_TIMER_INTERVAL_MS;
  return { phase: 'interval', remainingMs: intervalMs - ((elapsedMs - SET_TIMER_READY_MS) % intervalMs) };
};
