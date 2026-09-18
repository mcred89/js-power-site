import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActiveWorkoutSession } from './WorkoutSession';
import {
  adjustSessionSet, completeSessionSet, skipRemainingSessionExercise, skipSessionSet, startWorkoutSession,
  undoLatestSessionAction, updateSessionSetTimer,
} from '../data/routines';
import { createSetTimerAudio } from '../data/setTimerAudio';
import { TABATA_PRESCRIPTION } from '../data/tabata';

jest.mock('../data/setTimerAudio', () => ({ createSetTimerAudio: jest.fn() }));

const startedAt = '2026-09-18T12:00:00.000Z';
const strength = (id, movement, sets = 1) => ({
  id, generated: { movement, weight: 200, prescription: `${sets} × 5` }, overrides: {},
});
const makeRoutine = (exercises = [
  strength('squat', 'Squat'),
  { id: 'tabata', generated: { movement: 'Tabata sprints', weight: '', prescription: TABATA_PRESCRIPTION }, overrides: {} },
]) => startWorkoutSession({
  id: 'routine',
  workouts: [{
    id: 'workout', name: 'Squat', weekLabel: 'Week 1', sequence: 1,
    completedAt: null, session: null,
    exercises,
  }],
}, 'workout', startedAt);

let root;
let container;
let sound;
const button = label => [...document.querySelectorAll('button')]
  .find(item => item.textContent === label || item.getAttribute('aria-label') === label);
const click = async label => { await act(async () => button(label).click()); };
const setTimerDialog = () => document.querySelector('[aria-label="Set timer"]');
const countdown = () => document.querySelector('[role="timer"]')?.textContent;
const advance = async milliseconds => { await act(async () => jest.advanceTimersByTime(milliseconds)); };
const edit = async (label, value) => {
  const input = document.querySelector(`[aria-label="${label}"]`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const renderSession = async (exercises, persistTimer = () => Promise.resolve()) => {
  const mounted = {};
  mounted.onSetTimer = jest.fn(timer => {
    mounted.update(routine => updateSessionSetTimer(routine, 'workout', timer));
    if (timer) mounted.rememberInterval(timer.intervalMs);
    return persistTimer(timer);
  });
  const Harness = () => {
    const [routine, setRoutine] = useState(() => makeRoutine(exercises));
    const [intervalMs, setIntervalMs] = useState(60000);
    mounted.routine = routine;
    mounted.update = setRoutine;
    mounted.rememberInterval = setIntervalMs;
    return <ActiveWorkoutSession
      workout={routine.workouts[0]}
      initialSetTimerIntervalMs={intervalMs}
      onSetTimer={mounted.onSetTimer}
      onAdjust={(exerciseId, setId, values) => setRoutine(current => (
        adjustSessionSet(current, 'workout', exerciseId, setId, values)
      ))}
      onCompleteSet={(exerciseId, setId, values) => setRoutine(current => completeSessionSet(
        values ? adjustSessionSet(current, 'workout', exerciseId, setId, values) : current,
        'workout', exerciseId, setId,
      ))}
      onUndo={() => setRoutine(current => undoLatestSessionAction(current, 'workout'))}
      onFinish={() => {}}
      onLeave={() => {}}
      onRpe={() => {}}
      onSkipExercise={(exerciseId, setId, values) => setRoutine(current => skipRemainingSessionExercise(
        values ? adjustSessionSet(current, 'workout', exerciseId, setId, values) : current,
        'workout', exerciseId,
      ))}
      onSkipSet={(exerciseId, setId, values) => setRoutine(current => skipSessionSet(
        values ? adjustSessionSet(current, 'workout', exerciseId, setId, values) : current,
        'workout', exerciseId, setId,
      ))}
      onSubstitute={() => {}}
    />;
  };
  await act(async () => root.render(<Harness />));
  return mounted;
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date(startedAt));
  sound = { unlock: jest.fn().mockResolvedValue(), schedule: jest.fn(), stop: jest.fn(), close: jest.fn() };
  createSetTimerAudio.mockReturnValue(sound);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.useRealTimers();
  jest.clearAllMocks();
});

