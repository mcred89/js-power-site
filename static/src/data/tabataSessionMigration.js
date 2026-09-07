import { tabataRoundCount } from './tabata';

const roundKeys = new Set([
  'id', 'number', 'plannedWeight', 'plannedReps', 'actualWeight', 'actualReps',
  'status', 'completedAt', 'skippedAt', 'skipActionId', 'splitSeconds', 'tabataTimer',
]);

const untouchedRound = (set, index) => (
  set && set.number === index + 1 && set.status === 'pending' &&
  [set.plannedWeight, set.actualWeight, set.plannedReps, set.actualReps]
    .every(value => value === '') &&
  [set.completedAt, set.skippedAt, set.skipActionId, set.splitSeconds, set.tabataTimer]
    .every(value => value === null || value === undefined) &&
  Object.keys(set).every(key => roundKeys.has(key))
);

const migrateExercise = exercise => {
  const rounds = tabataRoundCount(exercise);
  if (!rounds || !Array.isArray(exercise.sets) || !exercise.sets.length) return exercise;
  const [first] = exercise.sets;
  if (exercise.sets.length === 1) {
    if (first.status !== 'pending' || Object.prototype.hasOwnProperty.call(first, 'tabataTimer')) return exercise;
    return { ...exercise, sets: [{ ...first, tabataTimer: null }] };
  }
  // Preserve settled rounds and any user-specific per-round data. Only the
  // untouched generated round placeholders can safely become one timer set.
  if (exercise.sets.length !== rounds || !exercise.sets.every(untouchedRound)) return exercise;
  return { ...exercise, sets: [{ ...first, tabataTimer: null }] };
};

export const addTabataTimers = record => {
  if (!Array.isArray(record.workouts)) return record;
  let changed = false;
  const workouts = record.workouts.map(workout => {
    if (workout.completedAt || !['inProgress', 'paused'].includes(workout.session?.status) ||
        !Array.isArray(workout.session.exercises)) return workout;
    const exercises = workout.session.exercises.map(migrateExercise);
    if (exercises.every((exercise, index) => exercise === workout.session.exercises[index])) return workout;
    changed = true;
    return { ...workout, session: { ...workout.session, exercises } };
  });
  return changed ? { ...record, workouts } : record;
};
