import {
  createRoutine,
  deleteFutureWorkout,
  startWorkoutSession,
  updateExercise,
  visibleExercise,
} from './routines';
import { correctMaxes, refreshAdaptiveProgression } from './routineRecalculation';
import { getPlanUpdateSummary, updateRoutinePlan } from './routineUpdates';

const inputs = {
  maxSquat: '500', maxPress: '225', maxDead: '600',
  mainLiftChoice: 'Low', duration: '5 weeks', mesoMode: false,
  includeStrongmanDay: false, includeBackoffSets: false,
  maxProgressionMode: 'fixed',
  squatIncrement: '10', pressIncrement: '5', deadliftIncrement: '10',
  pressWeakPoint: 'Triceps', deadliftWeakPoint: 'Back',
  squatTabataEnabled: true, pressTabataEnabled: true, deadliftTabataEnabled: true,
};
const makeRoutine = overrides => createRoutine('profile', 'My plan', { ...inputs, ...overrides });
const findExercise = (workout, movement) => workout.exercises.find(exercise => exercise.generated.movement === movement);

describe('updating an existing plan', () => {
  it('removes Tabata only from future deadlift days and preserves every recorded or started snapshot', () => {
    let routine = makeRoutine();
    routine.workouts[2].completedAt = '2026-09-21T12:00:00.000Z';
    routine = startWorkoutSession(routine, routine.workouts[5].id, '2026-09-21T12:00:00.000Z');
    routine.workouts[8].session = { status: 'paused', exercises: [], elapsedSeconds: 30 };
    routine.workouts[11].session = { status: 'imported-record', note: 'Preserve me' };
    const snapshots = [2, 5, 8, 11].map(index => routine.workouts[index]);
    const before = JSON.stringify(routine);

    const updated = updateRoutinePlan(routine, { deadliftTabataEnabled: false });

    [2, 5, 8, 11].forEach((index, position) => expect(updated.workouts[index]).toBe(snapshots[position]));
    expect(findExercise(updated.workouts[14], 'Tabata sprints')).toBeUndefined();
    expect(updated.workouts.filter(workout => ['Squat', 'Press'].includes(workout.name))
      .every(workout => findExercise(workout, 'Tabata sprints'))).toBe(true);
    expect(JSON.stringify(routine)).toBe(before);
    expect(getPlanUpdateSummary(routine, updated)).toEqual({
      changedWorkouts: 1, completedWorkouts: 1, startedWorkouts: 3, preservedOverrides: 0,
    });
  });

  it('updates weights and fixed progression while preserving deleted sequence gaps and unknown fields', () => {
    let routine = makeRoutine({
      mesoMode: true,
      microCycles: [{ duration: '5 weeks', volume: 'Low', note: 'Keep cycle note' }, { duration: '3 weeks', volume: 'High' }],
      customInput: { keep: true },
    });
    routine.customRecord = { keep: true };
    routine.workouts[4].customWorkout = 'keep';
    routine.workouts[4].exercises[0].customExercise = 'keep';
    routine.workouts[4].exercises[0].generated.customGenerated = 'keep';
    routine = deleteFutureWorkout(routine, routine.workouts[1].id);
    const original = routine.workouts.find(workout => workout.sequence === 5);
    const unknown = { ...original, id: 'unknown', sequence: 9999 };
    routine.workouts.push(unknown);

    const updated = updateRoutinePlan(routine, {
      ...routine.inputs, maxSquat: '600', squatIncrement: '20', customInput: { keep: false },
      microCycles: [{ duration: '5 weeks', volume: 'High', note: 'Do not replace' }, { duration: '3 weeks', volume: 'Low' }],
    });

    expect(updated.workouts.map(workout => workout.id)).toEqual(routine.workouts.map(workout => workout.id));
    expect(updated.workouts.map(workout => workout.sequence)).not.toContain(2);
    expect(updated.workouts.find(workout => workout.sequence === 16).effectiveMaxes.maxSquat).toBe(620);
    const next = updated.workouts.find(workout => workout.sequence === 5);
    expect(next.customWorkout).toBe('keep');
    expect(next.exercises[0]).toMatchObject({ id: original.exercises[0].id, customExercise: 'keep', generated: { customGenerated: 'keep' } });
    expect(updated.inputs.customInput).toEqual({ keep: true });
    expect(updated.inputs.microCycles[0].note).toBe('Keep cycle note');
    expect(updated.customRecord).toBe(routine.customRecord);
    expect(updated.workouts[updated.workouts.length - 1]).toBe(unknown);
  });

  it('matches exercise roles when adding back-offs and replacing accessory and event movements', () => {
    let routine = makeRoutine({
      pressEventEnabled: true, pressEventMovement: 'Log press', pressEventSets: '3', pressEventReps: '5',
    });
    const press = routine.workouts[1];
    const accessory = findExercise(press, 'Tricep extensions');
    const curls = findExercise(press, 'Curls');
    const event = findExercise(press, 'Strongman event: Log press');
    const tabata = findExercise(press, 'Tabata sprints');
    routine = updateExercise(routine, press.id, accessory.id, { weight: '35' });
    routine = updateExercise(routine, press.id, curls.id, { prescription: '2 × 10' });
    routine = updateExercise(routine, press.id, event.id, { movement: 'Axle press' });
    const updated = updateRoutinePlan(routine, {
      includeBackoffSets: true, pressWeakPoint: 'Shoulders',
      pressEventMovement: '  Sandbag carry  ', pressEventSets: '4', pressEventReps: '8',
    });
    const exercises = updated.workouts[1].exercises;

    expect(exercises.slice(1, 4).every(exercise => Object.keys(exercise.overrides).length === 0)).toBe(true);
    expect(findExercise(updated.workouts[1], 'Dumbbell overhead press')).toMatchObject({ id: accessory.id, overrides: { weight: '35' } });
    expect(findExercise(updated.workouts[1], 'Curls')).toMatchObject({ id: curls.id, overrides: { prescription: '2 × 10' } });
    expect(findExercise(updated.workouts[1], 'Strongman event: Sandbag carry')).toMatchObject({
      id: event.id, overrides: { movement: 'Axle press' }, generated: { prescription: '4 × 8' },
    });
    expect(exercises[exercises.length - 1].id).toBe(tabata.id);
    expect(updated.inputs.pressEventMovement).toBe('Sandbag carry');
    expect(getPlanUpdateSummary(routine, updated).preservedOverrides).toBe(3);
  });

  it('keeps removed custom exercises through later updates, max correction, and adaptive refresh', () => {
    let routine = makeRoutine({
      includeBackoffSets: true, mesoMode: true, maxProgressionMode: 'adaptive',
      microCycles: [{ duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' }],
      pressEventEnabled: true, pressEventMovement: 'Log press', pressEventSets: '3', pressEventReps: '5',
    });
    const press = routine.workouts[1];
    const customized = [press.exercises[1], findExercise(press, 'Tricep extensions'), findExercise(press, 'Strongman event: Log press')];
    customized.forEach((exercise, index) => {
      routine = updateExercise(routine, press.id, exercise.id, { weight: String(45 + index) });
    });
    const unknown = { id: 'custom-import', generated: { movement: 'Farmer walk', weight: '100', prescription: '3 × 1' }, overrides: {} };
    routine.workouts[1].exercises.push(unknown);
    const originalExercises = routine.workouts[1].exercises;

    let updated = updateRoutinePlan(routine, { includeBackoffSets: false, pressWeakPoint: '', pressEventEnabled: false });
    updated = correctMaxes(updated, { maxPress: '250' });
    updated = refreshAdaptiveProgression(updated).routine;
    updated = updateRoutinePlan(updated, { maxSquat: '510' });
    const exercises = updated.workouts[1].exercises;

    customized.forEach(exercise => {
      expect(exercises.find(item => item.id === exercise.id)).toEqual(originalExercises.find(item => item.id === exercise.id));
    });
    expect(exercises.find(exercise => exercise.id === unknown.id)).toEqual(unknown);
    expect(exercises.filter(exercise => exercise.generated.movement === 'Press back-off')).toHaveLength(1);
    expect(exercises[exercises.length - 1].generated.movement).toBe('Tabata sprints');
    expect(visibleExercise(exercises.find(exercise => exercise.id === customized[0].id)).weight).toBe('45');
  });

  it('removes ordinary events and finishers but preserves explicitly overridden ones', () => {
    let routine = makeRoutine({
      deadliftEventEnabled: true, deadliftEventMovement: 'Yoke', deadliftEventSets: '2', deadliftEventReps: '1',
    });
    const deadlift = routine.workouts[2];
    const finisher = findExercise(deadlift, 'Tabata sprints');
    routine = updateExercise(routine, deadlift.id, finisher.id, { movement: 'Bike sprints' });
    const updated = updateRoutinePlan(routine, { deadliftEventEnabled: false, deadliftTabataEnabled: false });
    expect(findExercise(updated.workouts[2], 'Strongman event: Yoke')).toBeUndefined();
    expect(updated.workouts[2].exercises[updated.workouts[2].exercises.length - 1]).toMatchObject({
      id: finisher.id, overrides: { movement: 'Bike sprints' },
    });
    expect(findExercise(updated.workouts[5], 'Tabata sprints')).toBeUndefined();
  });

  it('resolves adaptive maxes from history and switches back to same or fixed progression', () => {
    const routine = makeRoutine({
      mesoMode: true,
      microCycles: [{ duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' }],
    });
    routine.workouts[0] = {
      ...routine.workouts[0], completedAt: '2026-09-21T12:00:00.000Z',
      session: { primaryExerciseId: 'recorded', exercises: [{
        exerciseId: 'recorded', movement: 'Squat', sets: [{ status: 'completed', actualWeight: 400, actualReps: 10 }],
      }] },
    };
    const adaptive = updateRoutinePlan(routine, { maxProgressionMode: 'adaptive' });
    expect(adaptive.workouts[15].effectiveMaxes.maxSquat).toBe(535);
    expect(adaptive.workouts[0]).toBe(routine.workouts[0]);
    const same = updateRoutinePlan(adaptive, { maxProgressionMode: 'same' });
    expect(same.workouts[15].effectiveMaxes.maxSquat).toBe(500);
    const fixed = updateRoutinePlan(same, { maxProgressionMode: 'fixed', squatIncrement: '25' });
    expect(fixed.workouts[15].effectiveMaxes.maxSquat).toBe(525);
  });

  it.each([
    { mesoMode: true }, { duration: '3 weeks' }, { includeStrongmanDay: true },
    { microCycles: [{ duration: '5 weeks', volume: 'High' }] },
  ])('rejects schedule topology changes: %o', changes => {
    expect(() => updateRoutinePlan(makeRoutine(), changes)).toThrow(/cannot change/);
  });

  it('rejects cycle duration and count changes while accepting volume edits', () => {
    const routine = makeRoutine({ mesoMode: true, microCycles: [{ duration: '5 weeks', volume: 'Low' }] });
    expect(() => updateRoutinePlan(routine, { microCycles: [{ duration: '3 weeks', volume: 'Low' }] })).toThrow(/cannot change/);
    expect(() => updateRoutinePlan(routine, { microCycles: [] })).toThrow(/cannot change/);
    const updated = updateRoutinePlan(routine, { microCycles: [{ volume: 'High' }] });
    expect(updated.workouts[0].exercises[0].generated.prescription).toBe('5 × 10');
    expect(updated.inputs.microCycles[0].duration).toBe('5 weeks');
  });

  it.each([
    { maxSquat: '' }, { maxPress: Infinity }, { maxDead: 'NaN' }, { maxSquat: 1002 }, { maxPress: 0 },
    { maxSquat: true },
    { maxProgressionMode: 'surprise' }, { maxProgressionMode: '' }, { maxProgressionMode: null },
    { mainLiftChoice: 'Medium' }, { pressWeakPoint: 'Arms' },
    { deadliftWeakPoint: 'Chest' }, { deadliftTabataEnabled: 'false' },
    { squatEventEnabled: true, squatEventMovement: '   ', squatEventSets: 3, squatEventReps: 8 },
    { squatEventEnabled: true, squatEventMovement: 'Yoke', squatEventSets: 1.5, squatEventReps: 8 },
    { squatEventEnabled: true, squatEventMovement: 'Yoke', squatEventSets: 21, squatEventReps: 8 },
    { squatEventEnabled: true, squatEventMovement: 'Yoke', squatEventSets: 3, squatEventReps: 101 },
  ])('rejects invalid input without mutating the saved routine: %o', changes => {
    const routine = makeRoutine();
    const before = JSON.stringify(routine);
    expect(() => updateRoutinePlan(routine, changes)).toThrow();
    expect(JSON.stringify(routine)).toBe(before);
  });

  it.each([
    { squatIncrement: -1 }, { pressIncrement: 101 }, { deadliftIncrement: 'Infinity' },
  ])('rejects invalid increments when fixed progression is active: %o', changes => {
    const routine = makeRoutine({ mesoMode: true, microCycles: [{ duration: '5 weeks', volume: 'Low' }] });
    const before = JSON.stringify(routine);
    expect(() => updateRoutinePlan(routine, changes)).toThrow(/increase/);
    expect(JSON.stringify(routine)).toBe(before);
  });

  it('allows Tabata-only edits with dormant invalid builder fields and retains their values', () => {
    const routine = makeRoutine({
      squatIncrement: '101', pressIncrement: '-1', deadliftIncrement: 'Infinity',
      squatEventEnabled: false, squatEventMovement: 'Yoke', squatEventSets: '0', squatEventReps: '101',
    });
    const updated = updateRoutinePlan(routine, { deadliftTabataEnabled: false });

    expect(updated.inputs).toEqual({ ...routine.inputs, deadliftTabataEnabled: false });
    expect(findExercise(updated.workouts[2], 'Tabata sprints')).toBeUndefined();
    expect(() => updateRoutinePlan(updated, { squatEventEnabled: true })).toThrow(/event sets/);
    expect(() => updateRoutinePlan(updated, { squatEventEnabled: true, squatEventSets: '3' })).toThrow(/event reps/);
  });

  it.each(['same', 'adaptive'])('validates dormant increments when switching from %s to fixed', mode => {
    const routine = makeRoutine({
      mesoMode: true, maxProgressionMode: mode, squatIncrement: '101',
      microCycles: [{ duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' }],
    });
    const updated = updateRoutinePlan(routine, { deadliftTabataEnabled: false });

    expect(updated.inputs.squatIncrement).toBe('101');
    expect(updated.workouts[15].effectiveMaxes.maxSquat).toBe(500);
    expect(() => updateRoutinePlan(updated, { maxProgressionMode: 'fixed' })).toThrow(/Squat increase/);
    const fixed = updateRoutinePlan(updated, { maxProgressionMode: 'fixed', squatIncrement: '' });
    expect(fixed.workouts[15].effectiveMaxes.maxSquat).toBe(500);
  });

  it('is a no-op for unchanged settings and ignores unrelated requested fields', () => {
    const routine = makeRoutine();
    expect(updateRoutinePlan(routine, { ...routine.inputs, workouts: [], profileId: 'other', mystery: 'ignore' })).toBe(routine);
  });
});
