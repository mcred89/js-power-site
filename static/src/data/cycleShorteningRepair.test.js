import { IDBFactory } from 'fake-indexeddb';
import { createRoutine } from './routines';
import { correctMaxes, refreshAdaptiveProgression } from './routineRecalculation';
import { updateRoutinePlan } from './routineUpdates';
import { deleteFutureWorkout } from './workoutActions';
import { repairShortenedCycles } from './cycleShorteningRepair';
import { DATABASE_VERSION, runDatabaseMigrations } from './storageMigrations';
import { BACKUP_VERSION, exportBackup, migrateBackup, parseBackup } from './storageBackup';

if (!global.structuredClone) global.structuredClone = value => JSON.parse(JSON.stringify(value));

const inputs = {
  maxSquat: '300', maxPress: '200', maxDead: '400', mainLiftChoice: 'Low',
  duration: '5 weeks', includeStrongmanDay: true, mesoMode: false,
};
const find = (routine, name, sourceWeek, cycleIndex = 0) => routine.workouts.find(workout => (
  workout.cycleIndex === cycleIndex && workout.name === name && workout.sourceWeek === sourceWeek
));
const pending = (routine, cycleIndex = 0) => routine.workouts.filter(workout => (
  workout.cycleIndex === cycleIndex && !workout.completedAt
));

// Reproduce the shipped v21 transform directly. Using updateRoutinePlan here
// would accidentally create fixtures with the corrected implementation.
const brokenRoutine = (completedWeeks = 3, overrides = {}, cycleIndex = 0, beforeShortening = () => {}) => {
  const routine = createRoutine('profile', 'Already shortened', { ...inputs, ...overrides });
  routine.workouts.forEach(workout => {
    if (workout.cycleIndex < cycleIndex || (workout.cycleIndex === cycleIndex && workout.sourceWeek < completedWeeks)) {
      workout.completedAt = '2026-09-30T12:00:00.000Z';
    }
  });
  beforeShortening(routine);
  const logged = new Set((routine.strongmanLog || []).map(entry => entry.workoutId));
  return {
    ...routine,
    inputs: routine.inputs.mesoMode ? {
      ...routine.inputs,
      microCycles: routine.inputs.microCycles.map((cycle, index) => index === cycleIndex ? { ...cycle, duration: '3 weeks' } : cycle),
    } : { ...routine.inputs, duration: '3 weeks' },
    workouts: routine.workouts.flatMap(workout => {
      if (workout.cycleIndex !== cycleIndex || workout.completedAt || workout.skippedAt || workout.session || logged.has(workout.id)) return [workout];
      if (routine.inputs.includeStrongmanDay && (
        (workout.name === 'Deadlift' && [1, 3].includes(workout.sourceWeek)) ||
        (workout.name === 'Strongman' && [0, 2].includes(workout.sourceWeek))
      )) return [];
      const weekIndex = Math.floor(workout.sourceWeek / 2);
      return [{ ...workout, weekIndex, weekLabel: `Week ${weekIndex + 1}` }];
    }),
  };
};

it('repairs the reported three completed weeks into one six-day Week 4, with deterministic restoration', () => {
  const original = brokenRoutine();
  const before = JSON.stringify(original);
  expect(pending(original).map(workout => workout.name)).toEqual(['Squat', 'Press', 'Strongman', 'Squat', 'Press', 'Deadlift', 'Strongman']);
  const repaired = repairShortenedCycles(original);
  expect(pending(repaired).map(workout => [workout.name, workout.sourceWeek, workout.weekIndex])).toEqual([
    ['Squat', 3, 3], ['Press', 3, 3], ['Deadlift', 3, 3], ['Squat', 4, 3], ['Press', 4, 3], ['Strongman', 4, 3],
  ]);
  expect(find(repaired, 'Deadlift', 3)).toMatchObject({ sequence: 15, weekLabel: 'Week 4', exercises: [{
    generated: { movement: 'Deadlift', weight: 320, prescription: '4 × 3' }, overrides: {},
  }] });
  original.workouts.filter(workout => workout.completedAt).forEach(workout => {
    expect(repaired.workouts.find(item => item.id === workout.id)).toBe(workout);
  });
  expect(repaired.updatedAt).toBe(original.updatedAt);
  expect(repaired.cycleWeekGroups).toEqual({ 0: [[0], [1], [2], [3, 4]] });
  expect(repaired.shorteningRepair.removedWorkouts).toEqual([find(original, 'Strongman', 3), find(original, 'Deadlift', 4)]);
  expect(repaired.shorteningRepair.restoredWorkoutIds).toEqual([find(repaired, 'Deadlift', 3).id]);
  expect(repairShortenedCycles(original)).toEqual(repaired);
  expect(repairShortenedCycles(repaired)).toBe(repaired);
  expect(JSON.stringify(original)).toBe(before);
});

