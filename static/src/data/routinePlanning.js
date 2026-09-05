import { buildRoutinePlan, MAX_PROGRESSION_MODES } from './routineGeneration';
import { adaptiveCycleMaxes } from './routines';

const makeId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2);
const now = () => new Date().toISOString();

// Generation and future recalculation load on demand; active set tracking stays eager.
export const createRoutine = (profileId, name, inputs, resolvedCycleMaxes = []) => {
  let sequence = 0;
  const workouts = [];

  buildRoutinePlan(inputs, resolvedCycleMaxes).forEach((cycle, cycleIndex) => {
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
          session: null,
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
    kind: 'strength',
    name,
    inputs: { ...inputs },
    workouts,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const refreshAdaptiveProgression = routine => {
  if (routine.kind === 'strongman' || !routine.inputs?.mesoMode || routine.inputs.maxProgressionMode !== MAX_PROGRESSION_MODES.ADAPTIVE) {
    return { routine, changed: false };
  }
  const cycleMaxes = adaptiveCycleMaxes(routine);
  const regenerated = createRoutine(routine.profileId, routine.name, routine.inputs, cycleMaxes);
  const generatedBySequence = new Map(regenerated.workouts.map(workout => [workout.sequence, workout]));
  let changed = false;
  const workouts = routine.workouts.map(workout => {
    const generatedWorkout = generatedBySequence.get(workout.sequence);
    if (workout.kind === 'eventSlot' || workout.completedAt ||
        ['inProgress', 'paused'].includes(workout.session?.status) || !generatedWorkout) return workout;
    const next = {
      ...workout,
      effectiveMaxes: generatedWorkout.effectiveMaxes,
      exercises: generatedWorkout.exercises.map((exercise, exerciseIndex) => ({
        ...exercise,
        id: workout.exercises[exerciseIndex]?.id || exercise.id,
        overrides: workout.exercises[exerciseIndex]?.overrides || {},
      })),
    };
    if (JSON.stringify(next.effectiveMaxes) !== JSON.stringify(workout.effectiveMaxes) ||
        JSON.stringify(next.exercises.map(exercise => exercise.generated)) !==
          JSON.stringify(workout.exercises.map(exercise => exercise.generated))) changed = true;
    return next;
  });
  return {
    changed,
    routine: changed ? { ...routine, workouts, updatedAt: now() } : routine,
  };
};

export const correctMaxes = (routine, maxes) => {
  if (routine.kind === 'strongman') return routine;
  const inputs = { ...routine.inputs, ...maxes };
  const regenerated = createRoutine(routine.profileId, routine.name, inputs);
  // Sequence is the persisted identity of a generated workout. Index it once so long,
  // chained mesocycles remain O(W); gaps from user deletions must not shift later plans.
  const generatedBySequence = [null, ...regenerated.workouts];

  const corrected = {
    ...routine,
    inputs,
    updatedAt: now(),
    workouts: routine.workouts.map(workout => {
      const generatedWorkout = generatedBySequence[workout.sequence];
      if (workout.kind === 'eventSlot' || workout.completedAt ||
          ['inProgress', 'paused'].includes(workout.session?.status) || !generatedWorkout) {
        // Started and completed prescriptions are snapshots. Unknown sequences can come from
        // older/imported data and must also survive rather than being guessed by array position.
        return workout;
      }
      return {
        ...workout,
        effectiveMaxes: generatedWorkout.effectiveMaxes,
        exercises: generatedWorkout.exercises.map((exercise, exerciseIndex) => ({
          ...exercise,
          // Exercise position is stable within a generated workout. Retain persisted IDs and
          // explicit overrides so corrections do not break session links or user edits.
          id: workout.exercises[exerciseIndex]?.id || exercise.id,
          overrides: workout.exercises[exerciseIndex]?.overrides || {},
        })),
      };
    }),
  };
  return refreshAdaptiveProgression(corrected).routine;
};
