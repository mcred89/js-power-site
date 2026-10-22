import { adaptiveCycleMaxes, createRoutine, visibleExercise } from './routines';
import { hasAdaptiveProgression } from './routineGeneration';
import { isTabataExercise } from './tabata';
import { isLengthenedCycle, isRescheduledCycle, isRemovedByShortening } from './cycleShortening';

export { isShortenedCycle, isRemovedByShortening } from './cycleShortening';

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

const stageKey = workout => Number.isInteger(workout.sourceWeek) && workout.sourceWeek >= 0 && workout.sourceWeek < 5
  ? `${workout.cycleIndex}:${workout.name}:${workout.sourceWeek}` : null;

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
export const regenerateFutureWorkouts = (routine, inputs = routine.inputs, cycleWeekGroups = routine.cycleWeekGroups) => {
  const nextRoutine = { ...routine, inputs };
  const cycleMaxes = inputs.mesoMode && hasAdaptiveProgression(inputs)
    ? adaptiveCycleMaxes(nextRoutine)
    : [];
  const regenerated = createRoutine(routine.profileId, routine.name, inputs, cycleMaxes, cycleWeekGroups);
  const generatedByStage = new Map(regenerated.workouts.map(workout => [stageKey(workout), workout]));
  const loggedIds = new Set((routine.strongmanLog || []).map(entry => entry.workoutId));
  // Duplicate imported stages are retained as custom records. Only the earliest
  // original queue position owns a generated stage; never merge their history.
  const stageOwners = new Map();
  [...routine.workouts].sort((a, b) => a.sequence - b.sequence).forEach(workout => {
    const key = stageKey(workout);
    if (key && !stageOwners.has(key)) stageOwners.set(key, workout);
  });
  const workouts = routine.workouts.flatMap(workout => {
    const key = stageKey(workout);
    // Every existing session is a snapshot, including imported/unknown statuses.
    if (workout.completedAt || workout.skippedAt || workout.session || workout.strongmanQueue?.length || loggedIds.has(workout.id)) return [workout];
    // Missing identity denotes an unknown imported/custom record. Migrations
    // annotate recognized legacy workouts before any schedule can be changed.
    if (!key || stageOwners.get(key) !== workout) return [workout];
    const generatedWorkout = generatedByStage.get(key);
    if (!generatedWorkout) return isRemovedByShortening(workout, routine.inputs, inputs, cycleWeekGroups) ? [] : [workout];
    const next = {
      ...workout,
      ...(isRescheduledCycle(routine.inputs, inputs, workout.cycleIndex) ? {
        weekIndex: generatedWorkout.weekIndex,
        weekLabel: generatedWorkout.weekLabel,
      } : {}),
      effectiveMaxes: { ...workout.effectiveMaxes, ...generatedWorkout.effectiveMaxes },
      exercises: mergeGeneratedExercises(workout, generatedWorkout),
    };
    return [JSON.stringify(next) === JSON.stringify(workout) ? workout : next];
  });

  if (!regenerated.workouts.some(workout => isLengthenedCycle(routine.inputs, inputs, workout.cycleIndex))) return workouts;
  // Restore only days omitted by the previous schedule. A missing day that was
  // already scheduled is a deliberate deletion, not a gap to fill on plan edits.
  const previous = createRoutine(routine.profileId, routine.name, routine.inputs, [], routine.cycleWeekGroups);
  const previousStages = new Set(previous.workouts.map(stageKey));
  const deletedStages = new Set(Array.isArray(routine.deletedWorkoutStages) ? routine.deletedWorkoutStages : []);
  const additions = regenerated.workouts.filter(workout => (
    isLengthenedCycle(routine.inputs, inputs, workout.cycleIndex) &&
    !previousStages.has(stageKey(workout)) && !stageOwners.has(stageKey(workout)) && !deletedStages.has(stageKey(workout))
  ));
  const owners = new Set([...stageOwners.values()].map(workout => workout.id));
  additions.forEach(workout => {
    // Anchor new days to the retained generated stages, without renumbering any
    // recorded snapshot or moving custom/imported records relative to each other.
    const rank = candidate => owners.has(candidate.id) ? generatedByStage.get(stageKey(candidate))?.sequence : undefined;
    let index = workouts.findIndex(candidate => rank(candidate) > workout.sequence);
    if (index < 0) {
      index = workouts.reduce((position, candidate, candidateIndex) => (
        rank(candidate) < workout.sequence ? candidateIndex + 1 : position
      ), workouts.length);
    }
    const before = index > 0 ? workouts[index - 1].sequence : 0;
    const after = index < workouts.length ? workouts[index].sequence : before + 2;
    // Sequence has always been a numeric ordering key. Fractional positions keep
    // existing IDs, history, and backup records intact when inserting between days.
    const sequence = before + (after - before) / 2;
    if (!Number.isFinite(sequence) || sequence <= before || sequence >= after) {
      throw new Error('This plan has conflicting workout order values. Restore a valid backup before changing its cycle length.');
    }
    workouts.splice(index, 0, { ...workout, sequence });
    owners.add(workout.id);
  });
  return workouts;
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
