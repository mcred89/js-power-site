export const isSupportedRoutine = record => Boolean(record) && record.kind !== 'strongman';

// Only the empty placeholders introduced by the retired planner need restoring.
// Started/completed days and user-edited prescriptions remain historical records.
export const restoreLegacyEventSlots = record => {
  if (!isSupportedRoutine(record) || !Array.isArray(record.workouts)) return record;
  let changed = false;
  const workouts = record.workouts.map(workout => {
    if (workout.kind !== 'eventSlot' || workout.completedAt || workout.skippedAt || workout.session ||
        !Array.isArray(workout.exercises) || workout.exercises.length) return workout;
    changed = true;
    const { kind, eventRef, eventRemoved, ...restored } = workout;
    return { ...restored, exercises: [{
      id: `${workout.id}:strongman-day`,
      generated: { movement: 'Strongman day', weight: '', prescription: '' },
      overrides: {},
    }] };
  });
  return changed ? { ...record, workouts } : record;
};
