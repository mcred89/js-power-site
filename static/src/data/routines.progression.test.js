import { adaptiveCycleMaxes, adaptiveStatusForWorkout, createRoutine, createRoutineFromTemplate, startWorkoutSession, updateExercise } from './routines';
import { createRoutineTemplate, duplicateRoutine } from './routineCopies';
import { refreshAdaptiveProgression } from './routineRecalculation';
import { updateRoutinePlan } from './routineUpdates';

const inputs = {
  maxSquat: '500',
  maxPress: '225',
  maxDead: '600',
  squatIncrement: '10',
  pressIncrement: '5',
  deadliftIncrement: '25',
  mainLiftChoice: 'Low',
  duration: '3 weeks',
  mesoMode: true,
  maxProgressionMode: 'adaptive',
  liftProgressionModes: { press: 'same', deadlift: 'fixed' },
  microCycles: Array.from({ length: 4 }, () => ({ duration: '3 weeks', volume: 'Low' })),
};

const recordEstimate = (routine, cycleIndex, lift, actualWeight, actualReps = 10) => {
  const target = routine.workouts.find(workout => workout.cycleIndex === cycleIndex && workout.name === lift);
  return {
    ...routine,
    workouts: routine.workouts.map(workout => workout !== target ? workout : {
      ...workout,
      completedAt: '2026-09-23T12:00:00.000Z',
      session: {
        status: 'completed',
        primaryExerciseId: 'primary',
        exercises: [{ exerciseId: 'primary', movement: lift, sets: [
          { status: 'completed', actualWeight, actualReps },
        ] }],
      },
    }),
  };
};

it('combines adaptive, same, and fixed progression independently in each microcycle', () => {
  let routine = createRoutine('profile', 'Mixed progression', inputs);
  routine = recordEstimate(routine, 0, 'Squat', 405);
  routine = recordEstimate(routine, 0, 'Press', 250);
  routine = recordEstimate(routine, 0, 'Deadlift', 600);
  expect(adaptiveCycleMaxes(routine)).toEqual([
    { maxSquat: 500, maxPress: 225, maxDead: 600 },
    { maxSquat: 540, maxPress: 225, maxDead: 625 },
    { maxSquat: 540, maxPress: 225, maxDead: 650 },
    { maxSquat: 540, maxPress: 225, maxDead: 675 },
  ]);

  const refreshed = refreshAdaptiveProgression(routine);
  const future = refreshed.routine.workouts.filter(workout => workout.cycleIndex === 1);
  expect(refreshed.changed).toBe(true);
  expect(future[0].exercises[0].generated.weight).toBe(355);
  expect(future[1].exercises[0].generated.weight).toBe(150);
  expect(future[2].exercises[0].generated.weight).toBe(410);
  expect(refreshed.routine.workouts[0]).toBe(routine.workouts[0]);
  expect(refreshAdaptiveProgression(refreshed.routine).changed).toBe(false);
});

it('never reduces an adaptive max when the prior cycle has a lower or missing estimate', () => {
  let routine = createRoutine('profile', 'Adaptive floor', inputs);
  routine = recordEstimate(routine, 0, 'Squat', 300);
  expect(adaptiveCycleMaxes(routine).map(maxes => maxes.maxSquat)).toEqual([500, 500, 500, 500]);
  routine = recordEstimate(routine, 0, 'Squat', 405);
  routine = recordEstimate(routine, 1, 'Squat', 300);
  expect(adaptiveCycleMaxes(routine).map(maxes => maxes.maxSquat)).toEqual([500, 540, 540, 540]);
  expect(adaptiveCycleMaxes(routine).map(maxes => maxes.maxPress)).toEqual([225, 225, 225, 225]);
});

it.each(['completed', 'inProgress', 'paused'])('keeps the %s squat snapshot as a floor when an existing fixed plan becomes adaptive', status => {
  let routine = createRoutine('profile', 'Started fixed plan', {
    ...inputs,
    maxSquat: '400',
    squatIncrement: '25',
    maxProgressionMode: 'fixed',
    liftProgressionModes: {},
  });
  const target = routine.workouts.find(workout => workout.cycleIndex === 1 && workout.name === 'Squat');
  if (status === 'completed') {
    routine = recordEstimate(routine, 1, 'Squat', 300, 3);
  } else {
    routine = startWorkoutSession(routine, target.id);
    if (status === 'paused') {
      routine = { ...routine, workouts: routine.workouts.map(workout => workout.id !== target.id ? workout : {
        ...workout, session: { ...workout.session, status: 'paused' },
      }) };
    }
  }
  const snapshot = routine.workouts.find(workout => workout.id === target.id);
  const updated = updateRoutinePlan(routine, { liftProgressionModes: { squat: 'adaptive' } });
  expect(adaptiveCycleMaxes(updated).map(maxes => maxes.maxSquat)).toEqual([400, 425, 425, 425]);
  expect(updated.workouts.find(workout => workout.id === target.id)).toBe(snapshot);
  expect(updated.workouts.filter(workout => workout.name === 'Squat' && workout.cycleIndex >= 1)
    .every(workout => workout.effectiveMaxes.maxSquat === 425)).toBe(true);
  const lowerLaterEstimate = recordEstimate(updated, 2, 'Squat', 300, 3);
  expect(adaptiveCycleMaxes(lowerLaterEstimate).map(maxes => maxes.maxSquat)).toEqual([400, 425, 425, 425]);
  expect(refreshAdaptiveProgression(updated).changed).toBe(false);
});