it.each([1, 2, 4])('reconstructs the remaining groups after %i original completed weeks', completedWeeks => {
  const original = brokenRoutine(completedWeeks);
  const repaired = repairShortenedCycles(original);
  const weeks = new Map();
  pending(repaired).forEach(workout => {
    if (!weeks.has(workout.weekIndex)) weeks.set(workout.weekIndex, []);
    weeks.get(workout.weekIndex).push(workout.name);
  });
  expect([...weeks.values()]).toEqual(completedWeeks === 1 ? [
    ['Squat', 'Press', 'Deadlift', 'Squat', 'Press', 'Strongman'],
    ['Squat', 'Press', 'Deadlift', 'Squat', 'Press', 'Strongman'],
  ] : completedWeeks === 2 ? [
    ['Squat', 'Press', 'Deadlift', 'Squat', 'Press', 'Strongman'],
    ['Squat', 'Press', 'Deadlift', 'Strongman'],
  ] : [['Squat', 'Press', 'Deadlift', 'Strongman']]);
});

it('uses the final-cycle offset and an untouched donor max, retaining prior cycles and customized removed work', () => {
  const original = brokenRoutine(3, { mesoMode: true, maxProgressionMode: 'adaptive', microCycles: [
    { duration: '3 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'High' },
  ] }, 1);
  const donor = find(original, 'Deadlift', 4, 1);
  donor.effectiveMaxes.maxDead = 500;
  donor.exercises[0].overrides = { weight: '123' };
  donor.custom = { notes: 'Keep my future customization available' };
  const repaired = repairShortenedCycles(original);
  expect(repaired.workouts.filter(workout => workout.cycleIndex === 0)).toEqual(original.workouts.filter(workout => workout.cycleIndex === 0));
  expect(find(repaired, 'Deadlift', 3, 1)).toMatchObject({ sequence: 31, effectiveMaxes: { maxDead: 500 },
    exercises: [{ generated: { weight: 350, prescription: '5 × 7' } }],
  });
  expect(repaired.shorteningRepair.removedWorkouts).toContain(donor);
  expect(repaired.shorteningRepair.removedWorkouts.find(workout => workout.id === donor.id).custom).toBe(donor.custom);
});

it('protects activity begun after the faulty update without using it to advance the original boundary', () => {
  const original = brokenRoutine();
  const squat = find(original, 'Squat', 3);
  squat.session = { status: 'inProgress', extra: 'keep' };
  const press = find(original, 'Press', 3);
  press.skippedAt = '2026-10-01';
  const deadlift = find(original, 'Deadlift', 4);
  deadlift.completedAt = '2026-10-02';
  const strongman = find(original, 'Strongman', 3);
  original.strongmanLog = [{ id: 'effort', workoutId: strongman.id, note: 'Logged after the bad conversion' }];
  const repaired = repairShortenedCycles(original);
  [squat, press, deadlift, strongman].forEach(workout => expect(repaired.workouts.find(item => item.id === workout.id)).toBe(workout));
  expect(repaired.strongmanLog).toBe(original.strongmanLog);
  expect(find(repaired, 'Deadlift', 3).weekIndex).toBe(3);
  expect(repaired.cycleWeekGroups[0]).toEqual([[0], [1], [2], [3, 4]]);
});

it.each(['started', 'completed', 'logged'])('recovers an erased deadlift inside the original active week after %s activity', activity => {
  const original = brokenRoutine(3, {}, 0, routine => {
    if (activity === 'logged') {
      routine.strongmanLog = [{ id: 'effort', workoutId: find(routine, 'Strongman', 3).id, note: 'Original Week 4' }];
    } else {
      const squat = find(routine, 'Squat', 3);
      if (activity === 'started') squat.session = { status: 'inProgress', startedAt: '2026-10-01', custom: true };
      else squat.completedAt = '2026-10-01';
    }
  });
  expect(find(original, 'Deadlift', 3)).toBeUndefined();
  const repaired = repairShortenedCycles(original);
  expect(find(repaired, 'Deadlift', 3)).toMatchObject({ weekIndex: 3, sequence: 15,
    exercises: [{ generated: { movement: 'Deadlift', weight: 320, prescription: '4 × 3' } }],
  });
  expect(find(repaired, 'Deadlift', 4)).toBeDefined();
  const protectedIds = new Set((original.strongmanLog || []).map(entry => entry.workoutId));
  original.workouts.filter(workout => workout.completedAt || workout.session || protectedIds.has(workout.id))
    .forEach(workout => expect(repaired.workouts.find(candidate => candidate.id === workout.id)).toBe(workout));
});

it('restores an erased Strongman day in the partially completed third week before combining weeks four and five', () => {
  const original = brokenRoutine(2, {}, 0, routine => {
    find(routine, 'Squat', 2).completedAt = '2026-10-01';
  });
  expect(find(original, 'Strongman', 2)).toBeUndefined();
  const repaired = repairShortenedCycles(original);
  expect(pending(repaired).map(workout => [workout.name, workout.weekIndex])).toEqual([
    ['Press', 2], ['Deadlift', 2], ['Strongman', 2],
    ['Squat', 3], ['Press', 3], ['Deadlift', 3], ['Squat', 3], ['Press', 3], ['Strongman', 3],
  ]);
});

it('does not fill a fully settled historical gap indistinguishable from a deliberate deletion', () => {
  const original = brokenRoutine(3);
  original.workouts = original.workouts.filter(workout => !(workout.name === 'Deadlift' && workout.sourceWeek === 1));
  const repaired = repairShortenedCycles(original);
  expect(find(repaired, 'Deadlift', 1)).toBeUndefined();
  expect(find(repaired, 'Deadlift', 3)).toBeDefined();
});

it.each([
  [2, ['Squat', 'Press', 'Deadlift'], 'Strongman'],
  [3, ['Squat', 'Press', 'Strongman'], 'Deadlift'],
])('recovers an erased final day of original source %i when its surviving days were already settled', (sourceWeek, completedNames, missingName) => {
  const original = brokenRoutine(sourceWeek, {}, 0, routine => {
    completedNames.forEach(name => { find(routine, name, sourceWeek).completedAt = '2026-10-01'; });
  });
  expect(find(original, missingName, sourceWeek)).toBeUndefined();
  const repaired = repairShortenedCycles(original);
  expect(find(repaired, missingName, sourceWeek)).toMatchObject({ weekIndex: sourceWeek, completedAt: null, session: null });
  original.workouts.filter(workout => workout.completedAt).forEach(workout => {
    expect(repaired.workouts.find(candidate => candidate.id === workout.id)).toBe(workout);
  });
});

it('uses the nearest later protected lift snapshot when every remaining bad projection has since been recorded', () => {
  const original = brokenRoutine(3, { mesoMode: true, maxProgressionMode: 'adaptive', microCycles: [
    { duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' },
  ] }, 1);
  pending(original, 1).forEach(workout => {
    workout.completedAt = '2026-10-02';
    workout.effectiveMaxes = { ...workout.effectiveMaxes, maxDead: 500 };
  });
  const repaired = repairShortenedCycles(original);
  expect(find(repaired, 'Deadlift', 3, 1)).toMatchObject({ effectiveMaxes: { maxDead: 500 },
    exercises: [{ generated: { weight: 400, prescription: '4 × 3' } }],
  });
  original.workouts.forEach(workout => expect(repaired.workouts.find(candidate => candidate.id === workout.id)).toBe(workout));
});

it('preserves unknown records and unrelated deletion gaps, and never re-adds a workout deleted after repair', () => {
  const original = brokenRoutine();
  const deletedPress = find(original, 'Press', 4);
  original.workouts = original.workouts.filter(workout => workout !== deletedPress);
  const duplicate = { ...find(original, 'Squat', 3), id: 'duplicate', sequence: 99, extra: true };
  const unknown = { id: 'unknown', cycleIndex: 0, custom: 'Keep' };
  original.workouts.push(duplicate, unknown);
  const repaired = repairShortenedCycles(original);
  expect(find(repaired, 'Press', 4)).toBeUndefined();
  expect(repaired.workouts).toContain(duplicate);
  expect(repaired.workouts).toContain(unknown);
  const removedAgain = deleteFutureWorkout(repaired, find(repaired, 'Deadlift', 3).id);
  expect(repairShortenedCycles(removedAgain)).toBe(removedAgain);
  expect(find(correctMaxes(removedAgain, { maxDead: '500' }), 'Deadlift', 3)).toBeUndefined();
});

it('keeps restored stage 3 deadlifts responsive to max correction, plan updates and adaptive refresh', () => {
  const repaired = repairShortenedCycles(brokenRoutine());
  const deadlift = find(repaired, 'Deadlift', 3);
  const corrected = correctMaxes(repaired, { maxDead: '500' });
  expect(find(corrected, 'Deadlift', 3).id).toBe(deadlift.id);
  expect(find(corrected, 'Deadlift', 3).exercises[0].generated.weight).toBe(400);
  const edited = updateRoutinePlan(corrected, { includeBackoffSets: true });
  expect(find(edited, 'Deadlift', 3).exercises).toHaveLength(4);
  expect(edited.workouts.map(workout => workout.id)).toEqual(repaired.workouts.map(workout => workout.id));
  const adaptive = repairShortenedCycles(brokenRoutine(3, { mesoMode: true, maxProgressionMode: 'adaptive', microCycles: [
    { duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' },
  ] }, 1));
  expect(refreshAdaptiveProgression(adaptive).routine.workouts.map(workout => workout.id)).toEqual(adaptive.workouts.map(workout => workout.id));
  expect(find(refreshAdaptiveProgression(adaptive).routine, 'Deadlift', 3, 1)).toBeDefined();
});

it('leaves native three-week plans, unchanged five-week plans and ambiguous imported shapes alone', () => {
  const native = createRoutine('profile', 'Native', { ...inputs, duration: '3 weeks' });
  native.workouts.slice(0, 9).forEach(workout => { workout.completedAt = '2026-09-30'; });
  const malformed = brokenRoutine();
  malformed.workouts.find(workout => !workout.completedAt).sequence = 999;
  const unknown = { id: 'unknown', inputs: {}, workouts: [], custom: true };
  [native, createRoutine('profile', 'Five', inputs), malformed, unknown, null,
    createRoutine('profile', 'Native without Strongman', { ...inputs, duration: '3 weeks', includeStrongmanDay: false }),
    { ...brokenRoutine(), kind: 'custom' }, { ...brokenRoutine(), inputs: { ...inputs, mainLiftChoice: 'unknown' } },
  ].forEach(record => expect(repairShortenedCycles(record)).toBe(record));
});

it('preserves unknown repair metadata and leaves custom queue collisions unchanged', () => {
  const conflict = brokenRoutine();
  conflict.workouts.push({ id: 'custom', name: 'My custom day', cycleIndex: 0, sequence: 15 });
  const unknownMetadata = { ...brokenRoutine(), shorteningRepair: { removedWorkouts: { future: true } } };
  const unknownIds = { ...brokenRoutine(), shorteningRepair: { restoredWorkoutIds: 'future format' } };
  [conflict, unknownMetadata, unknownIds].forEach(record => expect(repairShortenedCycles(record)).toBe(record));
});

it('does not invent missing work when no original progress establishes a shortening boundary', () => {
  const original = brokenRoutine(0);
  const repaired = repairShortenedCycles(original);
  expect(repaired.workouts).toBe(original.workouts);
  expect(repaired.cycleWeekGroups[0]).toEqual([[0, 1], [2, 3], [4]]);
  expect(repaired.shorteningRepair.restoredWorkoutIds).toEqual([]);
});

it('does not repack a correctly converted unstarted schedule when only source-zero lifting was subsequently recorded', () => {
  const original = brokenRoutine(0);
  const squat = find(original, 'Squat', 0);
  squat.session = { status: 'inProgress', startedAt: '2026-10-01' };
  const repaired = repairShortenedCycles(original);
  // Source zero has Week 1 labels both before and after conversion. Without
  // its original Strongman record, timing is ambiguous and cannot move the
  // boundary safely: preserve the canonical three-week schedule and activity.
  expect(repaired.workouts).toBe(original.workouts);
  expect(repaired.cycleWeekGroups[0]).toEqual([[0, 1], [2, 3], [4]]);
  expect(find(repaired, 'Strongman', 0)).toBeUndefined();
  expect(find(repaired, 'Squat', 0)).toBe(squat);
});

it('repairs week labels without dropping deadlifts when no strongman days were included', () => {
  const original = brokenRoutine(3, { includeStrongmanDay: false });
  const repaired = repairShortenedCycles(original);
  expect(pending(repaired).map(workout => [workout.name, workout.weekIndex])).toEqual([
    ['Squat', 3], ['Press', 3], ['Deadlift', 3], ['Squat', 3], ['Press', 3], ['Deadlift', 3],
  ]);
  expect(repaired.workouts.map(workout => workout.id)).toEqual(original.workouts.map(workout => workout.id));
});

describe('version 22 repair migration', () => {
  it('upgrades an actual version 21 database and retains profiles, historical snapshots and unrelated records', async () => {
    const factory = new IDBFactory();
    const original = brokenRoutine();
    const unknown = { id: 'unknown', futureData: { retain: true } };
    const template = { ...brokenRoutine(), id: 'template', unknown: true };
    const profile = { id: 'profile', activeRoutineId: original.id, unknown: true };
    const open = version => new Promise((resolve, reject) => {
      const request = factory.open('cycle-repair', version);
      request.onupgradeneeded = event => runDatabaseMigrations(request.result, request.transaction, event.oldVersion, version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
    const previous = await open(21);
    await new Promise((resolve, reject) => {
      const transaction = previous.transaction(['routines', 'profiles', 'templates'], 'readwrite');
      transaction.objectStore('routines').put(original);
      transaction.objectStore('routines').put(unknown);
      transaction.objectStore('profiles').put(profile);
      transaction.objectStore('templates').put(template);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    previous.close();
    const database = await open(DATABASE_VERSION);
    const read = (store, id) => new Promise((resolve, reject) => {
      const request = database.transaction(store, 'readonly').objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(await read('routines', original.id)).toEqual(repairShortenedCycles(original));
    expect(await read('routines', unknown.id)).toEqual(unknown);
    expect(await read('profiles', profile.id)).toEqual(profile);
    expect(await read('templates', template.id)).toEqual(template);
    expect(await read('metadata', 'dataSchemaVersion')).toEqual({ key: 'dataSchemaVersion', value: DATABASE_VERSION });
    database.close();
  });

  it('migrates version 21 backups purely and retains repair identity and archives through current backup import', () => {
    const original = brokenRoutine();
    const unknown = { id: 'unknown', futureData: 'keep' };
    const template = { ...brokenRoutine(), id: 'template' };
    const backup = { format: 'mcilroy-method-backup', version: 21, dataSchemaVersion: 21,
      profiles: [{ id: 'profile' }], routines: [original, unknown], templates: [template], archives: [], extension: true,
    };
    const before = JSON.stringify(backup);
    const migrated = migrateBackup(backup);
    expect(migrated).toMatchObject({ version: BACKUP_VERSION, dataSchemaVersion: DATABASE_VERSION, extension: true });
    expect(migrated.routines[0]).toEqual(repairShortenedCycles(original));
    expect(migrated.routines[1]).toBe(unknown);
    expect(migrated.templates[0]).toBe(template);
    const imported = parseBackup(exportBackup(migrated.profiles, migrated.routines, migrated.templates));
    expect(imported.routines[0]).toEqual(migrated.routines[0]);
    expect(JSON.stringify(backup)).toBe(before);
  });
});
