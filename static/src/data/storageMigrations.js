export const DATABASE_VERSION = 7;

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

export const activeWorkoutIdsByProfile = routines => {
  const newest = new Map();
  (Array.isArray(routines) ? routines : []).forEach(routine => {
    if (!routine?.profileId || !routine.workouts?.some(workout => workout.session?.status === 'inProgress')) return;
    const previous = newest.get(routine.profileId);
    // Legacy data can contain multiple active sessions. updatedAt is the established
    // tie-breaker; keep it stable so startup never changes which workout is resumed.
    if (!previous || String(routine.updatedAt || '').localeCompare(String(previous.updatedAt || '')) > 0) {
      newest.set(routine.profileId, routine);
    }
  });
  return new Map([...newest].map(([profileId, routine]) => [profileId, routine.id]));
};

export const addActiveWorkoutReferences = (profiles, routines) => {
  const activeIds = activeWorkoutIdsByProfile(routines);
  return Array.isArray(profiles) ? profiles.map(profile => ({
    ...profile,
    activeWorkoutRoutineId: activeIds.get(profile.id) || null,
  })) : profiles;
};

// Each migration upgrades from the previous numeric version to its key. Keep
// migrations forever: a returning installation may be several releases old.
export const databaseMigrations = {
  1: ({ database, done }) => {
    createRecordStore(database, 'profiles');
    createRecordStore(database, 'routines');
    done();
  },
  2: ({ database, transaction, done }) => {
    if (!database.objectStoreNames.contains('metadata')) {
      database.createObjectStore('metadata', { keyPath: 'key' });
    }
    transaction.objectStore('metadata').put({
      key: 'dataSchemaVersion',
      value: 2,
    });
    done();
  },
  3: ({ database, transaction, done }) => {
    const cursorRequest = transaction.objectStore('routines').openCursor();
    cursorRequest.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) {
        transaction.objectStore('metadata').put({ key: 'dataSchemaVersion', value: 3 });
        done();
        return;
      }
      cursor.update(addEffectiveMaxSnapshots(cursor.value));
      cursor.continue();
    };
  },
  4: ({ transaction, done }) => {
    const cursorRequest = transaction.objectStore('routines').openCursor();
    cursorRequest.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) {
        transaction.objectStore('metadata').put({ key: 'dataSchemaVersion', value: 4 });
        done();
        return;
      }
      cursor.update(addWorkoutSessions(cursor.value));
      cursor.continue();
    };
  },
  5: ({ database, transaction, done }) => {
    createRecordStore(database, 'templates');
    transaction.objectStore('metadata').put({
      key: 'dataSchemaVersion',
      value: 5,
    });
    done();
  },
  6: ({ transaction, done }) => {
    const cursorRequest = transaction.objectStore('routines').openCursor();
    cursorRequest.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) {
        transaction.objectStore('metadata').put({ key: 'dataSchemaVersion', value: 6 });
        done();
        return;
      }
      cursor.update(addSessionActionMetadata(cursor.value));
      cursor.continue();
    };
  },
  7: ({ transaction, done }) => {
    const routinesStore = transaction.objectStore('routines');
    if (!routinesStore.indexNames.contains('profileId')) {
      routinesStore.createIndex('profileId', 'profileId', { unique: false });
    }
    const routines = [];
    const routineCursor = routinesStore.openCursor();
    routineCursor.onsuccess = event => {
      const cursor = event.target.result;
      if (cursor) {
        routines.push(cursor.value);
        cursor.continue();
        return;
      }
      const activeIds = activeWorkoutIdsByProfile(routines);
      const profileCursor = transaction.objectStore('profiles').openCursor();
      profileCursor.onsuccess = profileEvent => {
        const profile = profileEvent.target.result;
        if (!profile) {
          transaction.objectStore('metadata').put({ key: 'dataSchemaVersion', value: 7 });
          done();
          return;
        }
        profile.update({
          ...profile.value,
          activeWorkoutRoutineId: activeIds.get(profile.value.id) || null,
        });
        profile.continue();
      };
    };
  },
};

export const runDatabaseMigrations = (database, transaction, oldVersion, newVersion) => {
  const run = version => {
    if (version > newVersion) return;
    const migrate = databaseMigrations[version];
    if (!migrate) {
      throw new Error(`Missing IndexedDB migration for version ${version}.`);
    }
    // Cursor migrations must finish before the next migration starts. In particular,
    // v7 derives profile pointers from the fully migrated v3/v4/v6 routine records.
    migrate({ database, transaction, done: () => run(version + 1) });
  };
  run(oldVersion + 1);
};

export const BACKUP_VERSION = 7;

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
