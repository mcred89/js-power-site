import {
  adjustSessionSet, completeSessionSet, finishWorkoutSession, sessionElapsedSeconds,
  skipRemainingSessionExercise, skipSessionSet, startWorkoutSession, substituteSessionExercise,
  undoLatestSessionAction, updateSessionSetTimer,
} from './routines';
import { getSetTimerElapsedMs, getSetTimerTiming } from './setTimer';
import { TABATA_PRESCRIPTION } from './tabata';

const at = seconds => new Date(Date.parse('2026-09-18T12:00:00.000Z') + seconds * 1000).toISOString();
const sessionOf = routine => routine.workouts[0].session;
const makeRoutine = (secondIsTabata = false) => startWorkoutSession({
  id: 'routine', workouts: [{ id: 'workout', sequence: 1, completedAt: null, session: null, exercises: [
    { id: 'squat', generated: { movement: 'Squat', weight: 200, prescription: '2 × 5' }, overrides: {} },
    { id: 'second', generated: secondIsTabata
      ? { movement: 'Sprint', weight: '', prescription: TABATA_PRESCRIPTION }
      : { movement: 'Press', weight: 100, prescription: '1 × 5' }, overrides: {} },
  ] }],
}, 'workout', at(0));
const startTimer = (routine, time = 10) => updateSessionSetTimer(routine, 'workout', {
  intervalMs: 60000, elapsedMs: 0, runningSince: at(time), exerciseId: 'squat',
}, at(time));
const pauseTimer = (routine, time) => {
  const timer = sessionOf(routine).setTimer;
  return updateSessionSetTimer(routine, 'workout', {
    ...timer, elapsedMs: getSetTimerElapsedMs(timer, Date.parse(at(time))), runningSince: null,
  }, at(time));
};
const complete = (routine, exerciseIndex, setIndex, time) => {
  const exercise = sessionOf(routine).exercises[exerciseIndex];
  return completeSessionSet(routine, 'workout', exercise.exerciseId, exercise.sets[setIndex].id, at(time));
};

