import { estimatedOneRepMax, normalizeMainLift, summarizeProgress } from './progress';

const workout = ({
  id,
  completedAt,
  lift = 'Squat',
  sets = [{ weight: 200, reps: 5, split: 60 }],
  elapsedSeconds = 600,
  legacy = false,
}) => ({
  id,
  completedAt,
  session: legacy ? null : {
    status: 'completed',
    elapsedSeconds,
    primaryExerciseId: `${id}-main`,
    exercises: [{
      exerciseId: `${id}-main`,
      movement: lift,
      sets: sets.map((set, index) => ({
        id: `${id}-${index}`,
        status: set.status || 'completed',
        actualWeight: set.weight,
        actualReps: set.reps,
        splitSeconds: set.split,
      })),
    }],
  },
});

const routine = (id, workouts) => ({ id, workouts });

it('calculates Epley estimates and recognizes only canonical main lifts', () => {
  expect(estimatedOneRepMax(300, 5)).toBe(350);
  expect(estimatedOneRepMax('', 5)).toBeNull();
  expect(normalizeMainLift(' squat ')).toBe('Squat');
  expect(normalizeMainLift('Paused Squat')).toBeNull();
});

it('selects the best set per workout and keeps the PR lifetime-scoped', () => {
  const routines = [routine('one', [
    workout({ id: 'old', completedAt: '2025-01-06T12:00:00.000Z', sets: [{ weight: 300, reps: 5, split: 60 }] }),
    workout({ id: 'new', completedAt: '2026-08-10T12:00:00.000Z', sets: [
      { weight: 200, reps: 5, split: 50 },
      { weight: 210, reps: 3, split: 100 },
    ] }),
  ])];
  const result = summarizeProgress(routines, { range: '30d', now: new Date('2026-08-18T12:00:00.000Z') });

  expect(result.e1rmSeries).toHaveLength(1);
  expect(result.e1rmSeries[0].value).toBeCloseTo(233.33);
  expect(result.personalRecord.workoutId).toBe('old');
});

it('aggregates volume, routines, weekly consistency, and legacy completions', () => {
  const routines = [
    routine('one', [
      workout({ id: 'a', completedAt: '2026-08-03T12:00:00.000Z', sets: [{ weight: 100, reps: 5, split: 60 }] }),
      workout({ id: 'b', completedAt: '2026-08-10T12:00:00.000Z', legacy: true }),
    ]),
    routine('two', [workout({ id: 'c', completedAt: '2026-08-17T12:00:00.000Z', sets: [{ weight: 200, reps: 2, split: 40 }] })]),
  ];
  const result = summarizeProgress(routines, { range: '30d', now: new Date('2026-08-18T12:00:00.000Z') });
  const filtered = summarizeProgress(routines, { range: '30d', routineId: 'two', now: new Date('2026-08-18T12:00:00.000Z') });

  expect(result.completedWorkouts).toBe(3);
  expect(result.totalVolume).toBe(900);
  expect(result.consistency).toMatchObject({ activeWeeks: 3, current: 3, longest: 3 });
  expect(filtered.completedWorkouts).toBe(1);
  expect(filtered.totalVolume).toBe(400);
});

it('averages workout duration and primary-lift set intervals', () => {
  const routines = [routine('one', [
    workout({
      id: 'a',
      completedAt: '2026-08-10T12:00:00.000Z',
      elapsedSeconds: 600,
      sets: [{ weight: 200, reps: 5, split: 60 }, { weight: 200, reps: 5, split: 150 }],
    }),
    workout({
      id: 'b',
      completedAt: '2026-08-17T12:00:00.000Z',
      elapsedSeconds: 900,
      sets: [{ weight: 205, reps: 5, split: 120 }],
    }),
  ])];
  const squat = summarizeProgress(routines, { range: '30d', now: new Date('2026-08-18T12:00:00.000Z') })
    .timing.find(item => item.lift === 'Squat');

  expect(squat.averageWorkoutSeconds).toBe(750);
  expect(squat.averageSetIntervalSeconds).toBe(90);
});
