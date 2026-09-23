import { IDBFactory } from 'fake-indexeddb';
import {
  addLiftProgressionModes, DATABASE_VERSION, runDatabaseMigrations,
} from './storageMigrations';
import {
  BACKUP_VERSION, backupMigrations, exportBackup, migrateBackup, parseBackup,
} from './storageBackup';

if (!global.structuredClone) {
  global.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const legacyRoutine = mode => ({
  id: `routine-${mode}`, profileId: 'p1', unknown: { kept: true },
  inputs: { maxProgressionMode: mode, maxSquat: '400', deadliftIncrement: '25', unknown: 'kept' },
  workouts: [
    { id: 'completed', completedAt: '2026-09-20', effectiveMaxes: { maxSquat: 400 },
      exercises: [{ id: 'squat', generated: { weight: '320' }, overrides: {} }],
      session: { status: 'completed', notes: 'Keep history', exercises: [] },
    },
    { id: 'pending', completedAt: null, effectiveMaxes: { maxSquat: 410 },
      exercises: [{ id: 'deadlift', generated: { weight: '400' }, overrides: { weight: '425' } }],
    },
  ],
});

describe('per-lift progression compatibility', () => {
  it.each(['same', 'fixed', 'adaptive'])('inherits the legacy %s mode without changing increments or workouts', mode => {
    const routine = legacyRoutine(mode);
    const before = JSON.stringify(routine);
    const migrated = addLiftProgressionModes(routine);

    expect(migrated.inputs).toEqual({ ...routine.inputs, liftProgressionModes: {} });
    expect(migrated.workouts).toBe(routine.workouts);
    expect(migrated.unknown).toBe(routine.unknown);
    expect(JSON.stringify(routine)).toBe(before);
    expect(addLiftProgressionModes(migrated)).toBe(migrated);
  });

  it('retains existing per-lift settings and unknown data without normalizing user records', () => {
    const record = { inputs: {
      maxProgressionMode: 'adaptive',
      liftProgressionModes: { squat: 'same', deadlift: 'fixed', futureLift: { method: 'custom' } },
    } };
    expect(addLiftProgressionModes(record)).toBe(record);
    const unknown = { id: 'extension', custom: { kept: true } };
    expect(addLiftProgressionModes(unknown)).toBe(unknown);
    [null, 'unrecognized', []].forEach(inputs => {
      const unrecognized = { id: 'unrecognized', inputs };
      expect(addLiftProgressionModes(unrecognized)).toBe(unrecognized);
    });
    const existingUnknownMap = { inputs: { liftProgressionModes: null } };
    expect(addLiftProgressionModes(existingUnknownMap)).toBe(existingUnknownMap);
  });

  it.each(Array.from({ length: 15 }, (_, index) => index + 1))('upgrades version %i backups while retaining their shared progression choice', version => {
    const routine = legacyRoutine('adaptive');
    const original = {
      format: 'mcilroy-method-backup', version, dataSchemaVersion: version,
      profiles: [{ id: 'p1', activeRoutineId: routine.id }], routines: [routine],
      templates: [{ id: 't1', inputs: { maxProgressionMode: 'same', unknown: true } }],
      archives: [], unknown: true,
    };
    const before = JSON.stringify(original);
    const migrated = migrateBackup(original);

    expect(migrated).toMatchObject({ version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION, unknown: true });
    expect(migrated.routines[0].inputs).toMatchObject({ ...routine.inputs, liftProgressionModes: {} });
    expect(migrated.templates[0].inputs).toMatchObject({ maxProgressionMode: 'same', liftProgressionModes: {}, unknown: true });
    expect(JSON.stringify(original)).toBe(before);
  });

  it('purely upgrades v15 backups and round-trips per-lift settings, archives, and snapshots', () => {
    const routine = legacyRoutine('adaptive');
    const configured = { ...legacyRoutine('fixed'), inputs: {
      maxProgressionMode: 'adaptive', liftProgressionModes: { deadlift: 'fixed', extension: 'keep' }, deadliftIncrement: '25',
    } };
    const unknown = { id: 'extension', unknown: ['Keep me'] };
    const template = { id: 't1', inputs: { maxProgressionMode: 'same', unknown: true } };
    const archive = { id: 'routines:retired', store: 'routines', record: legacyRoutine('same') };
    const original = {
      format: 'mcilroy-method-backup', version: 15, dataSchemaVersion: 15, unknown: { kept: true },
      profiles: [{ id: 'p1', activeRoutineId: routine.id }], routines: [routine, configured, unknown],
      templates: [template], archives: [archive],
    };
    const before = JSON.stringify(original);
    const migrated = migrateBackup(original);

    expect(migrated).toEqual({
      ...original, version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION,
      routines: [addLiftProgressionModes(routine), configured, unknown],
      templates: [addLiftProgressionModes(template)],
    });
    expect(migrated.routines[0].workouts).toBe(routine.workouts);
    expect(migrated.routines[1]).toBe(configured);
    expect(migrated.routines[2]).toBe(unknown);
    expect(migrated.archives).toBe(original.archives);
    expect(JSON.stringify(original)).toBe(before);
    expect(backupMigrations[16](original)).toEqual(migrated);
    const restored = parseBackup(exportBackup(migrated.profiles, migrated.routines, migrated.templates, migrated.archives));
    expect(restored.routines).toEqual(migrated.routines);
    expect(restored.templates).toEqual(migrated.templates);
    expect(restored.archives).toEqual(original.archives);
  });

  it('upgrades a deployed v15 database without changing workouts, profiles, archives, or existing lift choices', async () => {
    const indexedDB = new IDBFactory();
    const routines = ['same', 'fixed', 'adaptive'].map(legacyRoutine);
    const configured = { ...legacyRoutine('configured'), inputs: {
      maxProgressionMode: 'adaptive', liftProgressionModes: { deadlift: 'fixed', extension: 'keep' }, deadliftIncrement: '25',
    } };
    const unknown = { id: 'extension', unknown: ['Keep me'] };
    const template = { id: 't1', inputs: { maxProgressionMode: 'adaptive' }, unknown: true };
    const profile = { id: 'p1', activeRoutineId: routines[0].id, unknown: true };
    const archive = { id: 'routines:retired', store: 'routines', record: legacyRoutine('same') };
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('lift-progression-upgrade', 15);
      request.onupgradeneeded = () => {
        const database = request.result;
        ['profiles', 'routines', 'templates', 'archives'].forEach(name => database.createObjectStore(name, { keyPath: 'id' }));
        database.createObjectStore('metadata', { keyPath: 'key' });
        request.transaction.objectStore('routines').createIndex('profileId', 'profileId');
        request.transaction.objectStore('archives').createIndex('profileId', 'record.profileId');
        [...routines, configured, unknown].forEach(routine => request.transaction.objectStore('routines').put(routine));
        request.transaction.objectStore('profiles').put(profile);
        request.transaction.objectStore('templates').put(template);
        request.transaction.objectStore('archives').put(archive);
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lift-progression-upgrade', DATABASE_VERSION);
      request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const read = (store, id) => new Promise((resolve, reject) => {
      const request = database.transaction(store).objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    for (const routine of routines) {
      expect(await read('routines', routine.id)).toEqual(addLiftProgressionModes(routine));
    }
    expect(await read('routines', configured.id)).toEqual(configured);
    expect(await read('routines', unknown.id)).toEqual(unknown);
    expect(await read('templates', template.id)).toEqual(addLiftProgressionModes(template));
    expect(await read('profiles', profile.id)).toEqual(profile);
    expect(await read('archives', archive.id)).toEqual(archive);
    expect(await read('metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
    database.close();
  });
});
