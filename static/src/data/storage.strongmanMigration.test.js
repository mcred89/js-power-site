import { IDBFactory } from 'fake-indexeddb';
import { addStrongmanTracking, createStrongmanLogEntry } from './strongman';
import { DATABASE_VERSION, runDatabaseMigrations } from './storageMigrations';
import { BACKUP_VERSION, exportBackup, migrateBackup, parseBackup } from './storageBackup';

if (!global.structuredClone) global.structuredClone = value => JSON.parse(JSON.stringify(value));

const routine = { id: 'r1', profileId: 'p1', inputs: { includeStrongmanDay: true, unknown: true },
  workouts: [{ id: 'completed', completedAt: '2026-01-01', exercises: [{ generated: { movement: 'Strongman day' } }],
    session: { status: 'completed', exercises: [], unknown: true } }], unknown: { preserved: true } };
const archive = { id: 'routines:old', store: 'routines', record: { kind: 'strongman', inputs: { events: ['legacy'] } } };

describe('strongman tracking migration', () => {
  it.each(Array.from({ length: 16 }, (_, index) => index + 1))('purely upgrades v%i backups and retains historical snapshots', version => {
    const original = { format: 'mcilroy-method-backup', version, dataSchemaVersion: version,
      profiles: [{ id: 'p1' }], routines: [routine], templates: [{ id: 't1', inputs: {} }], archives: [archive],
      extension: { future: true } };
    const before = JSON.stringify(original);
    const migrated = migrateBackup(original);
    expect(migrated).toMatchObject({ version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION,
      extension: { future: true }, routines: [{ strongmanLog: [], inputs: { strongmanCompetition: null, unknown: true } }],
      templates: [{ inputs: { strongmanCompetition: null } }], archives: [archive] });
    expect(migrated.routines[0].workouts[0].completedAt).toBe('2026-01-01');
    expect(migrated.routines[0].workouts[0].session.unknown).toBe(true);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('round-trips current competition, actual results and opaque archived data', () => {
    const saved = { ...routine, inputs: { ...routine.inputs, strongmanCompetition: {
      name: 'Next meet', date: '', events: [{ id: 'event', name: 'Carry medley', type: 'medley', components: [], unknown: true }],
    } }, strongmanLog: [createStrongmanLogEntry({ date: '2026-01-01', movement: 'Yoke', sets: [{ weight: 580, distance: 50 }] })] };
    const restored = parseBackup(exportBackup([{ id: 'p1' }], [saved], [], [archive]));
    expect(restored.routines).toEqual([saved]);
    expect(restored.archives).toEqual([archive]);
  });

  it('rejects malformed known strongman data before importing without altering the source', () => {
    const saved = { ...routine, strongmanLog: [createStrongmanLogEntry({ date: '2026-01-01',
      movement: 'Yoke', sets: [{ weight: 580, distance: 50 }] })] };
    saved.strongmanLog[0].sets[0].weight = -100;
    const contents = exportBackup([{ id: 'p1' }], [saved]);
    expect(() => parseBackup(contents)).toThrow('invalid strongman data');
    expect(saved.strongmanLog[0].sets[0].weight).toBe(-100);
  });

  it('rejects non-text display fields before an imported record can break the training screen', () => {
    const saved = { ...routine, strongmanLog: [createStrongmanLogEntry({ date: '2026-01-01',
      movement: 'Yoke', sets: [{ weight: 580, distance: 50 }] })] };
    saved.strongmanLog[0].notes = { invalid: true };
    expect(() => parseBackup(exportBackup([{ id: 'p1' }], [saved]))).toThrow('notes must be text');
    expect(() => parseBackup(exportBackup([{ id: 'p1' }], [{ ...routine, inputs: {
      ...routine.inputs, strongmanCompetition: { name: { invalid: true }, events: [] },
    } }]))).toThrow('text competition name');
  });

  it.each([undefined, null, '', ' ', 7])('rejects saved competition and snapshot IDs of %p without repairing the source', id => {
    ['competition', 'snapshot'].forEach(location => {
      ['event', 'component'].forEach(target => {
        const event = { id: 'event', name: 'Carry medley', type: 'medley',
          components: [{ id: 'bag', name: 'Sandbag', weight: 200, distance: 50 }] };
        if (target === 'event') event.id = id;
        else event.components[0].id = id;
        const saved = location === 'competition' ? {
          ...routine, inputs: { ...routine.inputs, strongmanCompetition: { events: [event] } },
        } : {
          ...routine, strongmanLog: [{ id: 'entry', date: '2026-01-01', movement: 'Carry medley',
            scope: 'medley', eventSnapshot: event, sets: [{ id: 'set', seconds: 42 }] }],
        };
        const before = JSON.stringify(saved);
        expect(() => parseBackup(exportBackup([{ id: 'p1' }], [saved]))).toThrow('nonempty text ID');
        expect(JSON.stringify(saved)).toBe(before);
      });
    });
  });

  it('rejects IDs shared across competition events and implements', () => {
    const event = { id: 'event', name: 'Carry medley', type: 'medley', components: [
      { id: 'bag', name: 'Sandbag' }, { id: 'yoke', name: 'Yoke' },
    ] };
    const eventsWithDuplicate = [
      [event, { id: 'event', name: 'Log press' }],
      [event, { id: 'bag', name: 'Log press' }],
      [{ ...event, components: [{ id: 'bag', name: 'Sandbag' }, { id: 'bag', name: 'Yoke' }] }],
    ];
    eventsWithDuplicate.forEach(events => {
      const saved = { ...routine, inputs: { ...routine.inputs, strongmanCompetition: { events } } };
      expect(() => parseBackup(exportBackup([{ id: 'p1' }], [saved]))).toThrow('own ID');
    });
  });

  it('preserves legacy medley results with hidden metrics and no time when importing', () => {
    const entry = createStrongmanLogEntry({ date: '2026-01-01', movement: 'Carry medley', scope: 'medley',
      eventSnapshot: { id: 'event', name: 'Carry medley', type: 'medley', components: [] },
      sets: [{ seconds: 42 }] });
    const untimed = { ...entry, id: 'untimed', sets: [{ ...entry.sets[0], weight: 500, seconds: '' }] };
    const timed = { ...entry, sets: [{ ...entry.sets[0], reps: 0, extension: { preserved: true } }] };
    const saved = { ...routine, strongmanLog: [untimed, timed] };
    const restored = parseBackup(exportBackup([{ id: 'p1' }], [saved]));
    expect(restored.routines[0]).toEqual(saved);
  });

  it.each([0, 16])('creates or upgrades a v%i database with v17 containers and untouched snapshots', async oldVersion => {
    const indexedDB = new IDBFactory();
    const name = `strongman-migration-${oldVersion}`;
    if (oldVersion) await new Promise((resolve, reject) => {
      const request = indexedDB.open(name, oldVersion);
      request.onupgradeneeded = () => {
        ['profiles', 'routines', 'templates', 'archives'].forEach(store => request.result.createObjectStore(store, { keyPath: 'id' }));
        request.result.createObjectStore('metadata', { keyPath: 'key' });
        request.transaction.objectStore('routines').createIndex('profileId', 'profileId');
        request.transaction.objectStore('archives').createIndex('profileId', 'record.profileId');
        request.transaction.objectStore('routines').put(routine);
        request.transaction.objectStore('templates').put({ id: 't1', inputs: {} });
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
    expect(database.objectStoreNames.contains('archives')).toBe(true);
    expect(await read('metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
    if (oldVersion) {
      expect(await read('routines', 'r1')).toEqual(addStrongmanTracking(routine));
      expect(await read('templates', 't1')).toEqual({ id: 't1', inputs: { strongmanCompetition: null } });
      expect(await read('archives', archive.id)).toEqual(archive);
    }
    database.close();
  });
});
