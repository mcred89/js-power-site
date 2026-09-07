import { IDBFactory } from 'fake-indexeddb';
import { addTabataTimers } from './tabataSessionMigration';
import { DATABASE_VERSION, runDatabaseMigrations } from './storageMigrations';
import { BACKUP_VERSION, exportBackup, migrateBackup, parseBackup } from './storageBackup';

if (!global.structuredClone) {
  global.structuredClone = value => JSON.parse(JSON.stringify(value));
}

const legacyExercise = () => ({
  exerciseId: 'tabata',
  movement: 'Tabata sprints',
  prescription: '8 rounds: 20 seconds sprint / 10 seconds rest',
  plannedWeight: '',
  original: null,
  substitutedAt: null,
  notes: 'Keep this exercise note',
  sets: Array.from({ length: 8 }, (_, index) => ({
    id: `round-${index + 1}`,
    number: index + 1,
    plannedWeight: '',
    plannedReps: '',
    actualWeight: '',
    actualReps: '',
    status: 'pending',
    completedAt: null,
    skippedAt: null,
    skipActionId: null,
    splitSeconds: null,
  })),
});

const routineWith = (exercise = legacyExercise()) => ({
  id: 'r1',
  profileId: 'p1',
  inputs: { squatTabataEnabled: true, squatEventEnabled: true },
  unknown: { preserved: true },
  workouts: [{
    id: 'w1',
    completedAt: null,
    exercises: [{ id: 'tabata', generated: { movement: 'Tabata sprints' }, overrides: {} }],
    session: { status: 'inProgress', notes: 'Keep this session note', exercises: [exercise] },
  }],
});

const exerciseFor = routine => routine.workouts[0].session.exercises[0];

it('migrates only untouched legacy round placeholders to one set and preserves first identity', () => {
  const routine = routineWith();
  const serialized = JSON.stringify(routine);
  const migrated = addTabataTimers(routine);
  expect(exerciseFor(migrated)).toEqual({
    ...exerciseFor(routine),
    sets: [{ ...exerciseFor(routine).sets[0], tabataTimer: null }],
  });
  expect(migrated.unknown).toBe(routine.unknown);
  expect(migrated.workouts[0].exercises).toBe(routine.workouts[0].exercises);
  expect(migrated.workouts[0].session.notes).toBe('Keep this session note');
  expect(JSON.stringify(routine)).toBe(serialized);
  expect(addTabataTimers(migrated)).toBe(migrated);
});

it.each([
  ['completed rounds', set => ({ ...set, status: 'completed', completedAt: '2026-09-07T12:00:00.000Z', splitSeconds: 30 })],
  ['skipped rounds', set => ({ ...set, status: 'skipped', skippedAt: '2026-09-07T12:00:00.000Z', skipActionId: 'skip-1' })],
  ['unknown per-round data', set => ({ ...set, personalNote: 'Do not lose me' })],
  ['changed weights', set => ({ ...set, actualWeight: 20 })],
  ['changed reps', set => ({ ...set, actualReps: 3 })],
  ['earlier action timestamps', set => ({ ...set, completedAt: '2026-09-07T12:00:00.000Z' })],
])('preserves all old round records when they contain %s', (label, change) => {
  const exercise = legacyExercise();
  exercise.sets[2] = change(exercise.sets[2]);
  const routine = routineWith(exercise);
  expect(addTabataTimers(routine)).toBe(routine);
  expect(exerciseFor(routine).sets).toHaveLength(8);
});

it.each(['inProgress', 'paused'])('migrates untouched Tabata in a %s session', status => {
  const routine = routineWith();
  routine.workouts[0].session.status = status;
  expect(exerciseFor(addTabataTimers(routine)).sets).toHaveLength(1);
});

it('preserves completed workout and completed session snapshots exactly', () => {
  const completedWorkout = routineWith();
  completedWorkout.workouts[0].completedAt = '2026-09-07T12:00:00.000Z';
  expect(addTabataTimers(completedWorkout)).toBe(completedWorkout);
  const completedSession = routineWith();
  completedSession.workouts[0].session.status = 'completed';
  expect(addTabataTimers(completedSession)).toBe(completedSession);
});

