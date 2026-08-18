import {
  correctMaxes,
  createRoutine,
  routineHistoryToCsv,
  routinePlanToCsv,
  setWorkoutComplete,
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
