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

const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

const workoutsToCsv = (routine, workouts) => {
  const rows = [[
    'Routine',
    'Microcycle',
    'Week',
    'Workout',
    'Session',
    'Movement',
    'Weight (lb)',
    'Prescription',
    'Status',
    'Completed at',
  ]];

  workouts.forEach(workout => workout.exercises.forEach(exercise => {
    const shown = visibleExercise(exercise);
    rows.push([
      routine.name,
      workout.cycleLabel,
      workout.weekLabel,
      workout.sequence,
      workout.name,
      shown.movement,
      shown.weight,
      shown.prescription,
      workout.completedAt ? 'Completed' : 'Planned',
      workout.completedAt,
    ]);
  }));

  return rows.map(row => row.map(escapeCsv).join(',')).join('\n');
};

export const routinePlanToCsv = routine => workoutsToCsv(routine, routine.workouts);

export const routineHistoryToCsv = routine => workoutsToCsv(
  routine,
  routine.workouts.filter(workout => workout.completedAt),
);

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
          effectiveMaxes: { ...cycle.effectiveMaxes },
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

export const deleteFutureWorkout = (routine, workoutId) => ({
  ...routine,
  updatedAt: now(),
  workouts: routine.workouts.filter(workout => (
    workout.id !== workoutId || workout.completedAt
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
    workouts: routine.workouts.map(workout => {
      const generatedWorkout = regenerated.workouts.find(item => item.sequence === workout.sequence);
      if (workout.completedAt || !generatedWorkout) {
        return workout;
      }
      return {
        ...workout,
        effectiveMaxes: { ...generatedWorkout.effectiveMaxes },
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
