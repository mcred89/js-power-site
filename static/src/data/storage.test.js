import { exportBackup, parseBackup } from './storage';

describe('portable backups', () => {
  it('round trips profiles, routines, and templates', () => {
    const profiles = [{ id: 'p1', name: 'Alex' }];
    const routines = [{ id: 'r1', profileId: 'p1', name: 'Plan' }];
    const templates = [{ id: 't1', name: 'Meet prep', inputs: { maxSquat: '315' } }];

    expect(parseBackup(exportBackup(profiles, routines, templates))).toMatchObject({
      profiles,
      routines,
      templates,
      version: 6,
      dataSchemaVersion: 6,
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
      version: 6,
      dataSchemaVersion: 6,
      templates: [],
    });
    expect(oldBackup.version).toBe(1);
  });

  it('upgrades version 4 backups and preserves unknown fields', () => {
    const oldBackup = {
      format: 'mcilroy-method-backup', version: 4, dataSchemaVersion: 4,
      profiles: [], routines: [], unknown: { retained: true },
    };

    expect(parseBackup(JSON.stringify(oldBackup))).toEqual({
      ...oldBackup, version: 6, dataSchemaVersion: 6, templates: [],
    });
  });

  it('upgrades version 5 session records without mutating unknown fields', () => {
    const oldBackup = {
      format: 'mcilroy-method-backup', version: 5, dataSchemaVersion: 5,
      profiles: [], templates: [], unknown: 'retained',
      routines: [{ id: 'r1', workouts: [{ session: { exercises: [{ unknown: true, sets: [{ status: 'skipped' }] }] } }] }],
    };
    const migrated = parseBackup(JSON.stringify(oldBackup));

    expect(migrated).toMatchObject({ version: 6, dataSchemaVersion: 6, unknown: 'retained' });
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
});
