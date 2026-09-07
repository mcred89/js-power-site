import { exportBackup, parseBackup } from './storageBackup';
import { BACKUP_VERSION, DATABASE_VERSION } from './storageMigrations';
import { IDBFactory } from 'fake-indexeddb';

describe('portable backups', () => {
  it('round trips profiles, routines, and templates', () => {
    const profiles = [{ id: 'p1', name: 'Alex' }];
    const routines = [{ id: 'r1', profileId: 'p1', name: 'Plan' }];
    const templates = [{ id: 't1', name: 'Meet prep', inputs: { maxSquat: '315' } }];

    expect(parseBackup(exportBackup(profiles, routines, templates))).toMatchObject({
      profiles,
      routines,
      templates,
      version: BACKUP_VERSION,
      dataSchemaVersion: DATABASE_VERSION,
    });
  });

  it('upgrades version 1 backups without changing their records', () => {
    const oldBackup = {
      format: 'mcilroy-method-backup',
      version: 1,
      profiles: [{ id: 'p1', name: 'Alex' }],
      routines: [{ id: 'r1', profileId: 'p1', name: 'Plan' }],
    };

    expect(parseBackup(JSON.stringify(oldBackup))).toEqual({
      ...oldBackup,
      version: BACKUP_VERSION,
      dataSchemaVersion: DATABASE_VERSION,
      templates: [],
      archives: [],
      routines: [{ ...oldBackup.routines[0], kind: 'strength' }],
      profiles: [{ id: 'p1', name: 'Alex', activeRoutineId: 'r1', activeWorkoutRoutineId: null }],
    });
    expect(oldBackup.version).toBe(1);
  });

  it('upgrades version 4 backups and preserves unknown fields', () => {
    const oldBackup = {
      format: 'mcilroy-method-backup', version: 4, dataSchemaVersion: 4,
      profiles: [], routines: [], unknown: { retained: true },
    };

    expect(parseBackup(JSON.stringify(oldBackup))).toEqual({
      ...oldBackup, version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION, templates: [], archives: [],
    });
  });

  it('upgrades version 5 session records without mutating unknown fields', () => {
    const oldBackup = {
      format: 'mcilroy-method-backup', version: 5, dataSchemaVersion: 5,
      profiles: [], templates: [], unknown: 'retained',
      routines: [{ id: 'r1', workouts: [{ session: { exercises: [{ unknown: true, sets: [{ status: 'skipped' }] }] } }] }],
    };
    const migrated = parseBackup(JSON.stringify(oldBackup));

    expect(migrated).toMatchObject({ version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION, unknown: 'retained' });
    expect(migrated.routines[0].workouts[0].session.exercises[0]).toMatchObject({
      unknown: true, original: null, substitutedAt: null,
      sets: [{ status: 'skipped', skippedAt: null, skipActionId: null }],
    });
    expect(oldBackup.version).toBe(5);
  });

  it('rejects backups made by a newer, incompatible app', () => {
    expect(() => parseBackup(JSON.stringify({
      format: 'mcilroy-method-backup',
      version: 99,
      profiles: [],
      routines: [],
    }))).toThrow('not a supported');
  });

  it('normalizes dangling current-version active workout references', () => {
    const backup = {
      format: 'mcilroy-method-backup', version: 7, dataSchemaVersion: 7,
      profiles: [{ id: 'p1', activeWorkoutRoutineId: 'missing', unknown: true }],
      routines: [], templates: [],
    };
    expect(parseBackup(JSON.stringify(backup)).profiles).toEqual([
      { id: 'p1', activeRoutineId: null, activeWorkoutRoutineId: null, unknown: true },
    ]);
    expect(backup.profiles[0].activeWorkoutRoutineId).toBe('missing');
  });

  it('rejects unrelated JSON files', () => {
    expect(() => parseBackup('{"profiles":[]}')).toThrow('not a supported');
  });

  it.each([11, 12, 13, 14])('rejects malformed archive data in version %i instead of discarding it', version => {
    expect(() => parseBackup(JSON.stringify({
      format: 'mcilroy-method-backup', version,
      profiles: [], routines: [], templates: [], archives: { unknown: 'preserve this' },
    }))).toThrow('not a supported');
  });

  it('keeps existing archives and retires unexpected current-version blocks without overwriting collisions', () => {
    const existing = { id: 'routines:event', store: 'routines', record: { id: 'event', notes: 'Original archive' }, unknown: true };
    const event = { id: 'event', profileId: 'p1', kind: 'strongman', notes: 'Different record', workouts: [] };
    const source = { format: 'mcilroy-method-backup', version: BACKUP_VERSION, profiles: [{ id: 'p1' }], routines: [event], templates: [], archives: [existing] };
    const serialized = JSON.stringify(source);
    const parsed = parseBackup(serialized);
    expect(parsed.routines).toEqual([]);
    expect(parsed.archives).toEqual([existing, { id: 'routines:event:2', store: 'routines', record: event }]);
    expect(parseBackup(exportBackup(parsed.profiles, parsed.routines, parsed.templates, parsed.archives)).archives).toEqual(parsed.archives);
    expect(JSON.stringify(source)).toBe(serialized);
  });
});

