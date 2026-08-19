export const DATABASE_VERSION = 6;

const effectiveMaxesFor = (inputs, cycleIndex = 0) => ({
  maxSquat: Number(inputs.maxSquat) + (Number(inputs.squatIncrement) || 0) * cycleIndex,
  maxPress: Number(inputs.maxPress) + (Number(inputs.pressIncrement) || 0) * cycleIndex,
  maxDead: Number(inputs.maxDead) + (Number(inputs.deadliftIncrement) || 0) * cycleIndex,
});

export const addEffectiveMaxSnapshots = routine => ({
  ...routine,
  workouts: Array.isArray(routine.workouts) ? routine.workouts.map(workout => ({
    ...workout,
    effectiveMaxes: workout.effectiveMaxes || effectiveMaxesFor(routine.inputs || {}, workout.cycleIndex),
  })) : routine.workouts,
});

export const addWorkoutSessions = routine => {
  if (!Array.isArray(routine.workouts)) {
    const { workouts, ...unchanged } = routine;
    return workouts === undefined ? unchanged : routine;
  }
  return {
    ...routine,
    workouts: routine.workouts.map(workout => ({
      ...workout,
      session: Object.prototype.hasOwnProperty.call(workout, 'session') ? workout.session : null,
    })),
  };
};

export const addSessionActionMetadata = routine => !Array.isArray(routine.workouts) ? routine : ({
  ...routine,
  workouts: routine.workouts.map(workout => ({
    ...workout,
    session: workout.session?.exercises ? {
      ...workout.session,
      exercises: workout.session.exercises.map(exercise => ({
        ...exercise,
        original: Object.prototype.hasOwnProperty.call(exercise, 'original') ? exercise.original : null,
        substitutedAt: Object.prototype.hasOwnProperty.call(exercise, 'substitutedAt') ? exercise.substitutedAt : null,
        sets: Array.isArray(exercise.sets) ? exercise.sets.map(set => ({
          ...set,
          skippedAt: Object.prototype.hasOwnProperty.call(set, 'skippedAt') ? set.skippedAt : null,
          skipActionId: Object.prototype.hasOwnProperty.call(set, 'skipActionId') ? set.skipActionId : null,
        })) : exercise.sets,
      })),
    } : workout.session,
  })),
});

const createRecordStore = (database, storeName) => {
  if (!database.objectStoreNames.contains(storeName)) {
    database.createObjectStore(storeName, { keyPath: 'id' });
  }
};

// Each migration upgrades from the previous numeric version to its key. Keep
// migrations forever: a returning installation may be several releases old.
export const databaseMigrations = {
  1: ({ database }) => {
    createRecordStore(database, 'profiles');
    createRecordStore(database, 'routines');
  },
  2: ({ database, transaction }) => {
    if (!database.objectStoreNames.contains('metadata')) {
      database.createObjectStore('metadata', { keyPath: 'key' });
    }
    transaction.objectStore('metadata').put({
      key: 'dataSchemaVersion',
      value: 2,
    });
  },
  3: ({ database, transaction }) => {
    const cursorRequest = transaction.objectStore('routines').openCursor();
    cursorRequest.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) return;
      cursor.update(addEffectiveMaxSnapshots(cursor.value));
      cursor.continue();
    };
    transaction.objectStore('metadata').put({
      key: 'dataSchemaVersion',
      value: 3,
    });
  },
  4: ({ transaction }) => {
    const cursorRequest = transaction.objectStore('routines').openCursor();
    cursorRequest.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) return;
      cursor.update(addWorkoutSessions(cursor.value));
      cursor.continue();
    };
    transaction.objectStore('metadata').put({
      key: 'dataSchemaVersion',
      value: 4,
    });
  },
  5: ({ database, transaction }) => {
    createRecordStore(database, 'templates');
    transaction.objectStore('metadata').put({
      key: 'dataSchemaVersion',
      value: 5,
    });
  },
  6: ({ transaction }) => {
    const cursorRequest = transaction.objectStore('routines').openCursor();
    cursorRequest.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) return;
      cursor.update(addSessionActionMetadata(cursor.value));
      cursor.continue();
    };
    transaction.objectStore('metadata').put({
      key: 'dataSchemaVersion',
      value: 6,
    });
  },
};

export const runDatabaseMigrations = (database, transaction, oldVersion, newVersion) => {
  for (let version = oldVersion + 1; version <= newVersion; version += 1) {
    const migrate = databaseMigrations[version];
    if (!migrate) {
      throw new Error(`Missing IndexedDB migration for version ${version}.`);
    }
    migrate({ database, transaction });
  }
};

export const BACKUP_VERSION = 6;

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
