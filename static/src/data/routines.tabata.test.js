import {
  adjustSessionSet,
  completeSessionSet,
  createRoutine,
  finishWorkoutSession,
  reopenWorkoutSession,
  skipRemainingSessionExercise,
  skipSessionSet,
  startWorkoutSession,
  substituteSessionExercise,
  undoLatestSessionAction,
  updateExercise,
} from './routines';
import { TABATA_PRESCRIPTION } from './tabata';

const inputs = {
  maxSquat: '300',
  maxPress: '150',
  maxDead: '400',
  duration: '5 weeks',
  mainLiftChoice: 'Low',
  squatTabataEnabled: true,
};

const tabataFor = routine => routine.workouts[0].session.exercises.slice(-1)[0];

it('starts generated Tabata as one timer set with blank weight and reps', () => {
  let routine = createRoutine('profile-1', 'Tabata plan', inputs);
  routine = startWorkoutSession(routine, routine.workouts[0].id, '2026-09-07T12:00:00.000Z');

  const tabata = tabataFor(routine);
  expect(tabata).toMatchObject({
    movement: 'Tabata sprints',
    prescription: TABATA_PRESCRIPTION,
    plannedWeight: '',
  });
  expect(tabata.sets).toHaveLength(1);
  expect(tabata.sets[0]).toMatchObject({
    number: 1,
    plannedWeight: '',
    plannedReps: '',
    actualWeight: '',
    actualReps: '',
    status: 'pending',
    tabataTimer: null,
  });
  expect(routine.workouts[0].session.exercises[0].sets).toHaveLength(4);
  expect(routine.workouts[0].session.exercises[0].sets[0].actualReps).toBe(6);
});

it('persists timer progress and completes the entire finisher with one session action', () => {
  let routine = createRoutine('profile-1', 'Tabata plan', inputs);
  const workoutId = routine.workouts[0].id;
  routine = startWorkoutSession(routine, workoutId, '2026-09-07T12:00:00.000Z');
  const tabata = tabataFor(routine);
  routine = adjustSessionSet(routine, workoutId, tabata.exerciseId, tabata.sets[0].id, {
    tabataTimer: { elapsedMs: 75000, runningSince: '2026-09-07T12:01:30.000Z' },
  });
  expect(tabataFor(routine).sets[0].tabataTimer).toEqual({
    elapsedMs: 75000, runningSince: '2026-09-07T12:01:30.000Z',
  });
  expect(tabata.sets[0].tabataTimer).toBeNull();
  routine = adjustSessionSet(routine, workoutId, tabata.exerciseId, tabata.sets[0].id, {
    tabataTimer: { elapsedMs: 290000, runningSince: null },
  });
  routine = completeSessionSet(routine, workoutId, tabata.exerciseId, tabata.sets[0].id, '2026-09-07T12:04:50.000Z');
  expect(tabataFor(routine).sets).toHaveLength(1);
  expect(tabataFor(routine).sets[0]).toMatchObject({
    status: 'completed', actualWeight: '', actualReps: '', splitSeconds: 290,
    tabataTimer: { elapsedMs: 290000, runningSince: null },
  });
  routine = undoLatestSessionAction(routine, workoutId, '2026-09-07T12:05:15.000Z');
  expect(tabataFor(routine).sets[0]).toMatchObject({ status: 'pending', tabataTimer: null });
});

it('skips, undoes, and reopens the whole finisher through the session log', () => {
  let routine = createRoutine('profile-1', 'Tabata plan', inputs);
  const workoutId = routine.workouts[0].id;
  routine = startWorkoutSession(routine, workoutId, '2026-09-07T12:00:00.000Z');
  const tabata = tabataFor(routine);
  routine = skipSessionSet(routine, workoutId, tabata.exerciseId, tabata.sets[0].id, '2026-09-07T12:00:30.000Z');
  expect(tabataFor(routine).sets.map(set => set.status)).toEqual(['skipped']);
  routine = undoLatestSessionAction(routine, workoutId, '2026-09-07T12:00:45.000Z');
  expect(tabataFor(routine).sets[0].status).toBe('pending');
  routine = skipRemainingSessionExercise(routine, workoutId, tabata.exerciseId, '2026-09-07T12:00:50.000Z');
  routine = finishWorkoutSession(routine, workoutId, '2026-09-07T12:01:00.000Z');
  routine = reopenWorkoutSession(routine, workoutId, '2026-09-07T12:02:00.000Z');
  expect(tabataFor(routine).sets.map(set => set.status)).toEqual(['pending']);
});

it.each([
  ['complete', completeSessionSet, 'completed'],
  ['skip', skipSessionSet, 'skipped'],
])('stops a running Tabata timer when its set is marked %s', (label, action, status) => {
  let routine = createRoutine('profile-1', 'Tabata plan', inputs);
  const workoutId = routine.workouts[0].id;
  routine = startWorkoutSession(routine, workoutId, '2026-09-07T12:00:00.000Z');
  const tabata = tabataFor(routine);
  routine = adjustSessionSet(routine, workoutId, tabata.exerciseId, tabata.sets[0].id, {
    tabataTimer: { elapsedMs: 20000, runningSince: '2026-09-07T12:01:00.000Z', unknown: true },
  });
  const original = tabataFor(routine).sets[0];
  routine = action(routine, workoutId, tabata.exerciseId, tabata.sets[0].id, '2026-09-07T12:01:30.000Z');
  expect(tabataFor(routine).sets[0]).toMatchObject({
    status,
    tabataTimer: { elapsedMs: 50000, runningSince: null, unknown: true },
  });
  expect(original.tabataTimer.runningSince).toBe('2026-09-07T12:01:00.000Z');
});