it('ends the timer with the last set and starts the next exercise only after a fresh choice and ready countdown', async () => {
  const mounted = await renderSession([strength('squat', 'Squat', 2), strength('row', 'Row', 2)]);
  await click('Start set timer');
  await click('2 min');
  await click('Start timer');
  await advance(35000);
  expect(countdown()).toBe('1:35');

  await edit('Weight (lb)', '225');
  await edit('Reps', '4');
  await click('Complete set');
  expect(countdown()).toBe('1:35');
  expect(sound.schedule).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[aria-label="Weight (lb)"]').value).toBe('225');
  await advance(5000);
  await edit('Weight (lb)', '230');
  await click('Complete set');

  expect(setTimerDialog()).toBeNull();
  expect(container.querySelector('.exercise-pager h1').textContent).toBe('Row');
  expect(button('Start set timer')).toBeDefined();
  expect(sound.stop).toHaveBeenCalled();
  const session = mounted.routine.workouts[0].session;
  expect(session.setTimer).toBeNull();
  expect(session.exercises[0].sets).toEqual([
    expect.objectContaining({ status: 'completed', actualWeight: '225', actualReps: '4' }),
    expect.objectContaining({ status: 'completed', actualWeight: '230', actualReps: '4' }),
  ]);
  expect(session.exercises[1].sets.every(set => set.status === 'pending')).toBe(true);
  expect(session.runningSince).toBe(startedAt);
  await advance(20000);
  expect(container.querySelector('.session-clock strong').textContent).toBe('1:00');
  expect(sound.schedule).toHaveBeenCalledTimes(1);
  expect(mounted.onSetTimer.mock.calls.filter(([timer]) => timer)).toHaveLength(1);

  await click('Start set timer');
  expect(document.querySelector('#set-timer-minutes').value).toBe('2');
  expect(button('Resume timer')).toBeUndefined();
  await click('1 min');
  await click('Start timer');
  expect(countdown()).toBe('0:10');
  expect(mounted.routine.workouts[0].session.setTimer).toMatchObject({ exerciseId: 'row', intervalMs: 60000, elapsedMs: 0 });
  await advance(10000);
  expect(countdown()).toBe('1:00');
});

it.each(['ready', 'paused'])('completing the last set during %s closes the timer without reviving it on Undo', async phase => {
  const mounted = await renderSession([strength('squat', 'Squat'), strength('row', 'Row')]);
  await click('Start set timer');
  await click('Start timer');
  await advance(phase === 'paused' ? 17000 : 3000);
  if (phase === 'paused') await click('Pause timer');
  const savedTimerCount = mounted.onSetTimer.mock.calls.length;
  await click('Complete set');
  expect(setTimerDialog()).toBeNull();
  expect(container.querySelector('.exercise-pager h1').textContent).toBe('Row');
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
  expect(mounted.onSetTimer).toHaveBeenCalledTimes(savedTimerCount);
  await advance(1000);
  await click('Undo latest action');
  expect(mounted.routine.workouts[0].session.exercises[0].sets[0].status).toBe('pending');
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
  expect(setTimerDialog()).toBeNull();
  expect(button('Start set timer')).toBeDefined();
});

it.each(['Skip this set', 'Skip exercise', 'Next exercise'])('%s ends the current timer and returns to normal exercise controls', async action => {
  const mounted = await renderSession([strength('squat', 'Squat'), strength('row', 'Row')]);
  await click('Start set timer');
  await click('Start timer');
  await advance(16000);
  await edit('Weight (lb)', '240');
  await click(action);
  expect(setTimerDialog()).toBeNull();
  expect(container.querySelector('.exercise-pager h1').textContent).toBe('Row');
  expect(button('Start set timer')).toBeDefined();
  const session = mounted.routine.workouts[0].session;
  expect(session.setTimer).toBeNull();
  expect(session.runningSince).toBe(startedAt);
  expect(session.exercises[0].sets[0]).toMatchObject({
    status: action === 'Next exercise' ? 'pending' : 'skipped', actualWeight: '240',
  });
  expect(sound.stop).toHaveBeenCalled();
  await click('Previous exercise');
  expect(setTimerDialog()).toBeNull();
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
});

it.each([
  ['next strength exercise', [strength('squat', 'Squat'), strength('row', 'Row')]],
  ['workout completion without another exercise', [strength('squat', 'Squat')]],
])('cancels delayed audio startup at %s', async (description, exercises) => {
  let unlock;
  sound.unlock.mockReturnValue(new Promise(resolve => { unlock = resolve; }));
  const mounted = await renderSession(exercises);
  await click('Start set timer');
  await click('Start timer');
  expect(button('Starting…')).toBeDefined();
  await click('Complete set');
  expect(setTimerDialog()).toBeNull();
  expect(container.querySelector('.session-topbar')).not.toBeNull();
  await act(async () => unlock());
  expect(sound.schedule).not.toHaveBeenCalled();
  expect(mounted.onSetTimer.mock.calls.every(([timer]) => timer === null)).toBe(true);
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
  expect(setTimerDialog()).toBeNull();
});

it('cancels delayed startup when Undo restores a different strength exercise', async () => {
  let unlock;
  sound.unlock.mockReturnValue(new Promise(resolve => { unlock = resolve; }));
  const mounted = await renderSession([strength('squat', 'Squat'), strength('row', 'Row')]);
  await click('Next exercise');
  await click('Complete set');
  expect(container.querySelector('.exercise-pager h1').textContent).toBe('Squat');
  await click('Start set timer');
  await click('Start timer');
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
  expect(button('Starting…')).toBeDefined();

  await click('Undo latest action');
  expect(setTimerDialog()).toBeNull();
  expect(mounted.routine.workouts[0].session.exercises[1].sets[0].status).toBe('pending');
  await act(async () => unlock());
  expect(sound.schedule).not.toHaveBeenCalled();
  expect(mounted.onSetTimer.mock.calls.every(([timer]) => timer === null)).toBe(true);
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
  expect(button('Start set timer')).toBeDefined();
});

