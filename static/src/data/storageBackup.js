import {
  DATABASE_VERSION, activeWorkoutIdsByProfile, addRoutineKind, addTrainingPlanReferences,
  addEffectiveMaxSnapshots, addWorkoutSessions, addSessionActionMetadata,
  addAccessoryWeakPoints, addMaxProgressionMode, addEventEvidenceSnapshots,
} from './storageMigrations';
import { validateStrongmanRecord } from './strongmanValidation';

// Loaded with backup/import tasks, outside the installed application's startup graph.
export const BACKUP_VERSION = 11;

export const addActiveWorkoutReferences = (profiles, routines) => {
  const activeIds = activeWorkoutIdsByProfile(routines);
  return Array.isArray(profiles) ? profiles.map(profile => ({
    ...profile,
    activeWorkoutRoutineId: activeIds.get(profile.id) || null,
  })) : profiles;
};

// Backup migrations must be pure: never mutate the object parsed from the
// user's file. This makes failed imports safe and migrations easy to test.
export const backupMigrations = {
  2: backup => ({
    ...backup,
    version: 2,
    dataSchemaVersion: 2,
  }),
  3: backup => ({
    ...backup,
    version: 3,
    dataSchemaVersion: 3,
    routines: Array.isArray(backup.routines)
      ? backup.routines.map(addEffectiveMaxSnapshots)
      : backup.routines,
  }),
  4: backup => ({
    ...backup,
    version: 4,
    dataSchemaVersion: 4,
    routines: Array.isArray(backup.routines)
      ? backup.routines.map(addWorkoutSessions)
      : backup.routines,
  }),
  5: backup => ({
    ...backup,
    version: 5,
    dataSchemaVersion: 5,
    templates: Array.isArray(backup.templates) ? backup.templates : [],
  }),
  6: backup => ({
    ...backup,
    version: 6,
    dataSchemaVersion: 6,
    routines: Array.isArray(backup.routines)
      ? backup.routines.map(addSessionActionMetadata)
      : backup.routines,
  }),
  7: backup => ({
    ...backup,
    version: 7,
    dataSchemaVersion: 7,
    profiles: addActiveWorkoutReferences(backup.profiles, backup.routines),
  }),
  8: backup => ({
    ...backup,
    version: 8,
    dataSchemaVersion: 8,
    routines: Array.isArray(backup.routines)
      ? backup.routines.map(addAccessoryWeakPoints)
      : backup.routines,
    templates: Array.isArray(backup.templates)
      ? backup.templates.map(addAccessoryWeakPoints)
      : backup.templates,
  }),
  9: backup => ({
    ...backup,
    version: 9,
    dataSchemaVersion: 9,
    routines: Array.isArray(backup.routines)
      ? backup.routines.map(addMaxProgressionMode)
      : backup.routines,
    templates: Array.isArray(backup.templates)
      ? backup.templates.map(addMaxProgressionMode)
      : backup.templates,
  }),
  10: backup => ({
    ...backup,
    version: 10,
    dataSchemaVersion: 10,
    profiles: Array.isArray(backup.profiles) ? backup.profiles.map(addTrainingPlanReferences) : backup.profiles,
    routines: Array.isArray(backup.routines) ? backup.routines.map(addRoutineKind) : backup.routines,
    templates: Array.isArray(backup.templates) ? backup.templates.map(addRoutineKind) : backup.templates,
  }),
  11: backup => ({
    ...backup,
    version: 11,
    dataSchemaVersion: 11,
    routines: Array.isArray(backup.routines) ? backup.routines.map(addEventEvidenceSnapshots) : backup.routines,
    templates: Array.isArray(backup.templates) ? backup.templates.map(addEventEvidenceSnapshots) : backup.templates,
  }),
};

export const migrateBackup = original => {
  if (!Number.isInteger(original?.version) || original.version < 1 || original.version > BACKUP_VERSION) {
    throw new Error('This is not a supported McIlroy Method backup.');
  }

  let backup = original;
  for (let version = original.version + 1; version <= BACKUP_VERSION; version += 1) {
    const migrate = backupMigrations[version];
    if (!migrate) {
      throw new Error(`Missing backup migration for version ${version}.`);
    }
    backup = migrate(backup);
  }
  return backup;
};

