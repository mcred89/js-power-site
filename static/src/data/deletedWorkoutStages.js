import { getCycleWeekGroups } from './cycleShortening';

const names = ['Squat', 'Press', 'Deadlift', 'Strongman'];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const workoutStageKey = workout => names.includes(workout?.name) &&
  Number.isInteger(workout.cycleIndex) && workout.cycleIndex >= 0 &&
  Number.isInteger(workout.sourceWeek) && workout.sourceWeek >= 0 && workout.sourceWeek < 5
  ? `${workout.cycleIndex}:${workout.name}:${workout.sourceWeek}` : null;

// Missing days from the currently configured schedule are deliberate deletions.
// Days omitted by a compressed week are not, and may be restored on expansion.
// No earlier deletion can be inferred for days already absent from that schedule.
export const addDeletedWorkoutStages = record => {
  if (!record || (record.kind && record.kind !== 'strength') || !record.inputs ||
      !Array.isArray(record.workouts) || has(record, 'deletedWorkoutStages')) return record;
  const cycles = record.inputs.mesoMode ? record.inputs.microCycles : [record.inputs];
  if (!Array.isArray(cycles) || !cycles.length || cycles.some(cycle => (
    !cycle || !['3 weeks', '5 weeks'].includes(cycle.duration)
  ))) return record;
  // Opaque legacy/archive records may predate stage identities. Their existing
  // days must never be mistaken for deletions when the identity is unresolved.
  if (record.workouts.some(workout => names.includes(workout?.name) && !workoutStageKey(workout))) return record;
  const existing = new Set(record.workouts.map(workoutStageKey).filter(Boolean));
  const deletedWorkoutStages = [];
  cycles.forEach((cycle, cycleIndex) => {
    getCycleWeekGroups(record.inputs, cycleIndex, record.cycleWeekGroups).forEach(group => {
      group.forEach((sourceWeek, index) => {
        const scheduled = ['Squat', 'Press'];
        if (!record.inputs.includeStrongmanDay || index === 0) scheduled.push('Deadlift');
        if (record.inputs.includeStrongmanDay && index === group.length - 1) scheduled.push('Strongman');
        scheduled.forEach(name => {
          const key = `${cycleIndex}:${name}:${sourceWeek}`;
          if (!existing.has(key)) deletedWorkoutStages.push(key);
        });
      });
    });
  });
  return { ...record, deletedWorkoutStages };
};
