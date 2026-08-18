import {
  adjustSessionSet,
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
  routineHistoryToCsv,
  routinePlanToCsv,
  setSessionRpe,
  setWorkoutComplete,
  startWorkoutSession,
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
};

describe('tracked routines', () => {
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
