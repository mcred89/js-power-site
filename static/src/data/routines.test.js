import {
  correctMaxes,
  createRoutine,
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
  });

  it('keeps manual exercise overrides through a max correction', () => {
    let routine = createRoutine('profile-1', 'Test plan', inputs);
    const workout = routine.workouts[0];
    const exercise = workout.exercises[0];
    routine = updateExercise(routine, workout.id, exercise.id, { weight: '350', prescription: '3 × 5' });
    routine = correctMaxes(routine, { maxSquat: '600', maxPress: '225', maxDead: '600' });

    expect(visibleExercise(routine.workouts[0].exercises[0])).toMatchObject({ weight: '350', prescription: '3 × 5' });
  });
});
