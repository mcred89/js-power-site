import {
  adjustSessionSet,
  adaptiveCycleMaxes,
  archiveRoutine,
  completeSessionSet,
  correctMaxes,
  createRoutine,
  createRoutineFromTemplate,
  createRoutineTemplate,
  deleteFutureWorkout,
  duplicateRoutine,
  finishWorkoutSession,
  parsePrescription,
  reopenWorkoutSession,
  refreshAdaptiveProgression,
  routineHistoryToCsv,
  routinePlanToCsv,
  restoreRoutine,
  setSessionRpe,
  setWorkoutComplete,
  startWorkoutSession,
  skipRemainingSessionExercise,
  skipSessionSet,
  substituteSessionExercise,
  undoLatestSessionAction,
  undoLatestSessionSet,
  updateExercise,
  visibleExercise,
} from './routines';

const inputs = {
  maxSquat: '500',
  maxPress: '225',
  maxDead: '600',
  duration: '5 weeks',
  mainLiftChoice: 'Low',
  mesoMode: false,
  includeBackoffSets: false,
  includeStrongmanDay: false,
  pressWeakPoint: 'Triceps',
  deadliftWeakPoint: 'Back',
};

describe('tracked routines', () => {
  it('archives and restores a routine without changing its workouts', () => {
    const routine = createRoutine('profile-1', 'Test plan', inputs);
    const archived = archiveRoutine(routine);
    const restored = restoreRoutine(archived);

    expect(archived.archived).toBe(true);
    expect(restored.archived).toBe(false);
    expect(restored.workouts).toBe(routine.workouts);
  });

  it('parses exact, ranged, and open prescriptions for set tracking', () => {
    expect(parsePrescription('4 × 6')).toEqual({ setCount: 4, plannedReps: 6, actualReps: 6 });
    expect(parsePrescription('3 × 5–20')).toEqual({ setCount: 3, plannedReps: '5–20', actualReps: 5 });
    expect(parsePrescription('')).toEqual({ setCount: 1, plannedReps: '', actualReps: '' });
  });

  it('turns a generated plan into an ordered workout queue', () => {
    const routine = createRoutine('profile-1', 'Test plan', inputs);

    expect(routine.workouts).toHaveLength(15);
    expect(routine.workouts[0]).toMatchObject({ sequence: 1, weekLabel: 'Week 1', name: 'Squat' });
    expect(routine.workouts[0].effectiveMaxes).toEqual({ maxSquat: 500, maxPress: 225, maxDead: 600 });
    expect(visibleExercise(routine.workouts[0].exercises[0])).toEqual({
      movement: 'Squat',
      weight: 325,
      prescription: '4 × 6',
    });
  });

  it('preserves completed prescriptions while recalculating future workouts', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const completed = routine.workouts[0];
    routine = setWorkoutComplete(routine, completed.id, true);
    routine = correctMaxes(routine, { maxSquat: '600', maxPress: '225', maxDead: '600' });

    expect(visibleExercise(routine.workouts[0].exercises[0]).weight).toBe(325);
    expect(visibleExercise(routine.workouts[3].exercises[0]).weight).toBe(420);
    expect(routine.workouts[0].effectiveMaxes.maxSquat).toBe(500);
    expect(routine.workouts[3].effectiveMaxes.maxSquat).toBe(600);
  });

  it('keeps manual exercise overrides through a max correction', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const workout = routine.workouts[0];
    const exercise = workout.exercises[0];
    routine = updateExercise(routine, workout.id, exercise.id, { weight: '350', prescription: '3 × 5' });
    routine = correctMaxes(routine, { maxSquat: '600', maxPress: '225', maxDead: '600' });

    expect(visibleExercise(routine.workouts[0].exercises[0])).toMatchObject({ weight: '350', prescription: '3 × 5' });
  });

  it('raises adaptive future cycles from the best completed estimate and propagates it', () => {
    let routine = createRoutine('profile-1', 'Adaptive plan', {
      ...inputs,
      mesoMode: true,
      maxProgressionMode: 'adaptive',
      microCycles: [
        { duration: '3 weeks', volume: 'Low' },
        { duration: '3 weeks', volume: 'Low' },
        { duration: '3 weeks', volume: 'Low' },
      ],
    });
    routine = startWorkoutSession(routine, routine.workouts[0].id, '2026-01-01T00:00:00.000Z');
    const session = routine.workouts[0].session;
    routine = adjustSessionSet(routine, routine.workouts[0].id, session.exercises[0].exerciseId, session.exercises[0].sets[0].id, {
      actualWeight: '405', actualReps: '10',
    });
    routine = completeSessionSet(routine, routine.workouts[0].id, session.exercises[0].exerciseId, session.exercises[0].sets[0].id, '2026-01-01T00:01:00.000Z');
    routine = finishWorkoutSession(routine, routine.workouts[0].id, '2026-01-01T00:02:00.000Z');
    const refreshed = refreshAdaptiveProgression(routine);

    expect(refreshed.changed).toBe(true);
    expect(adaptiveCycleMaxes(refreshed.routine)).toEqual([
      { maxSquat: 500, maxPress: 225, maxDead: 600 },
      { maxSquat: 540, maxPress: 225, maxDead: 600 },
      { maxSquat: 540, maxPress: 225, maxDead: 600 },
    ]);
    expect(refreshed.routine.workouts[15].effectiveMaxes.maxSquat).toBe(540);
    expect(visibleExercise(refreshed.routine.workouts[15].exercises[0]).weight).toBe(355);
    expect(refreshed.routine.workouts[30].effectiveMaxes.maxSquat).toBe(540);
    expect(refreshed.routine.workouts[0].effectiveMaxes.maxSquat).toBe(500);
  });

  it('uses the prior max as an adaptive floor and freezes an active future workout', () => {
    let routine = createRoutine('profile-1', 'Adaptive plan', {
      ...inputs,
      mesoMode: true,
      maxProgressionMode: 'adaptive',
      microCycles: [
        { duration: '3 weeks', volume: 'Low' },
        { duration: '3 weeks', volume: 'Low' },
      ],
    });
    routine = startWorkoutSession(routine, routine.workouts[15].id, '2026-01-01T00:00:00.000Z');
    routine = {
      ...routine,
      workouts: routine.workouts.map((workout, index) => index === 0 ? {
        ...workout,
        completedAt: '2026-01-02T00:00:00.000Z',
        session: {
          primaryExerciseId: 'primary',
          exercises: [{ exerciseId: 'primary', movement: 'Squat', sets: [
            { status: 'completed', actualWeight: 380, actualReps: 10 },
          ] }],
        },
      } : workout),
    };
    const refreshed = refreshAdaptiveProgression(routine).routine;

    expect(refreshed.workouts[15].effectiveMaxes.maxSquat).toBe(500);
    expect(refreshed.workouts[15].session.status).toBe('inProgress');
    expect(refreshed.workouts[18].effectiveMaxes.maxSquat).toBe(505);
  });

  it('duplicates the current plan without history or shared nested data', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const firstWorkout = routine.workouts[0];
    const firstExercise = firstWorkout.exercises[0];
    routine = updateExercise(routine, firstWorkout.id, firstExercise.id, { weight: '350' });
    routine = setWorkoutComplete(routine, firstWorkout.id, true);
    routine = deleteFutureWorkout(routine, routine.workouts[1].id);

    const copy = duplicateRoutine(routine, 'profile-2', 'Copied plan');

    expect(copy).toMatchObject({ profileId: 'profile-2', name: 'Copied plan', archived: false });
    expect(copy.id).not.toBe(routine.id);
    expect(copy.workouts).toHaveLength(routine.workouts.length);
    expect(copy.workouts.every(workout => workout.completedAt === null && workout.session === null)).toBe(true);
    expect(copy.workouts[0].id).not.toBe(routine.workouts[0].id);
    expect(copy.workouts[0].exercises[0].id).not.toBe(routine.workouts[0].exercises[0].id);
    expect(copy.workouts[0].exercises[0].overrides).toEqual({ weight: '350' });

    const editedCopy = updateExercise(copy, copy.workouts[0].id, copy.workouts[0].exercises[0].id, { weight: '400' });
    expect(visibleExercise(editedCopy.workouts[0].exercises[0]).weight).toBe('400');
    expect(visibleExercise(routine.workouts[0].exercises[0]).weight).toBe('350');
  });

  it('stores only generator inputs in templates and regenerates a fresh routine', () => {
    const routine = createRoutine('profile-1', 'Test plan', {
      ...inputs,
      mesoMode: true,
      microCycles: [{ duration: '3 weeks', volume: 'High' }],
    });
    const template = createRoutineTemplate(routine, 'Reusable setup');
    const generated = createRoutineFromTemplate(template, 'profile-2', 'Next plan');

    expect(template).toMatchObject({ name: 'Reusable setup', inputs: routine.inputs });
    expect(template.workouts).toBeUndefined();
    expect(generated).toMatchObject({ profileId: 'profile-2', name: 'Next plan' });
    expect(generated.workouts.every(workout => workout.completedAt === null && workout.session === null)).toBe(true);
    generated.inputs.microCycles[0].volume = 'Low';
    expect(template.inputs.microCycles[0].volume).toBe('High');
  });

  it('starts a session and propagates adjustments through pending sets', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const workout = routine.workouts[0];
    routine = startWorkoutSession(routine, workout.id, '2026-08-18T12:00:00.000Z');
    const sessionExercise = routine.workouts[0].session.exercises[0];
    routine = adjustSessionSet(routine, workout.id, sessionExercise.exerciseId, sessionExercise.sets[1].id, {
      actualWeight: '315',
      actualReps: '5',
    });

    const sets = routine.workouts[0].session.exercises[0].sets;
    expect(sets.map(set => set.actualWeight)).toEqual([325, '315', '315', '315']);
    expect(sets.map(set => set.actualReps)).toEqual([6, '5', '5', '5']);
    expect(sets[1].plannedWeight).toBe(325);
    expect(sets[1].plannedReps).toBe(6);
  });

  it('starts an accessory at zero and carries its last completed weight forward', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const firstPress = routine.workouts[1];
    routine = startWorkoutSession(routine, firstPress.id, '2026-08-18T12:00:00.000Z');
    const firstAccessory = routine.workouts[1].session.exercises.find(exercise => exercise.movement === 'Tricep extensions');
    expect(firstAccessory.sets.map(set => set.actualWeight)).toEqual([0, 0, 0]);

    firstAccessory.sets.forEach(set => {
      set.status = 'completed';
      set.actualWeight = '35';
    });
    routine.workouts[1].completedAt = '2026-08-18T13:00:00.000Z';
    const nextPress = routine.workouts[4];
    routine = startWorkoutSession(routine, nextPress.id, '2026-08-25T12:00:00.000Z');
    const nextAccessory = routine.workouts[4].session.exercises.find(exercise => exercise.movement === 'Tricep extensions');

    expect(nextAccessory.sets.map(set => set.actualWeight)).toEqual(['35', '35', '35']);
    expect(nextAccessory.sets.map(set => set.plannedWeight)).toEqual(['35', '35', '35']);
  });

  it('records stopwatch splits and does not propagate through completed sets', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const workout = routine.workouts[0];
    routine = startWorkoutSession(routine, workout.id, '2026-08-18T12:00:00.000Z');
    let exercise = routine.workouts[0].session.exercises[0];
    routine = completeSessionSet(routine, workout.id, exercise.exerciseId, exercise.sets[0].id, '2026-08-18T12:01:05.000Z');
    exercise = routine.workouts[0].session.exercises[0];
    routine = adjustSessionSet(routine, workout.id, exercise.exerciseId, exercise.sets[1].id, { actualWeight: '300' });

    const sets = routine.workouts[0].session.exercises[0].sets;
    expect(sets[0]).toMatchObject({ status: 'completed', actualWeight: 325, splitSeconds: 65 });
    expect(sets.slice(1).map(set => set.actualWeight)).toEqual(['300', '300', '300']);
  });

  it('undoes only the latest set and resumes a stopped stopwatch', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const workout = routine.workouts[0];
    routine = startWorkoutSession(routine, workout.id, '2026-08-18T12:00:00.000Z');
    routine.workouts[0].session.exercises = [routine.workouts[0].session.exercises[0]];
    const exercise = routine.workouts[0].session.exercises[0];
    exercise.sets.forEach((set, index) => {
      routine = completeSessionSet(routine, workout.id, exercise.exerciseId, set.id, `2026-08-18T12:0${index + 1}:00.000Z`);
    });
    routine = undoLatestSessionSet(routine, workout.id, '2026-08-18T12:05:00.000Z');

    const session = routine.workouts[0].session;
    expect(session.exercises[0].sets.map(set => set.status)).toEqual(['completed', 'completed', 'completed', 'pending']);
    expect(session.elapsedSeconds).toBe(180);
    expect(session.runningSince).toBe('2026-08-18T12:05:00.000Z');
  });

  it('skips a set or remaining exercise and undoes the grouped skip', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const workout = routine.workouts[0];
    routine = startWorkoutSession(routine, workout.id, '2026-08-18T12:00:00.000Z');
    let exercise = routine.workouts[0].session.exercises[0];
    routine = skipSessionSet(routine, workout.id, exercise.exerciseId, exercise.sets[0].id, '2026-08-18T12:01:00.000Z');
    exercise = routine.workouts[0].session.exercises[0];
    expect(exercise.sets.map(set => set.status)).toEqual(['skipped', 'pending', 'pending', 'pending']);

    routine = skipRemainingSessionExercise(routine, workout.id, exercise.exerciseId, '2026-08-18T12:02:00.000Z');
    const grouped = routine.workouts[0].session.exercises[0].sets.slice(1);
    expect(new Set(grouped.map(set => set.skipActionId)).size).toBe(1);
    routine = undoLatestSessionAction(routine, workout.id, '2026-08-18T12:03:00.000Z');
    expect(routine.workouts[0].session.exercises[0].sets.map(set => set.status)).toEqual(['skipped', 'pending', 'pending', 'pending']);
  });

  it('substitutes only pending session work and preserves the generated plan', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const workout = routine.workouts[0];
    const generatedMovement = visibleExercise(workout.exercises[0]).movement;
    routine = startWorkoutSession(routine, workout.id, '2026-08-18T12:00:00.000Z');
    let exercise = routine.workouts[0].session.exercises[0];
    routine = completeSessionSet(routine, workout.id, exercise.exerciseId, exercise.sets[0].id, '2026-08-18T12:01:00.000Z');
    exercise = routine.workouts[0].session.exercises[0];
    routine = substituteSessionExercise(routine, workout.id, exercise.exerciseId, {
      movement: 'Hack squat', weight: '225', setCount: '2', reps: '8',
    }, '2026-08-18T12:02:00.000Z');

    const substituted = routine.workouts[0].session.exercises[0];
    expect(substituted).toMatchObject({ movement: 'Hack squat', original: { movement: generatedMovement } });
    expect(substituted.sets.map(set => set.status)).toEqual(['completed', 'pending', 'pending']);
    expect(substituted.sets.slice(1).map(set => set.actualWeight)).toEqual(['225', '225']);
    expect(visibleExercise(routine.workouts[0].exercises[0]).movement).toBe(generatedMovement);
    routine = finishWorkoutSession(routine, workout.id, '2026-08-18T12:03:00.000Z');
    expect(routineHistoryToCsv(routine)).toContain('"Hack squat","Squat"');
  });

  it('finishes early with skipped sets, stored RPE, and the last set split', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const workout = routine.workouts[0];
    routine = startWorkoutSession(routine, workout.id, '2026-08-18T12:00:00.000Z');
    const exercise = routine.workouts[0].session.exercises[0];
    routine = completeSessionSet(routine, workout.id, exercise.exerciseId, exercise.sets[0].id, '2026-08-18T12:01:30.000Z');
    routine = setSessionRpe(routine, workout.id, 8);
    routine = finishWorkoutSession(routine, workout.id, '2026-08-18T12:03:00.000Z');

    const finished = routine.workouts[0];
    expect(finished.completedAt).toBe('2026-08-18T12:03:00.000Z');
    expect(finished.session).toMatchObject({
      status: 'completed',
      elapsedSeconds: 90,
      stoppedAt: '2026-08-18T12:01:30.000Z',
      rpe: 8,
    });
    expect(finished.session.exercises[0].sets.map(set => set.status)).toEqual(['completed', 'skipped', 'skipped', 'skipped']);
    expect(routineHistoryToCsv(routine)).toContain('"325","6","325","6","8","90","90"');

    routine = reopenWorkoutSession(routine, workout.id, '2026-08-18T12:04:00.000Z');
    expect(routine.workouts[0].completedAt).toBeNull();
    expect(routine.workouts[0].session.exercises[0].sets[1].status).toBe('pending');
  });

  it('deletes an incomplete workout without completing later workouts', () => {
    const routine = createRoutine('profile-1', 'Test plan', inputs);
    const deleted = routine.workouts[2];
    const updated = deleteFutureWorkout(routine, deleted.id);

    expect(updated.workouts).toHaveLength(14);
    expect(updated.workouts.map(workout => workout.id)).not.toContain(deleted.id);
    expect(updated.workouts.every(workout => workout.completedAt === null)).toBe(true);
    expect(updated.workouts[2].sequence).toBe(4);
  });

  it('does not delete a completed workout', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    routine = setWorkoutComplete(routine, routine.workouts[0].id, true);

    expect(deleteFutureWorkout(routine, routine.workouts[0].id).workouts).toHaveLength(15);
  });

  it('recalculates the matching generated workouts after one is deleted', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    routine = deleteFutureWorkout(routine, routine.workouts[1].id);
    routine = correctMaxes(routine, { maxSquat: '600', maxPress: '300', maxDead: '600' });

    expect(routine.workouts[1].sequence).toBe(3);
    expect(routine.workouts[1].name).toBe('Deadlift');
    expect(visibleExercise(routine.workouts[1].exercises[0]).movement).toBe('Deadlift');
  });

  it('preserves snapshots, exercise identities, overrides, sessions, gaps, and unknown sequences', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const completed = routine.workouts[0];
    const future = routine.workouts[3];
    routine = setWorkoutComplete(routine, completed.id, true);
    routine = updateExercise(routine, future.id, future.exercises[0].id, {
      movement: 'Paused squat',
      weight: '377',
    });
    routine = startWorkoutSession(routine, future.id, '2026-08-18T12:00:00.000Z');
    routine = substituteSessionExercise(routine, future.id, future.exercises[0].id, {
      movement: 'Belt squat', weight: '300', setCount: '2', reps: '8',
    }, '2026-08-18T12:01:00.000Z');
    routine = deleteFutureWorkout(routine, routine.workouts[1].id);
    const activeBefore = routine.workouts.find(item => item.id === future.id);
    const completedBefore = routine.workouts.find(item => item.id === completed.id);
    const unknown = { ...routine.workouts[2], id: 'imported-workout', sequence: 9999 };
    routine = { ...routine, workouts: [...routine.workouts, unknown] };

    const corrected = correctMaxes(routine, {
      maxSquat: '650', maxPress: '250', maxDead: '700',
    });
    const activeAfter = corrected.workouts.find(item => item.id === future.id);

    expect(corrected.workouts.find(item => item.id === completed.id)).toBe(completedBefore);
    expect(corrected.workouts.find(item => item.id === unknown.id)).toBe(unknown);
    expect(activeAfter.exercises[0].id).toBe(activeBefore.exercises[0].id);
    expect(activeAfter.exercises[0].overrides).toEqual({ movement: 'Paused squat', weight: '377' });
    expect(activeAfter.session).toBe(activeBefore.session);
    expect(activeAfter.session.exercises[0].movement).toBe('Belt squat');
    expect(corrected.workouts.map(item => item.sequence)).not.toContain(2);
  });

  it('corrects every matching workout in a long chained mesocycle', () => {
    const microCycles = Array.from({ length: 40 }, (_, index) => ({
      duration: index % 2 ? '5 weeks' : '3 weeks',
      volume: index % 3 ? 'Low' : 'High',
    }));
    const routine = createRoutine('profile-1', 'Long plan', { ...inputs, mesoMode: true, microCycles });
    const corrected = correctMaxes(routine, {
      maxSquat: '650', maxPress: '250', maxDead: '700',
    });

    expect(corrected.workouts).toHaveLength(routine.workouts.length);
    expect(corrected.workouts[corrected.workouts.length - 1].sequence).toBe(routine.workouts.length);
    expect(corrected.workouts.every((workout, index) => (
      workout.exercises.every((exercise, exerciseIndex) => (
        exercise.id === routine.workouts[index].exercises[exerciseIndex].id
      ))
    ))).toBe(true);
  });

  it('exports the stored plan with exercise overrides and workout status', () => {
    let routine = createRoutine('profile-1', 'Test, "plan"', inputs);
    const workout = routine.workouts[0];
    const exercise = workout.exercises[0];
    routine = updateExercise(routine, workout.id, exercise.id, { movement: 'Paused "Squat"', weight: '350' });
    routine = {
      ...routine,
      workouts: routine.workouts.map(item => item.id === workout.id
        ? { ...item, completedAt: '2026-08-18T12:00:00.000Z' }
        : item),
    };

    const csv = routinePlanToCsv(routine);

    expect(csv.split('\n')).toHaveLength(
      routine.workouts.reduce((total, item) => total + item.exercises.length, 1),
    );
    expect(csv).toContain('"Test, ""plan"""');
    expect(csv).toContain('"Paused ""Squat""","350","4 × 6","Completed","2026-08-18T12:00:00.000Z"');
    expect(csv).toContain('"Planned",""');
  });

  it('exports only completed workouts in history', () => {
    const routine = createRoutine('profile-1', 'Test plan', inputs);
    routine.workouts[1].completedAt = '2026-08-18T12:00:00.000Z';

    const csv = routineHistoryToCsv(routine);

    expect(csv.split('\n')).toHaveLength(routine.workouts[1].exercises.length + 1);
    expect(csv).toContain('"Press"');
    expect(csv).not.toContain('"Squat"');
    expect(csv).not.toContain('"Planned"');
  });
});