it('freezes a running finisher when ending a workout so reopening cannot resume stale time', () => {
  let routine = createRoutine('profile-1', 'Tabata plan', inputs);
  const workoutId = routine.workouts[0].id;
  routine = startWorkoutSession(routine, workoutId, '2026-09-07T12:00:00.000Z');
  const tabata = tabataFor(routine);
  routine = adjustSessionSet(routine, workoutId, tabata.exerciseId, tabata.sets[0].id, {
    tabataTimer: { elapsedMs: 20000, runningSince: '2026-09-07T12:01:00.000Z' },
  });
  routine = finishWorkoutSession(routine, workoutId, '2026-09-07T12:01:30.000Z');
  expect(tabataFor(routine).sets[0]).toMatchObject({
    status: 'skipped', tabataTimer: { elapsedMs: 50000, runningSince: null },
  });
  routine = reopenWorkoutSession(routine, workoutId, '2026-09-08T12:00:00.000Z');
  expect(tabataFor(routine).sets[0]).toMatchObject({
    status: 'pending', tabataTimer: { elapsedMs: 50000, runningSince: null },
  });
});

it('preserves completed timer snapshots when finishing the workout later', () => {
  let routine = createRoutine('profile-1', 'Tabata plan', inputs);
  const workoutId = routine.workouts[0].id;
  routine = startWorkoutSession(routine, workoutId, '2026-09-07T12:00:00.000Z');
  const tabata = tabataFor(routine);
  routine = adjustSessionSet(routine, workoutId, tabata.exerciseId, tabata.sets[0].id, {
    tabataTimer: { elapsedMs: 290000, runningSince: null },
  });
  routine = completeSessionSet(routine, workoutId, tabata.exerciseId, tabata.sets[0].id, '2026-09-07T12:04:50.000Z');
  const completed = tabataFor(routine).sets[0];
  routine = finishWorkoutSession(routine, workoutId, '2026-09-07T12:05:30.000Z');
  expect(tabataFor(routine).sets[0]).toBe(completed);
});

it.each([
  [{ prescription: '3 × 10' }, 3, '', 10],
  [{ weight: '20' }, 1, '20', ''],
])('keeps customized sprint exercise logging generic for %j', (overrides, setCount, weight, reps) => {
  let routine = createRoutine('profile-1', 'Tabata plan', inputs);
  const workout = routine.workouts[0];
  const exercise = workout.exercises.slice(-1)[0];
  routine = updateExercise(routine, workout.id, exercise.id, overrides);
  routine = startWorkoutSession(routine, workout.id, '2026-09-07T12:00:00.000Z');

  const sessionExercise = tabataFor(routine);
  expect(sessionExercise.sets).toHaveLength(setCount);
  expect(sessionExercise.sets[0]).toMatchObject({ actualWeight: weight, actualReps: reps });
});

it.each([
  [{ movement: 'Hill sprints' }, 8],
  [{ prescription: '6 rounds: 20 seconds sprint / 10 seconds rest' }, 6],
])('retains one timed finisher when editing %j', overrides => {
  let routine = createRoutine('profile-1', 'Tabata plan', inputs);
  const workout = routine.workouts[0];
  routine = updateExercise(routine, workout.id, workout.exercises.slice(-1)[0].id, overrides);
  routine = startWorkoutSession(routine, workout.id, '2026-09-07T12:00:00.000Z');
  const exercise = tabataFor(routine);

  expect(exercise.sets).toHaveLength(1);
  expect(exercise.sets[0].tabataTimer).toBeNull();
  expect(exercise.sets.every(set => set.actualReps === '' && set.actualWeight === '')).toBe(true);
});

it('uses the replacement prescription when substituting Tabata during a workout', () => {
  let routine = createRoutine('profile-1', 'Tabata plan', inputs);
  const workoutId = routine.workouts[0].id;
  routine = startWorkoutSession(routine, workoutId, '2026-09-07T12:00:00.000Z');
  const tabata = tabataFor(routine);
  routine = substituteSessionExercise(routine, workoutId, tabata.exerciseId, {
    movement: 'Jump rope', setCount: '3', reps: '50', weight: '',
  }, '2026-09-07T12:01:00.000Z');

  const replacement = tabataFor(routine);
  expect(replacement).toMatchObject({
    movement: 'Jump rope',
    prescription: '3 × 50',
    original: { movement: 'Tabata sprints', prescription: TABATA_PRESCRIPTION },
  });
  expect(replacement.sets).toHaveLength(3);
  expect(replacement.sets.every(set => set.actualReps === '50')).toBe(true);
});