it('adds a missing timer to a single pending finisher without overwriting timer or custom data', () => {
  const exercise = legacyExercise();
  exercise.sets = [{ ...exercise.sets[0], personalNote: 'Keep this note' }];
  const migrated = addTabataTimers(routineWith(exercise));
  expect(exerciseFor(migrated).sets).toEqual([{ ...exercise.sets[0], tabataTimer: null }]);
  const timer = { elapsedMs: 73000, runningSince: '2026-09-07T12:01:30.000Z' };
  exercise.sets[0].tabataTimer = timer;
  const routine = routineWith(exercise);
  expect(addTabataTimers(routine)).toBe(routine);
  expect(exerciseFor(routine).sets[0].tabataTimer).toBe(timer);
});

it('preserves unknown records, other prescriptions, and partially removed round arrays', () => {
  const unknown = { id: 'custom', unknown: true };
  expect(addTabataTimers(unknown)).toBe(unknown);
  const generic = routineWith({ ...legacyExercise(), prescription: '3 × 10' });
  expect(addTabataTimers(generic)).toBe(generic);
  const exercise = legacyExercise();
  exercise.sets.pop();
  const shortened = routineWith(exercise);
  expect(addTabataTimers(shortened)).toBe(shortened);
});

it('upgrades v13 backups purely and round-trips persisted timer state and unknown records', () => {
  const routine = routineWith();
  const archive = { id: 'routines:old', store: 'routines', record: { ...routine, id: 'old' } };
  const unknown = { id: 'custom', unknown: ['Keep me'] };
  const original = {
    format: 'mcilroy-method-backup', version: 13, dataSchemaVersion: 13,
    profiles: [{ id: 'p1', activeRoutineId: 'r1' }],
    routines: [routine, unknown], templates: [{ id: 't1', unknown: true }],
    archives: [archive], unknown: { preserved: true },
  };
  const serialized = JSON.stringify(original);
  const migrated = migrateBackup(original);
  expect(migrated).toEqual({
    ...original,
    version: BACKUP_VERSION,
    dataSchemaVersion: DATABASE_VERSION,
    routines: [addTabataTimers(routine), unknown],
  });
  expect(migrated.archives).toBe(original.archives);
  expect(JSON.stringify(original)).toBe(serialized);
  exerciseFor(migrated.routines[0]).sets[0].tabataTimer = {
    elapsedMs: 83000, runningSince: '2026-09-07T12:02:00.000Z',
  };
  const restored = parseBackup(exportBackup(migrated.profiles, migrated.routines, migrated.templates, migrated.archives));
  expect(restored.routines).toEqual(migrated.routines);
  expect(restored.archives).toEqual(original.archives);
});

it('upgrades a deployed v13 IndexedDB while retaining mixed history and unrelated stores', async () => {
  const indexedDB = new IDBFactory();
  const routine = routineWith();
  const mixedExercise = legacyExercise();
  mixedExercise.sets[0] = { ...mixedExercise.sets[0], status: 'completed', completedAt: '2026-09-07T12:00:00.000Z', splitSeconds: 30 };
  const mixed = { ...routineWith(mixedExercise), id: 'mixed' };
  const archive = { id: 'routines:old', store: 'routines', record: mixed };
  const template = { id: 't1', inputs: { squatTabataEnabled: true }, unknown: true };
  const profile = { id: 'p1', activeRoutineId: 'r1', unknown: true };
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('tabata-timer-upgrade', 13);
    request.onupgradeneeded = () => {
      const database = request.result;
      ['profiles', 'routines', 'templates', 'archives'].forEach(name => database.createObjectStore(name, { keyPath: 'id' }));
      database.createObjectStore('metadata', { keyPath: 'key' });
      request.transaction.objectStore('routines').createIndex('profileId', 'profileId');
      request.transaction.objectStore('archives').createIndex('profileId', 'record.profileId');
      request.transaction.objectStore('routines').put(routine);
      request.transaction.objectStore('routines').put(mixed);
      request.transaction.objectStore('profiles').put(profile);
      request.transaction.objectStore('templates').put(template);
      request.transaction.objectStore('archives').put(archive);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('tabata-timer-upgrade', DATABASE_VERSION);
    request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, event.newVersion);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  const read = (store, id) => new Promise((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  expect(await read('routines', 'r1')).toEqual(addTabataTimers(routine));
  expect(await read('routines', 'mixed')).toEqual(mixed);
  expect(await read('profiles', 'p1')).toEqual(profile);
  expect(await read('templates', 't1')).toEqual(template);
  expect(await read('archives', archive.id)).toEqual(archive);
  expect(await read('metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
  database.close();
});
