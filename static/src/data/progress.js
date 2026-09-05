import { estimatedOneRepMax, MAIN_LIFTS, normalizeMainLift } from './estimatedMax';

export { estimatedOneRepMax, MAIN_LIFTS, normalizeMainLift } from './estimatedMax';

const numeric = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const startOfDay = value => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const startOfWeek = value => {
  const date = startOfDay(value);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return date;
};

const dateKey = value => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const primaryExerciseFor = workout => workout.session?.exercises?.find(exercise => (
  exercise.exerciseId === workout.session.primaryExerciseId
)) || workout.session?.exercises?.[0];

const completedSets = exercise => (exercise?.sets || []).filter(set => set.status === 'completed');

// Facts are deliberately independent of the selected filters. Keep expensive session
// traversal here so changing a range or lift remains proportional to workout count.
export const buildProgressFacts = routines => (routines || []).flatMap(routine => (
  (routine.workouts || []).filter(workout => workout.completedAt).map(workout => {
    const primaryExercise = primaryExerciseFor(workout);
    const lift = normalizeMainLift(primaryExercise?.movement);
    const splits = completedSets(primaryExercise)
      .map(set => numeric(set.splitSeconds))
      .filter(value => value !== null && value >= 0)
      .sort((a, b) => a - b);
    let previous = 0;
    const intervals = splits.map(split => {
      const interval = Math.max(0, split - previous);
      previous = split;
      return interval;
    });
    const estimates = completedSets(primaryExercise)
      .map(set => estimatedOneRepMax(set.actualWeight, set.actualReps))
      .filter(value => value !== null);
    const duration = numeric(workout.session?.elapsedSeconds);
    const completedAt = workout.completedAt;
    const day = dateKey(completedAt);
    const weekStart = startOfWeek(completedAt);
    const volume = (workout.session?.exercises || []).reduce((workoutTotal, exercise) => (
      workoutTotal + completedSets(exercise).reduce((exerciseTotal, set) => {
        const weight = numeric(set.actualWeight);
        const reps = numeric(set.actualReps);
        return exerciseTotal + (weight !== null && reps !== null && weight > 0 && reps > 0 ? weight * reps : 0);
      }, 0)
    ), 0);
    return {
      routineId: routine.id,
      workoutId: workout.id,
      completedAt,
      dayKey: day,
      weekKey: dateKey(weekStart),
      volume,
      lift,
      e1rm: estimates.length ? Math.max(...estimates) : null,
      duration: workout.session?.status === 'completed' && duration !== null && duration >= 0 ? duration : null,
      completedSetSplits: splits,
      setIntervals: intervals,
      timingEligible: workout.session?.status === 'completed' && Boolean(lift),
    };
  })
)).sort((a, b) => a.completedAt.localeCompare(b.completedAt));

const rangeStart = (range, now, facts) => {
  if (range === 'all') return facts.length ? startOfDay(facts[0].completedAt) : startOfDay(now);
  const days = range === '30d' ? 30 : range === '1y' ? 365 : 90;
  const start = startOfDay(now);
  start.setDate(start.getDate() - (days - 1));
  return start;
};

const emptyTiming = () => MAIN_LIFTS.map(lift => ({
  lift,
  workoutCount: 0,
  durationTotal: 0,
  durationCount: 0,
  intervalTotal: 0,
  intervalCount: 0,
}));

const streaksFor = buckets => {
  let longest = 0;
  let running = 0;
  buckets.forEach(bucket => {
    running = bucket.workouts ? running + 1 : 0;
    longest = Math.max(longest, running);
  });
  let index = buckets.length - 1;
  if (index >= 0 && buckets[index].workouts === 0) index -= 1;
  let current = 0;
  while (index >= 0 && buckets[index].workouts > 0) {
    current += 1;
    index -= 1;
  }
  return { current, longest };
};

