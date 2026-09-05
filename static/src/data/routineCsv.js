import { visibleExercise } from './routines';

// Download formatting is loaded only with export tasks.
export const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

const planHeader = [
  'Routine', 'Microcycle', 'Week', 'Workout', 'Session', 'Movement', 'Weight (lb)',
  'Prescription', 'Status', 'Completed at',
];

const eventBlocksForExport = workout => workout.session?.eventBlocks || (workout.exercises || []).map(exercise => ({
  ...exercise,
  movement: exercise.overrides?.movement ?? exercise.generated?.movement,
  recipe: exercise.overrides?.event ?? exercise.generated?.event,
  prescription: exercise.overrides?.prescription ?? exercise.generated?.prescription,
}));
const csvDetail = value => value && typeof value === 'object' ? JSON.stringify(value) : value;
const eventMeasurements = value => [
  value?.weight, value?.weightUnit, value?.loadMeaning, value?.sets, value?.reps,
  value?.distance, value?.distanceUnit, value?.seconds, value?.height, value?.heightUnit,
];

function* eventPlanCsvRows(routine) {
  yield ['Routine', 'Phase', 'Event week', 'Workout', 'Session', 'Movement', 'Part',
    'Weight', 'Weight unit', 'Load meaning', 'Sets', 'Reps', 'Distance', 'Distance unit',
    'Seconds', 'Height', 'Height unit', 'Setup', 'Prescription', 'Status', 'Completed at']
    .map(escapeCsv).join(',');
  for (const workout of routine.workouts) {
    if (workout.kind === 'eventSlot') continue;
    for (const block of eventBlocksForExport(workout)) {
      const recipe = block.recipe;
      const parts = recipe?.parts?.length ? recipe.parts : [recipe];
      for (const part of parts) {
        yield [routine.name, workout.phase, workout.eventWeek, workout.sequence, workout.name,
          block.movement, part?.name, ...eventMeasurements(part), csvDetail(part?.setup ?? block.setup),
          block.prescription || (!recipe ? 'Set up today' : ''),
          workout.skippedAt || block.status === 'skipped' ? 'Skipped' : workout.completedAt ? 'Completed' : 'Planned', workout.completedAt]
          .map(escapeCsv).join(',');
      }
    }
  }
}

function* eventHistoryCsvRows(routine) {
  yield ['Routine', 'Phase', 'Event week', 'Workout', 'Session', 'Started at', 'Completed at',
    'Total seconds', 'Movement', 'Part', 'Attempt', 'Attempt status', 'Outcome',
    'Planned weight', 'Planned reps', 'Planned distance', 'Planned seconds',
    'Actual weight', 'Weight unit', 'Load meaning', 'Actual reps', 'Actual distance',
    'Distance unit', 'Event seconds', 'Height', 'Height unit', 'Setup', 'Notes', 'Attempt completed at']
    .map(escapeCsv).join(',');
  for (const workout of routine.workouts) {
    if (!workout.completedAt || workout.kind === 'eventSlot') continue;
    for (const block of eventBlocksForExport(workout)) {
      const attempts = block.attempts?.length ? block.attempts : [null];
      for (const [index, attempt] of attempts.entries()) {
        const recipe = attempt?.partId ? block.recipe?.parts?.find(part => part.id === attempt.partId) : block.recipe;
        yield [routine.name, workout.phase, workout.eventWeek, workout.sequence, workout.name,
          workout.session?.startedAt, workout.completedAt, workout.session?.elapsedSeconds,
          block.movement, attempt?.partName ?? (attempt?.partId ? recipe?.name : ''), attempt ? index + 1 : '',
          attempt?.status || (block.status === 'skipped' ? 'skipped' : 'No attempts recorded'), attempt?.outcome,
          recipe?.weight, recipe?.reps, recipe?.distance, recipe?.seconds,
          attempt?.weight, attempt?.weightUnit ?? recipe?.weightUnit, attempt?.loadMeaning ?? recipe?.loadMeaning,
          attempt?.reps, attempt?.distance, attempt?.distanceUnit ?? recipe?.distanceUnit, attempt?.seconds,
          attempt?.height, attempt?.heightUnit ?? recipe?.heightUnit,
          csvDetail(attempt?.setup ?? block.setup ?? recipe?.setup), attempt?.notes, attempt?.completedAt]
          .map(escapeCsv).join(',');
      }
    }
  }
}

