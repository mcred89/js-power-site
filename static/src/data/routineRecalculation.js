import { adaptiveCycleMaxes, createRoutine, visibleExercise } from './routines';
import { hasAdaptiveProgression } from './routineGeneration';
import { isTabataExercise } from './tabata';

const now = () => new Date().toISOString();

const accessoryNames = {
  Press: ['Dumbbell overhead press', 'Tricep extensions'],
  Deadlift: ['Bent over rows', 'Hip thrusters', 'Romanian deadlifts'],
};

// Derive roles from the original generated prescription, never its displayed override.
// Positions change when back-offs, accessories, events, or finishers are added.
const generatedExerciseRole = (exercise, workout) => {
  const { movement, prescription } = exercise.generated || {};
  if (movement === workout.name || (workout.name === 'Strongman' && movement === 'Strongman day')) return 'primary';
  if (movement === `${workout.name} back-off`) return `backoff:${prescription}`;
  if (accessoryNames[workout.name]?.includes(movement)) return 'accessory';
  if (workout.name === 'Press' && movement === 'Curls') return 'curls';
  if (typeof movement === 'string' && movement.startsWith('Strongman event: ')) return 'event';
  if (movement === 'Tabata sprints') return 'finisher';
  return null;
};

export const hasExerciseOverrides = exercise => Object.values(exercise.overrides || {})
  .some(value => value !== null && value !== undefined);

const mergeGeneratedExercises = (workout, generatedWorkout) => {
  const remaining = new Set(workout.exercises);
  const exercises = generatedWorkout.exercises.map(exercise => {
    const role = generatedExerciseRole(exercise, generatedWorkout);
    const existing = workout.exercises.find(candidate => (
      remaining.has(candidate) && role && generatedExerciseRole(candidate, workout) === role
    ));
    if (!existing) return exercise;
    remaining.delete(existing);
    return {
      ...existing,
      generated: { ...existing.generated, ...exercise.generated },
    };
  });
  // A removed option must not erase an individually edited exercise. Keep unknown
  // imported/custom exercises too; the unchanged stored shape needs no migration.
  const retained = [...remaining].filter(exercise => (
    hasExerciseOverrides(exercise) || !generatedExerciseRole(exercise, workout)
  ));
  const combined = [...exercises, ...retained];
  const isFinisher = exercise => generatedExerciseRole(exercise, workout) === 'finisher' ||
    isTabataExercise(visibleExercise(exercise));
  return [...combined.filter(exercise => !isFinisher(exercise)), ...combined.filter(isFinisher)];
};

// Reuse this path for plan edits, max corrections, and adaptive recalculation so
// later refreshes cannot destroy custom work retained by a previous plan edit.
export const regenerateFutureWorkouts = (routine, inputs = routine.inputs) => {
  const nextRoutine = { ...routine, inputs };
  const cycleMaxes = inputs.mesoMode && hasAdaptiveProgression(inputs)
    ? adaptiveCycleMaxes(nextRoutine)
    : [];
  const regenerated = createRoutine(routine.profileId, routine.name, inputs, cycleMaxes);
  const generatedBySequence = new Map(regenerated.workouts.map(workout => [workout.sequence, workout]));
  return routine.workouts.map(workout => {
    const generatedWorkout = generatedBySequence.get(workout.sequence);
    // Every existing session is a snapshot, including imported/unknown statuses.
    if (workout.completedAt || workout.skippedAt || workout.session || !generatedWorkout ||
        workout.name !== generatedWorkout.name || workout.cycleIndex !== generatedWorkout.cycleIndex ||
        workout.weekIndex !== generatedWorkout.weekIndex) return workout;
    const next = {
      ...workout,
      effectiveMaxes: { ...workout.effectiveMaxes, ...generatedWorkout.effectiveMaxes },
      exercises: mergeGeneratedExercises(workout, generatedWorkout),
    };
    return JSON.stringify(next) === JSON.stringify(workout) ? workout : next;
  });
};

export const refreshAdaptiveProgression = routine => {
  if (!routine.inputs?.mesoMode || !hasAdaptiveProgression(routine.inputs)) {
    return { routine, changed: false };
  }
  const workouts = regenerateFutureWorkouts(routine);
  const changed = workouts.some((workout, index) => workout !== routine.workouts[index]);
  return {
    changed,
    routine: changed ? { ...routine, workouts, updatedAt: now() } : routine,
  };
};

export const correctMaxes = (routine, maxes) => {
  const inputs = { ...routine.inputs, ...maxes };
  return {
    ...routine,
    inputs,
    updatedAt: now(),
    workouts: regenerateFutureWorkouts(routine, inputs),
  };
};