it('does not treat another lift or unstarted fixed projections as an adaptive floor', () => {
  let routine = createRoutine('profile', 'Started deadlift only', {
    ...inputs,
    maxSquat: '400',
    squatIncrement: '25',
    maxProgressionMode: 'fixed',
    liftProgressionModes: {},
  });
  routine = recordEstimate(routine, 2, 'Deadlift', 300, 3);
  const updated = updateRoutinePlan(routine, { liftProgressionModes: { squat: 'adaptive' } });
  expect(adaptiveCycleMaxes(updated).map(maxes => maxes.maxSquat)).toEqual([400, 400, 400, 400]);
  expect(adaptiveCycleMaxes(updated).map(maxes => maxes.maxDead)).toEqual([600, 625, 650, 675]);
});

it('refreshes an adaptive override with a fixed shared mode and preserves session snapshots and overrides', () => {
  let routine = createRoutine('profile', 'Fixed with adaptive squat', {
    ...inputs,
    maxProgressionMode: 'fixed',
    liftProgressionModes: { squat: 'adaptive' },
  });
  routine = recordEstimate(routine, 0, 'Squat', 405);
  const target = routine.workouts.find(workout => workout.cycleIndex === 1 && workout.name === 'Squat');
  routine = startWorkoutSession(routine, target.id);
  const active = routine.workouts.find(workout => workout.id === target.id);
  const laterSquats = routine.workouts.filter(workout => workout.cycleIndex === 1 && workout.name === 'Squat');
  const paused = { ...laterSquats[1], session: { status: 'paused' } };
  routine = { ...routine, workouts: routine.workouts.map(workout => workout.id === paused.id ? paused : workout) };
  const edited = laterSquats[2];
  routine = updateExercise(routine, edited.id, edited.exercises[0].id, { weight: '365', prescription: '2 × 5' });
  const refreshed = refreshAdaptiveProgression(routine);

  expect(refreshed.changed).toBe(true);
  expect(refreshed.routine.workouts.find(workout => workout.id === active.id)).toBe(active);
  expect(refreshed.routine.workouts.find(workout => workout.id === paused.id)).toBe(paused);
  const refreshedEdit = refreshed.routine.workouts.find(workout => workout.id === edited.id);
  expect(refreshedEdit.effectiveMaxes).toEqual({ maxSquat: 540, maxPress: 230, maxDead: 625 });
  expect(refreshedEdit.exercises[0].overrides).toEqual({ weight: '365', prescription: '2 × 5' });
});

it('reports adaptive progress only for the workout lift and ignores unrelated fixed increases', () => {
  const routine = createRoutine('profile', 'Independent statuses', {
    ...inputs,
    includeStrongmanDay: true,
    liftProgressionModes: { deadlift: 'fixed' },
  });
  const cycle = routine.workouts.filter(workout => workout.cycleIndex === 1);
  expect(adaptiveStatusForWorkout(routine, cycle.find(workout => workout.name === 'Squat')))
    .toBe('Adaptive · projected from Cycle 1');
  expect(adaptiveStatusForWorkout(routine, cycle.find(workout => workout.name === 'Press')))
    .toBe('Adaptive · projected from Cycle 1');
  expect(adaptiveStatusForWorkout(routine, cycle.find(workout => workout.name === 'Deadlift'))).toBeNull();
  expect(adaptiveStatusForWorkout(routine, cycle.find(workout => workout.name === 'Strongman'))).toBeNull();
  const improved = recordEstimate(routine, 0, 'Squat', 405);
  expect(adaptiveStatusForWorkout(improved, cycle.find(workout => workout.name === 'Squat')))
    .toBe('Adaptive · updated from Cycle 1');
  expect(adaptiveStatusForWorkout(improved, cycle.find(workout => workout.name === 'Press')))
    .toBe('Adaptive · projected from Cycle 1');
});

it('skips adaptive refresh when every lift overrides the shared adaptive strategy', () => {
  const routine = createRoutine('profile', 'No adaptive lifts', {
    ...inputs,
    liftProgressionModes: { squat: 'same', press: 'same', deadlift: 'fixed' },
  });
  expect(refreshAdaptiveProgression(routine)).toEqual({ routine, changed: false });
});

it('keeps lift strategies independent when copying or creating routines from a template', () => {
  const routine = createRoutine('profile', 'Mixed progression', inputs);
  const copy = duplicateRoutine(routine, 'profile', 'Copy');
  const template = createRoutineTemplate(routine, 'Reusable progression');
  const fromTemplate = createRoutineFromTemplate(template, 'profile', 'Next plan');
  copy.inputs.liftProgressionModes.deadlift = 'same';
  fromTemplate.inputs.liftProgressionModes.press = 'adaptive';
  expect(routine.inputs.liftProgressionModes).toEqual({ press: 'same', deadlift: 'fixed' });
  expect(template.inputs.liftProgressionModes).toEqual({ press: 'same', deadlift: 'fixed' });
  template.inputs.liftProgressionModes.deadlift = 'adaptive';
  expect(routine.inputs.liftProgressionModes).toEqual({ press: 'same', deadlift: 'fixed' });
  routine.inputs.liftProgressionModes.press = 'fixed';
  expect(inputs.liftProgressionModes).toEqual({ press: 'same', deadlift: 'fixed' });
});
