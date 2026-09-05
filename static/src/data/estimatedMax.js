export const MAIN_LIFTS = ['Squat', 'Press', 'Deadlift'];

const numeric = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeMainLift = movement => {
  const normalized = String(movement || '').trim().toLowerCase();
  return MAIN_LIFTS.find(lift => lift.toLowerCase() === normalized) || null;
};

export const estimatedOneRepMax = (weight, reps) => {
  const parsedWeight = numeric(weight);
  const parsedReps = numeric(reps);
  if (parsedWeight === null || parsedReps === null || parsedWeight <= 0 || parsedReps <= 0) return null;
  return parsedWeight * (1 + parsedReps / 30);
};

export const completedPrimaryEstimate = workout => {
  if (!workout?.completedAt || !workout.session?.exercises) return null;
  const primary = workout.session.exercises.find(exercise => (
    exercise.exerciseId === workout.session.primaryExerciseId
  )) || workout.session.exercises[0];
  const lift = normalizeMainLift(primary?.movement);
  const workoutLift = normalizeMainLift(workout.name);
  if (!lift || !workoutLift || lift !== workoutLift) return null;
  const estimates = (primary.sets || [])
    .filter(set => set.status === 'completed')
    .map(set => estimatedOneRepMax(set.actualWeight, set.actualReps))
    .filter(value => value !== null);
  return estimates.length ? { lift, value: Math.max(...estimates) } : null;
};
