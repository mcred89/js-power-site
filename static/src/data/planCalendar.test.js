import { buildPlanCalendar, formatCalendarDate, localDateKey, workoutWeekText } from './planCalendar';
import { createRoutine } from './routines';
import { repairShortenedCycles } from './cycleShorteningRepair';
import { updateRoutinePlan } from './routineUpdates';

const day = (id, cycleIndex, weekIndex, extra = {}) => ({
  id, cycleIndex, weekIndex, cycleLabel: `Cycle ${cycleIndex + 1}`, weekLabel: `Week ${weekIndex + 1}`, completedAt: null, ...extra,
});
const routine = (workouts, durations = ['5 weeks']) => ({
  createdAt: '2020-01-01T12:00:00Z',
  updatedAt: '2099-01-01T12:00:00Z',
  inputs: { mesoMode: durations.length > 1, duration: durations[0], microCycles: durations.map(duration => ({ duration })) },
  workouts,
});
const dates = calendar => calendar.weeks.map(week => [week.key, localDateKey(week.start), localDateKey(week.end)]);

const trainingPlan = (completedWeeks, includeStrongmanDay = true, extra = {}) => {
  const plan = createRoutine('profile', 'Duration change', {
    maxSquat: '300', maxPress: '200', maxDead: '400', mainLiftChoice: 'Low',
    duration: '5 weeks', includeStrongmanDay, ...extra,
  });
  plan.workouts.forEach(workout => {
    if (workout.cycleIndex === 0 && workout.sourceWeek < completedWeeks) workout.completedAt = '2026-09-25T12:00:00';
  });
  return plan;
};

describe.each([true, false])('estimated end after shortening with Strongman = %s', includeStrongmanDay => {
  it.each([
    [0, '2026-11-01', '2026-10-18', 3],
    [1, '2026-10-25', '2026-10-11', 2],
    [2, '2026-10-18', '2026-10-11', 2],
    [3, '2026-10-11', '2026-10-04', 1],
    [4, '2026-10-04', '2026-10-04', 1],
  ])('uses the remaining schedule after %i completed weeks', (completedWeeks, oldEnd, newEnd, remainingWeeks) => {
    const plan = trainingPlan(completedWeeks, includeStrongmanDay);
    const snapshot = JSON.stringify(plan);
    expect(localDateKey(buildPlanCalendar(plan, '2026-10-03').end)).toBe(oldEnd);
    const shortened = updateRoutinePlan(plan, { duration: '3 weeks' });
    const calendar = buildPlanCalendar(shortened, '2026-10-03');
    expect(localDateKey(calendar.end)).toBe(newEnd);
    expect(calendar.remainingWeeks).toBe(remainingWeeks);
    expect(JSON.stringify(plan)).toBe(snapshot);
    expect(localDateKey(buildPlanCalendar(JSON.parse(JSON.stringify(shortened)), '2026-10-03').end)).toBe(newEnd);
  });
});

