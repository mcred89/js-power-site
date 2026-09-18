import { DEFAULT_SET_TIMER_INTERVAL_MS } from './setTimerInterval';

export const addSetTimerPreference = profile => (
  Object.prototype.hasOwnProperty.call(profile, 'setTimerIntervalMs')
    ? profile
    : { ...profile, setTimerIntervalMs: DEFAULT_SET_TIMER_INTERVAL_MS }
);

export const addSetTimers = record => {
  if (!Array.isArray(record.workouts)) return record;
  let changed = false;
  const workouts = record.workouts.map(workout => {
    if (workout.completedAt || !['inProgress', 'paused'].includes(workout.session?.status) ||
        !Array.isArray(workout.session.exercises) ||
        Object.prototype.hasOwnProperty.call(workout.session, 'setTimer')) return workout;
    changed = true;
    return { ...workout, session: { ...workout.session, setTimer: null } };
  });
  return changed ? { ...record, workouts } : record;
};
