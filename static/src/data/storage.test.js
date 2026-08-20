import { exportBackup, parseBackup } from './storage';
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
      version: 7,
      dataSchemaVersion: 7,
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
      version: 7,
      dataSchemaVersion: 7,
      templates: [],
      profiles: [{ id: 'p1', name: 'Alex', activeWorkoutRoutineId: null }],
    });
    expect(oldBackup.version).toBe(1);
  });

  it('upgrades version 4 backups and preserves unknown fields', () => {
    const oldBackup = {
      format: 'mcilroy-method-backup', version: 4, dataSchemaVersion: 4,
      profiles: [], routines: [], unknown: { retained: true },
    };

    expect(parseBackup(JSON.stringify(oldBackup))).toEqual({
      ...oldBackup, version: 7, dataSchemaVersion: 7, templates: [],
    });
  });

  it('upgrades version 5 session records without mutating unknown fields', () => {
    const oldBackup = {
      format: 'mcilroy-method-backup', version: 5, dataSchemaVersion: 5,
      profiles: [], templates: [], unknown: 'retained',
      routines: [{ id: 'r1', workouts: [{ session: { exercises: [{ unknown: true, sets: [{ status: 'skipped' }] }] } }] }],
    };
    const migrated = parseBackup(JSON.stringify(oldBackup));

    expect(migrated).toMatchObject({ version: 7, dataSchemaVersion: 7, unknown: 'retained' });
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
      { id: 'p1', activeWorkoutRoutineId: null, unknown: true },
    ]);
    expect(backup.profiles[0].activeWorkoutRoutineId).toBe('missing');
  });

  it('rejects unrelated JSON files', () => {
    expect(() => parseBackup('{"profiles":[]}')).toThrow('not a supported');
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
    await isolatedStorage.getAll('profiles');
    await isolatedStorage.getAll('routines');

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
});
