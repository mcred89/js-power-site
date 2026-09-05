import {
  buildProgressFacts,
  estimatedOneRepMax,
  normalizeMainLift,
  sampleProgressSeries,
  summarizeProgress,
  summarizeProgressFacts,
} from './progress';

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

it('builds immutable sorted facts and produces the same summary through either API', () => {
  const routines = [routine('one', [
    workout({ id: 'later', completedAt: '2026-03-09T00:30:00-05:00', lift: 'Press', sets: [{ weight: 'bad', reps: 5, split: 90 }] }),
    workout({ id: 'earlier', completedAt: '2026-03-08T00:30:00-06:00', sets: [{ weight: 100, reps: 5, split: 50 }, { weight: 100, reps: 5, split: 120 }] }),
  ])];
  const before = JSON.stringify(routines);
  const facts = buildProgressFacts(routines);
  const options = { range: 'all', lift: 'Squat', now: new Date('2026-03-10T12:00:00-05:00') };

  expect(facts.map(fact => fact.workoutId)).toEqual(['earlier', 'later']);
  expect(facts[0]).toMatchObject({ routineId: 'one', dayKey: '2026-03-08', volume: 1000, lift: 'Squat', completedSetSplits: [50, 120], setIntervals: [50, 70] });
  expect(facts[1].e1rm).toBeNull();
  expect(summarizeProgressFacts(facts, options)).toEqual(summarizeProgress(routines, options));
  expect(JSON.stringify(routines)).toBe(before);
});

it('preserves all range, routine, lift, invalid-value, and legacy result fields', () => {
  const routines = [
    routine('one', [
      workout({ id: 'old-pr', completedAt: '2024-01-01T12:00:00.000Z', sets: [{ weight: 400, reps: 1, split: 20 }] }),
      workout({ id: 'invalid', completedAt: '2026-08-15T12:00:00.000Z', sets: [{ weight: Infinity, reps: 5, split: -5 }] }),
      workout({ id: 'legacy', completedAt: '2026-08-16T12:00:00.000Z', legacy: true }),
    ]),
    routine('two', [workout({ id: 'press', completedAt: '2026-08-17T12:00:00.000Z', lift: 'Press', sets: [{ weight: 100, reps: 5, split: 30 }] })]),
  ];
  const facts = buildProgressFacts(routines);
  const result = summarizeProgressFacts(facts, { range: '30d', routineId: 'one', lift: 'Squat', now: new Date('2026-08-18T12:00:00.000Z') });

  expect(result).toMatchObject({ completedWorkouts: 2, totalVolume: 0 });
  expect(result.personalRecord.workoutId).toBe('old-pr');
  expect(result.e1rmSeries).toEqual([]);
  expect(result.timing.find(item => item.lift === 'Squat')).toMatchObject({ workoutCount: 1, averageSetIntervalSeconds: null });
});

it('samples long series within the cap while retaining chronological extrema and endpoints', () => {
  const points = Array.from({ length: 1000 }, (_, index) => ({
    workoutId: `workout-${index}`,
    completedAt: new Date(2020, 0, index + 1).toISOString(),
    value: index === 333 ? -100 : index === 777 ? 10000 : 200 + Math.sin(index) * 20,
  }));
  const sampled = sampleProgressSeries(points);

  expect(sampled.length).toBeLessThanOrEqual(120);
  expect(sampled[0]).toBe(points[0]);
  expect(sampled[sampled.length - 1]).toBe(points[points.length - 1]);
  expect(sampled).toContain(points[333]);
  expect(sampled).toContain(points[777]);
  expect(new Set(sampled.map(point => point.workoutId)).size).toBe(sampled.length);
  expect(sampled.map(point => points.indexOf(point))).toEqual([...sampled].map(point => points.indexOf(point)).sort((a, b) => a - b));
});
