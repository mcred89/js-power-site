import { MAX_PROGRESSION_MODES } from './routineGeneration';
import { hasExerciseOverrides, regenerateFutureWorkouts } from './routineRecalculation';
import { applyBatch } from './storage';

const liftKeys = ['squat', 'press', 'deadlift'];
const editableKeys = [
  'maxSquat', 'maxPress', 'maxDead',
  'maxProgressionMode', 'squatIncrement', 'pressIncrement', 'deadliftIncrement',
  'mainLiftChoice', 'includeBackoffSets', 'pressWeakPoint', 'deadliftWeakPoint',
  ...liftKeys.flatMap(lift => [
    `${lift}EventEnabled`, `${lift}EventMovement`, `${lift}EventSets`, `${lift}EventReps`,
    `${lift}TabataEnabled`,
  ]),
];
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isBlank = value => value === undefined || value === null || String(value).trim() === '';

const validateNumber = (value, label, minimum, maximum, integer = false) => {
  const numeric = Number(value);
  if (isBlank(value) || !['string', 'number'].includes(typeof value) || !Number.isFinite(numeric) ||
      numeric < minimum || numeric > maximum || (integer && !Number.isInteger(numeric))) {
    throw new Error(`${label} must be ${integer ? 'a whole number' : 'a number'} from ${minimum} to ${maximum}.`);
  }
};

const validateChoice = (value, choices, label) => {
  if (!choices.includes(value)) throw new Error(`Choose a valid ${label}.`);
};

const updatedInputs = (original, changes) => {
  ['mesoMode', 'includeStrongmanDay'].forEach(key => {
    if (has(changes, key) && Boolean(changes[key]) !== Boolean(original[key])) {
      throw new Error('The workout schedule cannot change after a plan has been created.');
    }
  });
  if (has(changes, 'duration') && changes.duration !== original.duration) {
    throw new Error('Cycle duration cannot change after a plan has been created.');
  }

  const inputs = { ...original };
  editableKeys.forEach(key => {
    if (has(changes, key) && changes[key] !== undefined) inputs[key] = changes[key];
  });
  if (has(changes, 'microCycles') && changes.microCycles !== undefined) {
    const cycles = original.microCycles || [];
    if (!Array.isArray(changes.microCycles) || changes.microCycles.length !== cycles.length ||
        changes.microCycles.some((cycle, index) => !cycle || typeof cycle !== 'object' || Array.isArray(cycle) ||
          (has(cycle, 'duration') && cycle.duration !== cycles[index].duration))) {
      throw new Error('The number and duration of cycles cannot change after a plan has been created.');
    }
    inputs.microCycles = cycles.map((cycle, index) => ({
      ...cycle,
      ...(has(changes.microCycles[index], 'volume') ? { volume: changes.microCycles[index].volume } : {}),
    }));
  }

  [
    ['maxSquat', 'Squat max'], ['maxPress', 'Press max'], ['maxDead', 'Deadlift max'],
  ].forEach(([key, label]) => validateNumber(inputs[key], label, 1, 1001));
  const progressionMode = inputs.maxProgressionMode === undefined ? MAX_PROGRESSION_MODES.FIXED : inputs.maxProgressionMode;
  validateChoice(progressionMode, Object.values(MAX_PROGRESSION_MODES), 'max progression');
  if (inputs.mesoMode) {
    if (!Array.isArray(inputs.microCycles) || !inputs.microCycles.length) throw new Error('This plan has no cycles to update.');
    inputs.microCycles.forEach(cycle => validateChoice(cycle.volume, ['Low', 'High'], 'cycle volume'));
  } else {
    validateChoice(inputs.mainLiftChoice, ['Low', 'High'], 'training volume');
  }
  [
    ['pressWeakPoint', ['', 'Shoulders', 'Triceps']],
    ['deadliftWeakPoint', ['', 'Back', 'Glutes', 'Hamstrings']],
  ].forEach(([key, choices]) => validateChoice(inputs[key] ?? '', choices, 'accessory focus'));

  const booleanKeys = ['includeBackoffSets', ...liftKeys.flatMap(lift => [
    `${lift}EventEnabled`, `${lift}TabataEnabled`,
  ])];
  booleanKeys.forEach(key => {
    if (inputs[key] !== undefined && typeof inputs[key] !== 'boolean') throw new Error('Choose whether to include each optional exercise.');
  });
  liftKeys.forEach(lift => {
    const label = lift.charAt(0).toUpperCase() + lift.slice(1);
    const increment = inputs[`${lift}Increment`];
    // The builder keeps hidden fields when their option is disabled. Validate
    // their stored values only when that option will generate future work.
    if (inputs.mesoMode && progressionMode === MAX_PROGRESSION_MODES.FIXED && !isBlank(increment)) {
      validateNumber(increment, `${label} increase`, 0, 100);
    }
    const movementKey = `${lift}EventMovement`;
    if (has(changes, movementKey)) {
      if (typeof inputs[movementKey] !== 'string') throw new Error(`${label} event movement must be text.`);
      inputs[movementKey] = inputs[movementKey].trim();
    }
    if (inputs[`${lift}EventEnabled`]) {
      if (typeof inputs[movementKey] !== 'string' || !inputs[movementKey].trim()) {
        throw new Error(`Enter a movement for the ${label.toLowerCase()} day event.`);
      }
      inputs[movementKey] = inputs[movementKey].trim();
    }
    [
      ['Sets', 'sets', 20], ['Reps', 'reps', 100],
    ].forEach(([suffix, description, maximum]) => {
      const value = inputs[`${lift}Event${suffix}`];
      if (inputs[`${lift}EventEnabled`]) {
        validateNumber(value, `${label} event ${description}`, 1, maximum, true);
      }
    });
  });
  return inputs;
};

