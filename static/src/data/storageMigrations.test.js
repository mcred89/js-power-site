import {
  addEffectiveMaxSnapshots,
  addMaxProgressionMode,
  addAccessoryWeakPoints,
  addTabataSprintOptions,
  addSessionActionMetadata,
  addActiveWorkoutReferences,
  addWorkoutSessions,
  databaseMigrations,
  runDatabaseMigrations,
  DATABASE_VERSION,
  BACKUP_VERSION,
  migrateBackup,
} from './storageMigrations';
import { parseBackup, exportBackup } from './storageBackup';
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
    expect(Object.keys(databaseMigrations).map(Number)).toEqual(Array.from({ length: DATABASE_VERSION }, (_, index) => index + 1));
  });

  it('creates all stores for a new installation', () => {
    const context = migrationDatabase([]);
    runDatabaseMigrations(context.database, context.transaction, 0, DATABASE_VERSION);

    expect([...context.stores]).toEqual(['profiles', 'routines', 'metadata', 'templates', 'archives']);
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
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 12 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 13 } },
      { name: 'metadata', value: { key: 'dataSchemaVersion', value: 14 } },
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

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('upgrades a real version %i database in order', async oldVersion => {
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
        if (oldVersion >= 12) {
          const archives = database.createObjectStore('archives', { keyPath: 'id' });
          archives.createIndex('profileId', 'record.profileId', { unique: false });
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
      const request = indexedDB.open(name, DATABASE_VERSION);
      request.onupgradeneeded = event => runDatabaseMigrations(
        request.result, request.transaction, event.oldVersion, DATABASE_VERSION,
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
    expect(routine.workouts[0]).toHaveProperty('effectiveMaxes');
    expect(routine.workouts[0].session.exercises[0].sets[0]).toMatchObject({
      skippedAt: null, skipActionId: null,
    });
    expect(routine.inputs).toMatchObject({
      pressWeakPoint: '', deadliftWeakPoint: '',
      squatTabataEnabled: false, pressTabataEnabled: false, deadliftTabataEnabled: false,
    });
    expect(routine.inputs.maxProgressionMode).toBe('fixed');
    if (oldVersion >= 5) {
      expect(template.inputs).toMatchObject({
        pressWeakPoint: '', deadliftWeakPoint: '', maxProgressionMode: 'fixed',
        squatTabataEnabled: false, pressTabataEnabled: false, deadliftTabataEnabled: false,
      });
    } else {
      expect(template).toBeUndefined();
    }
    database.close();
  });

  it('creates a new database with every store and archive profile index', async () => {
    const indexedDB = new IDBFactory();
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('fresh-database', DATABASE_VERSION);
      request.onupgradeneeded = event => runDatabaseMigrations(
        request.result, request.transaction, event.oldVersion, DATABASE_VERSION,
      );
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    expect([...database.objectStoreNames]).toEqual(['archives', 'metadata', 'profiles', 'routines', 'templates']);
    const transaction = database.transaction('routines', 'readonly');
    expect(transaction.objectStore('routines').indexNames.contains('profileId')).toBe(true);
    const archiveIndex = database.transaction('archives').objectStore('archives').index('profileId');
    expect(archiveIndex.keyPath).toBe('record.profileId');
    const metadata = await new Promise((resolve, reject) => {
      const request = database.transaction('metadata').objectStore('metadata').get('dataSchemaVersion');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(metadata).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
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

describe('Tabata sprint compatibility', () => {
  const records = () => ({
    routine: {
      id: 'r1', profileId: 'p1', unknown: { preserved: true },
      inputs: { maxSquat: '400', squatEventEnabled: true, pressTabataEnabled: true, unknown: 'retained' },
      workouts: [
        { id: 'completed', completedAt: '2026-09-06', effectiveMaxes: { maxSquat: 400 },
          exercises: [{ id: 'squat', generated: { movement: 'Squat', weight: '320', prescription: '3x5' }, overrides: {} }],
          session: { status: 'completed', notes: 'Keep this history', exercises: [] },
        },
        { id: 'pending', completedAt: null,
          exercises: [{ id: 'event', generated: { movement: 'Strongman event: Sandbag', weight: '', prescription: '' }, overrides: { prescription: '3 carries' } }],
        },
      ],
    },
    template: { id: 't1', inputs: { deadliftEventEnabled: true, deadliftTabataEnabled: false }, unknown: true },
    archive: { id: 'routines:retired', store: 'routines', record: { id: 'retired', profileId: 'p1', inputs: { unknown: true } } },
  });

  it('advances the database and backup versions for independent sprint options', () => {
    expect(DATABASE_VERSION).toBe(14);
    expect(BACKUP_VERSION).toBe(14);
  });

  it('adds disabled defaults while preserving explicit options, unknown data, and workout snapshots', () => {
    const { routine } = records();
    const before = JSON.stringify(routine);
    const migrated = addTabataSprintOptions(routine);

    expect(migrated.inputs).toEqual({
      ...routine.inputs, squatTabataEnabled: false, pressTabataEnabled: true, deadliftTabataEnabled: false,
    });
    expect(migrated.workouts).toBe(routine.workouts);
    expect(migrated.unknown).toBe(routine.unknown);
    expect(JSON.stringify(routine)).toBe(before);
    const unknownRecord = { id: 'unknown', custom: { preserved: true } };
    expect(addTabataSprintOptions(unknownRecord)).toBe(unknownRecord);
  });

  it('migrates v12 backups purely without altering prescriptions, archives, or unknown records', () => {
    const { routine, template, archive } = records();
    const unknownRecord = { id: 'custom', unknown: ['Keep me'] };
    const original = {
      format: 'mcilroy-method-backup', version: 12, dataSchemaVersion: 12, unknown: { kept: true },
      profiles: [{ id: 'p1', activeRoutineId: 'r1' }], routines: [routine, unknownRecord],
      templates: [template], archives: [archive],
    };
    const before = JSON.stringify(original);
    const migrated = migrateBackup(original);

    expect(migrated).toEqual({
      ...original, version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION,
      routines: [addTabataSprintOptions(routine), unknownRecord], templates: [addTabataSprintOptions(template)],
    });
    expect(migrated.routines[0].workouts).toBe(routine.workouts);
    expect(migrated.archives).toBe(original.archives);
    expect(JSON.stringify(original)).toBe(before);
    const roundTrip = parseBackup(exportBackup(migrated.profiles, migrated.routines, migrated.templates, migrated.archives));
    expect(roundTrip.routines).toEqual(migrated.routines);
    expect(roundTrip.templates).toEqual(migrated.templates);
    expect(roundTrip.archives).toEqual(migrated.archives);
  });

  it('upgrades a deployed v12 database without changing completed or pending workout prescriptions', async () => {
    const indexedDB = new IDBFactory();
    const { routine, template, archive } = records();
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('deployed-before-tabata', 12);
      request.onupgradeneeded = () => {
        const database = request.result;
        ['profiles', 'routines', 'templates', 'archives'].forEach(name => database.createObjectStore(name, { keyPath: 'id' }));
        database.createObjectStore('metadata', { keyPath: 'key' });
        request.transaction.objectStore('routines').createIndex('profileId', 'profileId');
        request.transaction.objectStore('archives').createIndex('profileId', 'record.profileId');
        request.transaction.objectStore('profiles').put({ id: 'p1', activeRoutineId: 'r1', unknown: true });
        request.transaction.objectStore('routines').put(routine);
        request.transaction.objectStore('templates').put(template);
        request.transaction.objectStore('archives').put(archive);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('deployed-before-tabata', DATABASE_VERSION);
      request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const read = (store, id) => new Promise((resolve, reject) => {
      const request = database.transaction(store).objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(await read('routines', 'r1')).toEqual(addTabataSprintOptions(routine));
    expect(await read('templates', 't1')).toEqual(addTabataSprintOptions(template));
    expect(await read('archives', archive.id)).toEqual(archive);
    expect(await read('profiles', 'p1')).toEqual({ id: 'p1', activeRoutineId: 'r1', unknown: true });
    expect(await read('metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
    database.close();
  });
});

describe('retired strongman compatibility', () => {
  const records = () => {
    const strength = { id: 'strength', profileId: 'p1', kind: 'strength', updatedAt: '2026-09-01',
      inputs: { pressEventEnabled: true, pressEventMovement: 'Axle clean' },
      workouts: [
        { id: 'normal', exercises: [{ id: 'normal-exercise', generated: { movement: 'Strongman event: Axle clean' } }] },
        { id: 'empty', kind: 'eventSlot', exercises: [], session: null, eventRef: { routineId: 'events', workoutId: 'event-week' } },
        { id: 'completed', kind: 'eventSlot', exercises: [], completedAt: '2026-09-02', eventRef: { routineId: 'events', workoutId: 'done' } },
        { id: 'started', kind: 'eventSlot', exercises: [], session: { status: 'paused', startedAt: '2026-09-02', notes: 'Keep me' } },
        { id: 'edited', kind: 'eventSlot', exercises: [{ id: 'custom', overrides: { movement: 'Sandbag' } }] },
      ], unknown: { preserved: true },
    };
    const event = { id: 'events', profileId: 'p1', kind: 'strongman', updatedAt: '2026-09-05', unknown: 'keep',
      inputs: { events: [{ id: 'bag', goal: '300 lb' }] },
      workouts: [{ id: 'event-week', exercises: [], session: { status: 'inProgress', eventBlocks: [{ attempts: [{ weight: 200 }] }] } }],
    };
    return { strength, event };
  };

  it('keeps every shipped strongman migration', () => {
    expect(Object.keys(databaseMigrations).map(Number)).toEqual(expect.arrayContaining(Array.from({ length: 12 }, (_, index) => index + 1)));
  });

  it('migrates v11 backups purely, preserves retired records, and restores only untouched slots', () => {
    const { strength, event } = records();
    const original = { format: 'mcilroy-method-backup', version: 11, dataSchemaVersion: 11, unknown: 'preserved',
      profiles: [{ id: 'p1', activeRoutineId: 'events', scheduledStrengthRoutineId: 'strength', activeWorkoutRoutineId: 'events', activeStrongmanRoutineId: 'events' }],
      routines: [strength, event], templates: [{ ...event, id: 'event-template' }],
    };
    const before = JSON.stringify(original);
    const migrated = migrateBackup(original);
    expect(migrated).toMatchObject({ version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION, unknown: 'preserved' });
    expect(migrated.profiles[0]).toMatchObject({ activeRoutineId: 'strength', activeWorkoutRoutineId: null });
    expect(migrated.routines).toHaveLength(1);
    expect(migrated.templates).toEqual([]);
    expect(migrated.archives).toEqual([
      { id: 'routines:events', store: 'routines', record: event },
      { id: 'templates:event-template', store: 'templates', record: original.templates[0] },
    ]);
    expect(migrated.profiles[0]).not.toHaveProperty('scheduledStrengthRoutineId');
    expect(migrated.profiles[0]).not.toHaveProperty('activeStrongmanRoutineId');
    expect(migrated.routines[0].workouts[1]).toMatchObject({ id: 'empty', exercises: [{ generated: { movement: 'Strongman day', weight: '', prescription: '' }, overrides: {} }] });
    expect(migrated.routines[0].workouts.filter((_, index) => index !== 1)).toEqual(strength.workouts.filter((_, index) => index !== 1));
    expect(parseBackup(exportBackup(migrated.profiles, migrated.routines, migrated.templates, migrated.archives))).toMatchObject({
      profiles: migrated.profiles, routines: migrated.routines, templates: migrated.templates, archives: migrated.archives,
    });
    expect(JSON.stringify(original)).toBe(before);
  });

  it('repairs foreign and retired pointers and preserves only a same-profile normal active workout', () => {
    const { strength, event } = records();
    strength.workouts[0].session = { status: 'inProgress', exercises: [] };
    const foreign = { ...strength, id: 'foreign', profileId: 'p2' };
    const original = { format: 'mcilroy-method-backup', version: 11, profiles: [
      { id: 'p1', activeRoutineId: 'events', scheduledStrengthRoutineId: 'foreign', activeWorkoutRoutineId: 'events' },
      { id: 'p2', activeRoutineId: 'strength', activeWorkoutRoutineId: 'strength' },
      { id: 'p3', activeRoutineId: 'events', activeWorkoutRoutineId: 'events' },
    ], routines: [strength, event, foreign], templates: [] };
    expect(parseBackup(JSON.stringify(original)).profiles).toMatchObject([
      { id: 'p1', activeRoutineId: 'strength', activeWorkoutRoutineId: 'strength' },
      { id: 'p2', activeRoutineId: 'foreign', activeWorkoutRoutineId: 'foreign' },
      { id: 'p3', activeRoutineId: null, activeWorkoutRoutineId: null },
    ]);
  });

  it('opens an already deployed v11 database without losing its strength history or retired data', async () => {
    const indexedDB = new IDBFactory();
    const { strength, event } = records();
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('deployed-strongman', 11);
      request.onupgradeneeded = () => {
        const database = request.result;
        ['profiles', 'routines', 'templates'].forEach(name => database.createObjectStore(name, { keyPath: 'id' }));
        database.createObjectStore('metadata', { keyPath: 'key' });
        request.transaction.objectStore('routines').createIndex('profileId', 'profileId');
        request.transaction.objectStore('profiles').put({ id: 'p1', activeRoutineId: 'events', scheduledStrengthRoutineId: 'strength', activeWorkoutRoutineId: 'events' });
        request.transaction.objectStore('routines').put(strength);
        request.transaction.objectStore('routines').put(event);
        request.transaction.objectStore('templates').put({ ...event, id: 'event-template' });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('deployed-strongman', DATABASE_VERSION);
      request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const read = (store, id) => new Promise((resolve, reject) => {
      const request = database.transaction(store).objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(await read('profiles', 'p1')).toMatchObject({ activeRoutineId: 'strength', activeWorkoutRoutineId: null });
    expect(await read('routines', 'events')).toBeUndefined();
    expect(await read('templates', 'event-template')).toBeUndefined();
    expect(await read('archives', 'routines:events')).toEqual({ id: 'routines:events', store: 'routines', record: event });
    expect(await read('archives', 'templates:event-template')).toEqual({ id: 'templates:event-template', store: 'templates', record: { ...event, id: 'event-template' } });
    const restored = await read('routines', 'strength');
    expect(restored.workouts[1].exercises[0].generated.movement).toBe('Strongman day');
    expect(restored.workouts[2]).toEqual(strength.workouts[2]);
    expect(await read('metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
    database.close();
  });

  it('normalizes current backups without replacing a newly selected routine with a stale scheduling pointer', () => {
    const { strength, event } = records();
    const selected = { ...strength, id: 'selected' };
    const original = { format: 'mcilroy-method-backup', version: BACKUP_VERSION, profiles: [{ id: 'p1', activeRoutineId: 'selected', scheduledStrengthRoutineId: 'strength', activeWorkoutRoutineId: 'events' }], routines: [strength, selected, event], templates: [] };
    expect(parseBackup(JSON.stringify(original)).profiles[0]).toMatchObject({ activeRoutineId: 'selected', activeWorkoutRoutineId: null });
  });
});
