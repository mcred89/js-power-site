import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ActiveWorkoutSession,
  formatDuration,
} from './WorkoutSession';
import { WorkoutSessionHistory, WorkoutSummary } from './WorkoutSessionHistory';
import { TABATA_PRESCRIPTION } from '../data/tabata';

jest.mock('./TabataTimer', () => {
  const React = require('react');
  return function Timer({ roundCount, onTimerChange, onComplete, completed }) {
    return <div data-testid="tabata-timer">
      <span>{roundCount} sprints as one set</span>
      {completed ? <span>Tabata complete</span> : <>
        <button onClick={() => onTimerChange({ elapsedMs: 0, runningSince: '2026-09-07T12:00:00.000Z' })}>Start timer</button>
        <button onClick={() => onComplete({ elapsedMs: 290000, runningSince: null })}>Simulate timer completion</button>
        <button onClick={() => onComplete(null)}>Complete without timer</button>
      </>}
    </div>;
  };
});

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

const workoutWithTabata = (overrides = {}) => ({
  ...workout,
  session: {
    ...workout.session,
    exercises: [
      {
        ...workout.session.exercises[0],
        sets: workout.session.exercises[0].sets.map(set => ({ ...set, status: 'completed', splitSeconds: 60 })),
      },
      {
        exerciseId: 'tabata',
        movement: 'Tabata sprints',
        prescription: TABATA_PRESCRIPTION,
        plannedWeight: '',
        sets: Array.from({ length: 8 }, (_, index) => ({
          id: `round-${index + 1}`,
          number: index + 1,
          plannedWeight: '',
          plannedReps: '',
          actualWeight: '',
          actualReps: '',
          status: 'pending',
          splitSeconds: null,
        })),
        ...overrides,
      },
    ],
  },
});

it('runs Tabata with one timer and completes the whole set without sprint checkoffs', async () => {
  const single = workoutWithTabata();
  single.session.exercises[1].sets = [{ ...single.session.exercises[1].sets[0], tabataTimer: null }];
  const mounted = renderSession({}, single);
  await act(async () => {});
  expect(mounted.div.textContent).toContain('8 sprints as one set');
  expect(mounted.div.querySelector('[aria-label="Weight (lb)"]')).toBeNull();
  expect(mounted.div.querySelector('[aria-label="Reps"]')).toBeNull();
  expect(mounted.div.querySelector('.set-tally')).toBeNull();
  expect(mounted.div.querySelector('.session-progress').textContent).toBe('2/3 sets');
  expect(mounted.button('Complete round')).toBeUndefined();
  expect(mounted.button('Skip this round')).toBeUndefined();

  act(() => mounted.button('Start timer').click());
  expect(mounted.props.onAdjust).toHaveBeenCalledWith('tabata', 'round-1', {
    tabataTimer: { elapsedMs: 0, runningSince: '2026-09-07T12:00:00.000Z' },
  });
  act(() => mounted.button('Simulate timer completion').click());
  expect(mounted.props.onCompleteSet).toHaveBeenCalledWith('tabata', 'round-1', {
    tabataTimer: { elapsedMs: 290000, runningSince: null },
  });
  act(() => mounted.root.unmount());
});

it('completes Tabata without starting or saving a timer', async () => {
  const single = workoutWithTabata();
  single.session.exercises[1].sets = [{ ...single.session.exercises[1].sets[0], tabataTimer: null }];
  const mounted = renderSession({}, single);
  await act(async () => {});
  act(() => mounted.button('Complete without timer').click());
  expect(mounted.props.onAdjust).not.toHaveBeenCalled();
  expect(mounted.props.onCompleteSet).toHaveBeenCalledTimes(1);
  expect(mounted.props.onCompleteSet).toHaveBeenCalledWith('tabata', 'round-1', { tabataTimer: null });
  act(() => mounted.root.unmount());
});

it.each([
  { prescription: '3 × 10' },
  { plannedWeight: '20' },
  { movement: 'Jump rope', prescription: '3 × 50', original: { movement: 'Tabata sprints' } },
])('retains set controls for customized or substituted sprint work: %j', overrides => {
  const mounted = renderSession({}, workoutWithTabata(overrides));
  expect(mounted.div.textContent).toContain('Set 1 of 8');
  expect(mounted.div.querySelector('[aria-label="Weight (lb)"]')).not.toBeNull();
  expect(mounted.div.querySelector('[aria-label="Reps"]')).not.toBeNull();
  expect(mounted.button('Complete set')).toBeDefined();
  expect(mounted.button('Skip this set')).toBeDefined();
  act(() => mounted.root.unmount());
});

it('retains timing controls when a sprint exercise is renamed', async () => {
  const mounted = renderSession({}, workoutWithTabata({ movement: 'Hill sprints' }));
  await act(async () => {});
  expect(mounted.div.querySelector('h1').textContent).toBe('Hill sprints');
  expect(mounted.div.textContent).toContain('8 sprints as one set');
  expect(mounted.button('Start timer')).toBeDefined();
  expect(mounted.div.querySelector('[aria-label="Reps"]')).toBeNull();
  act(() => mounted.root.unmount());
});

