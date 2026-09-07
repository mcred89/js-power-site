export const TABATA_PRESCRIPTION = '8 rounds: 20 seconds sprint / 10 seconds rest';

export const tabataRoundCount = exercise => {
  if (!exercise || (exercise.weight ?? exercise.plannedWeight ?? '') !== '') return 0;
  const match = String(exercise.prescription || '')
    .match(/^\s*(\d+) rounds?: 20 seconds sprint \/ 10 seconds rest\s*$/i);
  const count = Number(match?.[1]);
  return Number.isInteger(count) && count > 0 && count <= 100 ? count : 0;
};

export const isTabataExercise = exercise => tabataRoundCount(exercise) > 0;

// Substitutions keep settled sets and the original prescription. Their completed
// sprint rounds should retain interval labels even when later work changes.
export const isTabataRound = (exercise, set) => (
  (isTabataExercise(exercise) || isTabataExercise(exercise.original)) &&
  [set.plannedWeight, set.actualWeight, set.plannedReps, set.actualReps]
    .every(value => (value ?? '') === '')
);
