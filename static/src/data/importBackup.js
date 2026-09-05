import { serializedRecordsEqual } from './recordComparison';
import { isSupportedRoutine, retireStrongmanData } from './retiredStrongman';

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
  const reservedIds = new Set([...localRecords, ...importedRecords].map(record => record.id));
  return importedRecords.map(imported => {
    const local = localById.get(imported.id);
    if (!local) return { type, status: 'new', action: 'copy', imported, result: imported };
    if (serializedRecordsEqual(local, imported)) {
      return { type, status: 'duplicate', action: 'skip', imported, local, result: local };
    }
    if (type === 'archive' || (type === 'routine' && local.profileId !== imported.profileId)) {
      const existingResult = localRecords.find(record => serializedRecordsEqual({ ...record, id: imported.id }, imported));
      if (existingResult) return {
        type, status: 'duplicate', action: 'skip', imported, local, existingResult, result: existingResult,
      };
      const copyId = `${imported.id}:imported-copy`;
      let id = copyId;
      let suffix = 2;
      while (reservedIds.has(id)) { id = `${copyId}:${suffix}`; suffix += 1; }
      reservedIds.add(id);
      return {
        type, status: 'conflict', action: 'copy', imported, local,
        reason: type === 'archive'
          ? 'Archived data differs. Keep the imported record as a separate copy.'
          : 'This routine belongs to another profile. Keep the imported routine as a separate copy.',
        result: { ...imported, id },
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

const reconcileProfile = (profile, routines) => {
  const own = routines.filter(record => record.profileId === profile.id && isSupportedRoutine(record))
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
  const selectable = own.filter(record => !record.archived);
  const active = own.filter(record => record.workouts?.some(workout => workout.session?.status === 'inProgress'));
  return {
    ...profile,
    ...(Object.prototype.hasOwnProperty.call(profile, 'activeRoutineId') ? {
      activeRoutineId: selectable.find(record => record.id === profile.activeRoutineId)?.id || selectable[0]?.id || null,
    } : {}),
    ...(Object.prototype.hasOwnProperty.call(profile, 'activeWorkoutRoutineId') || active.length ? {
      activeWorkoutRoutineId: active.find(record => record.id === profile.activeWorkoutRoutineId)?.id || active[0]?.id || null,
    } : {}),
  };
};

export const createImportPlan = (backup, profiles, routines, templates = [], archives = []) => {
  const incoming = [...backup.routines, ...(backup.templates || [])].some(record => !isSupportedRoutine(record))
    ? retireStrongmanData(backup, { preferScheduled: true }) : backup;
  const plan = {
    profiles: planStore(incoming.profiles, profiles, 'profile'),
    routines: planStore(incoming.routines, routines, 'routine'),
    templates: planStore(incoming.templates || [], templates, 'template'),
    archives: planStore(incoming.archives || [], archives, 'archive'),
  };
  const copiedRoutines = new Map(plan.routines.filter(item => item.imported.id !== item.result.id)
    .map(item => [item.imported.id, item.result]));
  plan.profiles = plan.profiles.map(item => {
    const imported = { ...item.imported };
    ['activeRoutineId', 'activeWorkoutRoutineId'].forEach(key => {
      const copy = copiedRoutines.get(imported[key]);
      if (copy?.profileId === imported.id) imported[key] = copy.id;
    });
    return { ...item, result: item.local ? mergeRecord(item.local, imported) : imported };
  });

  // Pointers must describe the committed merge, since a local completed workout
  // can replace an incoming active session with the same workout ID.
  const finalRoutines = new Map(routines.map(record => [record.id, record]));
  plan.routines.forEach(item => finalRoutines.set(item.result.id, item.result));
  const finalRecords = [...finalRoutines.values()];
  const profileIds = new Set(plan.profiles.map(item => item.result.id));
  const affectedProfiles = new Set(plan.routines.map(item => item.result.profileId));
  profiles.filter(profile => !profileIds.has(profile.id) && affectedProfiles.has(profile.id)).forEach(profile => {
    const result = reconcileProfile(profile, finalRecords);
    if (!serializedRecordsEqual(result, profile)) plan.profiles.push({
      type: 'profile', status: 'conflict', action: 'merge', imported: profile, local: profile, result,
    });
  });
  plan.profiles = plan.profiles.map(item => {
    const result = reconcileProfile(item.result, finalRecords);
    return {
      ...item, result,
      action: item.local ? (serializedRecordsEqual(result, item.local) ? 'skip' : 'merge') : 'copy',
    };
  });
  return plan;
};

const planItems = plan => [...plan.profiles, ...plan.routines, ...(plan.templates || []), ...(plan.archives || [])];

export const importPlanSummary = plan => planItems(plan).reduce((summary, item) => ({
  ...summary,
  [item.action]: summary[item.action] + 1,
}), { copy: 0, skip: 0, merge: 0 });

export const recordsToSave = plan => planItems(plan)
  .filter(item => item.action !== 'skip')
  .map(item => item.result);