describe('set timer workout recording', () => {
  it('starts disabled and preserves cadence and later-set edits when recording manually', () => {
    let routine = makeRoutine();
    expect(sessionOf(routine).setTimer).toBeNull();
    routine = startTimer(routine);
    const timer = sessionOf(routine).setTimer;
    const exercise = sessionOf(routine).exercises[0];
    routine = adjustSessionSet(routine, 'workout', 'squat', exercise.sets[0].id, { actualWeight: 205, actualReps: 4 });
    routine = complete(routine, 0, 0, 25);
    expect(sessionOf(routine).setTimer).toEqual(timer);
    expect(sessionOf(routine).exercises[0].sets).toMatchObject([
      { status: 'completed', actualWeight: 205, actualReps: 4, splitSeconds: 25, completedAt: at(25) },
      { status: 'pending', actualWeight: 205, actualReps: 4 },
    ]);
    expect(getSetTimerTiming(timer, Date.parse(at(25)))).toEqual({ phase: 'interval', remainingMs: 55000 });
  });

  it('pauses only the countdown and resumes its remainder while workout time keeps advancing', () => {
    let routine = pauseTimer(startTimer(makeRoutine()), 40);
    expect(sessionOf(routine)).toMatchObject({ elapsedSeconds: 0, runningSince: at(0), setTimer: { elapsedMs: 30000, runningSince: null } });
    expect(sessionElapsedSeconds(sessionOf(routine), at(100))).toBe(100);
    routine = updateSessionSetTimer(routine, 'workout', { ...sessionOf(routine).setTimer, runningSince: at(100) }, at(100));
    routine = complete(routine, 0, 0, 110);
    expect(sessionOf(routine).exercises[0].sets[0].splitSeconds).toBe(110);
    expect(getSetTimerTiming(sessionOf(routine).setTimer, Date.parse(at(110)))).toEqual({ phase: 'interval', remainingMs: 30000 });
  });

  it('permits manual edits and completion while the countdown is paused, recording actual workout time', () => {
    let routine = pauseTimer(startTimer(makeRoutine()), 15);
    const exercise = sessionOf(routine).exercises[0];
    routine = adjustSessionSet(routine, 'workout', 'squat', exercise.sets[0].id, { actualReps: 3 });
    routine = complete(routine, 0, 0, 100);
    expect(sessionOf(routine).exercises[0].sets[0]).toMatchObject({ splitSeconds: 100, actualReps: 3 });
    expect(sessionOf(routine)).toMatchObject({ runningSince: at(0), setTimer: { elapsedMs: 5000, runningSince: null } });
  });

  it.each(['running', 'paused', 'ready'])('stops the %s timer on the last set and undo leaves it off', phase => {
    let routine = startTimer(makeRoutine());
    if (phase === 'paused') routine = pauseTimer(routine, 13);
    routine = complete(complete(routine, 0, 0, 14), 0, 1, phase === 'ready' ? 15 : 40);
    expect(sessionOf(routine)).toMatchObject({ elapsedSeconds: 0, runningSince: at(0), setTimer: null });
    routine = undoLatestSessionAction(routine, 'workout', at(100));
    expect(sessionOf(routine)).toMatchObject({ elapsedSeconds: 0, runningSince: at(0), setTimer: null });
    expect(sessionOf(routine).exercises[0].sets[1].status).toBe('pending');
    routine = substituteSessionExercise(routine, 'workout', 'squat', { movement: 'Front squat', weight: 150, reps: 6, setCount: 1 }, at(120));
    expect(sessionOf(routine).runningSince).toBe(at(0));
    expect(sessionOf(routine).setTimer).toBeNull();
  });

  it.each(['set', 'exercise'])('also stops on skipping the last %s', action => {
    let routine = complete(startTimer(makeRoutine()), 0, 0, 25);
    const exercise = sessionOf(routine).exercises[0];
    routine = action === 'set'
      ? skipSessionSet(routine, 'workout', 'squat', exercise.sets[1].id, at(40))
      : skipRemainingSessionExercise(routine, 'workout', 'squat', at(40));
    expect(sessionOf(routine)).toMatchObject({ elapsedSeconds: 0, runningSince: at(0), setTimer: null });
    routine = undoLatestSessionAction(routine, 'workout', at(50));
    expect(sessionOf(routine).setTimer).toBeNull();
    expect(sessionOf(routine).exercises[0].sets[1].status).toBe('pending');
  });

  it('keeps cadence when skipping an earlier set and stops when skipping all remaining sets', () => {
    let routine = startTimer(makeRoutine());
    const timer = sessionOf(routine).setTimer;
    const exercise = sessionOf(routine).exercises[0];
    routine = skipSessionSet(routine, 'workout', 'squat', exercise.sets[0].id, at(25));
    expect(sessionOf(routine).setTimer).toEqual(timer);
    routine = undoLatestSessionAction(routine, 'workout', at(30));
    expect(sessionOf(routine).setTimer).toEqual(timer);
    routine = skipRemainingSessionExercise(routine, 'workout', 'squat', at(40));
    expect(sessionOf(routine)).toMatchObject({ setTimer: null, runningSince: at(0) });
    expect(sessionOf(routine).exercises[0].sets.map(set => set.status)).toEqual(['skipped', 'skipped']);
  });

  it('stops the timer before Tabata while leaving the workout clock untouched', () => {
    let routine = pauseTimer(startTimer(makeRoutine(true)), 20);
    routine = skipRemainingSessionExercise(routine, 'workout', 'squat', at(100));
    expect(sessionOf(routine)).toMatchObject({ setTimer: null, elapsedSeconds: 0, runningSince: at(0) });
    expect(sessionElapsedSeconds(sessionOf(routine), at(110))).toBe(110);
  });

  it.each(['completed', 'skipped'])('stops a strength timer when undo restores a %s Tabata exercise', action => {
    let routine = complete(makeRoutine(true), 0, 0, 10);
    routine = action === 'completed'
      ? complete(routine, 1, 0, 25)
      : skipRemainingSessionExercise(routine, 'workout', 'second', at(25));
    routine = startTimer(routine, 40);
    routine = undoLatestSessionAction(routine, 'workout', at(80));
    expect(sessionOf(routine)).toMatchObject({ setTimer: null, elapsedSeconds: 0, runningSince: at(0) });
    expect(sessionOf(routine).exercises[1].sets[0]).toMatchObject({
      status: 'pending', completedAt: null, skippedAt: null, splitSeconds: null, tabataTimer: null,
    });
    expect(sessionOf(routine).exercises[0].sets.map(set => set.status)).toEqual(['completed', 'pending']);
    expect(sessionElapsedSeconds(sessionOf(routine), at(90))).toBe(90);
  });

  it('stops a running timer when undo restores a different strength exercise', () => {
    let routine = complete(makeRoutine(), 1, 0, 25);
    routine = startTimer(routine, 40);
    routine = undoLatestSessionAction(routine, 'workout', at(80));
    expect(sessionOf(routine)).toMatchObject({ setTimer: null, elapsedSeconds: 0, runningSince: at(0) });
    expect(sessionOf(routine).exercises[1].sets[0].status).toBe('pending');
  });

  it('preserves timer cadence when undo restores a set of the same exercise', () => {
    let routine = complete(startTimer(makeRoutine()), 0, 0, 25);
    const timer = sessionOf(routine).setTimer;
    routine = undoLatestSessionAction(routine, 'workout', at(80));
    expect(sessionOf(routine).setTimer).toEqual(timer);
    expect(sessionOf(routine).exercises[0].sets[0].status).toBe('pending');
    expect(getSetTimerTiming(sessionOf(routine).setTimer, Date.parse(at(80)))).toEqual({ phase: 'interval', remainingMs: 60000 });
  });

  it('stops rather than transferring to later or earlier unfinished exercises', () => {
    let routine = makeRoutine();
    const second = sessionOf(routine).exercises[1];
    routine.workouts[0].session.exercises.push({ ...second, exerciseId: 'third', sets: second.sets.map(set => ({ ...set, id: 'third-set' })) });
    routine = updateSessionSetTimer(routine, 'workout', {
      intervalMs: 60000, elapsedMs: 0, runningSince: at(10), exerciseId: 'second',
    }, at(10));
    routine = complete(routine, 1, 0, 40);
    expect(sessionOf(routine).setTimer).toBeNull();
    routine = updateSessionSetTimer(routine, 'workout', {
      intervalMs: 30000, elapsedMs: 0, runningSince: at(45), exerciseId: 'third',
    }, at(45));
    routine = complete(routine, 2, 0, 50);
    expect(sessionOf(routine)).toMatchObject({ setTimer: null, runningSince: at(0) });
  });

  it('stops without losing progress or changing workout time, and starts fresh on the next run', () => {
    let routine = pauseTimer(complete(startTimer(makeRoutine()), 0, 0, 25), 40);
    routine = updateSessionSetTimer(routine, 'workout', null, at(100));
    expect(sessionOf(routine)).toMatchObject({ setTimer: null, elapsedSeconds: 0, runningSince: at(0) });
    expect(sessionOf(routine).exercises[0].sets.map(set => set.status)).toEqual(['completed', 'pending']);
    routine = startTimer(routine, 110);
    expect(getSetTimerTiming(sessionOf(routine).setTimer, Date.parse(at(110)))).toEqual({ phase: 'ready', remainingMs: 10000 });
  });

  it('clears the timer when all sets are settled or the workout is finished', () => {
    let routine = complete(complete(startTimer(makeRoutine()), 0, 0, 25), 0, 1, 40);
    routine = complete(routine, 1, 0, 100);
    expect(sessionOf(routine)).toMatchObject({ setTimer: null, elapsedSeconds: 100, runningSince: null });
    expect(sessionOf(updateSessionSetTimer(routine, 'workout', null, at(120))).runningSince).toBeNull();
    expect(sessionOf(finishWorkoutSession(startTimer(makeRoutine()), 'workout', at(40)))).toMatchObject({ status: 'completed', setTimer: null, runningSince: null });
  });

  it('rejects timers with invalid intervals or no eligible pending exercise', () => {
    const routine = makeRoutine(true);
    const timer = { intervalMs: 60000, elapsedMs: 0, runningSince: at(10), exerciseId: 'squat' };
    [ { ...timer, intervalMs: 500 }, { ...timer, exerciseId: 'second' }, { ...timer, exerciseId: 'missing' } ].forEach(invalid => {
      expect(sessionOf(updateSessionSetTimer(routine, 'workout', invalid, at(10)))).toBe(sessionOf(routine));
    });
  });
});
