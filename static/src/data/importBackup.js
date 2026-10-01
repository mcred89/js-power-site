import { serializedRecordsEqual } from './recordComparison';
import { isSupportedRoutine, retireStrongmanData } from './retiredStrongman';
import { validateStrongmanRecord } from './strongman';
import { validateProfileCompetitions } from './strongmanCompetitions';
export { importPlanBatch, activateRoutineImport } from './importPersistence';

const mergeRecord = (local, imported) => ({ ...imported, ...local });

// Import never changes the meet a local profile is currently preparing for.
// Keep other incoming configurations as inactive snapshots, including different
// versions of a meet with the same ID, instead of silently dropping them.
const mergeProfile = (local, imported) => {
  const merged = mergeRecord(local, imported);
  const localHistory = local.strongmanCompetitionHistory || [];
  const importedHistory = imported.strongmanCompetitionHistory || [];
  const active = merged.strongmanCompetition;
  const incomingActive = imported.strongmanCompetition;
  const incoming = [...importedHistory, ...(incomingActive && !serializedRecordsEqual(incomingActive, active)
    ? [{ ...incomingActive, status: 'saved' }] : [])];
  if (!Object.prototype.hasOwnProperty.call(local, 'strongmanCompetitionHistory') &&
      !Object.prototype.hasOwnProperty.call(imported, 'strongmanCompetitionHistory') && !incoming.length) return merged;
  const history = [...localHistory];
  const reservedIds = new Set([active?.id, ...history.map(item => item.id), ...incoming.map(item => item.id)]);
  const equivalent = (existing, candidate) => {
    if (serializedRecordsEqual(existing, candidate)) return true;
    if (existing.originalCompetitionId !== candidate.id) return false;
    const restored = { ...existing, id: candidate.id };
    if (!Object.prototype.hasOwnProperty.call(candidate, 'originalCompetitionId')) delete restored.originalCompetitionId;
    return serializedRecordsEqual(restored, candidate);
  };
  incoming.forEach(candidate => {
    if (history.some(existing => equivalent(existing, candidate))) return;
    if (active?.id !== candidate.id && !history.some(existing => existing.id === candidate.id)) {
      history.push(candidate);
      return;
    }
    const baseId = `${candidate.id}:imported-copy`;
    let id = baseId;
    let suffix = 2;
    while (reservedIds.has(id)) { id = `${baseId}:${suffix}`; suffix += 1; }
    reservedIds.add(id);
    history.push({ ...candidate, id, originalCompetitionId: candidate.id });
  });
  return { ...merged, strongmanCompetitionHistory: history };
};

// Preserve both versions of a conflicting training entry. Imported copies have
// stable IDs, so importing the same backup again cannot duplicate history.
const mergeStrongmanLogs = (local, imported) => {
  const merged = [...local];
  const reservedIds = new Set([...local, ...imported].map(entry => entry.id));
  imported.forEach(entry => {
    const existing = merged.find(item => item.id === entry.id);
    if (!existing) { merged.push(entry); return; }
    if (serializedRecordsEqual(existing, entry) || merged.some(item => (
      serializedRecordsEqual({ ...item, id: entry.id }, entry)
    ))) return;
    const baseId = `${entry.id}:imported-copy`;
    let id = baseId;
    let suffix = 2;
    while (reservedIds.has(id)) {
      id = `${baseId}:${suffix}`;
      suffix += 1;
    }
    reservedIds.add(id);
    merged.push({ ...entry, id });
  });
  return merged;
};

const mergeRoutine = (local, imported) => {
  const localWorkouts = Array.isArray(local.workouts) ? local.workouts : [];
  const localWorkoutIds = new Set(localWorkouts.map(workout => workout.id));
  return {
    ...mergeRecord(local, imported),
    ...((Array.isArray(local.strongmanLog) || Array.isArray(imported.strongmanLog)) ? {
      strongmanLog: mergeStrongmanLogs(
        Array.isArray(local.strongmanLog) ? local.strongmanLog : [],
        Array.isArray(imported.strongmanLog) ? imported.strongmanLog : [],
      ),
    } : {}),
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
      result: type === 'routine' ? mergeRoutine(local, imported)
        : type === 'profile' ? mergeProfile(local, imported) : mergeRecord(local, imported),
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
  incoming.profiles.forEach(validateProfileCompetitions);
  [...incoming.routines, ...(incoming.templates || [])].forEach(validateStrongmanRecord);
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
    return { ...item, result: item.local ? mergeProfile(item.local, imported) : imported };
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
