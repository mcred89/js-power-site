import { buildRoutinePlan } from '../components/RoutineGenerator';

const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const now = () => new Date().toISOString();

export const visibleExercise = exercise => ({
  movement: exercise.overrides.movement ?? exercise.generated.movement,
  weight: exercise.overrides.weight ?? exercise.generated.weight,
  prescription: exercise.overrides.prescription ?? exercise.generated.prescription,
});

export const createRoutine = (profileId, name, inputs) => {
  let sequence = 0;
  const workouts = [];

  buildRoutinePlan(inputs).forEach((cycle, cycleIndex) => {
    cycle.weeks.forEach((week, weekIndex) => {
      week.forEach(day => {
        sequence += 1;
        workouts.push({
          id: makeId(),
          sequence,
          cycleIndex,
          cycleLabel: inputs.mesoMode ? `Cycle ${cycleIndex + 1}` : null,
          weekIndex,
          weekLabel: `Week ${weekIndex + 1}`,
          name: day.name,
          completedAt: null,
          exercises: day.exercises.map(exercise => ({
            id: makeId(),
            generated: { ...exercise },
            overrides: {},
          })),
        });
      });
    });
  });

  const timestamp = now();
  return {
    id: makeId(),
    profileId,
    name,
    inputs: { ...inputs },
    workouts,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const setWorkoutComplete = (routine, workoutId, complete) => ({
  ...routine,
  updatedAt: now(),
  workouts: routine.workouts.map(workout => (
    workout.id === workoutId
      ? { ...workout, completedAt: complete ? now() : null }
      : workout
  )),
});

export const updateExercise = (routine, workoutId, exerciseId, values) => ({
  ...routine,
  updatedAt: now(),
  workouts: routine.workouts.map(workout => (
    workout.id !== workoutId || workout.completedAt
      ? workout
      : {
        ...workout,
        exercises: workout.exercises.map(exercise => (
          exercise.id === exerciseId
            ? { ...exercise, overrides: { ...exercise.overrides, ...values } }
            : exercise
        )),
      }
  )),
});

export const clearExerciseOverrides = (routine, workoutId, exerciseId) => ({
  ...routine,
  updatedAt: now(),
  workouts: routine.workouts.map(workout => (
    workout.id !== workoutId || workout.completedAt
      ? workout
      : {
        ...workout,
        exercises: workout.exercises.map(exercise => (
          exercise.id === exerciseId ? { ...exercise, overrides: {} } : exercise
        )),
      }
  )),
});

export const correctMaxes = (routine, maxes) => {
  const inputs = { ...routine.inputs, ...maxes };
  const regenerated = createRoutine(routine.profileId, routine.name, inputs);

  return {
    ...routine,
    inputs,
    updatedAt: now(),
    workouts: routine.workouts.map((workout, workoutIndex) => {
      if (workout.completedAt || !regenerated.workouts[workoutIndex]) {
        return workout;
      }
      const generatedWorkout = regenerated.workouts[workoutIndex];
      return {
        ...workout,
        exercises: generatedWorkout.exercises.map((exercise, exerciseIndex) => ({
          ...exercise,
          id: workout.exercises[exerciseIndex]?.id || exercise.id,
          overrides: workout.exercises[exerciseIndex]?.overrides || {},
        })),
      };
    }),
  };
};

export const cloneImportedRecord = record => ({
  ...record,
  id: makeId(),
  name: `${record.name} (Imported)`,
  createdAt: now(),
  updatedAt: now(),
});