it('opens the pending legacy sprint after undo even when an earlier record has a completed timer', async () => {
  const legacy = workoutWithTabata();
  legacy.session.exercises[1].sets = legacy.session.exercises[1].sets.map((set, index) => ({
    ...set,
    status: index === 7 ? 'pending' : 'completed',
    tabataTimer: index === 7 ? null : { elapsedMs: 290000, runningSince: null },
  }));
  const mounted = renderSession({}, legacy);
  await act(async () => {});
  expect(mounted.div.textContent).toContain('1 sprints as one set');
  act(() => mounted.button('Start timer').click());
  expect(mounted.props.onAdjust.mock.calls[0].slice(0, 2)).toEqual(['tabata', 'round-8']);
  act(() => mounted.root.unmount());
});

it('shows Tabata rounds and timing in history without suggesting weight or reps', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const completed = workoutWithTabata();
  completed.session.exercises[1].sets = completed.session.exercises[1].sets.map((set, index) => ({
    ...set,
    status: index === 0 ? 'completed' : 'skipped',
    splitSeconds: index === 0 ? 90 : null,
  }));
  act(() => root.render(<WorkoutSessionHistory workout={completed} />));
  const history = div.querySelectorAll('.history-exercise')[1];
  expect(history.textContent).toContain('Round 1');
  expect(history.textContent).toContain('20 seconds sprint / 10 seconds rest');
  expect(history.textContent).toContain('Split 1:30 · Interval 0:30');
  expect(history.textContent).toContain('Round 8Skipped');
  expect(history.textContent).not.toMatch(/weight|reps| lb/);

  act(() => root.render(<WorkoutSummary workout={completed} onDone={() => {}} />));
  expect(div.textContent).toContain('Completed sets + rounds3');
  expect(div.textContent).toContain('Skipped sets + rounds7');
  expect(div.textContent).toContain('2,000 lb');
  act(() => root.unmount());
});

it.each([
  ['timed', { elapsedMs: 290000, runningSince: null }],
  ['manual', null],
])('shows %s Tabata completion as one set in history and summary', async (label, timer) => {
  const completed = workoutWithTabata();
  completed.session.exercises[1].sets = [{
    ...completed.session.exercises[1].sets[0], status: 'completed', splitSeconds: 350,
    tabataTimer: timer,
  }];
  const mounted = renderSession({}, completed);
  await act(async () => mounted.button('Next exercise').click());
  expect(mounted.div.textContent).toContain('Tabata complete');
  act(() => mounted.root.render(<WorkoutSessionHistory workout={completed} />));
  const history = mounted.div.querySelectorAll('.history-exercise')[1];
  expect(history.querySelectorAll('.history-set')).toHaveLength(1);
  expect(history.textContent).toContain('Set 1');
  expect(history.querySelector('.history-set span').textContent).toBe(timer
    ? 'Tabata finisher complete · 4:50'
    : 'Tabata finisher complete');
  expect(history.textContent).not.toMatch(/Round 1|reps|Open weight/);
  act(() => mounted.root.render(<WorkoutSummary workout={completed} onDone={() => {}} />));
  expect(mounted.div.textContent).toContain('Completed sets3');
  act(() => mounted.root.unmount());
});

it('retains completed round history when remaining sprint work is substituted', () => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const div = document.createElement('div');
  const root = createRoot(div);
  const completed = workoutWithTabata({
    movement: 'Jump rope',
    prescription: '1 × 50',
    original: { movement: 'Tabata sprints', prescription: TABATA_PRESCRIPTION, plannedWeight: '' },
    sets: [
      { id: 'round-1', number: 1, plannedWeight: '', plannedReps: '', actualWeight: '', actualReps: '', status: 'completed', splitSeconds: 90 },
      { id: 'jump-set', number: 2, plannedWeight: '', plannedReps: '50', actualWeight: '', actualReps: '50', status: 'completed', splitSeconds: 150 },
    ],
  });
  act(() => root.render(<WorkoutSessionHistory workout={completed} />));
  const rows = div.querySelectorAll('.history-exercise')[1].querySelectorAll('.history-set');
  expect(rows[0].textContent).toContain('Round 1');
  expect(rows[0].textContent).toContain('20 seconds sprint / 10 seconds rest');
  expect(rows[0].textContent).not.toContain('reps');
  expect(rows[1].textContent).toContain('Set 2');
  expect(rows[1].textContent).toContain('50 reps');
  act(() => root.render(<WorkoutSummary workout={completed} onDone={() => {}} />));
  expect(div.textContent).toContain('Completed sets + rounds4');
  act(() => root.unmount());
});

it('does not offer undo for finish-generated skips without an action timestamp', () => {
  const finishedSkip = {
    ...workout,
    session: {
      ...workout.session,
      exercises: [{
        ...workout.session.exercises[0],
        sets: [{ id: 'finish-skip', number: 1, status: 'skipped', skippedAt: null }],
      }],
    },
  };
  const { div, root } = renderSession({}, finishedSkip);
  expect(Array.from(div.querySelectorAll('button')).find(button => button.textContent === 'Undo latest action').disabled).toBe(true);
  act(() => root.unmount());
});

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
])('flushes a restoration-equivalent payload before %s', async (label, buttonLabel, callback) => {
  jest.useFakeTimers();
  const mounted = renderSession();
  mounted.edit('Weight (lb)', '231');
  mounted.edit('Reps', '9');
  await act(async () => mounted.button(buttonLabel).click());

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
