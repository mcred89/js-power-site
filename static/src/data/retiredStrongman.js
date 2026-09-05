import { serializedRecordsEqual } from './recordComparison';

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

export const restoreRetiredStrongmanReferences = (profiles, routines, { preferScheduled = false } = {}) => {
  if (!Array.isArray(profiles)) return profiles;
  const available = (Array.isArray(routines) ? routines : []).filter(isSupportedRoutine);
  return profiles.map(profile => {
    const own = available.filter(record => record.profileId === profile.id);
    const selectable = own.filter(record => !record.archived);
    const priorities = preferScheduled
      ? [profile.scheduledStrengthRoutineId, profile.activeRoutineId]
      : [profile.activeRoutineId, profile.scheduledStrengthRoutineId];
    const selected = priorities.map(id => selectable.find(record => record.id === id)).find(Boolean) ||
      [...selectable].sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0];
    const active = own.filter(record => record.workouts?.some(workout => workout.session?.status === 'inProgress'))
      .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))[0];
    const { activeStrongmanRoutineId, scheduledStrengthRoutineId, ...restored } = profile;
    return { ...restored, activeRoutineId: selected?.id || null, activeWorkoutRoutineId: active?.id || null };
  });
};

// Archives retain retired records without making the old workout UI interpret
// them. Existing archive IDs and unknown records survive imports unchanged.
export const retireStrongmanData = (data, options) => {
  if (data.archives !== undefined && !Array.isArray(data.archives)) {
    throw new Error('This is not a supported McIlroy Method backup.');
  }
  const archives = Array.isArray(data.archives) ? [...data.archives] : [];
  const archiveById = new Map(archives.map(archive => [archive.id, archive]));
  const retire = (records, store) => !Array.isArray(records) ? records : records.filter(record => {
    if (record?.kind !== 'strongman') return true;
    const baseId = `${store}:${record.id}`;
    let id = baseId;
    let suffix = 1;
    while (archiveById.has(id)) {
      const existing = archiveById.get(id);
      if (existing.store === store && serializedRecordsEqual(existing.record, record)) return false;
      suffix += 1;
      id = `${baseId}:${suffix}`;
    }
    const archive = { id, store, record };
    archives.push(archive);
    archiveById.set(id, archive);
    return false;
  });
  const routines = retire(data.routines, 'routines');
  const templates = retire(data.templates, 'templates');
  return {
    ...data,
    profiles: restoreRetiredStrongmanReferences(data.profiles, routines, options),
    routines: Array.isArray(routines) ? routines.map(restoreLegacyEventSlots) : routines,
    templates,
    archives,
  };
};
