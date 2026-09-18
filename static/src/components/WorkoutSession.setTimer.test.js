import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ActiveWorkoutSession } from './WorkoutSession';
import {
  adjustSessionSet, completeSessionSet, startWorkoutSession,
  undoLatestSessionAction, updateSessionSetTimer,
} from '../data/routines';
import { createSetTimerAudio } from '../data/setTimerAudio';
import { TABATA_PRESCRIPTION } from '../data/tabata';

jest.mock('../data/setTimerAudio', () => ({ createSetTimerAudio: jest.fn() }));

const startedAt = '2026-09-18T12:00:00.000Z';
const makeRoutine = () => startWorkoutSession({
  id: 'routine',
  workouts: [{
    id: 'workout', name: 'Squat', weekLabel: 'Week 1', sequence: 1,
    completedAt: null, session: null,
    exercises: [
      { id: 'squat', generated: { movement: 'Squat', weight: 200, prescription: '1 × 5' }, overrides: {} },
      { id: 'tabata', generated: { movement: 'Tabata sprints', weight: '', prescription: TABATA_PRESCRIPTION }, overrides: {} },
    ],
  }],
}, 'workout', startedAt);

let root;
let container;
let sound;
const button = label => [...document.querySelectorAll('button')]
  .find(item => item.textContent === label || item.getAttribute('aria-label') === label);
const click = async label => { await act(async () => button(label).click()); };
const setTimerDialog = () => document.querySelector('[aria-label="Set timer"]');

const renderSession = async () => {
  const mounted = {};
  mounted.onSetTimer = jest.fn(timer => {
    mounted.update(routine => updateSessionSetTimer(routine, 'workout', timer));
    return Promise.resolve();
  });
  const Harness = () => {
    const [routine, setRoutine] = useState(makeRoutine);
    mounted.routine = routine;
    mounted.update = setRoutine;
    return <ActiveWorkoutSession
      workout={routine.workouts[0]}
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
      onSkipExercise={() => {}}
      onSkipSet={() => {}}
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
