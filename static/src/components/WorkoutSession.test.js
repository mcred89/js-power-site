import React, { act, StrictMode } from 'react';
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

const renderSession = (overrides = {}, value = workout) => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const props = {
    onAdjust: jest.fn(),
    onCompleteSet: jest.fn(),
    onFinish: jest.fn(),
    onLeave: jest.fn(),
    onRpe: jest.fn(),
    onSkipExercise: jest.fn(),
    onSkipSet: jest.fn(),
    onSubstitute: jest.fn(),
    onUndo: jest.fn(),
    ...overrides,
  };
  act(() => root.render(<ActiveWorkoutSession workout={value} {...props} />));
  const button = label => [...div.querySelectorAll('button')]
    .find(item => item.getAttribute('aria-label') === label || item.textContent === label);
  const edit = (label, valueToSet) => {
    const input = div.querySelector(`[aria-label="${label}"]`);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, valueToSet);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input;
  };
  return { button, div, edit, props, root };
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

  expect(onAdjust).not.toHaveBeenCalled();
  expect(onCompleteSet).toHaveBeenCalledWith('e1', 's2', { actualWeight: '205' });
  expect(onRpe).toHaveBeenCalledWith(8);
  expect(onUndo).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});

it('coalesces input bursts into one adjustment after 250 ms', () => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onAdjust = jest.fn();
  act(() => root.render(<ActiveWorkoutSession
    workout={workout}
    onAdjust={onAdjust}
    onCompleteSet={() => {}}
    onFinish={() => {}}
    onLeave={() => {}}
    onRpe={() => {}}
    onUndo={() => {}}
  />));
  const input = div.querySelector('[aria-label="Weight (lb)"]');
  for (let index = 0; index < 10; index += 1) {
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, `20${index}`);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  act(() => jest.advanceTimersByTime(249));
  expect(onAdjust).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(onAdjust).toHaveBeenCalledTimes(1);
  expect(onAdjust).toHaveBeenCalledWith('e1', 's2', { actualWeight: '209' });
  act(() => root.unmount());
  jest.useRealTimers();
});

it.each([
  ['blur', input => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))],
  ['page hide', () => window.dispatchEvent(new Event('pagehide'))],
])('flushes a pending draft on %s', (label, boundary) => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onAdjust = jest.fn();
  act(() => root.render(<ActiveWorkoutSession
    workout={workout}
    onAdjust={onAdjust}
    onCompleteSet={() => {}}
    onFinish={() => {}}
    onLeave={() => {}}
    onRpe={() => {}}
    onUndo={() => {}}
  />));
  const input = div.querySelector('[aria-label="Reps"]');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '12');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => boundary(input));
  expect(onAdjust).toHaveBeenCalledWith('e1', 's2', { actualReps: '12' });
  act(() => root.unmount());
  jest.useRealTimers();
});

it('flushes the latest values when the session unmounts', () => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onAdjust = jest.fn();
  act(() => root.render(<ActiveWorkoutSession
    workout={workout}
    onAdjust={onAdjust}
    onCompleteSet={() => {}}
    onFinish={() => {}}
    onLeave={() => {}}
    onRpe={() => {}}
    onUndo={() => {}}
  />));
  const input = div.querySelector('[aria-label="Weight (lb)"]');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '225');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => root.unmount());
  expect(onAdjust).toHaveBeenCalledWith('e1', 's2', { actualWeight: '225' });
  act(() => jest.runOnlyPendingTimers());
  expect(onAdjust).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('flushes a combined weight and reps draft in one completion action', () => {
  jest.useFakeTimers();
  const mounted = renderSession();
  mounted.edit('Weight (lb)', '237.5');
  mounted.edit('Reps', '7');
  act(() => mounted.button('Complete set').click());

  expect(mounted.props.onAdjust).not.toHaveBeenCalled();
  expect(mounted.props.onCompleteSet).toHaveBeenCalledTimes(1);
  expect(mounted.props.onCompleteSet).toHaveBeenCalledWith('e1', 's2', {
    actualWeight: '237.5',
    actualReps: '7',
  });
  act(() => mounted.root.unmount());
  jest.useRealTimers();
});

