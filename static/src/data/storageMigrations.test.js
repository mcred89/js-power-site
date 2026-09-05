import {
  addEffectiveMaxSnapshots,
  addMaxProgressionMode,
  addAccessoryWeakPoints,
  addSessionActionMetadata,
  addWorkoutSessions,
  addRoutineKind,
  addTrainingPlanReferences,
  addEventEvidenceSnapshots,
  databaseMigrations,
  runDatabaseMigrations,
} from './storageMigrations';
import { migrateBackup, addActiveWorkoutReferences } from './storageBackup';
import { IDBFactory } from 'fake-indexeddb';

// fake-indexeddb follows the browser cloning contract; CRA's Jest runtime predates
// structuredClone, so provide it only inside this test module.
if (!global.structuredClone) {
  global.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const migrationDatabase = existingStores => {
  const stores = new Set(existingStores);
  const puts = [];
  return {
    database: {
      objectStoreNames: { contains: name => stores.has(name) },
      createObjectStore: (name, options) => {
        stores.add(name);
        return { name, options };
      },
    },
    transaction: {
      objectStore: name => ({
        indexNames: { contains: () => false },
        createIndex: jest.fn(),
        put: value => puts.push({ name, value }),
        openCursor: () => {
          const request = {};
          Object.defineProperty(request, 'onsuccess', {
            set: handler => handler({ target: { result: null } }),
          });
          return request;
        },
      }),
    },
    stores,
    puts,
  };
};

describe('IndexedDB migrations', () => {
  it('migrates legacy evidence without assigning retrospective capability proof or changing paused attempts', () => {
    const source = { kind: 'strongman', unknown: true, inputs: { events: [{ coverage: [{ routineId: 'normal', unknown: true }] }] },
      coverageEvidence: [{ eventId: 'bag', attempts: [{ weight: 200 }] }], workouts: [{ session: {
        status: 'paused', runningSince: null, elapsedSeconds: 35, eventBlocks: [{ id: 'old', attempts: [{ weight: 200 }] },
          { id: 'new', capabilitySnapshot: { eventId: 'bag', practiceId: 'pick', capabilityIds: ['pick'], focus: 'pick', parts: [] } }],
      } }] };
    const before = JSON.stringify(source);
    const migrated = addEventEvidenceSnapshots(source);
    expect(migrated.inputs.events[0].coverage[0]).toEqual({ routineId: 'normal', unknown: true, capabilitySnapshot: null });
    expect(migrated.coverageEvidence[0]).toMatchObject({ capabilitySnapshot: null, attempts: [{ weight: 200 }] });
    expect(migrated.workouts[0].session).toMatchObject({ status: 'paused', runningSince: null, elapsedSeconds: 35 });
    expect(migrated.workouts[0].session.eventBlocks[0]).toMatchObject({ capabilitySnapshot: null, attempts: [{ weight: 200 }] });
    expect(migrated.workouts[0].session.eventBlocks[1]).toEqual(source.workouts[0].session.eventBlocks[1]);
    expect(migrateBackup({ version: 10, routines: [source], templates: [source], profiles: [] })).toMatchObject({
      version: 11, dataSchemaVersion: 11, routines: [migrated], templates: [migrated],
    });
    expect(JSON.stringify(source)).toBe(before);
  });
  it('adds independent plan enrollment without changing legacy exercises or unknown fields', () => {
    const record = { id: 'r1', unknown: true, workouts: [{ exercises: [{ movement: 'Strongman event: Axle' }] }] };
    expect(addRoutineKind(record)).toEqual({ ...record, kind: 'strength' });
    expect(record.kind).toBeUndefined();
    expect(addRoutineKind({ ...record, kind: 'strongman' }).kind).toBe('strongman');
    expect(addTrainingPlanReferences({ id: 'p1', activeRoutineId: 'r1' })).toEqual({
      id: 'p1', activeRoutineId: 'r1', scheduledStrengthRoutineId: 'r1', activeStrongmanRoutineId: null,
    });
  });

  it('migrates version 9 backups purely and retains both routine kinds', () => {
    const source = { version: 9, profiles: [{ id: 'p1', activeRoutineId: 'r1' }],
      routines: [{ id: 'r1', unknown: { retained: true } }, { id: 'e1', kind: 'strongman' }],
      templates: [{ id: 't1', inputs: {} }], unknown: true };
    const before = JSON.stringify(source);
    const migrated = migrateBackup(source);
    expect(migrated.version).toBe(11);
    expect(migrated.routines.map(record => record.kind)).toEqual(['strength', 'strongman']);
    expect(migrated.templates[0].kind).toBe('strength');
    expect(migrated.profiles[0].scheduledStrengthRoutineId).toBe('r1');
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('retains unknown records and snapshots while migrating backup version %i', version => {
    const original = { version, unknown: { untouched: true }, profiles: [{ id: 'p1', activeRoutineId: 'r1' }],
      routines: [{ id: 'r1', profileId: 'p1', unknown: true, inputs: {}, workouts: [{
        id: 'w1', completedAt: '2026-01-01', effectiveMaxes: { maxSquat: 400 },
        exercises: [{ id: 'x1', unknown: 'retained', generated: { movement: 'Strongman event: Axle' } }],
      }] }], templates: [{ id: 't1', inputs: {}, unknown: true }],
    };
    const serialized = JSON.stringify(original);
    const result = migrateBackup(original);
    expect(result).toMatchObject({ version: 11, dataSchemaVersion: 11, unknown: original.unknown });
    expect(result.routines[0]).toMatchObject({ kind: 'strength', unknown: true, workouts: [{
      completedAt: '2026-01-01', effectiveMaxes: { maxSquat: 400 }, exercises: original.routines[0].workouts[0].exercises,
    }] });
    expect(result.templates[0]).toMatchObject({ kind: 'strength', unknown: true });
    expect(JSON.stringify(original)).toBe(serialized);
  });
  it('contains every migration through the current version', () => {
    expect(Object.keys(databaseMigrations).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('creates all stores for a new installation', () => {
    const context = migrationDatabase([]);
    runDatabaseMigrations(context.database, context.transaction, 0, 11);

    expect([...context.stores]).toEqual(['profiles', 'routines', 'metadata', 'templates']);
    expect(context.puts).toEqual([
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 2 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 3 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 4 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 5 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 6 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 7 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 8 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 9 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 10 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 11 } },
    ]);
  });

  it('upgrades version 1 through every later migration without recreating stores', () => {
    const context = migrationDatabase(['profiles', 'routines']);
    runDatabaseMigrations(context.database, context.transaction, 1, 9);

    expect([...context.stores]).toEqual(['profiles', 'routines', 'metadata', 'templates']);
    expect(context.puts.map(entry => entry.value.value)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('adds templates when upgrading from version 4', () => {
    const context = migrationDatabase(['profiles', 'routines', 'metadata']);
    runDatabaseMigrations(context.database, context.transaction, 4, 5);

    expect([...context.stores]).toEqual(['profiles', 'routines', 'metadata', 'templates']);
    expect(context.puts).toEqual([{ name: 'metadata', value: { key: 'dataSchemaVersion', value: 5 } }]);
  });

  it('runs the session metadata migration when upgrading from version 5', () => {
    const context = migrationDatabase(['profiles', 'routines', 'metadata', 'templates']);
    runDatabaseMigrations(context.database, context.transaction, 5, 6);

    expect([...context.stores]).toEqual(['profiles', 'routines', 'metadata', 'templates']);
    expect(context.puts).toEqual([{ name: 'metadata', value: { key: 'dataSchemaVersion', value: 6 } }]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('supports upgrading a version %i installation to version 9', oldVersion => {
    const stores = ['profiles', 'routines'];
    if (oldVersion >= 2) stores.push('metadata');
    if (oldVersion >= 5) stores.push('templates');
    const context = migrationDatabase(stores);
    expect(() => runDatabaseMigrations(context.database, context.transaction, oldVersion, 9)).not.toThrow();
    expect(context.puts.at(-1)).toEqual({
      name: 'metadata', value: { key: 'dataSchemaVersion', value: 9 },
    });
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9])('upgrades a real version %i database in order', async oldVersion => {
    const indexedDB = new IDBFactory();
    const name = `migration-${oldVersion}`;
    await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, oldVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('profiles')) database.createObjectStore('profiles', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('routines')) database.createObjectStore('routines', { keyPath: 'id' });
        if (oldVersion >= 2 && !database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata', { keyPath: 'key' });
        if (oldVersion >= 5 && !database.objectStoreNames.contains('templates')) database.createObjectStore('templates', { keyPath: 'id' });
        if (oldVersion >= 7) {
          request.transaction.objectStore('routines').createIndex('profileId', 'profileId', { unique: false });
        }
        request.transaction.objectStore('profiles').put({
          id: 'p1',
          unknown: true,
          ...(oldVersion >= 7 ? { activeWorkoutRoutineId: 'r1' } : {}),
        });
        request.transaction.objectStore('routines').put({
          id: 'r1', profileId: 'p1', updatedAt: '2026-01-01', inputs: oldVersion >= 8
            ? { pressWeakPoint: '', deadliftWeakPoint: '', ...(oldVersion >= 9 ? { maxProgressionMode: 'fixed' } : {}) }
            : {},
          workouts: [{
            id: 'w1',
            ...(oldVersion >= 3 ? { effectiveMaxes: {} } : {}),
            session: { status: 'inProgress', exercises: [{
              ...(oldVersion >= 6 ? { original: null, substitutedAt: null } : {}),
              sets: [{ ...(oldVersion >= 6 ? { skippedAt: null, skipActionId: null } : {}) }],
            }] },
          }],
        });
        if (oldVersion >= 5) {
          request.transaction.objectStore('templates').put({
            id: 't1',
            inputs: oldVersion >= 8 ? { pressWeakPoint: '', deadliftWeakPoint: '', ...(oldVersion >= 9 ? { maxProgressionMode: 'fixed' } : {}) } : {},
            unknown: true,
          });
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 11);
      request.onupgradeneeded = event => runDatabaseMigrations(
        request.result, request.transaction, event.oldVersion, 11,
      );
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = database.transaction(['profiles', 'routines', 'metadata', 'templates'], 'readonly');
    const profile = await new Promise((resolve, reject) => {
      const request = tx.objectStore('profiles').get('p1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const routine = await new Promise((resolve, reject) => {
      const request = tx.objectStore('routines').get('r1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const template = await new Promise((resolve, reject) => {
      const request = tx.objectStore('templates').get('t1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(tx.objectStore('routines').indexNames.contains('profileId')).toBe(true);
    expect(profile).toMatchObject({ id: 'p1', unknown: true, activeWorkoutRoutineId: 'r1' });
    expect(profile).toMatchObject({ scheduledStrengthRoutineId: null, activeStrongmanRoutineId: null });
    expect(routine.kind).toBe('strength');
    expect(routine.workouts[0]).toHaveProperty('effectiveMaxes');
    expect(routine.workouts[0].session.exercises[0].sets[0]).toMatchObject({
      skippedAt: null, skipActionId: null,
    });
    expect(routine.inputs).toMatchObject({ pressWeakPoint: '', deadliftWeakPoint: '' });
    expect(routine.inputs.maxProgressionMode).toBe('fixed');
    if (oldVersion >= 5) {
      expect(template.kind).toBe('strength');
      expect(template.inputs).toMatchObject({ pressWeakPoint: '', deadliftWeakPoint: '', maxProgressionMode: 'fixed' });
    } else {
      expect(template).toBeUndefined();
    }
    database.close();
  });

  it('creates a real version 11 database with every store and index', async () => {
    const indexedDB = new IDBFactory();
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('fresh-version-11', 11);
      request.onupgradeneeded = event => runDatabaseMigrations(
        request.result, request.transaction, event.oldVersion, 11,
      );
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    expect([...database.objectStoreNames]).toEqual(['metadata', 'profiles', 'routines', 'templates']);
    const transaction = database.transaction('routines', 'readonly');
    expect(transaction.objectStore('routines').indexNames.contains('profileId')).toBe(true);
    database.close();
  });

  it('upgrades a real version 10 database with historical and paused event evidence intact', async () => {
    const indexedDB = new IDBFactory();
    const record = { id: 'event', kind: 'strongman', inputs: { events: [{ id: 'bag', coverage: [{ routineId: 'normal' }] }] },
      workouts: [{ id: 'week', exercises: [{ id: 'exercise' }], session: { status: 'paused', runningSince: null, elapsedSeconds: 42,
        eventBlocks: [{ id: 'block', attempts: [{ id: 'attempt', weight: 200, extension: true }] }] } }], extension: true };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('event-evidence-upgrade', 10);
      request.onupgradeneeded = () => {
        ['profiles', 'routines', 'templates'].forEach(store => request.result.createObjectStore(store, { keyPath: 'id' }));
        request.result.createObjectStore('metadata', { keyPath: 'key' });
        request.transaction.objectStore('routines').put(record);
        request.transaction.objectStore('templates').put({ ...record, id: 'template' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('event-evidence-upgrade', 11);
      request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, 11);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const read = (store, key) => new Promise((resolve, reject) => {
      const request = database.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(await read('routines', 'event')).toEqual(addEventEvidenceSnapshots(record));
    expect(await read('templates', 'template')).toEqual(addEventEvidenceSnapshots({ ...record, id: 'template' }));
    expect(await read('metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: 11 });
    database.close();
  });

  it('adds empty weak points without mutating legacy routine inputs', () => {
    const routine = { inputs: { maxPress: '200', unknown: true } };
    expect(addAccessoryWeakPoints(routine).inputs).toEqual({
      maxPress: '200', unknown: true, pressWeakPoint: '', deadliftWeakPoint: '',
    });
    expect(routine.inputs.pressWeakPoint).toBeUndefined();
  });

  it('adds fixed progression without mutating legacy inputs or unknown fields', () => {
    const record = { inputs: { maxSquat: '400', unknown: true }, unknown: 'kept' };
    expect(addMaxProgressionMode(record)).toEqual({
      inputs: { maxSquat: '400', unknown: true, maxProgressionMode: 'fixed' },
      unknown: 'kept',
    });
    expect(record.inputs.maxProgressionMode).toBeUndefined();
  });

  it('adds max snapshots without changing the original routine', () => {
    const routine = {
      inputs: { maxSquat: '400', maxPress: '200', maxDead: '500', squatIncrement: '10' },
      workouts: [{ id: 'w1', cycleIndex: 2, unknown: 'preserved' }],
    };

    expect(addEffectiveMaxSnapshots(routine).workouts[0]).toEqual({
      id: 'w1',
      cycleIndex: 2,
      unknown: 'preserved',
      effectiveMaxes: { maxSquat: 420, maxPress: 200, maxDead: 500 },
    });
    expect(routine.workouts[0].effectiveMaxes).toBeUndefined();
  });

  it('adds nullable workout sessions without changing the original routine', () => {
    const routine = { workouts: [{ id: 'w1', unknown: 'preserved' }] };

    expect(addWorkoutSessions(routine).workouts[0]).toEqual({
      id: 'w1',
      unknown: 'preserved',
      session: null,
    });
    expect(routine.workouts[0].session).toBeUndefined();
  });

  it('adds session action metadata without changing the original routine', () => {
    const routine = { workouts: [{ session: { exercises: [{ sets: [{ status: 'pending', unknown: true }] }] } }] };
    const migrated = addSessionActionMetadata(routine);

    expect(migrated.workouts[0].session.exercises[0]).toMatchObject({
      original: null,
      substitutedAt: null,
      sets: [{ status: 'pending', unknown: true, skippedAt: null, skipActionId: null }],
    });
    expect(routine.workouts[0].session.exercises[0].original).toBeUndefined();
  });

  it('derives the newest active routine per profile without mutating records', () => {
    const profiles = [{ id: 'p1', unknown: true }, { id: 'p2' }];
    const routines = [
      { id: 'old', profileId: 'p1', updatedAt: '2025-01-01', workouts: [{ session: { status: 'inProgress' } }] },
      { id: 'new', profileId: 'p1', updatedAt: '2026-01-01', workouts: [{ session: { status: 'inProgress' } }] },
    ];
    expect(addActiveWorkoutReferences(profiles, routines)).toEqual([
      { id: 'p1', unknown: true, activeWorkoutRoutineId: 'new' },
      { id: 'p2', activeWorkoutRoutineId: null },
    ]);
    expect(profiles[0].activeWorkoutRoutineId).toBeUndefined();
  });
});