// Workers consume these iterators one row at a time. Keep the synchronous array exports
// below for compatibility, but do not make background downloads retain the entire CSV.
export function* routinePlanCsvRowIterator(routine) {
  if (routine.kind === 'strongman') { yield* eventPlanCsvRows(routine); return; }
  yield planHeader.map(escapeCsv).join(',');
  for (const workout of routine.workouts) {
    if (workout.kind === 'eventSlot') continue;
    for (const exercise of workout.exercises) {
      const shown = visibleExercise(exercise);
      yield [routine.name, workout.cycleLabel, workout.weekLabel, workout.sequence,
        workout.name, shown.movement, shown.weight, shown.prescription,
        workout.completedAt ? 'Completed' : 'Planned', workout.completedAt]
        .map(escapeCsv).join(',');
    }
  }
}

export const routinePlanCsvRows = routine => [...routinePlanCsvRowIterator(routine)];
export const routinePlanToCsv = routine => routinePlanCsvRows(routine).join('\n');

const formatSeconds = seconds => seconds === null || seconds === undefined ? '' : seconds;

export function* routineHistoryCsvRowIterator(routine) {
  if (routine.kind === 'strongman') { yield* eventHistoryCsvRows(routine); return; }
  yield [
    'Routine', 'Microcycle', 'Week', 'Workout', 'Session', 'Started at', 'Completed at',
    'Total seconds', 'Movement', 'Substituted for', 'Set', 'Set status', 'Planned weight (lb)',
    'Planned reps', 'Actual weight (lb)', 'Actual reps', 'RPE', 'Split seconds',
    'Interval seconds',
  ].map(escapeCsv).join(',');

  for (const workout of routine.workouts.filter(item => item.completedAt)) {
    if (workout.kind === 'eventSlot') continue;
    if (!workout.session?.exercises) {
      for (const exercise of workout.exercises) {
        const shown = visibleExercise(exercise);
        yield [
          routine.name, workout.cycleLabel, workout.weekLabel, workout.sequence, workout.name,
          '', workout.completedAt, '', shown.movement, '', '', 'Legacy completed', shown.weight,
          shown.prescription, '', '', '', '', '',
        ].map(escapeCsv).join(',');
      }
      continue;
    }

    const intervals = new Map();
    let previousSplit = 0;
    workout.session.exercises.flatMap(exercise => exercise.sets)
      .filter(set => set.status === 'completed')
      .sort((a, b) => a.splitSeconds - b.splitSeconds)
      .forEach(set => {
        intervals.set(set.id, set.splitSeconds - previousSplit);
        previousSplit = set.splitSeconds;
      });
    for (const sessionExercise of workout.session.exercises) {
      for (const set of sessionExercise.sets) {
        const interval = intervals.has(set.id) ? intervals.get(set.id) : '';
        yield [
          routine.name, workout.cycleLabel, workout.weekLabel, workout.sequence, workout.name,
          workout.session.startedAt, workout.completedAt, formatSeconds(workout.session.elapsedSeconds),
          sessionExercise.movement, sessionExercise.original?.movement || '', set.number, set.status, set.plannedWeight, set.plannedReps,
          set.actualWeight, set.actualReps,
          sessionExercise.exerciseId === workout.session.primaryExerciseId ? workout.session.rpe : '',
          formatSeconds(set.splitSeconds), interval,
        ].map(escapeCsv).join(',');
      }
    }
  }

}

export const routineHistoryCsvRows = routine => [...routineHistoryCsvRowIterator(routine)];

export const routineHistoryToCsv = routine => routineHistoryCsvRows(routine).join('\n');
