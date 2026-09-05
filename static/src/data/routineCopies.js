import { restoreLegacyEventSlots } from './retiredStrongman';

// Copy and template creation are loaded only from plan actions.
const makeId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const now = () => new Date().toISOString();

export const duplicateRoutine = (routine, profileId, name) => {
  const timestamp = now();
  return restoreLegacyEventSlots({
    ...routine,
    id: makeId(),
    profileId,
    name,
    inputs: {
      ...routine.inputs,
      microCycles: routine.inputs?.microCycles?.map(cycle => ({ ...cycle })),
    },
    workouts: routine.workouts.map(workout => ({
      ...workout,
      id: makeId(),
      completedAt: null,
      session: null,
      effectiveMaxes: workout.effectiveMaxes ? { ...workout.effectiveMaxes } : workout.effectiveMaxes,
      exercises: workout.exercises.map(exercise => ({
        ...exercise,
        id: makeId(),
        generated: { ...exercise.generated },
        overrides: { ...exercise.overrides },
      })),
    })),
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
};

export const createRoutineTemplate = (routine, name) => {
  const timestamp = now();
  return {
    id: makeId(),
    name,
    inputs: {
      ...routine.inputs,
      microCycles: routine.inputs?.microCycles?.map(cycle => ({ ...cycle })),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};
