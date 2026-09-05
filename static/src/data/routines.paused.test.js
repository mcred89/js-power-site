import {
  adjustSessionSet,
  completeSessionSet,
  correctMaxes,
  createRoutine,
  reopenWorkoutSession,
  refreshAdaptiveProgression,
  sessionElapsedSeconds,
  startWorkoutSession,
  substituteSessionExercise,
} from './routines';
import { duplicateRoutine } from './routineCopies';

const inputs = {
  maxSquat: '500', maxPress: '225', maxDead: '600', duration: '5 weeks',
  mainLiftChoice: 'Low', mesoMode: false, includeBackoffSets: false,
  includeStrongmanDay: false, pressWeakPoint: 'Triceps', deadliftWeakPoint: 'Back',
};
const startedAt = '2026-08-18T12:00:00.000Z';
const resumedAt = '2026-08-20T12:00:00.000Z';

// Version 11 could pause an ordinary workout when a different plan became active.
const pausedRoutine = (routine, index = 0) => {
  const workoutId = routine.workouts[index].id;
  let changed = startWorkoutSession(routine, workoutId, startedAt);
  const exercise = changed.workouts[index].session.exercises[0];
  changed = adjustSessionSet(changed, workoutId, exercise.exerciseId, exercise.sets[0].id, {
    actualWeight: '315', actualReps: '5',
  });
  changed = completeSessionSet(changed, workoutId, exercise.exerciseId, exercise.sets[0].id, '2026-08-18T12:01:00.000Z');
  changed = substituteSessionExercise(changed, workoutId,
    exercise.exerciseId,
    { movement: 'Safety bar squat', weight: '300', reps: '3', setCount: 3 },
    '2026-08-18T12:01:30.000Z');
  changed.workouts[index].session = {
    ...changed.workouts[index].session,
    status: 'paused', runningSince: null, stoppedAt: '2026-08-18T12:02:00.000Z',
    elapsedSeconds: 120, notes: 'Keep the completed set and substitution.',
  };
  return changed;
};

it('resumes a paused ordinary workout without discarding sets, substitutions, or its elapsed time', () => {
  const routine = pausedRoutine(createRoutine('profile', 'Strength', inputs));
  const original = routine.workouts[0];
  const before = JSON.stringify(routine);
  const resumed = startWorkoutSession(routine, original.id, resumedAt);

  expect(resumed.workouts[0]).toEqual({
    ...original,
    session: { ...original.session, status: 'inProgress', runningSince: resumedAt, stoppedAt: null },
  });
  expect(sessionElapsedSeconds(resumed.workouts[0].session, '2026-08-20T12:00:30.000Z')).toBe(150);
  expect(resumed.workouts[0].session.exercises[0].sets[0]).toMatchObject({
    status: 'completed', actualWeight: '315', actualReps: '5', splitSeconds: 60,
  });
  expect(JSON.stringify(routine)).toBe(before);
});

it('keeps paused workout prescriptions frozen during explicit max correction', () => {
  const routine = pausedRoutine(createRoutine('profile', 'Strength', inputs));
  const original = routine.workouts[0];
  const corrected = correctMaxes(routine, { maxSquat: '600' });

  expect(corrected.workouts[0]).toBe(original);
  expect(corrected.workouts[3].effectiveMaxes.maxSquat).toBe(600);
  expect(corrected.workouts[3].exercises[0].generated.weight).toBe(420);
});

it('reopens a retired completed event slot as a usable freeform strongman day', () => {
  const routine = createRoutine('profile', 'Strength', inputs);
  routine.workouts[0] = {
    ...routine.workouts[0], name: 'Strongman', kind: 'eventSlot', exercises: [],
    completedAt: '2026-08-18T14:00:00.000Z',
    eventRef: { routineId: 'retired-block', workoutId: 'retired-event-week' },
  };
  const original = JSON.stringify(routine);
  const workoutId = routine.workouts[0].id;
  const reopened = reopenWorkoutSession(routine, workoutId, resumedAt);

  expect(reopened.workouts[0]).toMatchObject({ completedAt: null, exercises: [{
    generated: { movement: 'Strongman day', weight: '', prescription: '' }, overrides: {},
  }] });
  expect(reopened.workouts[0]).not.toHaveProperty('kind');
  expect(reopened.workouts[0]).not.toHaveProperty('eventRef');
  const started = startWorkoutSession(reopened, workoutId, resumedAt);
  expect(started.workouts[0].session).toMatchObject({
    status: 'inProgress', exercises: [{ movement: 'Strongman day', sets: [{ status: 'pending' }] }],
  });
  expect(JSON.stringify(routine)).toBe(original);
});

it('copies a retired completed event slot into a usable freeform strongman day', () => {
  const routine = createRoutine('profile', 'Strength', inputs);
  routine.workouts[0] = {
    ...routine.workouts[0], name: 'Strongman', kind: 'eventSlot', exercises: [],
    completedAt: '2026-08-18T14:00:00.000Z',
    eventRef: { routineId: 'retired-block', workoutId: 'retired-event-week' },
  };
  const original = JSON.stringify(routine);
  const copied = duplicateRoutine(routine, 'other-profile', 'Fresh routine');

  expect(copied.workouts[0]).toMatchObject({ completedAt: null, session: null, exercises: [{
    generated: { movement: 'Strongman day', weight: '', prescription: '' }, overrides: {},
  }] });
  expect(copied.workouts[0]).not.toHaveProperty('kind');
  expect(copied.workouts[0]).not.toHaveProperty('eventRef');
  const started = startWorkoutSession(copied, copied.workouts[0].id, resumedAt);
  expect(started.workouts[0].session).toMatchObject({
    status: 'inProgress', exercises: [{ movement: 'Strongman day', sets: [{ status: 'pending' }] }],
  });
  expect(JSON.stringify(routine)).toBe(original);
});

it('keeps a paused later-cycle snapshot while adaptive progression updates unstarted work', () => {
  let routine = pausedRoutine(createRoutine('profile', 'Adaptive strength', {
    ...inputs, mesoMode: true, maxProgressionMode: 'adaptive',
    microCycles: [{ duration: '3 weeks', volume: 'Low' }, { duration: '3 weeks', volume: 'Low' }],
  }), 15);
  routine = {
    ...routine,
    workouts: routine.workouts.map((workout, index) => index !== 0 ? workout : {
      ...workout,
      completedAt: '2026-08-18T14:00:00.000Z',
      session: {
        primaryExerciseId: 'primary',
        exercises: [{ exerciseId: 'primary', movement: 'Squat', sets: [
          { status: 'completed', actualWeight: 405, actualReps: 10 },
        ] }],
      },
    }),
  };
  const original = routine.workouts[15];
  const refreshed = refreshAdaptiveProgression(routine);

  expect(refreshed.changed).toBe(true);
  expect(refreshed.routine.workouts[15]).toBe(original);
  expect(refreshed.routine.workouts[18].effectiveMaxes.maxSquat).toBe(540);
});