export const summarizeProgressFacts = (
  facts,
  { range = '90d', routineId = 'all', lift = 'Squat', now = new Date() } = {},
) => {
  const scoped = facts.filter(fact => routineId === 'all' || fact.routineId === routineId);
  const start = rangeStart(range, now, scoped);
  const end = new Date(now);
  const buckets = [];
  const cursor = startOfWeek(start);
  const last = startOfWeek(end);
  while (cursor <= last) {
    buckets.push({ key: dateKey(cursor), start: new Date(cursor), workouts: 0, volume: 0 });
    cursor.setDate(cursor.getDate() + 7);
  }
  const bucketByKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  const timing = emptyTiming();
  const timingByLift = new Map(timing.map(item => [item.lift, item]));
  const e1rmSeries = [];
  let personalRecord = null;
  let completedWorkouts = 0;
  let totalVolume = 0;

  // One pass supplies lifetime PR and every range aggregate; the PR intentionally
  // considers scoped facts outside the selected date range.
  scoped.forEach(fact => {
    if (fact.lift === lift && fact.e1rm !== null && (!personalRecord || fact.e1rm > personalRecord.value)) {
      personalRecord = { lift, value: fact.e1rm, completedAt: fact.completedAt, workoutId: fact.workoutId };
    }
    const completedDate = new Date(fact.completedAt);
    if (completedDate < start || completedDate > end) return;
    completedWorkouts += 1;
    totalVolume += fact.volume;
    const bucket = bucketByKey.get(fact.weekKey);
    if (bucket) {
      bucket.workouts += 1;
      bucket.volume += fact.volume;
    }
    if (fact.lift === lift && fact.e1rm !== null) {
      e1rmSeries.push({ lift, value: fact.e1rm, completedAt: fact.completedAt, workoutId: fact.workoutId });
    }
    if (fact.timingEligible) {
      const item = timingByLift.get(fact.lift);
      item.workoutCount += 1;
      if (fact.duration !== null) {
        item.durationTotal += fact.duration;
        item.durationCount += 1;
      }
      fact.setIntervals.forEach(interval => {
        item.intervalTotal += interval;
        item.intervalCount += 1;
      });
    }
  });
  const activeWeeks = buckets.filter(bucket => bucket.workouts > 0).length;
  return {
    completedWorkouts,
    totalVolume,
    weekly: buckets,
    consistency: {
      activeWeeks,
      totalWeeks: buckets.length,
      activeWeekRate: buckets.length ? activeWeeks / buckets.length : 0,
      ...streaksFor(buckets),
    },
    e1rmSeries,
    personalRecord,
    timing: timing.map(item => ({
      lift: item.lift,
      workoutCount: item.workoutCount,
      averageWorkoutSeconds: item.durationCount ? item.durationTotal / item.durationCount : null,
      averageSetIntervalSeconds: item.intervalCount ? item.intervalTotal / item.intervalCount : null,
    })),
  };
};

export const summarizeProgress = (routines, options) => summarizeProgressFacts(buildProgressFacts(routines), options);

export const sampleProgressSeries = (points, limit = 120) => {
  if (points.length <= limit) return points;
  const required = new Set([0, points.length - 1]);
  let minimum = 0;
  let maximum = 0;
  points.forEach((point, index) => {
    if (point.value < points[minimum].value) minimum = index;
    if (point.value > points[maximum].value) maximum = index;
  });
  required.add(minimum);
  required.add(maximum);
  const remaining = limit - required.size;
  const candidates = [];
  const bucketCount = Math.max(1, Math.ceil(remaining / 2));
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const from = Math.floor(bucket * points.length / bucketCount);
    const to = Math.floor((bucket + 1) * points.length / bucketCount);
    let localMinimum = from;
    let localMaximum = from;
    for (let index = from + 1; index < to; index += 1) {
      if (points[index].value < points[localMinimum].value) localMinimum = index;
      if (points[index].value > points[localMaximum].value) localMaximum = index;
    }
    candidates.push(localMinimum, localMaximum);
  }
  candidates.forEach(index => {
    if (required.size < limit) required.add(index);
  });
  // Fill any capacity lost to duplicate extrema, retaining chronological coverage.
  for (let index = 0; required.size < limit && index < points.length; index += 1) required.add(index);
  const seenWorkoutIds = new Set();
  return [...required].sort((a, b) => a - b).map(index => points[index]).filter(point => {
    if (seenWorkoutIds.has(point.workoutId)) return false;
    seenWorkoutIds.add(point.workoutId);
    return true;
  });
};
