import { createRoutine, startWorkoutSession } from './routines';
import { correctMaxes, refreshAdaptiveProgression } from './routineRecalculation';
import { getPlanUpdateSummary, updateRoutinePlan } from './routineUpdates';
import { buildPlanCalendar } from './planCalendar';
import { deleteFutureWorkout, updateExercise } from './workoutActions';

const inputs = {
  maxSquat: '300', maxPress: '200', maxDead: '400',
  duration: '5 weeks', mainLiftChoice: 'Low', includeStrongmanDay: true,
  maxProgressionMode: 'fixed', squatIncrement: '10', pressIncrement: '5', deadliftIncrement: '20',
};
const make = changes => createRoutine('profile', 'Plan', { ...inputs, ...changes });
const stage = (routine, name, sourceWeek, cycleIndex = 0) => routine.workouts.find(workout => (
  workout.cycleIndex === cycleIndex && workout.name === name && workout.sourceWeek === sourceWeek
));
const shortenFinal = routine => updateRoutinePlan(routine, {
  microCycles: routine.inputs.microCycles.map((cycle, index, cycles) => (
    index === cycles.length - 1 ? { ...cycle, duration: '3 weeks' } : cycle
  )),
});

it('compresses all five lifting stages and removes the correct untouched strongman and deadlift days', () => {
  const routine = make();
  const before = JSON.stringify(routine);
  const updated = updateRoutinePlan(routine, { duration: '3 weeks' });
  const fresh = make({ duration: '3 weeks' });
  const prescriptions = plan => plan.workouts.map(workout => ({
    name: workout.name, sourceWeek: workout.sourceWeek, weekIndex: workout.weekIndex,
    exercises: workout.exercises.map(exercise => exercise.generated),
  }));
  expect(prescriptions(updated)).toEqual(prescriptions(fresh));
  expect(updated.workouts).toHaveLength(16);
  expect(updated.workouts.map(workout => workout.id)).toEqual(routine.workouts
    .filter(workout => ![4, 7, 12, 15].includes(workout.sequence)).map(workout => workout.id));
  expect(getPlanUpdateSummary(routine, updated)).toMatchObject({
    removedWorkouts: 4, removedByName: { Deadlift: 2, Strongman: 2 }, preservedExtraWorkouts: 0,
  });
  expect(JSON.stringify(routine)).toBe(before);
  expect(updateRoutinePlan(updated, { duration: '3 weeks' })).toBe(updated);
});

it('keeps completed prior cycles and two completed weeks of the final cycle byte-for-byte', () => {
  let routine = make({ mesoMode: true, microCycles: [
    { duration: '3 weeks', volume: 'High' }, { duration: '5 weeks', volume: 'Low' },
  ] });
  routine.workouts.forEach(workout => {
    if (workout.cycleIndex === 0 || workout.weekIndex < 2) workout.completedAt = '2026-09-30T12:00:00Z';
  });
  const customized = stage(routine, 'Press', 3, 1);
  routine = updateExercise(routine, customized.id, customized.exercises[0].id, { movement: 'Log press', weight: '150' });
  const before = JSON.stringify(routine);
  const snapshots = routine.workouts.filter(workout => workout.completedAt);
  const updated = shortenFinal(routine);
  snapshots.forEach(workout => expect(updated.workouts.find(item => item.id === workout.id)).toBe(workout));
  expect(getPlanUpdateSummary(routine, updated)).toMatchObject({
    removedWorkouts: 2, removedByName: { Deadlift: 1, Strongman: 1 }, preservedExtraWorkouts: 2,
  });
  expect(updated.workouts.filter(workout => !workout.completedAt).map(workout => [workout.name, workout.weekIndex])).toEqual([
    ['Squat', 1], ['Press', 1], ['Deadlift', 1], ['Squat', 1], ['Press', 1], ['Strongman', 1],
    ['Squat', 2], ['Press', 2], ['Deadlift', 2], ['Strongman', 2],
  ]);
  expect(stage(updated, 'Press', 3, 1).exercises[0].overrides).toEqual({ movement: 'Log press', weight: '150' });
  expect(stage(updated, 'Squat', 3, 1).exercises[0].generated.weight).toBe(250);
  expect(JSON.stringify(routine)).toBe(before);
});

it('preserves started, paused, skipped, imported-session and separately logged days even outside the shortened schedule', () => {
  let routine = make();
  const started = stage(routine, 'Deadlift', 1);
  routine = startWorkoutSession(routine, started.id, '2026-09-30T12:00:00Z');
  stage(routine, 'Deadlift', 3).session = { status: 'paused', exercises: [] };
  stage(routine, 'Strongman', 0).skippedAt = '2026-09-30T12:00:00Z';
  const logged = stage(routine, 'Strongman', 2);
  routine.strongmanLog = [{ id: 'effort', workoutId: logged.id, note: 'Keep my result' }];
  stage(routine, 'Squat', 4).session = { status: 'unknown', futureField: 'preserve' };
  const protectedWorkouts = routine.workouts.filter(workout => workout.session || workout.skippedAt || workout.id === logged.id);
  const updated = updateRoutinePlan(routine, { duration: '3 weeks', maxDead: '450' });
  protectedWorkouts.forEach(workout => expect(updated.workouts.find(item => item.id === workout.id)).toBe(workout));
  expect(updated.strongmanLog).toBe(routine.strongmanLog);
  expect(getPlanUpdateSummary(routine, updated)).toMatchObject({ removedWorkouts: 0, preservedExtraWorkouts: 4 });
});

