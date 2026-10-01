const validDate = value => {
  if (value === null || value === undefined || value === '') return null;
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') return null;
  // A date-only value represents a local calendar day, not midnight in UTC.
  // Check the calendar portion before parsing so invalid imported dates cannot
  // silently roll over into a different month.
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(T|$)/);
    if (!match) return null;
    const [, yearText, monthText, dayText, time] = match;
    const [year, month, day] = [yearText, monthText, dayText].map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    if (!time) return date;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const localDay = value => {
  const date = validDate(value);
  if (date) date.setHours(0, 0, 0, 0);
  return date;
};

const addDays = (value, count) => {
  const date = localDay(value);
  if (date) date.setDate(date.getDate() + count);
  return date;
};

const monday = value => {
  const date = localDay(value);
  return date ? addDays(date, -((date.getDay() + 6) % 7)) : null;
};

const earliest = dates => dates.reduce((result, date) => (
  date && (!result || date < result) ? date : result
), null);

const latest = dates => dates.reduce((result, date) => (
  date && (!result || date > result) ? date : result
), null);

export const localDateKey = value => {
  const date = validDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const formatCalendarDate = value => {
  const key = localDateKey(value);
  return key ? `${key.slice(5, 7)}/${key.slice(8, 10)}/${key.slice(2, 4)}` : '';
};

// Imported metadata must not drive unbounded slot allocation. The cycle limit
// still accommodates centuries of generated plans and long history fixtures.
const MAX_CYCLE_INDEX = 9999;
const indexFrom = (index, label, prefix, maximum) => {
  const supported = value => Number.isInteger(value) && value >= 0 && value <= maximum;
  if (supported(index)) return index;
  const match = String(label ?? '').match(new RegExp(`^(?:${prefix}\\s+)?(\\d+)$`, 'i'));
  const labeledIndex = match ? Number(match[1]) - 1 : -1;
  return supported(labeledIndex) ? labeledIndex : 0;
};

const workoutIndices = workout => ({
  cycle: indexFrom(workout.cycleIndex, workout.cycleLabel, 'Cycle', MAX_CYCLE_INDEX),
  week: indexFrom(workout.weekIndex, workout.weekLabel, 'Week', 4),
});

export const workoutWeekText = workout => {
  if (!workout) return '';
  const { cycle, week } = workoutIndices(workout);
  return `${workout.cycleLabel || cycle > 0 ? `Cycle ${cycle + 1} · ` : ''}Week ${week + 1}`;
};

// Dates remain derived from the queue and recorded activity. Calendar estimates
// never alter workouts, completed snapshots, or the stored backup format.
export const buildPlanCalendar = (routine, today = new Date()) => {
  const workouts = (routine?.workouts || []).filter(workout => workout && typeof workout === 'object');
  if (!workouts.length) return null;
  const configuredCycles = routine.inputs?.mesoMode ? routine.inputs.microCycles : [routine.inputs || {}];
  const cycles = Array.isArray(configuredCycles) ? configuredCycles.slice(0, MAX_CYCLE_INDEX + 1) : [];
  const lengths = new Map(cycles.map((cycle, index) => [index, cycle?.duration === '3 weeks' ? 3 : cycle?.duration === '5 weeks' ? 5 : 0]));
  const workoutIds = new Set(workouts.map(workout => workout.id));
  const loggedActivity = new Map();
  // Strongman days record efforts directly instead of opening a timed session.
  // Retrospective or deleted-workout logs remain history, not plan activity.
  (Array.isArray(routine.strongmanLog) ? routine.strongmanLog : []).forEach(entry => {
    if (!entry?.workoutId || !workoutIds.has(entry.workoutId)) return;
    const date = localDay(entry.date);
    if (!date) return;
    if (!loggedActivity.has(entry.workoutId)) loggedActivity.set(entry.workoutId, []);
    loggedActivity.get(entry.workoutId).push(date);
  });
  const groups = new Map();
  workouts.forEach(workout => {
    const { cycle, week } = workoutIndices(workout);
    lengths.set(cycle, Math.max(lengths.get(cycle) || 0, week + 1));
    const key = `${cycle}:${week}`;
    if (!groups.has(key)) groups.set(key, { cycle, week, workouts: [] });
    groups.get(key).workouts.push(workout);
  });

  const showCycles = Boolean(routine.inputs?.mesoMode) || [...groups.values()].some(group => (
    group.cycle > 0 || group.workouts.some(workout => Boolean(workout.cycleLabel))
  ));
  const entries = [];
  [...lengths.keys()].sort((left, right) => left - right).forEach(cycle => {
    for (let week = 0; week < lengths.get(cycle); week += 1) {
      const key = `${cycle}:${week}`;
      const days = groups.get(key)?.workouts || [];
      const activity = days.flatMap(workout => [
        localDay(workout.session?.startedAt), localDay(workout.completedAt), ...(loggedActivity.get(workout.id) || []),
      ]).filter(Boolean);
      const completions = days.map(workout => localDay(workout.completedAt)).filter(Boolean);
      const completed = days.length > 0 && days.every(workout => Boolean(workout.completedAt));
      entries.push({
        ordinal: entries.length,
        workouts: days,
        activity,
        completions,
        week: {
          key,
          cycleLabel: showCycles ? `Cycle ${cycle + 1}` : null,
          weekLabel: `Week ${week + 1}`,
          start: completed ? monday(earliest(activity)) : null,
          end: completed ? addDays(monday(latest(completions) || latest(activity)), 6) : null,
          completed,
          empty: days.length === 0,
        },
      });
    }
  });

  // Deleted weeks retain their spacing inside the plan. Empty leading/trailing
  // weeks have no work to schedule and should not extend its remaining duration.
  const first = entries.findIndex(entry => !entry.week.empty);
  const last = entries.reduce((index, entry, position) => entry.week.empty ? index : position, first);
  const visible = entries.slice(first, last + 1);
  const pending = visible.filter(entry => !entry.week.empty && !entry.week.completed);
  const current = pending[0];
  const finalPending = pending[pending.length - 1];
  let anchor = monday(today);
  if (current && !current.activity.length) {
    const previous = visible.filter(entry => entry.ordinal < current.ordinal && entry.week.completed && entry.activity.length).pop();
    if (previous) {
      // Finishing one program week early does not move the following week back
      // into the same calendar week. Starting it explicitly does allow that.
      const next = addDays(monday(latest(previous.activity)), (current.ordinal - previous.ordinal) * 7);
      anchor = latest([anchor, next]);
    }
  }
  if (current) {
    visible.forEach(entry => {
      if (!entry.week.completed && entry.ordinal >= current.ordinal && entry.ordinal <= finalPending.ordinal) {
        // Any started week is current work, even when an earlier queue entry
        // remains unfinished. Untouched weeks retain their ordinal projection.
        entry.week.start = entry.activity.length ? monday(today) : addDays(anchor, (entry.ordinal - current.ordinal) * 7);
        entry.week.end = addDays(entry.week.start, 6);
      }
    });
  }

  const actualStart = earliest(visible.flatMap(entry => entry.activity));
  const actualEnd = latest(visible.flatMap(entry => entry.completions));
  const completed = !pending.length;
  const pendingStart = earliest(pending.map(entry => entry.week.start));
  const pendingEnd = latest(pending.map(entry => entry.week.end));
  const end = completed ? actualEnd : latest([pendingEnd, actualEnd]);
  // Compare local calendar components, not elapsed milliseconds across DST.
  const dayOrdinal = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  const remainingWeeks = pendingStart && pendingEnd
    ? 1 + (dayOrdinal(monday(pendingEnd)) - dayOrdinal(pendingStart)) / 7 : 0;
  const byWorkoutId = new Map();
  visible.forEach(entry => entry.workouts.forEach(workout => byWorkoutId.set(workout.id, entry.week)));
  return {
    weeks: visible.map(entry => entry.week),
    byWorkoutId,
    start: actualStart || current?.week.start || null,
    end,
    started: Boolean(actualStart),
    completed,
    remainingWeeks,
    finalWeek: monday(end),
  };
};
