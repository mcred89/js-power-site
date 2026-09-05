import { createRoutine } from './routinePlanning';
import { cloneStrongmanRoutine } from './strongmanTransfer';

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2);
const now = () => new Date().toISOString();

export const duplicateRoutine = (routine, profileId, name) => {
  if (routine.kind === 'strongman') return cloneStrongmanRoutine(routine, { profileId, name });
  const timestamp = now();
  return {
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
      ...(workout.kind === 'eventSlot' ? { eventRef: null, eventRemoved: false, skippedAt: null } : {}),
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
  };
};

export const createRoutineTemplate = (routine, name) => {
  const timestamp = now();
  if (routine.kind === 'strongman') {
    const copy = cloneStrongmanRoutine(routine, { name });
    return {
      id: copy.id, kind: 'strongman', name,
      inputs: { ...copy.inputs, competitionDate: '' }, createdAt: timestamp, updatedAt: timestamp,
    };
  }
  return {
    id: makeId(),
    name,
    kind: 'strength',
    inputs: {
      ...routine.inputs,
      microCycles: routine.inputs?.microCycles?.map(cycle => ({ ...cycle })),
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createRoutineFromTemplate = (template, profileId, name) => {
  if (template.kind === 'strongman') throw new Error('Use the strongman builder to create a block from this template.');
  return createRoutine(profileId, name, {
    ...template.inputs,
    microCycles: template.inputs?.microCycles?.map(cycle => ({ ...cycle })),
  });
};

export const cloneImportedRecord = record => ({
  ...record,
  id: makeId(),
  name: `${record.name} (Imported)`,
  createdAt: now(),
  updatedAt: now(),
});
