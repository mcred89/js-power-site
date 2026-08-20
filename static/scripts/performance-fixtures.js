'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_TIME = Date.parse('2026-01-05T18:00:00.000Z');

const isoAt = index => new Date(BASE_TIME + index * DAY_MS).toISOString();

const makeSets = (workoutIndex, exerciseIndex, completed = true) => Array.from(
  { length: exerciseIndex === 0 ? 3 : 2 },
  (_, setIndex) => ({
    id: `set-${workoutIndex}-${exerciseIndex}-${setIndex}`,
    number: setIndex + 1,
    status: completed ? 'completed' : 'pending',
    plannedWeight: 185 + exerciseIndex * 20,
    plannedReps: 5,
    actualWeight: completed ? 185 + exerciseIndex * 20 : '',
    actualReps: completed ? 5 : '',
    splitSeconds: completed ? (setIndex + 1) * 95 : null,
  }),
);

const makeWorkout = (index, completed = true) => {
  const completedAt = completed ? isoAt(index) : null;
  const movements = ['Squat', 'Row', 'Plank'];
  return {
    id: `workout-${index}`,
    sequence: index + 1,
    cycleIndex: Math.floor(index / 15),
    cycleLabel: `Cycle ${Math.floor(index / 15) + 1}`,
    weekIndex: Math.floor(index / 3) % 5,
    weekLabel: `Week ${Math.floor(index / 3) % 5 + 1}`,
    name: `Session ${index + 1}`,
    effectiveMaxes: { squat: 315, press: 185, dead: 405 },
    completedAt,
    exercises: movements.map((movement, exerciseIndex) => ({
      id: `exercise-${index}-${exerciseIndex}`,
      generated: {
        movement,
        weight: 185 + exerciseIndex * 20,
        prescription: exerciseIndex === 0 ? '3 x 5' : '2 x 8',
      },
      overrides: {},
    })),
    session: {
      status: completed ? 'completed' : 'inProgress',
      startedAt: isoAt(index - 0.04),
      completedAt,
      elapsedSeconds: completed ? 32 * 60 : 0,
      runningSince: completed ? null : isoAt(index),
      primaryExerciseId: `exercise-${index}-0`,
      rpe: completed ? 8 : null,
      exercises: movements.map((movement, exerciseIndex) => ({
        exerciseId: `exercise-${index}-${exerciseIndex}`,
        movement,
        prescription: exerciseIndex === 0 ? '3 x 5' : '2 x 8',
        sets: makeSets(index, exerciseIndex, completed),
      })),
    },
  };
};

const makeRoutine = (id, workoutCount, options = {}) => ({
  id,
  profileId: options.profileId || 'profile-performance',
  name: options.name || `Performance routine ${id}`,
  inputs: { weeks: 5, mesoMode: true, volume: 'high' },
  archived: Boolean(options.archived),
  createdAt: isoAt(0),
  updatedAt: isoAt(Math.max(0, workoutCount - 1)),
  workouts: Array.from({ length: workoutCount }, (_, index) => makeWorkout(
    (options.startIndex || 0) + index,
    options.completed !== false,
  )),
});

const buildActiveRoutine = () => {
  const routine = makeRoutine('routine-active', 15, { completed: true });
  routine.workouts[14] = makeWorkout(14, false);
  return routine;
};

const buildCompletedRoutines = years => Array.from({ length: years }, (_, year) => (
  makeRoutine(`routine-year-${year + 1}`, 156, {
    archived: true,
    name: `Completed year ${year + 1}`,
    startIndex: year * 156,
  })
));

const buildProgressHistory = workoutCount => [makeRoutine('routine-progress', workoutCount)];

const buildBackupPair = (workoutCount = 5000) => {
  const backup = {
    format: 'mcilroy-method-backup',
    version: 6,
    dataSchemaVersion: 6,
    exportedAt: isoAt(workoutCount),
    profiles: [{
      id: 'profile-performance',
      name: 'Performance profile',
      activeRoutineId: 'routine-progress',
      createdAt: isoAt(0),
      updatedAt: isoAt(workoutCount),
    }],
    routines: buildProgressHistory(workoutCount),
    templates: [],
  };
  const changed = JSON.parse(JSON.stringify(backup));
  changed.routines[0].workouts[Math.floor(workoutCount / 2)]
    .session.exercises[0].sets[1].actualReps = 6;
  return { identical: JSON.parse(JSON.stringify(backup)), original: backup, changed };
};

module.exports = {
  PROGRESS_HISTORY_SIZES: [100, 1000, 5000, 10000, 20000],
  buildActiveRoutine,
  buildBackupPair,
  buildCompletedRoutines,
  buildProgressHistory,
};