export const exportBackup = (profiles, routines, templates = []) => JSON.stringify({
  format: 'mcilroy-method-backup',
  version: BACKUP_VERSION,
  dataSchemaVersion: DATABASE_VERSION,
  exportedAt: new Date().toISOString(),
  profiles,
  routines,
  templates,
}, null, 2);

// Preserve dangling coverage as reviewable user data. A partial restore must not
// silently claim coverage by a missing exercise or another profile's workout.
const normalizeEventReferences = (record, routinesById) => {
  const visit = value => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, visit(entry)]));
    if (typeof value.routineId === 'string') {
      const target = routinesById.get(value.routineId);
      const sameProfile = target && (!record.profileId || target.profileId === record.profileId);
      const targetWorkouts = target?.workouts || [];
      const workoutExists = !value.workoutId || targetWorkouts.some(workout => workout.id === value.workoutId);
      const exerciseExists = !value.exerciseId || targetWorkouts.some(workout => (
        (!value.workoutId || workout.id === value.workoutId) && workout.exercises?.some(exercise => exercise.id === value.exerciseId)
      ));
      if (!sameProfile || !workoutExists || !exerciseExists) result.unresolved = true;
    }
    return result;
  };
  return visit(record);
};

export const parseBackup = contents => {
  const migrated = migrateBackup(JSON.parse(contents));
  if (migrated.format !== 'mcilroy-method-backup' ||
      !Array.isArray(migrated.profiles) || !Array.isArray(migrated.routines) ||
      !Array.isArray(migrated.templates)) {
    throw new Error('This is not a supported McIlroy Method backup.');
  }
  const routines = migrated.routines.map(addRoutineKind);
  const templates = migrated.templates.map(addRoutineKind);
  routines.forEach(record => validateStrongmanRecord(record, { complete: true }));
  templates.forEach(record => validateStrongmanRecord(record, { complete: true, template: true }));
  const routinesById = new Map(routines.map(routine => [routine.id, routine]));
  const profiles = migrated.profiles.map(profile => {
    const normalized = addTrainingPlanReferences(profile);
    const eventPlan = routinesById.get(normalized.activeStrongmanRoutineId);
    if (!eventPlan || eventPlan.profileId !== profile.id || eventPlan.kind !== 'strongman') {
      normalized.activeStrongmanRoutineId = null;
    }
    return normalized;
  });
  // Normalize even current-version files: hand-edited or partially copied backups may
  // contain dangling active-workout references, which startup must never chase.
  const backup = {
    ...migrated,
    profiles: addActiveWorkoutReferences(profiles, routines),
    routines: routines.map(routine => normalizeEventReferences(routine, routinesById)),
    templates,
  };
  return backup;
};


export const normalizeRoutineTransfer = payload => {
  if (payload?.format !== 'mcilroy-method-routine-transfer' || ![1, 2].includes(payload.version) ||
      !payload.routine || typeof payload.routine !== 'object' || Array.isArray(payload.routine) ||
      (payload.version === 2 && (!Number.isInteger(payload.schemaVersion) || payload.schemaVersion > DATABASE_VERSION || payload.schemaVersion < 1))) {
    throw new Error('This is not a supported routine transfer.');
  }
  // V1 did not record its data schema, so apply the idempotent legacy steps to
  // strength records. Event records can only originate from the current schema.
  const version = payload.version === 1 ? (payload.routine.kind === 'strongman' ? DATABASE_VERSION : 1) : payload.schemaVersion;
  const migrated = migrateBackup({ version, routines: [payload.routine], profiles: [], templates: [] });
  validateStrongmanRecord(migrated.routines[0], { complete: true });
  return { ...payload, version: 2, schemaVersion: DATABASE_VERSION, routine: addRoutineKind(migrated.routines[0]) };
};
