const comparableRecord = value => {
  if (Array.isArray(value)) return value.map(comparableRecord);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => ({
      ...result,
      [key]: comparableRecord(value[key]),
    }), {});
  }
  return value;
};

const recordsEqual = (left, right) => (
  JSON.stringify(comparableRecord(left)) === JSON.stringify(comparableRecord(right))
);

const mergeRecord = (local, imported) => ({ ...imported, ...local });

const mergeRoutine = (local, imported) => {
  const localWorkouts = Array.isArray(local.workouts) ? local.workouts : [];
  const localWorkoutIds = new Set(localWorkouts.map(workout => workout.id));
  return {
    ...mergeRecord(local, imported),
    workouts: [
      ...localWorkouts,
      ...(Array.isArray(imported.workouts)
        ? imported.workouts.filter(workout => !localWorkoutIds.has(workout.id))
        : []),
    ].sort((left, right) => (left.sequence || 0) - (right.sequence || 0)),
  };
};

const planStore = (importedRecords, localRecords, type) => {
  const localById = new Map(localRecords.map(record => [record.id, record]));
  return importedRecords.map(imported => {
    const local = localById.get(imported.id);
    if (!local) return { type, status: 'new', action: 'copy', imported, result: imported };
    if (recordsEqual(local, imported)) {
      return { type, status: 'duplicate', action: 'skip', imported, local, result: local };
    }
    return {
      type,
      status: 'conflict',
      action: 'merge',
      imported,
      local,
      result: type === 'routine' ? mergeRoutine(local, imported) : mergeRecord(local, imported),
    };
  });
};

export const createImportPlan = (backup, profiles, routines) => ({
  profiles: planStore(backup.profiles, profiles, 'profile'),
  routines: planStore(backup.routines, routines, 'routine'),
});

export const importPlanSummary = plan => [...plan.profiles, ...plan.routines].reduce((summary, item) => ({
  ...summary,
  [item.action]: summary[item.action] + 1,
}), { copy: 0, skip: 0, merge: 0 });

export const recordsToSave = plan => [...plan.profiles, ...plan.routines]
  .filter(item => item.action !== 'skip')
  .map(item => item.result);