describe('IndexedDB connection reuse', () => {
  it('opens the database once across multiple transactions', async () => {
    const originalIndexedDB = window.indexedDB;
    const open = jest.fn(() => {
      const database = {
        close: jest.fn(),
        transaction: () => {
          const transaction = {
            objectStore: () => ({ getAll: () => ({ result: [] }) }),
          };
          Promise.resolve().then(() => transaction.oncomplete());
          return transaction;
        },
      };
      const request = { result: database };
      Promise.resolve().then(() => request.onsuccess());
      return request;
    });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open } });

    let isolatedStorage;
    jest.isolateModules(() => { isolatedStorage = require('./storage'); });
    await Promise.all([
      isolatedStorage.getAll('profiles'),
      isolatedStorage.getAll('routines'),
    ]);

    expect(open).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDB });
  });

  it('queries routines through the profile index', async () => {
    const originalIndexedDB = window.indexedDB;
    const getAll = jest.fn(() => ({ result: [{ id: 'r1' }] }));
    const index = jest.fn(() => ({ getAll }));
    const open = jest.fn(() => {
      const database = {
        close: jest.fn(),
        transaction: () => {
          const transaction = { objectStore: () => ({ index }) };
          Promise.resolve().then(() => transaction.oncomplete());
          return transaction;
        },
      };
      const request = { result: database };
      Promise.resolve().then(() => request.onsuccess());
      return request;
    });
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open } });
    let isolatedStorage;
    jest.isolateModules(() => { isolatedStorage = require('./storage'); });

    await expect(isolatedStorage.getAllByIndex('routines', 'profileId', 'p1')).resolves.toEqual([{ id: 'r1' }]);
    expect(index).toHaveBeenCalledWith('profileId');
    expect(getAll).toHaveBeenCalledWith('p1');
    expect(() => isolatedStorage.getAll('unknown')).toThrow('Unknown IndexedDB store');
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDB });
  });
});

