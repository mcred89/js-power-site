import { visibleExercise } from './routines';

// CSV formatting is loaded only when exporting training data.
export const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

const planHeader = [
  'Routine', 'Microcycle', 'Week', 'Workout', 'Session', 'Movement', 'Weight (lb)',
  'Prescription', 'Status', 'Completed at',
];

// Workers consume these iterators one row at a time. Keep the synchronous array exports
// below for compatibility, but do not make background downloads retain the entire CSV.
export function* routinePlanCsvRowIterator(routine) {
  yield planHeader.map(escapeCsv).join(',');
  for (const workout of routine.workouts) {
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
  yield [
    'Routine', 'Microcycle', 'Week', 'Workout', 'Session', 'Started at', 'Completed at',
    'Total seconds', 'Movement', 'Substituted for', 'Set', 'Set status', 'Planned weight (lb)',
    'Planned reps', 'Actual weight (lb)', 'Actual reps', 'RPE', 'Split seconds',
    'Interval seconds',
  ].map(escapeCsv).join(',');

  for (const workout of routine.workouts.filter(item => item.completedAt)) {
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
