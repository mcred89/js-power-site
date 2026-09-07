import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import TabataTimer from './TabataTimer';
import { createTabataAudio } from '../data/tabataAudio';

jest.mock('../data/tabataAudio', () => ({ createTabataAudio: jest.fn() }));

let root;
let container;
let sound;

const button = label => [...document.querySelectorAll('button')]
  .find(item => item.textContent === label || item.getAttribute('aria-label') === label);
const click = async label => {
  await act(async () => button(label).click());
};
const advance = milliseconds => {
  act(() => jest.advanceTimersByTime(milliseconds));
};
const renderTimer = (overrides = {}) => {
  const props = {
    roundCount: 8,
    timer: null,
    onTimerChange: jest.fn(),
    onComplete: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  act(() => root.render(<TabataTimer {...props} />));
  return props;
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date('2026-09-07T12:00:00.000Z'));
  sound = { unlock: jest.fn().mockResolvedValue(undefined), schedule: jest.fn(), stop: jest.fn(), close: jest.fn() };
  createTabataAudio.mockReturnValue(sound);
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

it('starts one hands-free set with a minute warm-up and changes phase colors, countdown, sprint number and elapsed time', async () => {
  const props = renderTimer();
  expect(container.textContent).toContain('1 minute warm-up, then 8 sprints');
  await click('Start timer');
  expect(sound.unlock).toHaveBeenCalledTimes(1);
  expect(sound.schedule).toHaveBeenCalledWith(8, 0);
  expect(document.querySelector('.tabata-timer-warmup')).not.toBeNull();
  expect(document.querySelector('[role="timer"]').textContent).toBe('1:00');
  expect(document.querySelector('.tabata-timer-round').textContent).toBe('Sprint 1 of 8');

  advance(60000);
  expect(document.querySelector('.tabata-timer-sprint')).not.toBeNull();
  expect(document.querySelector('[role="timer"]').textContent).toBe('0:20');
  expect(document.querySelector('.tabata-timer-total').textContent).toBe('Total time1:00 / 4:50');
  advance(20000);
  expect(document.querySelector('.tabata-timer-rest')).not.toBeNull();
  expect(document.querySelector('[role="timer"]').textContent).toBe('0:10');
  expect(document.querySelector('.tabata-timer-direction').textContent).toContain('Sprint 2 is next');
  advance(10000);
  expect(document.querySelector('.tabata-timer-sprint')).not.toBeNull();
  expect(document.querySelector('.tabata-timer-round').textContent).toBe('Sprint 2 of 8');
  expect(props.onTimerChange).toHaveBeenCalledTimes(1);
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('pauses the countdown and buzzers, then resumes from the same elapsed time', async () => {
  const props = renderTimer();
  await click('Start timer');
  advance(12300);
  await click('Pause timer');
  expect(props.onTimerChange).toHaveBeenLastCalledWith({ elapsedMs: 12300, runningSince: null });
  expect(sound.stop).toHaveBeenCalledTimes(1);
  advance(60000);
  expect(document.querySelector('[role="timer"]').textContent).toBe('0:48');
  await click('Resume timer');
  expect(sound.schedule).toHaveBeenLastCalledWith(8, 12300);
  advance(47700);
  expect(document.querySelector('.tabata-timer-sprint')).not.toBeNull();
});

it('completes the entire set once at the end of sprint eight, with no final rest or per-sprint checkoffs', async () => {
  const props = renderTimer({ timer: { elapsedMs: 285000, runningSince: null } });
  await click('Resume timer');
  expect(document.querySelector('.tabata-timer-round').textContent).toBe('Sprint 8 of 8');
  expect(document.querySelector('[role="timer"]').textContent).toBe('0:05');
  advance(5000);
  expect(props.onComplete).toHaveBeenCalledTimes(1);
  expect(props.onComplete).toHaveBeenCalledWith({ elapsedMs: 290000, runningSince: null });
  expect(document.querySelector('.tabata-timer-complete')).not.toBeNull();
  expect(document.querySelector('.tabata-timer-total').textContent).toBe('Total time4:50 / 4:50');
  expect(sound.stop).not.toHaveBeenCalled();
  expect(button('Complete round')).toBeUndefined();
  advance(60000);
  expect(props.onComplete).toHaveBeenCalledTimes(1);
});

it('pauses and saves a reopened running timer until a tap can enable audio', async () => {
  const props = renderTimer({ timer: { elapsedMs: 0, runningSince: '2026-09-07T11:58:50.000Z' } });
  expect(props.onTimerChange).toHaveBeenCalledWith({ elapsedMs: 70000, runningSince: null });
  expect(container.textContent).toContain('Timer paused after reopening');
  expect(sound.unlock).not.toHaveBeenCalled();
  advance(60000);
  expect(props.onComplete).not.toHaveBeenCalled();
  await click('Resume timer');
  expect(sound.schedule).toHaveBeenCalledWith(8, 70000);
  expect(document.querySelector('[role="timer"]').textContent).toBe('0:10');
});

it('closes to a paused card, stops sound, restores scrolling, and can restart from warm-up', async () => {
  document.body.style.overflow = 'auto';
  const props = renderTimer();
  await click('Start timer');
  expect(document.body.style.overflow).toBe('hidden');
  advance(15000);
  await click('Close timer');
  expect(document.querySelector('[aria-label="Tabata timer"]')).toBeNull();
  expect(document.body.style.overflow).toBe('auto');
  expect(props.onTimerChange).toHaveBeenLastCalledWith({ elapsedMs: 15000, runningSince: null });
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain('Paused at 0:15');
  await click('Resume timer');
  await click('Reset timer');
  expect(props.onTimerChange).toHaveBeenLastCalledWith(null);
  await click('Start timer');
  expect(document.querySelector('[role="timer"]').textContent).toBe('1:00');
  document.body.style.overflow = '';
});

it('keeps the timer paused when sound fails and starts only after a successful retry', async () => {
  sound.unlock.mockRejectedValue(new Error('Audio is unavailable'));
  const props = renderTimer();
  await click('Start timer');
  expect(document.querySelector('[role="status"]').textContent).toContain('The buzzer could not start');
  expect(sound.schedule).not.toHaveBeenCalled();
  advance(60000);
  expect(document.querySelector('.tabata-timer-warmup')).not.toBeNull();
  expect(document.querySelector('[role="timer"]').textContent).toBe('1:00');
  expect(props.onTimerChange).not.toHaveBeenCalled();
  sound.unlock.mockResolvedValue(undefined);
  await click('Retry sound');
  expect(sound.schedule).toHaveBeenCalledWith(8, 0);
  advance(60000);
  expect(document.querySelector('.tabata-timer-sprint')).not.toBeNull();
});

it('saves a paused clock and cancels future cues when navigating away during a sprint', async () => {
  const props = renderTimer();
  await click('Start timer');
  advance(67000);
  act(() => root.unmount());
  root = createRoot(container);
  expect(sound.close).toHaveBeenCalledTimes(1);
  expect(props.onTimerChange).toHaveBeenLastCalledWith({ elapsedMs: 67000, runningSince: null });
  advance(300000);
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('cancels pending audio startup and completion when unmounted', async () => {
  let resolveUnlock;
  sound.unlock.mockReturnValue(new Promise(resolve => { resolveUnlock = resolve; }));
  const props = renderTimer({ timer: { elapsedMs: 289000, runningSince: null } });
  act(() => button('Resume timer').click());
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => resolveUnlock());
  advance(10000);
  expect(sound.close).toHaveBeenCalledTimes(1);
  expect(sound.schedule).not.toHaveBeenCalled();
  expect(props.onTimerChange).not.toHaveBeenCalled();
  expect(props.onComplete).not.toHaveBeenCalled();
});

it('shows an already completed set without starting or completing it again', async () => {
  const props = renderTimer({ completed: true, timer: { elapsedMs: 290000, runningSince: null } });
  expect(container.textContent).toContain('Tabata complete');
  await click('View finished timer');
  expect(document.querySelector('.tabata-timer-complete')).not.toBeNull();
  expect(document.querySelector('.tabata-timer-round').textContent).toBe('Sprint 8 of 8');
  advance(1000);
  expect(props.onComplete).not.toHaveBeenCalled();
  expect(sound.unlock).not.toHaveBeenCalled();
});
