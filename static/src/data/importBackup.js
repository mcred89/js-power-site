import { serializedRecordsEqual } from './recordComparison';
import { cloneStrongmanRoutine, remapStrongmanReferences } from './strongmanTransfer';
import { reconcileImportGraph } from './importGraph';

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

const planStore = (importedRecords, localRecords, type, idMap) => {
  const localById = new Map(localRecords.map(record => [record.id, record]));
  return importedRecords.map(imported => {
    const local = localById.get(imported.id);
    if (!local) return { type, status: 'new', action: 'copy', imported, result: imported };
    if (serializedRecordsEqual(local, imported)) {
      return { type, status: 'duplicate', action: 'skip', imported, local, result: local };
    }
    if ((type === 'routine' || type === 'template') && (local.kind === 'strongman' || imported.kind === 'strongman')) {
      return {
        type, status: 'conflict', action: 'copy', imported, local,
        reason: 'Event plan components conflict. Keep the imported plan as a separate copy.',
        result: cloneStrongmanRoutine(imported, { preserveHistory: true, idMap, name: `${imported.name || 'Event plan'} (imported copy)` }),
      };
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

export const createImportPlan = (backup, profiles, routines, templates = []) => {
  const idMap = new Map();
  const plan = {
    profiles: planStore(backup.profiles, profiles, 'profile', idMap),
    routines: planStore(backup.routines, routines, 'routine', idMap),
    templates: planStore(backup.templates || [], templates, 'template', idMap),
  };
  if (idMap.size) Object.keys(plan).forEach(store => {
    plan[store] = plan[store].map(item => {
      if (item.action === 'skip') return item;
      // Rebuild strength/profile merges from the imported half only: existing local
      // references still belong to the original, never to its conflict copy.
      const incoming = remapStrongmanReferences(item.imported, idMap);
      const result = item.action === 'merge'
        ? (item.type === 'routine' ? mergeRoutine(item.local, incoming) : mergeRecord(item.local, incoming))
        : remapStrongmanReferences(item.result, idMap);
      return { ...item, result };
    });
  });
  return reconcileImportGraph(plan, profiles, routines);
};

const planItems = plan => [...plan.profiles, ...plan.routines, ...(plan.templates || [])];

export const importPlanSummary = plan => planItems(plan).reduce((summary, item) => ({
  ...summary,
  [item.action]: summary[item.action] + 1,
}), { copy: 0, skip: 0, merge: 0 });

export const recordsToSave = plan => planItems(plan)
  .filter(item => item.action !== 'skip')
  .map(item => item.result);
