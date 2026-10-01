import { IDBFactory } from 'fake-indexeddb';
import { DATABASE_VERSION, runDatabaseMigrations } from './storageMigrations';
import { BACKUP_VERSION, migrateBackup, parseBackup, exportBackup } from './storageBackup';
import { changeProfileCompetition, migrateStrongmanCompetitions } from './strongmanCompetitions';

if (!global.structuredClone) global.structuredClone = value => JSON.parse(JSON.stringify(value));

const competition = { name: 'Next meet', date: '', events: [{ id: 'yoke', name: 'Yoke', weight: 600, distance: 100 }] };
const routine = { id: 'r1', profileId: 'p1', kind: 'strength', createdAt: '2026-09-01T00:00:00.000Z',
  inputs: { strongmanCompetition: competition, unknown: true }, workouts: [],
  strongmanLog: [{ id: 'entry', movement: 'Yoke', date: '2026-09-10', sets: [{ id: 'set', weight: 580, distance: 50 }] }] };
const profile = { id: 'p1', activeRoutineId: 'r1', activeWorkoutRoutineId: null, unknown: { retained: true } };
const archive = { id: 'archived', store: 'routines', record: { kind: 'strongman', custom: true } };

it('purely upgrades v19 backup competition ownership and preserves opaque snapshots', () => {
  const original = { format: 'mcilroy-method-backup', version: 19, dataSchemaVersion: 19,
    profiles: [profile], routines: [routine], templates: [], archives: [archive], custom: { retained: true } };
  const before = JSON.stringify(original);
  const migrated = migrateBackup(original);
  expect(migrated).toEqual(migrateStrongmanCompetitions({ ...original, version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION }));
  expect(migrated.profiles[0].strongmanCompetition).toMatchObject({ name: 'Next meet', status: 'active' });
  expect(migrated.routines[0].strongmanLog[0].competitionId).toBe(migrated.profiles[0].strongmanCompetition.id);
  expect(migrated.archives).toEqual([archive]);
  expect(JSON.stringify(original)).toBe(before);
  expect(parseBackup(JSON.stringify(original))).toEqual(migrated);
});

it('round-trips an ended competition without reactivating legacy plan targets', () => {
  const migrated = migrateStrongmanCompetitions({ profiles: [profile], routines: [routine] });
  const ended = changeProfileCompetition(migrated.profiles[0], 'completed', '2026-10-01T12:00:00.000Z');
  const parsed = parseBackup(exportBackup([ended], migrated.routines, [], [archive]));
  expect(parsed.profiles).toEqual([ended]);
  expect(parsed.profiles[0].strongmanCompetition).toBeNull();
  expect(parsed.routines).toEqual(migrated.routines);
});

it('rejects malformed known profile competition state before import without mutating the backup', () => {
  const saved = changeProfileCompetition(profile, competition, '2026-10-01T12:00:00.000Z');
  const bad = { ...saved, strongmanCompetition: { ...saved.strongmanCompetition, id: 7 } };
  const before = JSON.stringify(bad);
  expect(() => parseBackup(exportBackup([bad], [routine]))).toThrow('nonempty text ID');
  expect(JSON.stringify(bad)).toBe(before);
});

it.each([0, 19])('creates or upgrades a v%i database to shared profile competitions', async oldVersion => {
  const indexedDB = new IDBFactory();
  const name = `competition-carryover-${oldVersion}`;
  if (oldVersion) await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, oldVersion);
    request.onupgradeneeded = () => {
      ['profiles', 'routines', 'templates', 'archives'].forEach(store => request.result.createObjectStore(store, { keyPath: 'id' }));
      request.result.createObjectStore('metadata', { keyPath: 'key' });
      request.transaction.objectStore('routines').createIndex('profileId', 'profileId');
      request.transaction.objectStore('archives').createIndex('profileId', 'record.profileId');
      request.transaction.objectStore('profiles').put(profile);
      request.transaction.objectStore('routines').put(routine);
      request.transaction.objectStore('routines').put({ id: 'unknown', custom: true });
      request.transaction.objectStore('archives').put(archive);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION);
    request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const read = (store, id) => new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  expect(await read('metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
  if (oldVersion) {
    const expected = migrateStrongmanCompetitions({ profiles: [profile], routines: [routine] });
    expect(await read('profiles', 'p1')).toEqual(expected.profiles[0]);
    expect(await read('routines', 'r1')).toEqual(expected.routines[0]);
    expect(await read('routines', 'unknown')).toEqual({ id: 'unknown', custom: true });
    expect(await read('archives', 'archived')).toEqual(archive);
  }
  database.close();
});
