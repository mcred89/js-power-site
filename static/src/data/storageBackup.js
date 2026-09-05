import {
  DATABASE_VERSION, addActiveWorkoutReferences, addEffectiveMaxSnapshots,
  addWorkoutSessions, addSessionActionMetadata, addAccessoryWeakPoints,
  addMaxProgressionMode, addRoutineKind, addTrainingPlanReferences, addEventEvidenceSnapshots,
} from './storageMigrations';
import { retireStrongmanData } from './retiredStrongman';

// Backup preparation runs in the on-demand data task worker, outside startup.
export const BACKUP_VERSION = 12;

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
    ...backup, version: 10, dataSchemaVersion: 10,
    profiles: Array.isArray(backup.profiles) ? backup.profiles.map(addTrainingPlanReferences) : backup.profiles,
    routines: Array.isArray(backup.routines) ? backup.routines.map(addRoutineKind) : backup.routines,
    templates: Array.isArray(backup.templates) ? backup.templates.map(addRoutineKind) : backup.templates,
  }),
  11: backup => ({
    ...backup, version: 11, dataSchemaVersion: 11,
    routines: Array.isArray(backup.routines) ? backup.routines.map(addEventEvidenceSnapshots) : backup.routines,
    templates: Array.isArray(backup.templates) ? backup.templates.map(addEventEvidenceSnapshots) : backup.templates,
  }),
  12: backup => retireStrongmanData({ ...backup, version: 12, dataSchemaVersion: 12 }, { preferScheduled: true }),
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

export const exportBackup = (profiles, routines, templates = [], archives = []) => JSON.stringify({
  format: 'mcilroy-method-backup',
  version: BACKUP_VERSION,
  dataSchemaVersion: DATABASE_VERSION,
  exportedAt: new Date().toISOString(),
  profiles,
  routines,
  templates,
  archives,
}, null, 2);

export const parseBackup = contents => {
  const migrated = migrateBackup(JSON.parse(contents));
  // Normalize even current-version files: hand-edited or partially copied backups may
  // contain dangling active-workout references, which startup must never chase.
  const backup = retireStrongmanData(migrated);
  if (backup.format !== 'mcilroy-method-backup' ||
      !Array.isArray(backup.profiles) || !Array.isArray(backup.routines) ||
      !Array.isArray(backup.templates) || !Array.isArray(backup.archives)) {
    throw new Error('This is not a supported McIlroy Method backup.');
  }
  return backup;
};
