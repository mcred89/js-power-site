import { IDBFactory } from 'fake-indexeddb';
import { buildRoutinePlan } from './routineGeneration';
import { createRoutine } from './routines';
import { addWorkoutSourceWeeks } from './workoutScheduleIdentity';
import { DATABASE_VERSION, runDatabaseMigrations } from './storageMigrations';
import { BACKUP_VERSION, backupMigrations, exportBackup, migrateBackup, parseBackup } from './storageBackup';

if (!global.structuredClone) {
  global.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const inputs = {
  maxSquat: '300', maxPress: '150', maxDead: '400', mainLiftChoice: 'Low',
  duration: '5 weeks', includeStrongmanDay: true, mesoMode: false,
};
const legacyRoutine = options => {
  const routine = createRoutine('profile', 'Legacy plan', { ...inputs, ...options });
  return {
    ...routine,
    workouts: routine.workouts.map(({ sourceWeek, ...workout }) => workout),
  };
};

describe('workout training-stage identity', () => {
  it.each(['3 weeks', '5 weeks'])('identifies every prescribed stage in a %s plan', duration => {
    const generated = buildRoutinePlan({ ...inputs, duration })[0].weeks.flat();
    expect(generated.filter(day => day.name === 'Squat').map(day => day.sourceWeek)).toEqual([0, 1, 2, 3, 4]);
    expect(generated.filter(day => day.name === 'Press').map(day => day.sourceWeek)).toEqual([0, 1, 2, 3, 4]);
    expect(generated.filter(day => day.name === 'Deadlift').map(day => day.sourceWeek))
      .toEqual(duration === '3 weeks' ? [0, 2, 4] : [0, 1, 2, 3, 4]);
    expect(generated.filter(day => day.name === 'Strongman').map(day => day.sourceWeek))
      .toEqual(duration === '3 weeks' ? [1, 3, 4] : [0, 1, 2, 3, 4]);
    const saved = createRoutine('profile', 'New plan', { ...inputs, duration });
    expect(saved.workouts.map(workout => workout.sourceWeek)).toEqual(generated.map(day => day.sourceWeek));
  });

  it('retains all deadlift stages without a Strongman day', () => {
    const routine = createRoutine('profile', 'Three weeks', { ...inputs, duration: '3 weeks', includeStrongmanDay: false });
    expect(routine.workouts.filter(workout => workout.name === 'Deadlift').map(workout => workout.sourceWeek)).toEqual([0, 1, 2, 3, 4]);
  });

  it('reconstructs mixed cycles using original sequence numbers despite deleted workouts', () => {
    const original = legacyRoutine({ mesoMode: true, microCycles: [
      { duration: '5 weeks', volume: 'Low' }, { duration: '3 weeks', volume: 'High' },
    ] });
    original.workouts = original.workouts.filter(workout => ![2, 6, 21, 24].includes(workout.sequence));
    const before = JSON.stringify(original);
    const migrated = addWorkoutSourceWeeks(original);
    expect(migrated.workouts.map(workout => [workout.sequence, workout.sourceWeek])).toEqual([
      [1, 0], [3, 0], [4, 0], [5, 1], [7, 1], [8, 1],
      [9, 2], [10, 2], [11, 2], [12, 2], [13, 3], [14, 3], [15, 3], [16, 3],
      [17, 4], [18, 4], [19, 4], [20, 4],
      [22, 0], [23, 0], [25, 1], [26, 1], [27, 2], [28, 2], [29, 2],
      [30, 3], [31, 3], [32, 3], [33, 4], [34, 4], [35, 4], [36, 4],
    ]);
    expect(JSON.stringify(original)).toBe(before);
    expect(migrated.workouts[0].exercises).toBe(original.workouts[0].exercises);
    expect(addWorkoutSourceWeeks(migrated)).toBe(migrated);
  });

  it('preserves snapshots, existing identities, and records that cannot be identified safely', () => {
    const routine = legacyRoutine();
    const [first, second, third, fourth] = routine.workouts;
    const completed = { ...first, completedAt: '2026-01-01', session: { status: 'completed', notes: 'My history' }, unknown: true };
    const existing = { ...second, sourceWeek: 4 };
    const mismatchedWeek = { ...third, weekIndex: 4 };
    const mismatchedCycle = { ...fourth, cycleIndex: 2 };
    const custom = { ...first, id: 'custom', name: 'Custom day', unknown: { keep: true } };
    const outsideSchedule = { ...second, id: 'outside', sequence: 100 };
    const unknown = { id: 'unknown', extra: [1, 2, 3] };
    const original = { ...routine, workouts: [completed, existing, mismatchedWeek, mismatchedCycle, custom, outsideSchedule, unknown] };
    const before = JSON.stringify(original);
    const migrated = addWorkoutSourceWeeks(original);
    expect(migrated.workouts[0]).toEqual({ ...completed, sourceWeek: 0 });
    expect(migrated.workouts[0].session).toBe(completed.session);
    original.workouts.slice(1).forEach((workout, index) => expect(migrated.workouts[index + 1]).toBe(workout));
    expect(JSON.stringify(original)).toBe(before);
    const template = { id: 'template', inputs, unknown: true };
    const strongman = { ...routine, kind: 'strongman' };
    const customKind = { ...routine, kind: 'custom' };
    const unknownInputs = { ...routine, inputs: { ...inputs, duration: 'custom' } };
    [template, strongman, customKind, unknownInputs].forEach(record => expect(addWorkoutSourceWeeks(record)).toBe(record));
  });
});

describe('source-week migration compatibility', () => {
  it.each([16, 17, 18, 19, 20])('upgrades a version %i database without rewriting historical data', async oldVersion => {
    const factory = new IDBFactory();
    const original = legacyRoutine({ duration: '3 weeks' });
    original.workouts = original.workouts.filter(workout => workout.sequence !== 1);
    original.workouts[0] = { ...original.workouts[0], completedAt: '2026-01-01', unknown: true };
    const template = { id: 'template', inputs, unknown: true };
    const open = version => new Promise((resolve, reject) => {
      const request = factory.open(`source-week-${oldVersion}`, version);
      request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const oldDatabase = await open(oldVersion);
    await new Promise((resolve, reject) => {
      const transaction = oldDatabase.transaction(['routines', 'templates'], 'readwrite');
      transaction.objectStore('routines').put(original);
      transaction.objectStore('templates').put(template);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    oldDatabase.close();
    const database = await open(DATABASE_VERSION);
    const read = (store, id) => new Promise((resolve, reject) => {
      const request = database.transaction(store, 'readonly').objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const migrated = await read('routines', original.id);
    expect(migrated.workouts).toEqual(addWorkoutSourceWeeks(original).workouts);
    expect(await read('templates', template.id)).toMatchObject(template);
    expect(await read('metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
    database.close();
  });

  it('retains every intervening backup migration', () => {
    expect(Object.keys(backupMigrations).map(Number)).toEqual(Array.from({ length: BACKUP_VERSION - 1 }, (_, index) => index + 2));
  });

  it.each(Array.from({ length: 20 }, (_, index) => index + 1))('migrates version %i backups without mutating original workouts', version => {
    const routine = legacyRoutine({ duration: '3 weeks' });
    routine.workouts = routine.workouts.filter(workout => workout.sequence !== 4);
    const original = {
      format: 'mcilroy-method-backup', version, dataSchemaVersion: version,
      profiles: [{ id: 'profile' }], routines: [routine], templates: [], archives: [], unknown: { preserved: true },
    };
    const before = JSON.stringify(original);
    const migrated = migrateBackup(original);
    expect(migrated).toMatchObject({ version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION, unknown: original.unknown });
    expect(migrated.routines[0].workouts).toMatchObject(addWorkoutSourceWeeks(routine).workouts);
    expect(JSON.stringify(original)).toBe(before);
  });

  it('preserves unknown records and restores persisted identities from current backups', () => {
    const routine = legacyRoutine();
    const unknown = { id: 'custom', custom: { data: 'untouched' } };
    const template = { id: 'template', inputs, unknown: true };
    const original = {
      format: 'mcilroy-method-backup', version: 20, dataSchemaVersion: 20,
      profiles: [{ id: 'profile' }], routines: [routine, unknown], templates: [template], archives: [],
    };
    const migrated = migrateBackup(original);
    expect(migrated.routines[1]).toBe(unknown);
    expect(migrated.templates[0]).toBe(template);
    const restored = parseBackup(exportBackup(migrated.profiles, migrated.routines, migrated.templates));
    expect(restored.routines[0].workouts).toEqual(migrated.routines[0].workouts);
    expect(restored.routines[1]).toEqual(unknown);
  });
});
