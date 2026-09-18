// Derive elapsed time from saved timestamps rather than render ticks. Both
// workout timers share this clock without loading their optional UI schedules.
export const getTimerElapsedMs = (timer, now = Date.now()) => {
  if (!timer) return 0;
  const elapsedMs = Number.isFinite(timer.elapsedMs) ? Math.max(0, timer.elapsedMs) : 0;
  const runningSince = typeof timer.runningSince === 'string' ? Date.parse(timer.runningSince) : NaN;
  return Number.isFinite(runningSince) && Number.isFinite(now)
    ? elapsedMs + Math.max(0, now - runningSince)
    : elapsedMs;
};