describe('atomic IndexedDB batches', () => {
  let originalIndexedDB;
  let originalStructuredClone;
  let isolatedStorage;

  beforeEach(() => {
    originalIndexedDB = window.indexedDB;
    originalStructuredClone = global.structuredClone;
    global.structuredClone = value => JSON.parse(JSON.stringify(value));
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: new IDBFactory() });
    jest.isolateModules(() => { isolatedStorage = require('./storage'); });
  });

  afterEach(() => {
    global.structuredClone = originalStructuredClone;
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: originalIndexedDB });
  });

  it('commits records in multiple stores together', async () => {
    await isolatedStorage.applyBatch({ puts: {
      profiles: [{ id: 'p1', activeWorkoutRoutineId: 'r1' }],
      routines: [{ id: 'r1', profileId: 'p1' }],
    } });
    await expect(isolatedStorage.get('profiles', 'p1')).resolves.toMatchObject({ activeWorkoutRoutineId: 'r1' });
    await expect(isolatedStorage.get('routines', 'r1')).resolves.toMatchObject({ profileId: 'p1' });
  });

  it('aborts every store when a later request is invalid', async () => {
    await expect(isolatedStorage.applyBatch({ puts: {
      profiles: [{ id: 'p1' }],
      routines: [{ profileId: 'p1' }],
    } })).rejects.toBeTruthy();
    await expect(isolatedStorage.get('profiles', 'p1')).resolves.toBeUndefined();
  });

  it('does not partially import when a record in the final store fails', async () => {
    await expect(isolatedStorage.applyBatch({ puts: {
      profiles: [{ id: 'import-profile', unknownProfileField: true }],
      routines: [{ id: 'import-routine', profileId: 'import-profile', unknownRoutineField: true }],
      templates: [{ name: 'missing primary key' }],
    } })).rejects.toBeTruthy();
    await expect(isolatedStorage.get('profiles', 'import-profile')).resolves.toBeUndefined();
    await expect(isolatedStorage.get('routines', 'import-routine')).resolves.toBeUndefined();
  });

  it('does not partially delete a profile or its routines when a delete fails', async () => {
    await isolatedStorage.applyBatch({ puts: {
      profiles: [{ id: 'delete-profile' }],
      routines: [{ id: 'delete-routine', profileId: 'delete-profile' }],
    } });
    await expect(isolatedStorage.applyBatch({ deletes: {
      profiles: ['delete-profile'],
      routines: ['delete-routine', undefined],
    } })).rejects.toBeTruthy();
    await expect(isolatedStorage.get('profiles', 'delete-profile')).resolves.toEqual({ id: 'delete-profile' });
    await expect(isolatedStorage.get('routines', 'delete-routine')).resolves.toMatchObject({ profileId: 'delete-profile' });
  });

  it('does not activate a routine when creating that routine fails', async () => {
    await isolatedStorage.save('profiles', { id: 'create-profile', activeRoutineId: null });
    await expect(isolatedStorage.applyBatch({ puts: {
      profiles: [{ id: 'create-profile', activeRoutineId: 'new-routine' }],
      routines: [{ profileId: 'create-profile' }],
    } })).rejects.toBeTruthy();
    await expect(isolatedStorage.get('profiles', 'create-profile')).resolves.toMatchObject({ activeRoutineId: null });
  });

  it('aborts an import when a record changed after its preview', async () => {
    const previewed = { id: 'race-profile', name: 'Before', unknown: { retained: true } };
    await isolatedStorage.save('profiles', previewed);
    await isolatedStorage.save('profiles', { ...previewed, name: 'Changed while preview was open' });

    await expect(isolatedStorage.applyBatch({
      puts: { profiles: [{ ...previewed, importedOnly: true }] },
      conditions: { profiles: [{ key: previewed.id, expected: previewed }] },
    })).rejects.toMatchObject({ name: 'BatchConflictError' });
    await expect(isolatedStorage.get('profiles', previewed.id)).resolves.toEqual({
      ...previewed,
      name: 'Changed while preview was open',
    });
  });

  it('uses serialized-record semantics for conditional import guards', async () => {
    await isolatedStorage.save('profiles', {
      id: 'json-semantics', nested: { kept: true }, values: [null, null],
    });
    await expect(isolatedStorage.applyBatch({
      puts: { profiles: [{ id: 'json-semantics', committed: true }] },
      conditions: { profiles: [{
        key: 'json-semantics',
        expected: {
          values: [, undefined], id: 'json-semantics', nested: { omitted: undefined, kept: true },
        },
      }] },
    })).resolves.toBeUndefined();
    await expect(isolatedStorage.get('profiles', 'json-semantics')).resolves.toEqual({
      id: 'json-semantics', committed: true,
    });
  });

  it('deletes routines found through an index in the profile transaction', async () => {
    await isolatedStorage.applyBatch({ puts: {
      profiles: [{ id: 'indexed-delete' }],
      routines: [
        { id: 'known', profileId: 'indexed-delete' },
        { id: 'deferred', profileId: 'indexed-delete', unknown: true },
        { id: 'kept', profileId: 'other' },
      ],
    } });

    await isolatedStorage.applyBatch({
      deletes: { profiles: ['indexed-delete'] },
      deleteByIndex: { routines: [{ indexName: 'profileId', key: 'indexed-delete' }] },
    });

    await expect(isolatedStorage.get('profiles', 'indexed-delete')).resolves.toBeUndefined();
    await expect(isolatedStorage.get('routines', 'known')).resolves.toBeUndefined();
    await expect(isolatedStorage.get('routines', 'deferred')).resolves.toBeUndefined();
    await expect(isolatedStorage.get('routines', 'kept')).resolves.toMatchObject({ profileId: 'other' });
  });

  it('validates indexes used by atomic deletes', () => {
    expect(() => isolatedStorage.applyBatch({
      deleteByIndex: { profiles: [{ indexName: 'profileId', key: 'p1' }] },
    })).toThrow('Unknown IndexedDB index');
  });

  it('deletes only a removed profile\'s archive records in the same transaction', async () => {
    await isolatedStorage.applyBatch({ puts: {
      profiles: [{ id: 'p1' }],
      archives: [
        { id: 'routines:event', store: 'routines', record: { id: 'event', profileId: 'p1' } },
        { id: 'routines:other', store: 'routines', record: { id: 'other', profileId: 'p2' } },
      ],
    } });
    await isolatedStorage.applyBatch({
      deletes: { profiles: ['p1'] },
      deleteByIndex: { archives: [{ indexName: 'profileId', key: 'p1' }] },
    });
    await expect(isolatedStorage.get('profiles', 'p1')).resolves.toBeUndefined();
    await expect(isolatedStorage.getAll('archives')).resolves.toEqual([
      { id: 'routines:other', store: 'routines', record: { id: 'other', profileId: 'p2' } },
    ]);
  });

  it('rolls back profile deletion and archive changes if any archive write fails', async () => {
    const original = { id: 'routines:event', store: 'routines', record: { id: 'event', profileId: 'p1', unknown: true } };
    await isolatedStorage.applyBatch({ puts: { profiles: [{ id: 'p1' }], archives: [original] } });
    await expect(isolatedStorage.applyBatch({
      puts: { archives: [{ id: 'copy', record: original.record }, { record: original.record }] },
      deletes: { profiles: ['p1'] },
      deleteByIndex: { archives: [{ indexName: 'profileId', key: 'p1' }] },
    })).rejects.toBeTruthy();
    await expect(isolatedStorage.get('profiles', 'p1')).resolves.toEqual({ id: 'p1' });
    await expect(isolatedStorage.getAll('archives')).resolves.toEqual([original]);
  });
});