it('keeps delayed startup when Undo restores an earlier set of the same exercise', async () => {
  let unlock;
  sound.unlock.mockReturnValue(new Promise(resolve => { unlock = resolve; }));
  const mounted = await renderSession([strength('squat', 'Squat', 2), strength('row', 'Row')]);
  await click('Complete set');
  await click('Start set timer');
  await click('Start timer');
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
  await click('Undo latest action');
  expect(setTimerDialog()).not.toBeNull();
  expect(button('Starting…')).toBeDefined();
  expect(mounted.routine.workouts[0].session.exercises[0].sets[0].status).toBe('pending');

  await act(async () => unlock());
  expect(sound.schedule).toHaveBeenCalledTimes(1);
  expect(mounted.routine.workouts[0].session.setTimer).toMatchObject({ exerciseId: 'squat', elapsedMs: 0 });
  expect(countdown()).toBe('0:10');
  await advance(14000);
  expect(countdown()).toBe('0:56');
  await click('Complete set');
  await click('Undo latest action');
  expect(countdown()).toBe('0:56');
  expect(sound.schedule).toHaveBeenCalledTimes(1);
});

it('does not revive the timer when a delayed Stop failure arrives after Undo closes its view', async () => {
  let rejectStop;
  const stopWrite = new Promise((resolve, reject) => { rejectStop = reject; });
  const mounted = await renderSession(
    [strength('squat', 'Squat'), strength('row', 'Row')],
    timer => timer ? Promise.resolve() : stopWrite,
  );
  await click('Next exercise');
  await click('Complete set');
  await click('Start set timer');
  await click('Start timer');
  await advance(17000);
  expect(sound.schedule).toHaveBeenCalledTimes(1);
  expect(mounted.routine.workouts[0].session.setTimer.runningSince).toBeTruthy();

  await click('Stop timer');
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
  expect(setTimerDialog()).not.toBeNull();
  expect(button('Stop timer').disabled).toBe(true);
  await click('Undo latest action');
  expect(setTimerDialog()).toBeNull();
  expect(mounted.routine.workouts[0].session.exercises[1].sets[0].status).toBe('pending');
  const writesAtClose = mounted.onSetTimer.mock.calls.length;

  await act(async () => rejectStop(new Error('Storage unavailable')));
  expect(mounted.onSetTimer).toHaveBeenCalledTimes(writesAtClose);
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
  expect(setTimerDialog()).toBeNull();
  expect(button('Start set timer')).toBeDefined();
  expect(sound.schedule).toHaveBeenCalledTimes(1);
});

it('cancels a delayed first start when completing strength work moves to Tabata', async () => {
  let unlock;
  sound.unlock.mockReturnValue(new Promise(resolve => { unlock = resolve; }));
  const mounted = await renderSession();
  await click('Start set timer');
  await click('Start timer');
  expect(setTimerDialog()).not.toBeNull();
  expect(button('Complete set')).toBeDefined();

  await click('Complete set');
  expect(setTimerDialog()).toBeNull();
  expect(container.querySelector('.exercise-pager h1').textContent).toBe('Tabata sprints');
  expect(button('Complete without timer')).toBeDefined();
  expect(button('Start timer')).toBeDefined();
  expect(mounted.routine.workouts[0].session.exercises[0].sets[0].status).toBe('completed');

  await act(async () => unlock());
  expect(sound.schedule).not.toHaveBeenCalled();
  expect(mounted.onSetTimer.mock.calls.every(([timer]) => timer === null)).toBe(true);
  expect(mounted.routine.workouts[0].session.setTimer).toBeNull();
  expect(mounted.routine.workouts[0].session.runningSince).toBe(startedAt);
  expect(setTimerDialog()).toBeNull();
  expect(button('Complete without timer')).toBeDefined();
});

it('closes the strength timer after undo restores Tabata and leaves its own controls available', async () => {
  const mounted = await renderSession();
  await click('Next exercise');
  await click('Complete without timer');
  await click('Previous exercise');
  await click('Start set timer');
  await click('Start timer');
  expect(sound.schedule).toHaveBeenCalledTimes(1);
  expect(setTimerDialog()).not.toBeNull();

  await click('Undo latest action');
  expect(setTimerDialog()).toBeNull();
  const session = mounted.routine.workouts[0].session;
  expect(session.setTimer).toBeNull();
  expect(session.exercises[0].sets[0].status).toBe('pending');
  expect(session.exercises[1].sets[0].status).toBe('pending');
  expect(session.runningSince).toBe(startedAt);
  expect(sound.stop).toHaveBeenCalled();
  await click('Next exercise');
  expect(container.querySelector('.exercise-pager h1').textContent).toBe('Tabata sprints');
  expect(button('Complete without timer')).toBeDefined();
  expect(button('Start timer')).toBeDefined();
  expect(setTimerDialog()).toBeNull();
});