// Pure plan edit: preserve history and individual overrides while replacing only
// the generated prescriptions for workouts that have never been started.
export const updateRoutinePlan = (routine, changes) => {
  if (!routine || routine.kind === 'strongman' || !routine.inputs || !Array.isArray(routine.workouts)) {
    throw new Error('Choose a strength plan to update.');
  }
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Enter the plan settings to update.');
  const inputs = updatedInputs(routine.inputs, changes);
  const workouts = regenerateFutureWorkouts(routine, inputs);
  if (JSON.stringify(inputs) === JSON.stringify(routine.inputs) &&
      workouts.every((workout, index) => workout === routine.workouts[index])) return routine;
  return { ...routine, inputs, workouts, updatedAt: new Date().toISOString() };
};

// Keep update-only persistence and conflict handling in the lazy Plans graph.
// Publish only after the guarded write, so failed saves never change the UI's plan.
export const commitPlanUpdate = async (routine, changes, saveRoutine) => {
  if (!routine) throw new Error('This plan is no longer available. Return to Plans and try again.');
  const updated = updateRoutinePlan(routine, changes);
  try {
    await saveRoutine(updated, record => applyBatch({
      puts: { routines: [record] },
      conditions: { routines: [{ key: routine.id, expected: routine }] },
    }), true);
  } catch (error) {
    if (error.name === 'BatchConflictError') {
      throw new Error('This plan changed in another window. Reload Plans and review your changes again.');
    }
    throw error;
  }
};

export const getPlanUpdateSummary = (routine, updatedRoutine) => {
  const updatedById = new Map(updatedRoutine.workouts.map(workout => [workout.id, workout]));
  return routine.workouts.reduce((summary, workout) => {
    if (workout.completedAt || workout.skippedAt) {
      summary.completedWorkouts += 1;
    } else if (workout.session) {
      summary.startedWorkouts += 1;
    } else {
      const updated = updatedById.get(workout.id);
      if (updated && JSON.stringify(workout) !== JSON.stringify(updated)) summary.changedWorkouts += 1;
      summary.preservedOverrides += (updated?.exercises || []).filter(hasExerciseOverrides).length;
    }
    return summary;
  }, { changedWorkouts: 0, completedWorkouts: 0, startedWorkouts: 0, preservedOverrides: 0 });
};
