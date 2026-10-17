import { copyStrongmanWorkout, previousStrongmanWorkouts } from './strongmanWorkoutCopy';
import { createStrongmanLogEntry, strongmanResults, validateStrongmanRecord } from './strongman';
import { duplicateRoutine } from './routineCopies';
import { createImportPlan } from './importBackup';

const entry = (id, date, movement = 'Stones', overrides = {}) => createStrongmanLogEntry({
  id, date, movement, workoutId: 'past-day', competitionId: 'meet', eventId: 'stones',
  sets: [{ id: `${id}-set`, weight: 200, reps: 5 }], ...overrides,
}, '2026-01-01T12:00:00.000Z');
const current = { id: 'current', name: 'Current plan', profileId: 'athlete', inputs: {}, workouts: [], strongmanLog: [] };
const workout = { id: 'today' };

it('groups real past sessions by plan, workout and date and keeps brief movement previews', () => {
  const old = { ...current, id: 'old', name: 'Previous plan', strongmanLog: [
    entry('stones', '2026-10-10'), entry('axle', '2026-10-10', 'Axle'),
    entry('yoke', '2026-10-10', 'Zercher yoke'), entry('stones-again', '2026-10-10', ' stones '),
    entry('log', '2026-10-10', 'Log'), entry('older', '2026-10-03'),
    entry('backfill', '2026-10-03', 'Sandbag', { workoutId: null }),
    entry('backfill2', '2026-10-03', 'Frame', { workoutId: null }),
    entry('second-day', '2026-10-03', 'Deadlift', { workoutId: 'another-day' }),
  ] };
  const plans = previousStrongmanWorkouts(current, [old, current, old], workout, '2026-10-17');
  expect(plans).toHaveLength(4);
  expect(plans[0]).toMatchObject({ date: '2026-10-10', label: 'Last week', routineName: 'Previous plan',
    preview: 'Stones, Axle, Zercher yoke +1' });
  expect(plans[0].entries).toHaveLength(5);
  expect(plans.slice(1).every(item => item.label === '2 weeks ago')).toBe(true);
  expect(plans.find(item => item.preview === 'Sandbag, Frame').entries).toHaveLength(2);
});

it('excludes other profiles, the current workout, today, future and invalid dates', () => {
  const plan = { ...current, strongmanLog: [
    entry('old', '2026-10-16'), entry('current', '2026-10-10', 'Current', { workoutId: workout.id }),
    entry('today', '2026-10-17'), { ...entry('future', '2026-10-16'), date: '2099-10-18' },
    { ...entry('invalid', '2026-10-16'), date: '2026-02-30' },
  ] };
  const other = { ...current, id: 'other', profileId: 'someone-else', strongmanLog: [entry('private', '2026-10-15')] };
  const stale = { ...plan, strongmanLog: [entry('stale', '2026-10-15')] };
  expect(previousStrongmanWorkouts(plan, [other, stale], workout, '2026-10-17'))
    .toEqual([expect.objectContaining({ label: 'Yesterday', entries: [plan.strongmanLog[0]] })]);
  expect(previousStrongmanWorkouts(plan, [], workout, 'invalid')).toEqual([]);
});

it('uses elapsed calendar dates across daylight-saving boundaries', () => {
  const routine = { ...current, strongmanLog: [entry('before-dst', '2026-03-01')] };
  expect(previousStrongmanWorkouts(routine, [], workout, '2026-03-08')[0].label).toBe('Last week');
});

it('copies every metric and setup with fresh identities without carrying actual outcomes or timestamps', () => {
  const source = { entries: [entry('points', '2026-10-10', 'Stone challenge', {
    componentId: 'stone', notes: 'Felt tired; missed the final lift',
    eventSnapshot: { id: 'stone', name: 'Stone challenge', type: 'single', timeGoal: 'points',
      scoringRules: 'Light = 1 point, heavy = 2', height: 48, components: [] },
    sets: [{ id: 'failed', weight: 200, reps: 0, distance: 0, seconds: 60, height: 48, points: 0,
      successful: false, extension: { retained: true } }],
  }), entry('medley', '2026-10-10', 'Carry medley', {
    scope: 'medley', eventSnapshot: { id: 'medley', name: 'Carry medley', type: 'medley',
      components: [{ id: 'bag', name: 'Sandbag', weight: 200, distance: 50 }] }, sets: [{ id: 'run', seconds: 45 }],
  })] };
  const before = JSON.stringify(source);
  const queue = copyStrongmanWorkout(source, workout.id, '2026-10-17', { id: 'new-meet' });
  expect(queue).toHaveLength(2);
  queue.forEach((copied, index) => {
    expect(copied.id).not.toBe(source.entries[index].id);
    expect(copied.sets[0].id).not.toBe(source.entries[index].sets[0].id);
    expect(copied).toMatchObject({ date: '2026-10-17', workoutId: workout.id, competitionId: 'new-meet', eventId: null, componentId: null, notes: '' });
    expect(copied).not.toHaveProperty('createdAt');
    expect(copied).not.toHaveProperty('updatedAt');
    expect(copied.eventSnapshot).toEqual(source.entries[index].eventSnapshot);
    expect(copied.eventSnapshot).not.toBe(source.entries[index].eventSnapshot);
  });
  expect(queue[0].sets[0]).toMatchObject({ weight: 200, reps: 0, distance: 0, seconds: 60, height: 48, points: 0, successful: true });
  expect(queue[0].eventSnapshot.scoringRules).toBe('Light = 1 point, heavy = 2');
  queue[0].sets[0].extension.retained = false;
  queue[1].eventSnapshot.components[0].weight = 250;
  expect(JSON.stringify(source)).toBe(before);
  const again = copyStrongmanWorkout(source, workout.id, '2026-10-17', { id: 'meet' });
  expect(again[0]).toMatchObject({ eventId: 'stones', componentId: 'stone' });
  expect(again[0].id).not.toBe(queue[0].id);
  expect(copyStrongmanWorkout(source, workout.id, '2026-10-17')[0].competitionId).toBeNull();
});

it('keeps pending copied sets out of actual results and clears them from plan duplicates', () => {
  const queue = copyStrongmanWorkout({ entries: [entry('source', '2026-10-10')] }, workout.id, '2026-10-17');
  const plan = { ...current, workouts: [{ ...workout, name: 'Strongman', exercises: [], strongmanQueue: queue }] };
  expect(() => validateStrongmanRecord(plan)).not.toThrow();
  expect(strongmanResults([plan])).toEqual([]);
  const copy = duplicateRoutine(plan, current.profileId, 'Copied plan');
  expect(copy.workouts[0].strongmanQueue).toEqual([]);
  expect(plan.workouts[0].strongmanQueue).toBe(queue);
});

it('keeps the local pending queue on merge and preserves incoming queues on new workouts', () => {
  const queue = copyStrongmanWorkout({ entries: [entry('source', '2026-10-10')] }, workout.id, '2026-10-17');
  const local = { ...current, workouts: [{ ...workout, strongmanQueue: queue }] };
  const incomingQueue = copyStrongmanWorkout({ entries: [entry('other', '2026-10-03')] }, 'new-day', '2026-10-17');
  const imported = { ...current, workouts: [{ ...workout, strongmanQueue: [] }, { id: 'new-day', strongmanQueue: incomingQueue }] };
  const result = createImportPlan({ profiles: [], routines: [imported], templates: [], archives: [] }, [], [local]).routines[0].result;
  expect(result.workouts[0].strongmanQueue).toBe(queue);
  expect(result.workouts[1].strongmanQueue).toBe(incomingQueue);
});
