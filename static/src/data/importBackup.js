import { serializedRecordsEqual } from './recordComparison';

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
    if (serializedRecordsEqual(local, imported)) {
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

export const createImportPlan = (backup, profiles, routines, templates = []) => ({
  profiles: planStore(backup.profiles, profiles, 'profile'),
  routines: planStore(backup.routines, routines, 'routine'),
  templates: planStore(backup.templates || [], templates, 'template'),
});

const planItems = plan => [...plan.profiles, ...plan.routines, ...(plan.templates || [])];

export const importPlanSummary = plan => planItems(plan).reduce((summary, item) => ({
  ...summary,
  [item.action]: summary[item.action] + 1,
}), { copy: 0, skip: 0, merge: 0 });

export const recordsToSave = plan => planItems(plan)
  .filter(item => item.action !== 'skip')
  .map(item => item.result);
