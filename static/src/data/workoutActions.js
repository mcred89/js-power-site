const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Optional workout actions load when requested, outside the initial shell.
export const substituteSessionExercise = (
  routine,
  workoutId,
  exerciseId,
  values,
  timestamp = new Date().toISOString(),
) => ({
  ...routine,
  updatedAt: new Date().toISOString(),
  workouts: routine.workouts.map(workout => {
    if (workout.id !== workoutId || workout.session?.status !== 'inProgress') return workout;
    const remainingSetCount = Math.max(1, Number(values.setCount) || 1);
    const exercises = workout.session.exercises.map(exercise => {
      if (exercise.exerciseId !== exerciseId) return exercise;
      const settled = exercise.sets.filter(set => set.status !== 'pending');
      const original = exercise.original || {
        movement: exercise.movement,
        prescription: exercise.prescription,
        plannedWeight: exercise.plannedWeight,
      };
      const pending = Array.from({ length: remainingSetCount }, (_, index) => ({
        id: makeId(),
        number: settled.length + index + 1,
        plannedWeight: values.weight,
        plannedReps: values.reps,
        actualWeight: values.weight,
        actualReps: values.reps,
        status: 'pending',
        completedAt: null,
        skippedAt: null,
        skipActionId: null,
        splitSeconds: null,
      }));
      return {
        ...exercise,
        movement: values.movement,
        prescription: `${remainingSetCount} × ${values.reps}`,
        plannedWeight: values.weight,
        original,
        substitutedAt: timestamp,
        sets: [...settled, ...pending],
      };
    });
    return {
      ...workout,
      session: {
        ...workout.session,
        exercises,
        runningSince: workout.session.runningSince || timestamp,
        stoppedAt: null,
      },
    };
  }),
});

export const deleteFutureWorkout = (routine, workoutId) => ({
  ...routine,
  updatedAt: new Date().toISOString(),
  workouts: routine.workouts.filter(workout => (
    workout.id !== workoutId || workout.completedAt
  )),
  ...(routine.strongmanLog && routine.workouts.some(workout => workout.id === workoutId && !workout.completedAt) ? {
    strongmanLog: routine.strongmanLog.map(entry => entry.workoutId === workoutId ? { ...entry, workoutId: null } : entry),
  } : {}),
});
