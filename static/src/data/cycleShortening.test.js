import { createRoutine, createRoutineFromTemplate, cloneImportedRecord } from './routines';
import { createRoutineTemplate, duplicateRoutine } from './routineCopies';
import { correctMaxes, refreshAdaptiveProgression } from './routineRecalculation';
import { getPlanUpdateSummary, updateRoutinePlan } from './routineUpdates';
import { exportBackup, parseBackup } from './storageBackup';
import { buildPlanCalendar } from './planCalendar';
import { updateExercise } from './workoutActions';

const inputs = {
  maxSquat: '300', maxPress: '200', maxDead: '400',
  duration: '5 weeks', mainLiftChoice: 'Low', includeStrongmanDay: true,
  maxProgressionMode: 'same',
};
const completedAt = '2026-10-01T12:00:00Z';
const make = changes => createRoutine('profile', 'Started five-week plan', { ...inputs, ...changes });
const stage = (routine, name, sourceWeek, cycleIndex = 0) => routine.workouts.find(workout => (
  workout.name === name && workout.sourceWeek === sourceWeek && workout.cycleIndex === cycleIndex
));
const completeWeeks = (routine, count, cycleIndex = 0) => ({
  ...routine,
  workouts: routine.workouts.map(workout => (
    workout.cycleIndex < cycleIndex || (workout.cycleIndex === cycleIndex && workout.sourceWeek < count)
      ? { ...workout, completedAt } : workout
  )),
});
const future = routine => routine.workouts.filter(workout => !workout.completedAt);
const schedule = routine => routine.workouts.map(workout => [workout.name, workout.sourceWeek, workout.weekIndex]);
const sixDays = ['Squat', 'Press', 'Deadlift', 'Squat', 'Press', 'Strongman'];
const fourDays = ['Squat', 'Press', 'Deadlift', 'Strongman'];

