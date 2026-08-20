import {
  addEffectiveMaxSnapshots,
  addSessionActionMetadata,
  addActiveWorkoutReferences,
  addWorkoutSessions,
  databaseMigrations,
  runDatabaseMigrations,
} from './storageMigrations';
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
  it('contains every migration through the current version', () => {
    expect(Object.keys(databaseMigrations).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('creates all stores for a new installation', () => {
    const context = migrationDatabase([]);
    runDatabaseMigrations(context.database, context.transaction, 0, 7);

    expect([...context.stores]).toEqual(['profiles', 'routines', 'metadata', 'templates']);
    expect(context.puts).toEqual([
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 2 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 3 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 4 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 5 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 6 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 7 } },
    ]);
  });

  it('upgrades version 1 through every later migration without recreating stores', () => {
    const context = migrationDatabase(['profiles', 'routines']);
    runDatabaseMigrations(context.database, context.transaction, 1, 7);

    expect([...context.stores]).toEqual(['profiles', 'routines', 'metadata', 'templates']);
    expect(context.puts.map(entry => entry.value.value)).toEqual([2, 3, 4, 5, 6, 7]);
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

  it.each([1, 2, 3, 4, 5, 6])('supports upgrading a version %i installation to version 7', oldVersion => {
    const stores = ['profiles', 'routines'];
    if (oldVersion >= 2) stores.push('metadata');
    if (oldVersion >= 5) stores.push('templates');
    const context = migrationDatabase(stores);
    expect(() => runDatabaseMigrations(context.database, context.transaction, oldVersion, 7)).not.toThrow();
    expect(context.puts.at(-1)).toEqual({
      name: 'metadata', value: { key: 'dataSchemaVersion', value: 7 },
    });
  });

  it.each([1, 2, 3, 4, 5, 6])('upgrades a real version %i database in order', async oldVersion => {
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
        request.transaction.objectStore('profiles').put({ id: 'p1', unknown: true });
        request.transaction.objectStore('routines').put({
          id: 'r1', profileId: 'p1', updatedAt: '2026-01-01', inputs: {},
          workouts: [{
            id: 'w1',
            ...(oldVersion >= 3 ? { effectiveMaxes: {} } : {}),
            session: { status: 'inProgress', exercises: [{
              ...(oldVersion >= 6 ? { original: null, substitutedAt: null } : {}),
              sets: [{ ...(oldVersion >= 6 ? { skippedAt: null, skipActionId: null } : {}) }],
            }] },
          }],
        });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 7);
      request.onupgradeneeded = event => runDatabaseMigrations(
        request.result, request.transaction, event.oldVersion, 7,
      );
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const tx = database.transaction(['profiles', 'routines', 'metadata'], 'readonly');
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
    expect(tx.objectStore('routines').indexNames.contains('profileId')).toBe(true);
    expect(profile).toMatchObject({ id: 'p1', unknown: true, activeWorkoutRoutineId: 'r1' });
    expect(routine.workouts[0]).toHaveProperty('effectiveMaxes');
    expect(routine.workouts[0].session.exercises[0].sets[0]).toMatchObject({
      skippedAt: null, skipActionId: null,
    });
    database.close();
  });

  it('creates a real version 7 database with every store and index', async () => {
    const indexedDB = new IDBFactory();
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('fresh-version-7', 7);
      request.onupgradeneeded = event => runDatabaseMigrations(
        request.result, request.transaction, event.oldVersion, 7,
      );
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    expect([...database.objectStoreNames]).toEqual(['metadata', 'profiles', 'routines', 'templates']);
    const transaction = database.transaction('routines', 'readonly');
    expect(transaction.objectStore('routines').indexNames.contains('profileId')).toBe(true);
    database.close();
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