it('keeps manual deletion gaps and custom records through shortening, further edits and max correction', () => {
  let routine = make({ mesoMode: true, microCycles: [
    { duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'High' },
  ] });
  const deleted = stage(routine, 'Press', 2);
  routine = deleteFutureWorkout(routine, deleted.id);
  const later = stage(routine, 'Squat', 1, 1);
  const unknown = { ...later, id: 'unknown', sequence: 9999 };
  const noIdentity = { ...later, id: 'no-identity', sourceWeek: undefined, sequence: 998 };
  routine.workouts.push(unknown, noIdentity);
  const updated = updateRoutinePlan(routine, { microCycles: [
    { duration: '3 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'High' },
  ] });
  const corrected = correctMaxes(updated, { maxSquat: '500' });
  const edited = updateRoutinePlan(corrected, { includeBackoffSets: true });
  [updated, corrected, edited].forEach(plan => {
    expect(plan.workouts.find(workout => workout.id === deleted.id)).toBeUndefined();
    expect(plan.workouts.find(workout => workout.id === unknown.id)).toBe(unknown);
    expect(plan.workouts.find(workout => workout.id === noIdentity.id)).toBe(noIdentity);
    expect(stage(plan, 'Squat', 1, 1).id).toBe(later.id);
    expect(stage(plan, 'Squat', 1, 1).sequence).toBe(later.sequence);
  });
  expect(stage(corrected, 'Squat', 1, 1).exercises[0].generated.weight).toBe(310);
  expect(stage(corrected, 'Squat', 3).exercises[0].generated.weight).toBe(400);
});

it('preserves IDs, overrides and the shorter queue after adaptive refresh and backup round trip', () => {
  let routine = make({ mesoMode: true, maxProgressionMode: 'adaptive', microCycles: [
    { duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' },
  ] });
  routine = shortenFinal(routine);
  const serialized = JSON.parse(JSON.stringify(routine));
  const refreshed = refreshAdaptiveProgression(serialized).routine;
  expect(refreshed.workouts).toEqual(routine.workouts);
  expect(updateRoutinePlan(refreshed, { maxSquat: '400' }).workouts.map(workout => workout.id))
    .toEqual(routine.workouts.map(workout => workout.id));
});

it('reports customizations on removed workouts separately from those on remaining workouts', () => {
  let routine = make();
  for (const workout of [stage(routine, 'Deadlift', 1), stage(routine, 'Press', 1)]) {
    routine = updateExercise(routine, workout.id, workout.exercises[0].id, { weight: '123' });
  }
  expect(getPlanUpdateSummary(routine, updateRoutinePlan(routine, { duration: '3 weeks' }))).toMatchObject({
    removedOverrides: 1, preservedOverrides: 1,
  });
});

it('compresses without removing any days when dedicated Strongman days are disabled', () => {
  const routine = make({ includeStrongmanDay: false });
  const updated = updateRoutinePlan(routine, { duration: '3 weeks' });
  expect(updated.workouts).toHaveLength(15);
  expect(updated.workouts.map(workout => workout.id)).toEqual(routine.workouts.map(workout => workout.id));
  expect(updated.workouts.filter(workout => workout.weekIndex === 0)).toHaveLength(6);
  expect(updated.workouts.filter(workout => workout.name === 'Deadlift')).toHaveLength(5);
});

it('retains historical Week 4 while forecasting only one future week after four completed weeks', () => {
  const routine = make();
  routine.workouts.forEach(workout => {
    if (workout.weekIndex < 4) workout.completedAt = '2026-09-30T12:00:00Z';
  });
  const updated = updateRoutinePlan(routine, { duration: '3 weeks' });
  const calendar = buildPlanCalendar(updated, '2026-10-03');
  expect(calendar.remainingWeeks).toBe(1);
  expect(calendar.weeks.find(week => week.weekLabel === 'Week 4').completed).toBe(true);
  expect(stage(updated, 'Deadlift', 4).weekLabel).toBe('Week 3');
});

it('does not allow lengthening a shortened cycle or changing the number of cycles', () => {
  const routine = make({ duration: '3 weeks' });
  expect(() => updateRoutinePlan(routine, { duration: '5 weeks' })).toThrow(/only change from 5 weeks to 3 weeks/);
});
