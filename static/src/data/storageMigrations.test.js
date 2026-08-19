import {
  addEffectiveMaxSnapshots,
  addSessionActionMetadata,
  addWorkoutSessions,
  databaseMigrations,
  runDatabaseMigrations,
} from './storageMigrations';

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
        put: value => puts.push({ name, value }),
        openCursor: () => ({}),
      }),
    },
    stores,
    puts,
  };
};

describe('IndexedDB migrations', () => {
  it('contains every migration through the current version', () => {
    expect(Object.keys(databaseMigrations).map(Number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('creates all stores for a new installation', () => {
    const context = migrationDatabase([]);
    runDatabaseMigrations(context.database, context.transaction, 0, 6);

    expect([...context.stores]).toEqual(['profiles', 'routines', 'metadata', 'templates']);
    expect(context.puts).toEqual([
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 2 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 3 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 4 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 5 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 6 } },
    ]);
  });

  it('upgrades version 1 through every later migration without recreating stores', () => {
    const context = migrationDatabase(['profiles', 'routines']);
    runDatabaseMigrations(context.database, context.transaction, 1, 6);

    expect([...context.stores]).toEqual(['profiles', 'routines', 'metadata', 'templates']);
    expect(context.puts.map(entry => entry.value.value)).toEqual([2, 3, 4, 5, 6]);
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
});
