export const MAIN_LIFTS = ['Squat', 'Press', 'Deadlift'];

const numeric = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeMainLift = movement => {
  const normalized = String(movement || '').trim().toLowerCase();
  return MAIN_LIFTS.find(lift => lift.toLowerCase() === normalized) || null;
};

export const estimatedOneRepMax = (weight, reps) => {
  const parsedWeight = numeric(weight);
  const parsedReps = numeric(reps);
  if (parsedWeight === null || parsedReps === null || parsedWeight <= 0 || parsedReps <= 0) return null;
  return parsedWeight * (1 + parsedReps / 30);
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

const rangeStart = (range, now, completed) => {
  if (range === 'all') {
    const first = completed.map(item => item.completedAt).sort()[0];
    return first ? startOfDay(first) : startOfDay(now);
  }
  const days = range === '30d' ? 30 : range === '1y' ? 365 : 90;
  const start = startOfDay(now);
  start.setDate(start.getDate() - (days - 1));
  return start;
};

const primaryExerciseFor = workout => workout.session?.exercises?.find(exercise => (
  exercise.exerciseId === workout.session.primaryExerciseId
)) || workout.session?.exercises?.[0];

const completedSets = exercise => (exercise?.sets || []).filter(set => set.status === 'completed');

const scopedWorkouts = (routines, routineId) => routines
  .filter(routine => routineId === 'all' || routine.id === routineId)
  .flatMap(routine => routine.workouts || [])
  .filter(workout => workout.completedAt)
  .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

const weekBuckets = (workouts, start, now) => {
  const buckets = [];
  const cursor = startOfWeek(start);
  const last = startOfWeek(now);
  while (cursor <= last) {
    buckets.push({ key: dateKey(cursor), start: new Date(cursor), workouts: 0, volume: 0 });
    cursor.setDate(cursor.getDate() + 7);
  }
  const byKey = new Map(buckets.map(bucket => [bucket.key, bucket]));
  workouts.forEach(workout => {
    const bucket = byKey.get(dateKey(startOfWeek(workout.completedAt)));
    if (!bucket) return;
    bucket.workouts += 1;
    bucket.volume += (workout.session?.exercises || []).reduce((workoutTotal, exercise) => (
      workoutTotal + completedSets(exercise).reduce((exerciseTotal, set) => {
        const weight = numeric(set.actualWeight);
        const reps = numeric(set.actualReps);
        return exerciseTotal + (weight !== null && reps !== null && weight > 0 && reps > 0 ? weight * reps : 0);
      }, 0)
    ), 0);
  });
  return buckets;
};

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

const e1rmForWorkout = workout => {
  const exercise = primaryExerciseFor(workout);
  const lift = normalizeMainLift(exercise?.movement);
  if (!lift) return null;
  const estimates = completedSets(exercise)
    .map(set => estimatedOneRepMax(set.actualWeight, set.actualReps))
    .filter(value => value !== null);
  if (!estimates.length) return null;
  return { lift, value: Math.max(...estimates), completedAt: workout.completedAt, workoutId: workout.id };
};

const average = values => values.length
  ? values.reduce((total, value) => total + value, 0) / values.length
  : null;

const timingFor = workouts => MAIN_LIFTS.map(lift => {
  const matching = workouts.map(workout => {
    const exercise = primaryExerciseFor(workout);
    if (normalizeMainLift(exercise?.movement) !== lift || workout.session?.status !== 'completed') return null;
    const splits = completedSets(exercise)
      .map(set => numeric(set.splitSeconds))
      .filter(value => value !== null && value >= 0)
      .sort((a, b) => a - b);
    let previous = 0;
    const intervals = splits.map(split => {
      const interval = Math.max(0, split - previous);
      previous = split;
      return interval;
    });
    const duration = numeric(workout.session.elapsedSeconds);
    return { duration: duration !== null && duration >= 0 ? duration : null, intervals };
  }).filter(Boolean);
  return {
    lift,
    workoutCount: matching.length,
    averageWorkoutSeconds: average(matching.map(item => item.duration).filter(value => value !== null)),
    averageSetIntervalSeconds: average(matching.flatMap(item => item.intervals)),
  };
});

export const summarizeProgress = (
  routines,
  { range = '90d', routineId = 'all', lift = 'Squat', now = new Date() } = {},
) => {
  const scoped = scopedWorkouts(routines, routineId);
  const start = rangeStart(range, now, scoped);
  const end = new Date(now);
  const ranged = scoped.filter(workout => {
    const completedAt = new Date(workout.completedAt);
    return completedAt >= start && completedAt <= end;
  });
  const buckets = weekBuckets(ranged, start, end);
  const streaks = streaksFor(buckets);
  const rangeEstimates = ranged.map(e1rmForWorkout).filter(Boolean);
  const lifetimeEstimates = scoped.map(e1rmForWorkout).filter(item => item?.lift === lift);
  const selectedEstimates = rangeEstimates.filter(item => item.lift === lift);
  const personalRecord = lifetimeEstimates.reduce((best, item) => (
    !best || item.value > best.value ? item : best
  ), null);
  const activeWeeks = buckets.filter(bucket => bucket.workouts > 0).length;

  return {
    completedWorkouts: ranged.length,
    totalVolume: buckets.reduce((total, bucket) => total + bucket.volume, 0),
    weekly: buckets,
    consistency: {
      activeWeeks,
      totalWeeks: buckets.length,
      activeWeekRate: buckets.length ? activeWeeks / buckets.length : 0,
      ...streaks,
    },
    e1rmSeries: selectedEstimates,
    personalRecord,
    timing: timingFor(ranged),
  };
};
