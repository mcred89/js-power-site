import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ActiveWorkoutSession,
  formatDuration,
  WorkoutSessionHistory,
  WorkoutSummary,
} from './WorkoutSession';

const workout = {
  name: 'Squat',
  weekLabel: 'Week 1',
  session: {
    status: 'inProgress',
    startedAt: '2026-08-18T12:00:00.000Z',
    runningSince: null,
    elapsedSeconds: 75,
    primaryExerciseId: 'e1',
    rpe: null,
    exercises: [{
      exerciseId: 'e1',
      movement: 'Squat',
      prescription: '2 × 5',
      sets: [
        { id: 's1', number: 1, plannedWeight: 200, plannedReps: 5, actualWeight: 200, actualReps: 5, status: 'completed', splitSeconds: 60 },
        { id: 's2', number: 2, plannedWeight: 200, plannedReps: 5, actualWeight: 200, actualReps: 5, status: 'pending', splitSeconds: null },
      ],
    }],
  },
};

it('formats stopwatch durations', () => {
  expect(formatDuration(75)).toBe('1:15');
  expect(formatDuration(3670)).toBe('1:01:10');
});

it('offers large set adjustments, completion, undo, and RPE controls', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onAdjust = jest.fn();
  const onCompleteSet = jest.fn();
  const onRpe = jest.fn();
  const onUndo = jest.fn();

  act(() => root.render(<ActiveWorkoutSession
    workout={workout}
    onAdjust={onAdjust}
    onCompleteSet={onCompleteSet}
    onFinish={() => {}}
    onLeave={() => {}}
    onRpe={onRpe}
    onUndo={onUndo}
  />));

  const button = label => [...div.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label);
  act(() => button('Increase weight (lb)').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  act(() => button('Complete set').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  act(() => button('8').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  act(() => button('Undo latest action').dispatchEvent(new MouseEvent('click', { bubbles: true })));

  expect(onAdjust).toHaveBeenCalledWith('e1', 's2', { actualWeight: '205' });
  expect(onCompleteSet).toHaveBeenCalledWith('e1', 's2');
  expect(onRpe).toHaveBeenCalledWith(8);
  expect(onUndo).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

it('resumes on the first exercise that still has pending sets', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const resumedWorkout = {
    ...workout,
    session: {
      ...workout.session,
      exercises: [
        {
          ...workout.session.exercises[0],
          movement: 'Press',
          sets: workout.session.exercises[0].sets.map(set => ({
            ...set,
            status: 'completed',
          })),
        },
        {
          exerciseId: 'e2',
          movement: 'Accessory Movement',
          prescription: '1 × 10',
          sets: [{ id: 's3', number: 1, status: 'completed' }],
        },
        {
          exerciseId: 'e3',
          movement: 'Curls',
          prescription: '3 × 10',
          sets: [{ id: 's4', number: 1, status: 'pending', actualWeight: '20', actualReps: '10' }],
        },
      ],
    },
  };

  act(() => root.render(<ActiveWorkoutSession
    workout={resumedWorkout}
    onAdjust={() => {}}
    onCompleteSet={() => {}}
    onFinish={() => {}}
    onLeave={() => {}}
    onRpe={() => {}}
    onUndo={() => {}}
  />));

  expect(div.querySelector('.exercise-pager h1').textContent).toBe('Curls');
  expect(div.textContent).toContain('Exercise 3 of 3');
  expect(div.querySelector('[aria-label="Previous exercise"]').disabled).toBe(false);
  act(() => root.unmount());
});

it('shows performed values, planned adjustments, and timing in history', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const completed = {
    ...workout,
    session: {
      ...workout.session,
      status: 'completed',
      rpe: 8,
      exercises: [{
        ...workout.session.exercises[0],
        sets: [{
          ...workout.session.exercises[0].sets[0],
          actualWeight: 205,
          actualReps: 4,
        }],
      }],
    },
  };

  act(() => root.render(<WorkoutSessionHistory workout={completed} />));

  expect(div.textContent).toContain('205 lb × 4 reps');
  expect(div.textContent).toContain('Plan: 200 lb × 5');
  expect(div.textContent).toContain('Split 1:00 · Interval 1:00');
  expect(div.textContent).toContain('Main-lift RPE8');
  act(() => root.unmount());
});

it('summarizes completed volume, skipped sets, RPE, and substitutions', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onDone = jest.fn();
  const completed = {
    ...workout,
    session: {
      ...workout.session,
      elapsedSeconds: 125,
      rpe: 8,
      exercises: [{
        ...workout.session.exercises[0],
        movement: 'Hack squat',
        original: { movement: 'Squat' },
        sets: [
          { ...workout.session.exercises[0].sets[0], actualWeight: 200, actualReps: 5 },
          { ...workout.session.exercises[0].sets[1], status: 'skipped' },
        ],
      }],
    },
  };
  act(() => root.render(<WorkoutSummary workout={completed} onDone={onDone} />));

  expect(div.textContent).toContain('2:05');
  expect(div.textContent).toContain('1,000 lb');
  expect(div.textContent).toContain('Squat → Hack squat');
  act(() => [...div.querySelectorAll('button')].find(button => button.textContent === 'Done').click());
  expect(onDone).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});