describe('shortening the untouched remainder of an in-progress cycle', () => {
  it.each([
    [0, [[0, 1], [2, 3], [4]], [sixDays, sixDays, fourDays], 4],
    [1, [[0], [1, 2], [3, 4]], [sixDays, sixDays], 4],
    [2, [[0], [1], [2, 3], [4]], [sixDays, fourDays], 2],
    [3, [[0], [1], [2], [3, 4]], [sixDays], 2],
    [4, [[0], [1], [2], [3], [4]], [fourDays], 0],
  ])('keeps %i completed weeks and combines only later untouched weeks', (count, groups, expectedWeeks, removed) => {
    const original = completeWeeks(make(), count);
    const before = JSON.stringify(original);
    const updated = updateRoutinePlan(original, { duration: '3 weeks' });

    expect(updated.cycleWeekGroups).toEqual({ 0: groups });
    expectedWeeks.forEach((names, index) => {
      const week = future(updated).filter(workout => workout.weekIndex === count + index);
      expect(week.map(workout => workout.name)).toEqual(names);
      expect(week.every(workout => workout.weekLabel === `Week ${count + index + 1}`)).toBe(true);
    });
    expect(future(updated)).toHaveLength(expectedWeeks.flat().length);
    expect(buildPlanCalendar(updated, '2026-10-03').remainingWeeks).toBe(expectedWeeks.length);
    original.workouts.filter(workout => workout.completedAt).forEach(workout => {
      expect(updated.workouts.find(candidate => candidate.id === workout.id)).toBe(workout);
    });
    updated.workouts.forEach(workout => {
      const old = stage(original, workout.name, workout.sourceWeek);
      expect(workout.id).toBe(old.id);
      expect(workout.sequence).toBe(old.sequence);
      expect(workout.exercises.map(exercise => exercise.id)).toEqual(old.exercises.map(exercise => exercise.id));
    });
    expect(getPlanUpdateSummary(original, updated).removedWorkouts).toBe(removed);
    expect(JSON.stringify(original)).toBe(before);
    expect(updateRoutinePlan(updated, { duration: '3 weeks' })).toBe(updated);
  });

  it('combines weeks four and five into S/P/D/S/P/Strongman at the original progression stages', () => {
    let original = completeWeeks(make(), 3);
    const press = stage(original, 'Press', 4);
    original = updateExercise(original, press.id, press.exercises[0].id, {
      movement: 'Log press', prescription: '3 × 5', weight: '123',
    });
    const updated = updateRoutinePlan(original, { duration: '3 weeks' });

    expect(schedule({ workouts: future(updated) })).toEqual([
      ['Squat', 3, 3], ['Press', 3, 3], ['Deadlift', 3, 3],
      ['Squat', 4, 3], ['Press', 4, 3], ['Strongman', 4, 3],
    ]);
    expect(stage(updated, 'Strongman', 3)).toBeUndefined();
    expect(stage(updated, 'Deadlift', 4)).toBeUndefined();
    expect(stage(updated, 'Deadlift', 3).exercises[0].generated).toMatchObject({ weight: 320, prescription: '4 × 3' });
    expect(stage(updated, 'Squat', 4).exercises[0].generated).toMatchObject({ weight: 255, prescription: '4 × 2' });
    expect(stage(updated, 'Press', 4).exercises[0]).toEqual(stage(original, 'Press', 4).exercises[0]);
    expect(getPlanUpdateSummary(original, updated)).toMatchObject({
      removedWorkouts: 2, removedByName: { Deadlift: 1, Strongman: 1 }, preservedOverrides: 1,
    });

    const corrected = correctMaxes(updated, { maxDead: '500', maxPress: '250' });
    const edited = updateRoutinePlan(corrected, { includeBackoffSets: true });
    [corrected, edited].forEach(plan => {
      expect(schedule(plan)).toEqual(schedule(updated));
      expect(plan.workouts.map(workout => workout.id)).toEqual(updated.workouts.map(workout => workout.id));
      expect(stage(plan, 'Deadlift', 3).exercises[0].generated.weight).toBe(400);
      expect(stage(plan, 'Press', 4).exercises[0].overrides).toEqual({
        movement: 'Log press', prescription: '3 × 5', weight: '123',
      });
      original.workouts.filter(workout => workout.completedAt).forEach(workout => {
        expect(plan.workouts.find(candidate => candidate.id === workout.id)).toBe(workout);
      });
    });
  });

  it('uses six lifting days including both deadlifts when the plan has no Strongman day', () => {
    const original = completeWeeks(make({ includeStrongmanDay: false }), 3);
    const updated = updateRoutinePlan(original, { duration: '3 weeks' });
    expect(schedule({ workouts: future(updated) })).toEqual([
      ['Squat', 3, 3], ['Press', 3, 3], ['Deadlift', 3, 3],
      ['Squat', 4, 3], ['Press', 4, 3], ['Deadlift', 4, 3],
    ]);
    expect(updated.workouts.map(workout => workout.id)).toEqual(original.workouts.map(workout => workout.id));
    expect(stage(updated, 'Deadlift', 4).exercises[0].generated.weight).toBe(340);
  });

  it.each(['session', 'skipped', 'completed', 'strongman log'])('preserves all of an active fourth week with a %s record', activity => {
    const original = completeWeeks(make(), 3);
    const active = stage(original, activity === 'strongman log' ? 'Strongman' : 'Squat', 3);
    if (activity === 'session') active.session = { status: 'paused', exercises: [], importedDetail: 'keep' };
    if (activity === 'skipped') active.skippedAt = completedAt;
    if (activity === 'completed') active.completedAt = completedAt;
    if (activity === 'strongman log') original.strongmanLog = [{ id: 'log', workoutId: active.id, note: 'Keep this effort' }];
    const updated = updateRoutinePlan(original, { duration: '3 weeks' });

    expect(updated.cycleWeekGroups).toEqual({ 0: [[0], [1], [2], [3], [4]] });
    expect(schedule(updated)).toEqual(schedule(original));
    expect(updated.workouts).toEqual(original.workouts);
    expect(updated.workouts.find(workout => workout.id === active.id)).toBe(active);
    expect(updated.strongmanLog).toBe(original.strongmanLog);
    expect(getPlanUpdateSummary(original, updated).removedWorkouts).toBe(0);
  });

  it.each(['session', 'strongman log'])('preserves earlier unfinished holes when week five has an out-of-order %s', activity => {
    const original = completeWeeks(make(), 1);
    const active = stage(original, activity === 'strongman log' ? 'Strongman' : 'Deadlift', 4);
    if (activity === 'session') active.session = { status: 'unknown', futureField: 'keep' };
    else original.strongmanLog = [{ id: 'log', workoutId: active.id, note: 'Out of order effort' }];
    const updated = updateRoutinePlan(original, { duration: '3 weeks' });

    expect(updated.cycleWeekGroups).toEqual({ 0: [[0], [1], [2], [3], [4]] });
    expect(updated.workouts).toEqual(original.workouts);
    expect(schedule(updated)).toEqual(schedule(original));
    expect(getPlanUpdateSummary(original, updated).removedWorkouts).toBe(0);
  });

  it('keeps five-week Strongman plans at four days per week during unrelated updates', () => {
    const original = completeWeeks(make(), 3);
    const updated = updateRoutinePlan(original, { includeBackoffSets: true });
    expect(schedule(updated)).toEqual(schedule(original));
    expect(updated.cycleWeekGroups).toBeUndefined();
    for (let week = 0; week < 5; week += 1) {
      expect(updated.workouts.filter(workout => workout.weekIndex === week).map(workout => workout.name)).toEqual(fourDays);
    }
  });

  it('keeps the final-cycle map and 80-percent deadlift through adaptive recalculation', () => {
    const original = completeWeeks(make({
      mesoMode: true, maxProgressionMode: 'adaptive',
      microCycles: [{ duration: '5 weeks', volume: 'Low' }, { duration: '5 weeks', volume: 'Low' }],
    }), 3, 1);
    const updated = updateRoutinePlan(original, { microCycles: [
      { duration: '5 weeks', volume: 'Low' }, { duration: '3 weeks', volume: 'Low' },
    ] });
    const priorDeadlift = stage(updated, 'Deadlift', 0);
    const recorded = {
      ...updated,
      workouts: updated.workouts.map(workout => workout.id === priorDeadlift.id ? {
        ...workout,
        session: {
          primaryExerciseId: workout.exercises[0].id,
          exercises: [{ exerciseId: workout.exercises[0].id, movement: 'Deadlift', sets: [
            { status: 'completed', actualWeight: 375, actualReps: 10 },
          ] }],
        },
      } : workout),
    };
    const refreshed = refreshAdaptiveProgression(recorded);
    expect(refreshed.changed).toBe(true);
    expect(refreshed.routine.cycleWeekGroups).toEqual({ 1: [[0], [1], [2], [3, 4]] });
    expect(schedule(refreshed.routine)).toEqual(schedule(updated));
    expect(future(refreshed.routine).map(workout => workout.name)).toEqual(sixDays);
    expect(stage(refreshed.routine, 'Deadlift', 3, 1).exercises[0].generated.weight).toBe(400);
    expect(stage(refreshed.routine, 'Deadlift', 3, 1).effectiveMaxes.maxDead).toBe(500);
    expect(stage(refreshed.routine, 'Deadlift', 4, 1)).toBeUndefined();
    recorded.workouts.filter(workout => workout.completedAt).forEach(workout => {
      expect(refreshed.routine.workouts.find(candidate => candidate.id === workout.id)).toBe(workout);
    });
  });

  it('preserves the schedule in JSON backups, imported copies, duplicates and subsequent max edits', () => {
    const updated = updateRoutinePlan(completeWeeks(make(), 3), { duration: '3 weeks' });
    const fromJson = JSON.parse(JSON.stringify(updated));
    const fromBackup = parseBackup(exportBackup([{ id: 'profile', name: 'Athlete' }], [updated])).routines[0];
    const imported = cloneImportedRecord(fromBackup);
    const duplicate = duplicateRoutine(fromBackup, 'other-profile', 'Copied schedule');

    [fromJson, fromBackup, imported, duplicate].forEach(plan => {
      expect(plan.cycleWeekGroups).toEqual(updated.cycleWeekGroups);
      expect(schedule(plan)).toEqual(schedule(updated));
      const corrected = correctMaxes(plan, { maxDead: '500' });
      expect(schedule(corrected)).toEqual(schedule(updated));
      expect(stage(corrected, 'Deadlift', 3).exercises[0].generated.weight).toBe(400);
      expect(stage(corrected, 'Deadlift', 4)).toBeUndefined();
    });
    expect(fromBackup.workouts).toEqual(updated.workouts);
    expect(duplicate.cycleWeekGroups).not.toBe(fromBackup.cycleWeekGroups);
    expect(duplicate.workouts.every(workout => !workout.completedAt && !workout.session)).toBe(true);
  });

  it('starts a template from the native three-week schedule instead of inheriting prior progress', () => {
    const updated = updateRoutinePlan(completeWeeks(make(), 3), { duration: '3 weeks' });
    const template = createRoutineTemplate(updated, 'Fresh three-week template');
    const fresh = createRoutineFromTemplate(template, 'other-profile', 'New routine');
    expect(template.cycleWeekGroups).toBeUndefined();
    expect(fresh.cycleWeekGroups).toBeUndefined();
    expect(schedule(fresh)).toEqual(schedule(make({ duration: '3 weeks' })));
    expect(fresh.workouts.filter(workout => workout.weekIndex === 0).map(workout => workout.name)).toEqual(sixDays);
    expect(fresh.workouts.filter(workout => workout.weekIndex === 1).map(workout => workout.name)).toEqual(sixDays);
    expect(fresh.workouts.filter(workout => workout.weekIndex === 2).map(workout => workout.name)).toEqual(fourDays);
  });
});
