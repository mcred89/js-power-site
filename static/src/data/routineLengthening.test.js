import { createRoutine } from './routines';
import { correctMaxes, refreshAdaptiveProgression } from './routineRecalculation';
import { getPlanUpdateSummary, updateRoutinePlan } from './routineUpdates';
import { buildPlanCalendar, localDateKey } from './planCalendar';
import { deleteFutureWorkout, updateExercise } from './workoutActions';
import { exportBackup, parseBackup } from './storageBackup';

const inputs = {
  maxSquat: '300', maxPress: '200', maxDead: '400',
  duration: '3 weeks', mainLiftChoice: 'Low', includeStrongmanDay: true,
  maxProgressionMode: 'fixed', squatIncrement: '10', pressIncrement: '5', deadliftIncrement: '20',
};
const make = changes => createRoutine('profile', 'Plan', { ...inputs, ...changes });
const stage = (routine, name, sourceWeek, cycleIndex = 0) => routine.workouts.find(workout => (
  workout.cycleIndex === cycleIndex && workout.name === name && workout.sourceWeek === sourceWeek
));
const schedule = routine => routine.workouts.map(workout => ({
  cycleIndex: workout.cycleIndex, name: workout.name, sourceWeek: workout.sourceWeek, weekIndex: workout.weekIndex,
  exercises: workout.exercises.map(exercise => exercise.generated),
}));
const expand = routine => updateRoutinePlan(routine, routine.inputs.mesoMode ? {
  microCycles: routine.inputs.microCycles.map(cycle => ({ ...cycle, duration: '5 weeks' })),
} : { duration: '5 weeks' });

it.each([true, false])('expands an untouched cycle to the complete five-week schedule (Strongman: %s)', includeStrongmanDay => {
  const original = make({ includeStrongmanDay });
  const before = JSON.stringify(original);
  const updated = expand(original);
  expect(schedule(updated)).toEqual(schedule(make({ includeStrongmanDay, duration: '5 weeks' })));
  expect(updated.workouts).toHaveLength(includeStrongmanDay ? 20 : 15);
  expect(updated.workouts.filter(workout => workout.name === 'Deadlift')).toHaveLength(5);
  original.workouts.forEach(workout => {
    const retained = updated.workouts.find(item => item.id === workout.id);
    expect(retained.sequence).toBe(workout.sequence);
    expect(retained.exercises).toEqual(workout.exercises);
  });
  expect(updated.workouts.map(workout => workout.sequence)).toEqual(
    updated.workouts.map(workout => workout.sequence).sort((a, b) => a - b),
  );
  expect(new Set(updated.workouts.map(workout => workout.sequence)).size).toBe(updated.workouts.length);
  expect(getPlanUpdateSummary(original, updated)).toMatchObject({
    addedWorkouts: includeStrongmanDay ? 4 : 0,
    addedByName: includeStrongmanDay ? { Deadlift: 2, Strongman: 2 } : {},
    removedWorkouts: 0,
  });
  expect(buildPlanCalendar(updated, '2026-10-03').remainingWeeks).toBe(5);
  expect(JSON.stringify(original)).toBe(before);
  expect(expand(updated)).toBe(updated);
});

it('preserves completed cycles and compressed history while extending every future cycle and end date', () => {
  const original = make({ mesoMode: true, microCycles: Array.from({ length: 3 }, () => ({ duration: '3 weeks', volume: 'Low' })) });
  original.workouts.forEach(workout => {
    if (workout.cycleIndex === 0 || (workout.cycleIndex === 1 && workout.weekIndex === 0)) {
      workout.completedAt = '2026-10-01T12:00:00Z';
    }
  });
  const updated = expand(original);
  expect(updated.cycleWeekGroups).toEqual({
    0: [[0, 1], [2, 3], [4]], 1: [[0, 1], [2], [3], [4]], 2: [[0], [1], [2], [3], [4]],
  });
  original.workouts.filter(workout => workout.completedAt).forEach(workout => {
    expect(updated.workouts.find(item => item.id === workout.id)).toBe(workout);
  });
  expect(stage(updated, 'Deadlift', 1, 1)).toBeUndefined();
  expect(stage(updated, 'Deadlift', 3, 1).exercises[0].generated.weight).toBe(340);
  expect(getPlanUpdateSummary(original, updated)).toMatchObject({ addedWorkouts: 6, addedByName: { Deadlift: 3, Strongman: 3 } });
  const before = buildPlanCalendar(original, '2026-10-03');
  const after = buildPlanCalendar(updated, '2026-10-03');
  expect(before.remainingWeeks).toBe(5);
  expect(after.remainingWeeks).toBe(8);
  expect(localDateKey(before.end)).toBe('2026-11-08');
  expect(localDateKey(after.end)).toBe('2026-11-29');
  expect(after.weeks.filter(week => week.cycleLabel === 'Cycle 1')).toHaveLength(3);
});

