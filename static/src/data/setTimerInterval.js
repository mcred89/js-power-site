export const DEFAULT_SET_TIMER_INTERVAL_MS = 60000;

export const isValidSetTimerInterval = intervalMs => (
  Number.isInteger(intervalMs) && intervalMs >= 6000 && intervalMs <= 3600000 && intervalMs % 1000 === 0
);