it('moves the end of later cycles earlier when an earlier cycle is shortened', () => {
  const plan = trainingPlan(3, true, { mesoMode: true, microCycles: [
    { duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' },
  ] });
  expect(localDateKey(buildPlanCalendar(plan, '2026-10-03').end)).toBe('2026-11-15');
  const shortened = updateRoutinePlan(plan, { microCycles: [
    { duration: '3 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' },
  ] });
  const calendar = buildPlanCalendar(shortened, '2026-10-03');
  expect(localDateKey(calendar.end)).toBe('2026-11-08');
  expect(calendar.remainingWeeks).toBe(6);
  const nextCycle = shortened.workouts.find(workout => workout.cycleIndex === 1);
  expect(localDateKey(calendar.byWorkoutId.get(nextCycle.id).start)).toBe('2026-10-05');
});

it('keeps the next-week anchor when shortening immediately after this week was completed', () => {
  const plan = trainingPlan(3);
  plan.workouts.filter(workout => workout.sourceWeek === 2).forEach(workout => { workout.completedAt = '2026-10-01T12:00:00'; });
  expect(localDateKey(buildPlanCalendar(plan, '2026-10-03').end)).toBe('2026-10-18');
  const calendar = buildPlanCalendar(updateRoutinePlan(plan, { duration: '3 weeks' }), '2026-10-03');
  expect(localDateKey(calendar.end)).toBe('2026-10-11');
  expect(calendar.remainingWeeks).toBe(1);
});

it('forecasts mixed cycle durations from this local Monday without changing the plan', () => {
  const plan = routine([day('first', 0, 0), day('third', 1, 0), day('last', 2, 2)], ['3 weeks', '5 weeks', '3 weeks']);
  const snapshot = JSON.stringify(plan);
  const calendar = buildPlanCalendar(plan, new Date(2026, 9, 1, 23));
  expect(calendar.weeks).toHaveLength(11);
  expect(localDateKey(calendar.byWorkoutId.get('third').start)).toBe('2026-10-19');
  expect(localDateKey(calendar.byWorkoutId.get('last').start)).toBe('2026-12-07');
  expect(localDateKey(calendar.start)).toBe('2026-09-28');
  expect(localDateKey(calendar.end)).toBe('2026-12-13');
  expect(calendar.remainingWeeks).toBe(11);
  expect(calendar.started).toBe(false);
  expect(JSON.stringify(plan)).toBe(snapshot);
});

it('keeps deleted interior week spacing and trims empty weeks before and after work', () => {
  const calendar = buildPlanCalendar(routine([day('first', 0, 1), day('last', 0, 3)]), '2026-10-01');
  expect(dates(calendar)).toEqual([
    ['0:1', '2026-09-28', '2026-10-04'],
    ['0:2', '2026-10-05', '2026-10-11'],
    ['0:3', '2026-10-12', '2026-10-18'],
  ]);
  expect(calendar.weeks[1]).toMatchObject({ empty: true, completed: false });
  expect(calendar.remainingWeeks).toBe(3);
});

it('moves the next unstarted program week to next Monday when the prior week just finished', () => {
  const calendar = buildPlanCalendar(routine([
    day('done', 0, 0, { completedAt: '2026-10-01T12:00:00' }),
    day('next', 0, 1),
    day('last', 0, 2),
  ]), '2026-10-01');
  expect(localDateKey(calendar.start)).toBe('2026-10-01');
  expect(localDateKey(calendar.byWorkoutId.get('next').start)).toBe('2026-10-05');
  expect(localDateKey(calendar.end)).toBe('2026-10-18');
  expect(calendar.started).toBe(true);
});

it('uses the current week after an explicit start or partial completion of that week', () => {
  [
    { session: { startedAt: '2026-09-30T10:00:00' } },
    { session: { startedAt: '2026-09-01T10:00:00' } },
  ].forEach(activity => {
    const calendar = buildPlanCalendar(routine([
      day('done', 0, 0, { completedAt: '2026-09-29T10:00:00' }),
      day('next', 0, 1, activity),
    ]), '2026-10-01');
    expect(localDateKey(calendar.byWorkoutId.get('next').start)).toBe('2026-09-28');
  });
  const partial = buildPlanCalendar(routine([
    day('previous', 0, 0, { completedAt: '2026-09-29T10:00:00' }),
    day('done', 0, 1, { completedAt: '2026-09-30T10:00:00' }),
    day('next', 0, 1),
  ]), '2026-10-01');
  expect(localDateKey(partial.byWorkoutId.get('next').start)).toBe('2026-09-28');
});

it('slides delayed remaining work forward while retaining the actual start date', () => {
  const calendar = buildPlanCalendar(routine([
    day('done', 0, 0, { session: { startedAt: '2026-08-03T12:00:00' }, completedAt: '2026-08-07T12:00:00' }),
    day('next', 0, 1),
  ]), '2026-10-01');
  expect(localDateKey(calendar.start)).toBe('2026-08-03');
  expect(localDateKey(calendar.end)).toBe('2026-10-04');
  expect(localDateKey(calendar.byWorkoutId.get('next').start)).toBe('2026-09-28');
});

it('retains actual weeks for out-of-order completions without projecting them into the future', () => {
  const calendar = buildPlanCalendar(routine([
    day('later', 0, 2, { completedAt: '2026-09-30T12:00:00' }),
    day('first', 0, 0),
    day('middle', 0, 1),
  ]), '2026-10-01');
  expect(localDateKey(calendar.byWorkoutId.get('later').start)).toBe('2026-09-28');
  expect(localDateKey(calendar.byWorkoutId.get('middle').start)).toBe('2026-10-05');
  expect(calendar.remainingWeeks).toBe(2);
  expect(localDateKey(calendar.end)).toBe('2026-10-11');
});

it('shows partially started future weeks as current work across the remaining calendar span', () => {
  const calendar = buildPlanCalendar(routine([
    day('first', 0, 0),
    day('middle-done', 0, 1, { completedAt: '2026-09-30T12:00:00' }),
    day('middle-pending', 0, 1),
    day('last', 0, 2),
  ]), '2026-10-01');
  expect(localDateKey(calendar.byWorkoutId.get('first').start)).toBe('2026-09-28');
  expect(localDateKey(calendar.byWorkoutId.get('middle-pending').start)).toBe('2026-09-28');
  expect(localDateKey(calendar.byWorkoutId.get('last').start)).toBe('2026-10-12');
  expect(localDateKey(calendar.end)).toBe('2026-10-18');
  expect(calendar.remainingWeeks).toBe(3);
});

it('does not shorten the end past unfinished earlier work when the last week was started early', () => {
  const calendar = buildPlanCalendar(routine([
    day('done', 0, 0, { completedAt: '2026-09-30T12:00:00' }),
    day('first-pending', 0, 1),
    day('middle-pending', 0, 2),
    day('last-started', 0, 3, { session: { startedAt: '2026-09-30T12:00:00' } }),
  ]), '2026-10-01');
  expect(localDateKey(calendar.byWorkoutId.get('first-pending').start)).toBe('2026-10-05');
  expect(localDateKey(calendar.byWorkoutId.get('middle-pending').start)).toBe('2026-10-12');
  expect(localDateKey(calendar.byWorkoutId.get('last-started').start)).toBe('2026-09-28');
  expect(localDateKey(calendar.end)).toBe('2026-10-18');
  expect(localDateKey(calendar.finalWeek)).toBe('2026-10-12');
  expect(calendar.remainingWeeks).toBe(3);
});

it('recognizes linked Strongman training as an early start without a timed session', () => {
  const plan = routine([
    day('done', 0, 0, { completedAt: '2026-09-30T12:00:00' }),
    day('next', 0, 1),
    day('strongman', 0, 2, { name: 'Strongman' }),
  ]);
  plan.strongmanLog = [
    { id: 'dated-effort', workoutId: 'strongman', date: '2026-09-29', createdAt: '2026-10-01T12:00:00Z' },
  ];
  const before = JSON.stringify(plan);
  const calendar = buildPlanCalendar(plan, '2026-10-01');
  expect(calendar.started).toBe(true);
  expect(localDateKey(calendar.start)).toBe('2026-09-29');
  expect(localDateKey(calendar.byWorkoutId.get('next').start)).toBe('2026-10-05');
  expect(localDateKey(calendar.byWorkoutId.get('strongman').start)).toBe('2026-09-28');
  expect(localDateKey(calendar.end)).toBe('2026-10-11');
  expect(calendar.remainingWeeks).toBe(2);
  expect(JSON.stringify(plan)).toBe(before);
});

it('ignores unlinked, deleted-workout, and invalid Strongman log dates for the plan calendar', () => {
  const plan = routine([day('strongman', 0, 0, { name: 'Strongman' }), day('next', 0, 1)]);
  const expected = buildPlanCalendar(plan, '2026-10-01');
  plan.strongmanLog = [
    { id: 'past', workoutId: null, date: '2026-01-01' },
    { id: 'deleted', workoutId: 'deleted-workout', date: '2026-02-01' },
    { id: 'invalid', workoutId: 'strongman', date: '2026-02-30' },
    { id: 'missing', workoutId: 'strongman', createdAt: '2026-03-01T12:00:00Z' },
    null,
  ];
  const before = JSON.stringify(plan);
  const calendar = buildPlanCalendar(plan, '2026-10-01');
  expect(calendar).toEqual(expected);
  expect(calendar.started).toBe(false);
  expect(JSON.stringify(plan)).toBe(before);
});

it('uses actual start and finish dates for completed plans even when a week spans several calendar weeks', () => {
  const calendar = buildPlanCalendar(routine([
    day('first', 0, 0, { session: { startedAt: '2026-08-05T12:00:00' }, completedAt: '2026-08-14T12:00:00' }),
    day('last', 0, 1, { completedAt: '2026-08-25T12:00:00' }),
  ]), '2026-10-01');
  expect(calendar).toMatchObject({ completed: true, remainingWeeks: 0, started: true });
  expect(localDateKey(calendar.start)).toBe('2026-08-05');
  expect(localDateKey(calendar.end)).toBe('2026-08-25');
  expect(localDateKey(calendar.finalWeek)).toBe('2026-08-24');
  expect(dates(calendar)[0]).toEqual(['0:0', '2026-08-03', '2026-08-16']);
});

it('preserves ordinal spacing across a deleted week immediately after completion', () => {
  const calendar = buildPlanCalendar(routine([
    day('done', 0, 0, { completedAt: '2026-10-01T12:00:00' }),
    day('next', 0, 2),
  ]), '2026-10-01');
  expect(localDateKey(calendar.byWorkoutId.get('next').start)).toBe('2026-10-12');
  expect(calendar.weeks[1]).toMatchObject({ empty: true, start: null, end: null });
});

it('handles year rollover, Sunday/Monday boundaries, and daylight saving using local days', () => {
  const plan = routine([day('first', 0, 0), day('next', 0, 1)]);
  expect(dates(buildPlanCalendar(plan, '2027-01-03'))).toEqual([
    ['0:0', '2026-12-28', '2027-01-03'],
    ['0:1', '2027-01-04', '2027-01-10'],
  ]);
  expect(localDateKey(buildPlanCalendar(plan, '2027-01-04').start)).toBe('2027-01-04');
  const spring = buildPlanCalendar(plan, new Date(2026, 2, 5, 23));
  expect(dates(spring)).toEqual([
    ['0:0', '2026-03-02', '2026-03-08'],
    ['0:1', '2026-03-09', '2026-03-15'],
  ]);
  spring.weeks.forEach(week => expect(week.start.getHours()).toBe(0));
  expect(spring.remainingWeeks).toBe(2);
  expect(buildPlanCalendar(plan, new Date(2026, 9, 30, 23)).remainingWeeks).toBe(2);
});

it('formats timestamps in local time and treats date-only values as local dates', () => {
  expect(localDateKey(new Date(2026, 9, 1, 23, 59))).toBe('2026-10-01');
  expect(formatCalendarDate('2026-10-01')).toBe('10/01/26');
  const instant = '2026-10-01T01:00:00Z';
  const local = new Date(instant);
  expect(localDateKey(instant)).toBe(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`);
  [null, undefined, '', 'now', '2026-02-30', '2026-02-30T12:00:00Z', {}, new Date(NaN)].forEach(value => {
    expect(formatCalendarDate(value)).toBe('');
    expect(localDateKey(value)).toBe('');
  });
});

it('normalizes numeric and missing legacy labels and tolerates invalid activity', () => {
  const calendar = buildPlanCalendar({ workouts: [
    { id: 'done', cycleLabel: 1, weekLabel: 1, completedAt: 'now' },
    { id: 'next', cycleLabel: 2, weekLabel: 2, session: { startedAt: 'invalid' } },
  ] }, '2026-10-01');
  expect(calendar.byWorkoutId.get('done')).toMatchObject({ cycleLabel: 'Cycle 1', weekLabel: 'Week 1', completed: true, start: null, end: null });
  expect(calendar.byWorkoutId.get('next')).toMatchObject({ cycleLabel: 'Cycle 2', weekLabel: 'Week 2' });
  expect(localDateKey(calendar.byWorkoutId.get('next').start)).toBe('2026-09-28');
  expect(workoutWeekText({ cycleLabel: 3, weekLabel: 2 })).toBe('Cycle 3 · Week 2');
  expect(workoutWeekText({ weekIndex: 1 })).toBe('Week 2');
  expect(workoutWeekText({})).toBe('Week 1');
  expect(workoutWeekText(null)).toBe('');
  expect(buildPlanCalendar({ workouts: [] })).toBeNull();
  expect(buildPlanCalendar(null)).toBeNull();
});

it('forecasts a copied plan with no activity from this week, irrespective of metadata dates', () => {
  const plan = routine([day('copied', 0, 0)]);
  const calendar = buildPlanCalendar(plan, '2026-10-01');
  expect(calendar.started).toBe(false);
  expect(localDateKey(calendar.start)).toBe('2026-09-28');
  expect(localDateKey(calendar.end)).toBe('2026-10-04');
});

it('bounds unsupported imported indexes and labels without discarding or changing records', () => {
  const plan = routine([
    day('large', Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, { cycleLabel: '999999999999999999999999999', weekLabel: '999999999999999999999999999' }),
    day('infinite', Infinity, Infinity, { cycleLabel: 'Infinity', weekLabel: 'Infinity' }),
    day('fallback-labels', -1, -1, { cycleLabel: 'Cycle 2', weekLabel: 'Week 3' }),
    day('nan', NaN, NaN, { cycleLabel: null, weekLabel: null }),
  ]);
  const before = JSON.stringify(plan);
  const calendar = buildPlanCalendar(plan, '2026-10-01');
  expect(calendar.weeks).toHaveLength(8);
  expect(calendar.byWorkoutId.size).toBe(4);
  expect(calendar.byWorkoutId.get('large').key).toBe('0:0');
  expect(calendar.byWorkoutId.get('infinite').key).toBe('0:0');
  expect(calendar.byWorkoutId.get('fallback-labels').key).toBe('1:2');
  expect(calendar.byWorkoutId.get('nan').key).toBe('0:0');
  expect(workoutWeekText(plan.workouts[0])).toBe('Cycle 1 · Week 1');
  expect(JSON.stringify(plan)).toBe(before);
  expect(plan.workouts[1].cycleIndex).toBe(Infinity);
});

it('retains large valid histories without filling absent cycle indexes', () => {
  const calendar = buildPlanCalendar(routine([day('history', 1333, 4)]), '2026-10-01');
  expect(calendar.weeks).toHaveLength(1);
  expect(calendar.byWorkoutId.get('history')).toMatchObject({ key: '1333:4', cycleLabel: 'Cycle 1334', weekLabel: 'Week 5' });
});

it('forecasts a started bad Week 2 snapshot together with the repaired six-day Week 4 without rewriting it', () => {
  const original = createRoutine('profile', 'Shortened', { maxSquat: '300', maxPress: '200', maxDead: '400',
    duration: '5 weeks', mainLiftChoice: 'Low', includeStrongmanDay: true,
  });
  original.inputs.duration = '3 weeks';
  original.workouts = original.workouts.flatMap(workout => {
    if (workout.sourceWeek < 3) return [{ ...workout, completedAt: '2026-09-30T12:00:00Z' }];
    if (workout.sourceWeek === 3 && workout.name === 'Deadlift') return [];
    const weekIndex = Math.floor(workout.sourceWeek / 2);
    return [{ ...workout, weekIndex, weekLabel: `Week ${weekIndex + 1}` }];
  });
  const started = original.workouts.find(workout => workout.name === 'Squat' && workout.sourceWeek === 3);
  started.session = { status: 'inProgress', startedAt: '2026-10-01T12:00:00Z' };
  const snapshot = JSON.stringify(started);
  const repaired = repairShortenedCycles(original);
  expect(repaired.workouts.find(workout => workout.id === started.id)).toBe(started);
  expect(started.weekLabel).toBe('Week 2');
  const before = JSON.stringify(repaired);
  const calendar = buildPlanCalendar(repaired, '2026-10-01');
  expect(calendar.remainingWeeks).toBe(1);
  expect(calendar.weeks.filter(week => !week.completed && !week.empty)).toHaveLength(1);
  const remaining = repaired.workouts.filter(workout => !workout.completedAt);
  expect(remaining).toHaveLength(6);
  remaining.forEach(workout => expect(calendar.byWorkoutId.get(workout.id)).toMatchObject({ key: '0:3', weekLabel: 'Week 4' }));
  expect(JSON.stringify(started)).toBe(snapshot);
  expect(JSON.stringify(repaired)).toBe(before);
});

it('ignores absent, invalid or inapplicable saved groupings and unknown workout identities', () => {
  const workout = day('future', 0, 1, { name: 'Squat', sourceWeek: 3 });
  const saved = { 0: [[0], [1], [2], [3, 4]] };
  const base = routine([workout], ['3 weeks']);
  const expected = buildPlanCalendar(base, '2026-10-01');
  [undefined, null, { 0: [[0], [1], [3, 4]] }, { 0: [[0], [1], [2], [3, 3]] }, { 0: 'unknown' }]
    .forEach(cycleWeekGroups => expect(buildPlanCalendar({ ...base, cycleWeekGroups }, '2026-10-01')).toEqual(expected));
  const fiveWeeks = routine([workout]);
  expect(buildPlanCalendar({ ...fiveWeeks, cycleWeekGroups: saved }, '2026-10-01'))
    .toEqual(buildPlanCalendar(fiveWeeks, '2026-10-01'));
  [{ ...workout, name: 'Custom' }, { ...workout, sourceWeek: undefined }, { ...workout, cycleIndex: undefined }]
    .forEach(unknown => {
      const plan = { ...base, workouts: [unknown] };
      expect(buildPlanCalendar({ ...plan, cycleWeekGroups: saved }, '2026-10-01'))
        .toEqual(buildPlanCalendar(plan, '2026-10-01'));
    });
});