it.each(['completed', 'skipped', 'session', 'queue', 'log'])('keeps the whole active compressed week through %s activity, including unfinished earlier gaps', kind => {
  const original = make();
  const protectedWorkout = stage(original, 'Squat', 2);
  if (kind === 'completed') protectedWorkout.completedAt = '2026-10-01T12:00:00Z';
  if (kind === 'skipped') protectedWorkout.skippedAt = '2026-10-01T12:00:00Z';
  if (kind === 'session') protectedWorkout.session = { status: 'unknown', note: 'Keep this snapshot' };
  if (kind === 'queue') protectedWorkout.strongmanQueue = [{ id: 'queued', note: 'Keep this queue' }];
  if (kind === 'log') original.strongmanLog = [{ id: 'entry', workoutId: protectedWorkout.id, date: '2026-10-01', note: 'Keep result' }];
  const updated = expand(original);
  expect(updated.cycleWeekGroups[0]).toEqual([[0, 1], [2, 3], [4]]);
  expect(updated.workouts).toEqual(original.workouts);
  expect(updated.workouts.find(item => item.id === protectedWorkout.id)).toBe(protectedWorkout);
  expect(updated.strongmanLog).toBe(original.strongmanLog);
  expect(getPlanUpdateSummary(original, updated).addedWorkouts).toBe(0);
  expect(buildPlanCalendar(updated, '2026-10-03').remainingWeeks).toBe(3);
});

it('preserves deleted days, customized exercises and unknown or duplicate records through expansion and later updates', () => {
  let original = make({ mesoMode: true, maxProgressionMode: 'adaptive', microCycles: [
    { duration: '3 weeks', volume: 'Low' }, { duration: '3 weeks', volume: 'High' },
  ] });
  const deleted = stage(original, 'Deadlift', 2);
  original = deleteFutureWorkout(original, deleted.id);
  const customized = stage(original, 'Press', 3);
  original = updateExercise(original, customized.id, customized.exercises[0].id, { weight: '123' });
  const duplicate = { ...stage(original, 'Squat', 0), id: 'duplicate', sequence: 1000, custom: true };
  const unknown = { ...duplicate, id: 'unknown', sequence: 1001, sourceWeek: undefined };
  original.workouts.push(duplicate, unknown);
  original.custom = { keep: true };
  const updated = expand(original);
  const saved = parseBackup(exportBackup([{ id: 'profile', name: 'Athlete' }], [updated])).routines[0];
  const corrected = correctMaxes(saved, { maxDead: '500' });
  const refreshed = refreshAdaptiveProgression(corrected).routine;
  const edited = updateRoutinePlan(refreshed, { includeBackoffSets: true });
  [updated, saved, corrected, refreshed, edited].forEach(plan => {
    expect(stage(plan, 'Deadlift', 2)).toBeUndefined();
    expect(plan.workouts.map(workout => workout.id)).toEqual(updated.workouts.map(workout => workout.id));
    expect(stage(plan, 'Press', 3).exercises[0].overrides).toEqual({ weight: '123' });
    expect(plan.workouts.find(workout => workout.id === duplicate.id)).toEqual(duplicate);
    expect(plan.workouts.find(workout => workout.id === unknown.id)).toEqual(unknown);
    expect(plan.custom).toEqual({ keep: true });
  });
  expect(stage(corrected, 'Deadlift', 3).exercises[0].generated.weight).toBe(400);
  expect(updated.workouts.find(workout => workout.id === duplicate.id)).toBe(duplicate);
});

it('can shorten and lengthen repeatedly without moving history, reviving deletions or duplicating stages', () => {
  let original = make({ duration: '5 weeks' });
  original.workouts.filter(workout => workout.sourceWeek === 0).forEach(workout => { workout.completedAt = '2026-10-01T12:00:00Z'; });
  original = deleteFutureWorkout(original, stage(original, 'Press', 3).id);
  const shortened = updateRoutinePlan(original, { duration: '3 weeks' });
  const expanded = expand(shortened);
  expect(expanded.cycleWeekGroups[0]).toEqual([[0], [1], [2], [3], [4]]);
  expect(schedule(expanded)).toEqual(schedule(original));
  const again = expand(updateRoutinePlan(expanded, { duration: '3 weeks' }));
  expect(schedule(again)).toEqual(schedule(original));
  expect(new Set(again.workouts.map(workout => `${workout.name}:${workout.sourceWeek}`)).size).toBe(again.workouts.length);
  original.workouts.filter(workout => workout.completedAt).forEach(workout => {
    expect(again.workouts.find(item => item.id === workout.id)).toBe(workout);
  });
});

it.each([['Deadlift', 1], ['Strongman', 0], ['Strongman', 2]])('never restores an explicitly deleted %s stage %i across shortening, backup and expansion', (name, sourceWeek) => {
  let original = make({ duration: '5 weeks' });
  const deleted = stage(original, name, sourceWeek);
  original = deleteFutureWorkout(original, deleted.id);
  const shortened = updateRoutinePlan(original, { duration: '3 weeks' });
  const saved = parseBackup(exportBackup([{ id: 'profile', name: 'Athlete' }], [shortened])).routines[0];
  const expanded = expand(saved);
  expect(stage(expanded, name, sourceWeek)).toBeUndefined();
  expect(expanded.workouts).toHaveLength(19);
  expect(expanded.deletedWorkoutStages).toContain(`0:${name}:${sourceWeek}`);
  expect(schedule(expand(updateRoutinePlan(expanded, { duration: '3 weeks' })))).toEqual(schedule(expanded));
});

it('does not delete a generated stage when only its imported duplicate is removed', () => {
  let original = make({ duration: '5 weeks' });
  const deadlift = stage(original, 'Deadlift', 1);
  original.workouts.push({ ...deadlift, id: 'duplicate', sequence: 1000 });
  original = deleteFutureWorkout(original, 'duplicate');
  expect(original.deletedWorkoutStages).toEqual([]);
  const expanded = expand(updateRoutinePlan(original, { duration: '3 weeks' }));
  expect(stage(expanded, 'Deadlift', 1)).toBeDefined();
  expect(schedule(expanded)).toEqual(schedule(original));
});
