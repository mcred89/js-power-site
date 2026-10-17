import { IDBFactory } from 'fake-indexeddb';
import { DATABASE_VERSION, runDatabaseMigrations } from './storageMigrations';
import { BACKUP_VERSION, exportBackup, migrateBackup, parseBackup } from './storageBackup';
import { copyStrongmanWorkout } from './strongmanWorkoutCopy';
import { createStrongmanLogEntry } from './strongman';

if (!global.structuredClone) global.structuredClone = value => JSON.parse(JSON.stringify(value));

const actual = createStrongmanLogEntry({ id: 'actual', movement: 'Yoke', workoutId: 'past', date: '2026-01-01',
  sets: [{ id: 'actual-set', weight: 580, reps: 1 }], unknown: { keep: true } });
const queue = copyStrongmanWorkout({ entries: [actual] }, 'today', '2026-01-08');
const routine = { id: 'plan', profileId: 'athlete', inputs: {}, strongmanLog: [actual],
  workouts: [{ id: 'past', name: 'Strongman', completedAt: '2026-01-01', exercises: [] },
    { id: 'today', name: 'Strongman', completedAt: null, exercises: [], strongmanQueue: queue }], unknown: { keep: true } };

const open = (factory, name, version) => new Promise((resolve, reject) => {
  const request = factory.open(name, version);
  request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const read = (database, store, id) => new Promise((resolve, reject) => {
  const request = database.transaction(store).objectStore(store).get(id);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

it('creates a fresh v23 database and persists queued prefills independently from actual history', async () => {
  const database = await open(new IDBFactory(), 'fresh-queue', DATABASE_VERSION);
  expect(await read(database, 'metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: 23 });
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('routines', 'readwrite');
    transaction.objectStore('routines').put(routine);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  expect(await read(database, 'routines', routine.id)).toEqual(routine);
  database.close();
});

it.each([17, 18, 19, 20, 21, 22])('upgrades v%i to v23 without rewriting saved training or adding queues', async version => {
  const factory = new IDBFactory();
  let database = await open(factory, `queue-upgrade-${version}`, version);
  const original = { ...routine, workouts: [routine.workouts[0]], inputs: { strongmanCompetition: null } };
  await new Promise((resolve, reject) => {
    const transaction = database.transaction('routines', 'readwrite');
    transaction.objectStore('routines').put(original);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
  database = await open(factory, `queue-upgrade-${version}`, DATABASE_VERSION);
  const stored = await read(database, 'routines', routine.id);
  expect(stored.workouts).toEqual(original.workouts);
  expect(stored.strongmanLog).toEqual(original.strongmanLog);
  expect(stored.unknown).toEqual(original.unknown);
  expect(stored.workouts[0]).not.toHaveProperty('strongmanQueue');
  expect(await read(database, 'metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: 23 });
  database.close();
});

it.each(Array.from({ length: 22 }, (_, index) => index + 1))('purely upgrades v%i backup data while preserving queues and unknown records', version => {
  const original = { format: 'mcilroy-method-backup', version, dataSchemaVersion: version,
    profiles: [{ id: 'athlete' }], routines: [routine, { id: 'unknown-record', unknown: true }],
    templates: [], archives: [{ id: 'archive', store: 'routines', record: { opaque: true } }], unknown: { keep: true } };
  const before = JSON.stringify(original);
  const migrated = migrateBackup(original);
  expect(migrated).toMatchObject({ version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION, unknown: { keep: true } });
  expect(migrated.routines[0].workouts[1].strongmanQueue).toEqual(queue);
  expect(migrated.routines[0].strongmanLog).toEqual([actual]);
  expect(migrated.routines[1]).toMatchObject({ id: 'unknown-record', unknown: true });
  expect(migrated.archives).toEqual(original.archives);
  expect(JSON.stringify(original)).toBe(before);
});

it('round-trips pending work and validates it even when there is no actual history field', () => {
  const restored = parseBackup(exportBackup([{ id: 'athlete' }], [routine]));
  expect(restored.routines).toEqual([routine]);
  const withoutLog = { ...routine };
  delete withoutLog.strongmanLog;
  expect(parseBackup(exportBackup([{ id: 'athlete' }], [withoutLog])).routines).toEqual([withoutLog]);
  const invalid = { ...withoutLog, workouts: [{ ...routine.workouts[1], strongmanQueue: [{ ...queue[0],
    sets: [{ ...queue[0].sets[0], weight: -1 }],
  }] }] };
  expect(() => parseBackup(exportBackup([{ id: 'athlete' }], [invalid]))).toThrow('invalid strongman data');
  expect(invalid.workouts[0].strongmanQueue[0].sets[0].weight).toBe(-1);
});

it.each([null, {}, [null], [{ ...queue[0], workoutId: 'someone-else' }], [{ ...queue[0], sets: [] }],
  [{ ...queue[0], sets: [queue[0].sets[0], queue[0].sets[0]] }], [queue[0], queue[0]],
])('rejects malformed pending queue %p without altering backup data', value => {
  const invalid = { ...routine, workouts: [{ ...routine.workouts[1], strongmanQueue: value }] };
  const contents = exportBackup([{ id: 'athlete' }], [invalid]);
  expect(() => parseBackup(contents)).toThrow('invalid strongman data');
  expect(exportBackup([{ id: 'athlete' }], [invalid]).replace(/"exportedAt": "[^"]+"/, ''))
    .toBe(contents.replace(/"exportedAt": "[^"]+"/, ''));
});