it.each([
  ['leave', '← Leave', 'onLeave'],
  ['RPE', '8', 'onRpe'],
  ['undo', 'Undo latest action', 'onUndo'],
  ['substitute', 'Substitute', null],
  ['finish confirmation', 'Finish workout', 'onFinish'],
])('flushes a restoration-equivalent payload before %s', (label, buttonLabel, callback) => {
  jest.useFakeTimers();
  const mounted = renderSession();
  mounted.edit('Weight (lb)', '231');
  mounted.edit('Reps', '9');
  act(() => mounted.button(buttonLabel).click());

  expect(mounted.props.onAdjust).toHaveBeenCalledTimes(1);
  expect(mounted.props.onAdjust).toHaveBeenCalledWith('e1', 's2', {
    actualWeight: '231',
    actualReps: '9',
  });
  if (callback) expect(mounted.props[callback]).toHaveBeenCalledTimes(1);
  act(() => mounted.root.unmount());
  expect(mounted.props.onAdjust).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it.each([
  ['skip set', 'Skip this set', 'onSkipSet'],
  ['skip exercise', 'Skip exercise', 'onSkipExercise'],
])('folds the final draft into the single durable %s action', (label, buttonLabel, callback) => {
  jest.useFakeTimers();
  const mounted = renderSession();
  mounted.edit('Weight (lb)', '245');
  mounted.edit('Reps', '4');
  act(() => mounted.button(buttonLabel).click());

  expect(mounted.props.onAdjust).not.toHaveBeenCalled();
  expect(mounted.props[callback]).toHaveBeenCalledTimes(1);
  expect(mounted.props[callback]).toHaveBeenCalledWith('e1', 's2', {
    actualWeight: '245',
    actualReps: '4',
  });
  act(() => mounted.root.unmount());
  jest.useRealTimers();
});

it.each([
  ['complete', 'Complete set', 'onCompleteSet'],
  ['skip set', 'Skip this set', 'onSkipSet'],
  ['skip exercise', 'Skip exercise', 'onSkipExercise'],
])('does not preflush when pointer blur precedes the %s click', (label, buttonLabel, callback) => {
  jest.useFakeTimers();
  const mounted = renderSession();
  const input = mounted.edit('Weight (lb)', '255');
  mounted.edit('Reps', '6');
  const action = mounted.button(buttonLabel);
  act(() => {
    input.focus();
    action.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    action.click();
  });

  expect(mounted.props.onAdjust).not.toHaveBeenCalled();
  expect(mounted.props[callback]).toHaveBeenCalledTimes(1);
  expect(mounted.props[callback]).toHaveBeenCalledWith('e1', 's2', {
    actualWeight: '255',
    actualReps: '6',
  });
  act(() => jest.runOnlyPendingTimers());
  expect(mounted.props.onAdjust).not.toHaveBeenCalled();
  act(() => mounted.root.unmount());
  jest.useRealTimers();
});

it('keeps a pointer-triggered stepper change in the same input burst', () => {
  jest.useFakeTimers();
  const mounted = renderSession();
  const input = mounted.edit('Weight (lb)', '210');
  const increase = mounted.button('Increase weight (lb)');
  act(() => {
    input.focus();
    increase.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    increase.click();
  });

  expect(mounted.props.onAdjust).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(249));
  expect(mounted.props.onAdjust).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  expect(mounted.props.onAdjust).toHaveBeenCalledTimes(1);
  expect(mounted.props.onAdjust).toHaveBeenCalledWith('e1', 's2', { actualWeight: '215' });
  act(() => mounted.root.unmount());
  jest.useRealTimers();
});

it('flushes immediately when pointer blur targets a non-action area inside the session', () => {
  jest.useFakeTimers();
  const mounted = renderSession();
  const input = mounted.edit('Weight (lb)', '222');
  const heading = mounted.div.querySelector('h1');
  act(() => {
    input.focus();
    heading.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    heading.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  expect(mounted.props.onAdjust).toHaveBeenCalledTimes(1);
  expect(mounted.props.onAdjust).toHaveBeenCalledWith('e1', 's2', { actualWeight: '222' });
  act(() => mounted.root.unmount());
  jest.useRealTimers();
});

it('flushes when pointer blur targets stepper label text rather than its controls', () => {
  jest.useFakeTimers();
  const mounted = renderSession();
  const input = mounted.edit('Reps', '13');
  const stepperLabel = mounted.div.querySelector('.session-stepper span');
  act(() => {
    input.focus();
    stepperLabel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
  });

  expect(mounted.props.onAdjust).toHaveBeenCalledTimes(1);
  expect(mounted.props.onAdjust).toHaveBeenCalledWith('e1', 's2', { actualReps: '13' });
  act(() => mounted.root.unmount());
  jest.useRealTimers();
});

it('keeps keyboard focus transitions inside the session accessible without preflushing', () => {
  jest.useFakeTimers();
  const mounted = renderSession();
  const input = mounted.edit('Reps', '10');
  const complete = mounted.button('Complete set');
  act(() => input.dispatchEvent(new FocusEvent('focusout', {
    bubbles: true,
    relatedTarget: complete,
  })));
  expect(mounted.props.onAdjust).not.toHaveBeenCalled();
  act(() => complete.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
  act(() => complete.click());
  expect(mounted.props.onCompleteSet).toHaveBeenCalledWith('e1', 's2', { actualReps: '10' });
  act(() => mounted.root.unmount());
  jest.useRealTimers();
});

it('flushes when the document becomes hidden', () => {
  jest.useFakeTimers();
  const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  const mounted = renderSession();
  mounted.edit('Reps', '11');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(mounted.props.onAdjust).toHaveBeenCalledWith('e1', 's2', { actualReps: '11' });
  act(() => mounted.root.unmount());
  if (original) Object.defineProperty(document, 'visibilityState', original);
  jest.useRealTimers();
});

it('flushes before next and previous exercise navigation', () => {
  jest.useFakeTimers();
  const twoExercises = {
    ...workout,
    session: {
      ...workout.session,
      exercises: [
        { ...workout.session.exercises[0], sets: workout.session.exercises[0].sets.map(set => ({ ...set, status: 'pending' })) },
        { exerciseId: 'e2', movement: 'Row', sets: [{ id: 's3', number: 1, actualWeight: 100, actualReps: 8, status: 'pending' }] },
      ],
    },
  };
  const mounted = renderSession({}, twoExercises);
  mounted.edit('Weight (lb)', '210');
  act(() => mounted.button('Next exercise').click());
  mounted.edit('Reps', '10');
  act(() => mounted.button('Previous exercise').click());
  expect(mounted.props.onAdjust.mock.calls).toEqual([
    ['e1', 's1', { actualWeight: '210' }],
    ['e2', 's3', { actualReps: '10' }],
  ]);
  act(() => mounted.root.unmount());
  jest.useRealTimers();
});

it('drains once without a state update during StrictMode unmount', () => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const onAdjust = jest.fn();
  act(() => root.render(<StrictMode><ActiveWorkoutSession workout={workout} onAdjust={onAdjust} onCompleteSet={() => {}} onFinish={() => {}} onLeave={() => {}} onRpe={() => {}} onSkipExercise={() => {}} onSkipSet={() => {}} onSubstitute={() => {}} onUndo={() => {}} /></StrictMode>));
  const input = div.querySelector('[aria-label="Weight (lb)"]');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '260');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => root.unmount());
  act(() => jest.runOnlyPendingTimers());
  expect(onAdjust).toHaveBeenCalledTimes(1);
  expect(onAdjust).toHaveBeenCalledWith('e1', 's2', { actualWeight: '260' });
  jest.useRealTimers();
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
