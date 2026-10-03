export const getCycleDuration = (inputs, cycleIndex) => inputs.mesoMode
  ? inputs.microCycles?.[cycleIndex]?.duration : inputs.duration;

export const buildRemainingWeekGroups = start => {
  const groups = Array.from({ length: start }, (_, index) => [index]);
  for (let sourceWeek = start; sourceWeek < 5; sourceWeek += 2) {
    groups.push(sourceWeek < 4 ? [sourceWeek, sourceWeek + 1] : [sourceWeek]);
  }
  return groups;
};

const validGroups = groups => Array.isArray(groups) &&
  groups.every(group => Array.isArray(group) && group.length >= 1 && group.length <= 2) &&
  JSON.stringify(groups.flat()) === '[0,1,2,3,4]';

export const getCycleWeekGroups = (inputs, cycleIndex, cycleWeekGroups = {}) => {
  const duration = getCycleDuration(inputs, cycleIndex);
  const saved = cycleWeekGroups?.[cycleIndex];
  if (duration === '3 weeks' && validGroups(saved)) return saved;
  return duration === '3 weeks' ? buildRemainingWeekGroups(0) : buildRemainingWeekGroups(5);
};

// Started sessions keep their original labels as snapshots, including labels
// saved by the old shortening bug. Forecast them using the saved schedule only
// when a valid explicit grouping and a known training stage are available.
export const getSavedWorkoutWeekIndex = (routine, workout) => {
  const groups = routine?.cycleWeekGroups?.[workout.cycleIndex];
  if (!Number.isInteger(workout.cycleIndex) || workout.cycleIndex < 0 ||
      !Number.isInteger(workout.sourceWeek) || workout.sourceWeek < 0 || workout.sourceWeek > 4 ||
      !['Squat', 'Press', 'Deadlift', 'Strongman'].includes(workout.name) ||
      getCycleDuration(routine?.inputs || {}, workout.cycleIndex) !== '3 weeks' || !validGroups(groups)) return null;
  return groups.findIndex(group => group.includes(workout.sourceWeek));
};

export const isShortenedCycle = (before, after, cycleIndex) => (
  getCycleDuration(before, cycleIndex) === '5 weeks' && getCycleDuration(after, cycleIndex) === '3 weeks'
);

export const isRecordedWorkout = (routine, workout) => Boolean(
  workout.completedAt || workout.skippedAt || workout.session ||
  (routine.strongmanLog || []).some(entry => entry.workoutId === workout.id)
);

export const withShortenedWeekGroups = (routine, inputs) => {
  const cycles = inputs.mesoMode ? inputs.microCycles : [inputs];
  let cycleWeekGroups = routine.cycleWeekGroups;
  cycles.forEach((cycle, cycleIndex) => {
    if (!isShortenedCycle(routine.inputs, inputs, cycleIndex)) return;
    // Keep the whole active week, and any earlier unfinished holes, in place.
    // Only wholly untouched weeks beyond the latest activity are combined.
    const latestActivity = routine.workouts.reduce((latest, workout) => (
      workout.cycleIndex === cycleIndex && Number.isInteger(workout.sourceWeek) &&
      workout.sourceWeek >= 0 && workout.sourceWeek < 5 && isRecordedWorkout(routine, workout)
        ? Math.max(latest, workout.sourceWeek) : latest
    ), -1);
    cycleWeekGroups = { ...cycleWeekGroups, [cycleIndex]: buildRemainingWeekGroups(latestActivity + 1) };
  });
  return cycleWeekGroups === routine.cycleWeekGroups ? routine : { ...routine, cycleWeekGroups };
};

export const workoutFitsCycleSchedule = (workout, inputs, cycleWeekGroups) => {
  const group = getCycleWeekGroups(inputs, workout.cycleIndex, cycleWeekGroups)
    .find(week => week.includes(workout.sourceWeek));
  if (!group) return false;
  if (workout.name === 'Strongman') return Boolean(inputs.includeStrongmanDay) && workout.sourceWeek === group[group.length - 1];
  if (workout.name === 'Deadlift') return !inputs.includeStrongmanDay || workout.sourceWeek === group[0];
  return ['Squat', 'Press'].includes(workout.name);
};

export const isRemovedByShortening = (workout, before, after, cycleWeekGroups) => (
  isShortenedCycle(before, after, workout.cycleIndex) &&
  Number.isInteger(workout.sourceWeek) && workout.sourceWeek >= 0 && workout.sourceWeek < 5 &&
  ['Squat', 'Press', 'Deadlift', 'Strongman'].includes(workout.name) &&
  !workoutFitsCycleSchedule(workout, after, cycleWeekGroups)
);
