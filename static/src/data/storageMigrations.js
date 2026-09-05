export const DATABASE_VERSION = 11;

const withEvidenceSnapshot = record => Object.prototype.hasOwnProperty.call(record, 'capabilitySnapshot')
  ? record : { ...record, capabilitySnapshot: null };

// Old history does not identify which checkpoints were associated at the time.
// Preserve it, but do not infer proof from today's editable practice definitions.
export const addEventEvidenceSnapshots = record => {
  if (record.kind !== 'strongman') return record;
  const result = { ...record };
  if (Array.isArray(record.inputs?.events)) result.inputs = { ...record.inputs, events: record.inputs.events.map(event => ({
    ...event,
    ...(Array.isArray(event.coverage) ? { coverage: event.coverage.map(withEvidenceSnapshot) } : {}),
  })) };
  if (Array.isArray(record.coverageEvidence)) result.coverageEvidence = record.coverageEvidence.map(withEvidenceSnapshot);
  if (Array.isArray(record.workouts)) result.workouts = record.workouts.map(workout => ({
    ...workout,
    ...(Array.isArray(workout.exercises) ? { exercises: workout.exercises.map(withEvidenceSnapshot) } : {}),
    ...(Array.isArray(workout.session?.eventBlocks) ? { session: { ...workout.session, eventBlocks: workout.session.eventBlocks.map(withEvidenceSnapshot) } } : {}),
  }));
  return result;
};

export const addRoutineKind = record => ({ ...record, kind: record.kind || 'strength' });

export const addTrainingPlanReferences = profile => ({
  ...profile,
  activeStrongmanRoutineId: profile.activeStrongmanRoutineId || null,
  scheduledStrengthRoutineId: Object.prototype.hasOwnProperty.call(profile, 'scheduledStrengthRoutineId')
    ? profile.scheduledStrengthRoutineId
    : profile.activeRoutineId || null,
});

export const addMaxProgressionMode = record => ({
  ...record,
  inputs: record.inputs ? {
    ...record.inputs,
    maxProgressionMode: Object.prototype.hasOwnProperty.call(record.inputs, 'maxProgressionMode')
      ? record.inputs.maxProgressionMode
      : 'fixed',
  } : record.inputs,
});

export const addAccessoryWeakPoints = routine => ({
  ...routine,
  inputs: routine.inputs ? {
    ...routine.inputs,
    pressWeakPoint: routine.inputs.pressWeakPoint || '',
    deadliftWeakPoint: routine.inputs.deadliftWeakPoint || '',
  } : routine.inputs,
});

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

const migrateRecordStores = (transaction, version, transforms, done) => {
  const stores = Object.entries(transforms);
  let remaining = stores.length;
  stores.forEach(([storeName, transform]) => {
    const request = transaction.objectStore(storeName).openCursor();
    request.onsuccess = event => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.update(transform(cursor.value));
        cursor.continue();
        return;
      }
      remaining -= 1;
      if (!remaining) {
        transaction.objectStore('metadata').put({ key: 'dataSchemaVersion', value: version });
        done();
      }
    };
  });
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
  3: ({ transaction, done }) => migrateRecordStores(transaction, 3, { routines: addEffectiveMaxSnapshots }, done),
  4: ({ transaction, done }) => migrateRecordStores(transaction, 4, { routines: addWorkoutSessions }, done),
  5: ({ database, transaction, done }) => {
    createRecordStore(database, 'templates');
    transaction.objectStore('metadata').put({
      key: 'dataSchemaVersion',
      value: 5,
    });
    done();
  },
  6: ({ transaction, done }) => migrateRecordStores(transaction, 6, { routines: addSessionActionMetadata }, done),
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
  8: ({ transaction, done }) => migrateRecordStores(transaction, 8, { routines: addAccessoryWeakPoints, templates: addAccessoryWeakPoints }, done),
  9: ({ transaction, done }) => migrateRecordStores(transaction, 9, { routines: addMaxProgressionMode, templates: addMaxProgressionMode }, done),
  10: ({ transaction, done }) => migrateRecordStores(transaction, 10, { routines: addRoutineKind, templates: addRoutineKind, profiles: addTrainingPlanReferences }, done),
  11: ({ transaction, done }) => migrateRecordStores(transaction, 11, { routines: addEventEvidenceSnapshots, templates: addEventEvidenceSnapshots }, done),

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

export { BACKUP_VERSION, backupMigrations, migrateBackup } from './storageBackup';
