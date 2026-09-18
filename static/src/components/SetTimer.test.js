import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import SetTimer from './SetTimer';
import { createSetTimerAudio } from '../data/setTimerAudio';

jest.mock('../data/setTimerAudio', () => ({ createSetTimerAudio: jest.fn() }));

let root;
let container;
let sound;
let props;
const button = label => [...document.querySelectorAll('button')]
  .find(item => item.textContent === label || item.getAttribute('aria-label') === label);
const click = async label => { await act(async () => button(label).click()); };
const advance = milliseconds => { act(() => jest.advanceTimersByTime(milliseconds)); };
const countdown = () => document.querySelector('[role="timer"]').textContent;
const render = (overrides = {}) => {
  props = {
    timer: null,
    exerciseId: 'squat',
    exerciseName: 'Squat',
    onTimerChange: jest.fn().mockResolvedValue(undefined),
    onClose: jest.fn(),
    ...overrides,
  };
  act(() => root.render(<SetTimer {...props} />));
  return props;
};
const rerender = overrides => {
  props = { ...props, ...overrides };
  act(() => root.render(<SetTimer {...props} />));
};
const editMinutes = value => {
  const input = document.querySelector('#set-timer-minutes');
  act(() => Simulate.change(input, { target: { value } }));
};

beforeEach(() => {
  global.IS_REACT_ACT_ENVIRONMENT = true;
  jest.useFakeTimers('modern');
  jest.setSystemTime(new Date('2026-09-18T12:00:00.000Z'));
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

it('asks for the interval, gives ten seconds ready, and repeats without recording sets', async () => {
  const complete = jest.fn();
  render({ children: <button onClick={complete}>Complete set</button> });
  expect(document.querySelector('[aria-label="Set timer"]')).not.toBeNull();
  expect(document.querySelector('#set-timer-minutes').value).toBe('1');
  await click('1.5 min');
  await click('Start timer');
  expect(countdown()).toBe('0:10');
  expect(props.onTimerChange).toHaveBeenLastCalledWith({ intervalMs: 90000, elapsedMs: 0, runningSince: '2026-09-18T12:00:00.000Z', exerciseId: 'squat' });
  advance(10000);
  expect(document.querySelector('[aria-label="Interval time remaining"]')).not.toBeNull();
  expect(countdown()).toBe('1:30');
  advance(3000);
  await click('Complete set');
  expect(countdown()).toBe('1:27');
  expect(complete).toHaveBeenCalledTimes(1);
  advance(87000);
  expect(countdown()).toBe('1:30');
  expect(complete).toHaveBeenCalledTimes(1);
  expect(props.onTimerChange).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain('Total time');
});

it('pauses the exact remainder and resumes without repeating ready or an immediate cue', async () => {
  render();
  await click('Start timer');
  advance(12300);
  await click('Pause timer');
  expect(props.onTimerChange).toHaveBeenLastCalledWith({ intervalMs: 60000, elapsedMs: 12300, runningSince: null, exerciseId: 'squat' });
  expect(sound.stop).toHaveBeenCalledTimes(1);
  advance(90000);
  expect(countdown()).toBe('0:58');
  await click('Resume timer');
  expect(sound.schedule.mock.calls[1][0]).toMatchObject({ elapsedMs: 12300, runningSince: '2026-09-18T12:01:42.300Z' });
  advance(57700);
  expect(countdown()).toBe('1:00');
});

it('can pause during ready and change a paused interval without starting it', async () => {
  render();
  await click('Start timer');
  advance(3200);
  await click('Pause timer');
  advance(10000);
  expect(countdown()).toBe('0:07');
  await click('Change interval');
  await click('2 min');
  await click('Save interval');
  expect(props.onTimerChange).toHaveBeenLastCalledWith({ intervalMs: 120000, elapsedMs: 0, runningSince: null, exerciseId: 'squat' });
  expect(countdown()).toBe('0:10');
  expect(button('Resume timer')).toBeDefined();
  expect(sound.schedule).toHaveBeenCalledTimes(1);
  await click('Resume timer');
  advance(10000);
  expect(countdown()).toBe('2:00');
});

it.each(['', '0', '0.01', '-1', '60.1', '1.001'])('rejects an invalid custom interval %s', value => {
  render();
  editMinutes(value);
  expect(button('Start timer').disabled).toBe(true);
});

it('allows whole-second custom intervals and remembers the supplied last interval', async () => {
  render({ initialIntervalMs: 90000 });
  expect(document.querySelector('#set-timer-minutes').value).toBe('1.5');
  editMinutes('0.25');
  await click('Start timer');
  expect(props.onTimerChange).toHaveBeenLastCalledWith(expect.objectContaining({ intervalMs: 15000 }));
});

it('stops and clears timer state before returning without touching child records', async () => {
  const complete = jest.fn();
  render({ children: <button onClick={complete}>Complete set</button> });
  await click('Start timer');
  advance(7000);
  await click('Stop timer');
  expect(sound.stop).toHaveBeenCalledTimes(1);
  expect(props.onTimerChange).toHaveBeenLastCalledWith(null);
  expect(props.onClose).toHaveBeenCalledTimes(1);
  expect(complete).not.toHaveBeenCalled();
});

it('pauses while hidden and never resumes automatically when visible again', async () => {
  const visibility = jest.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('visible');
  render();
  await click('Start timer');
  advance(17000);
  visibility.mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(props.onTimerChange).toHaveBeenLastCalledWith(expect.objectContaining({ elapsedMs: 17000, runningSince: null }));
  advance(100000);
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(countdown()).toBe('0:53');
  expect(sound.schedule).toHaveBeenCalledTimes(1);
  expect(button('Resume timer')).toBeDefined();
  visibility.mockRestore();
});

it('pauses on pagehide and saves a paused clock on navigation away', async () => {
  render();
  await click('Start timer');
  advance(4000);
  await act(async () => window.dispatchEvent(new Event('pagehide')));
  expect(props.onTimerChange).toHaveBeenLastCalledWith(expect.objectContaining({ elapsedMs: 4000, runningSince: null }));
  await click('Resume timer');
  advance(1000);
  act(() => root.unmount());
  root = createRoot(container);
  expect(props.onTimerChange).toHaveBeenLastCalledWith(expect.objectContaining({ elapsedMs: 5000, runningSince: null }));
  expect(sound.close).toHaveBeenCalledTimes(1);
});

it('reopens a running saved timer paused until a user enables sound', async () => {
  render({ timer: { intervalMs: 60000, elapsedMs: 0, runningSince: '2026-09-18T11:59:43.000Z', exerciseId: 'squat' } });
  expect(props.onTimerChange).toHaveBeenCalledWith({ intervalMs: 60000, elapsedMs: 17000, runningSince: null, exerciseId: 'squat' });
  expect(countdown()).toBe('0:53');
  advance(200000);
  expect(countdown()).toBe('0:53');
  expect(sound.unlock).not.toHaveBeenCalled();
  await click('Resume timer');
  expect(sound.schedule.mock.calls[0][0].elapsedMs).toBe(17000);
});

it('stays paused after audio failure and retries from the same countdown', async () => {
  sound.unlock.mockRejectedValueOnce(new Error('Blocked'));
  render();
  await click('Start timer');
  expect(props.onTimerChange).toHaveBeenLastCalledWith(expect.objectContaining({ elapsedMs: 0, runningSince: null }));
  expect(button('Retry sound')).toBeDefined();
  advance(10000);
  expect(countdown()).toBe('0:10');
  await click('Retry sound');
  expect(sound.schedule).toHaveBeenCalledTimes(1);
});

it('pauses if an already running audio clock becomes unavailable', async () => {
  render();
  await click('Start timer');
  advance(19000);
  await act(async () => sound.schedule.mock.calls[0][1](new Error('Interrupted')));
  expect(props.onTimerChange).toHaveBeenLastCalledWith(expect.objectContaining({ elapsedMs: 19000, runningSince: null }));
  expect(button('Retry sound')).toBeDefined();
});

it('cancels late audio startup after Stop and after unmount', async () => {
  let unlock;
  sound.unlock.mockReturnValue(new Promise(resolve => { unlock = resolve; }));
  render();
  act(() => button('Start timer').click());
  await click('Stop timer');
  await act(async () => unlock());
  expect(sound.schedule).not.toHaveBeenCalled();
  expect(props.onTimerChange).toHaveBeenCalledTimes(1);
  expect(props.onTimerChange).toHaveBeenCalledWith(null);
});

it('stops cues for externally paused state and closes when the workout clears its timer', async () => {
  render();
  await click('Start timer');
  const running = props.onTimerChange.mock.calls[0][0];
  rerender({ timer: running });
  advance(12000);
  rerender({ timer: { ...running, elapsedMs: 12000, runningSince: null } });
  expect(button('Resume timer')).toBeDefined();
  expect(sound.stop).toHaveBeenCalled();
  rerender({ timer: null });
  expect(props.onClose).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  root = createRoot(container);
  expect(props.onTimerChange).toHaveBeenCalledTimes(1);
});

it('pauses when changing exercise while preserving the remaining countdown', async () => {
  render();
  await click('Start timer');
  advance(28000);
  rerender({ exerciseId: 'bench', exerciseName: 'Bench press' });
  expect(props.onTimerChange).toHaveBeenLastCalledWith(expect.objectContaining({ exerciseId: 'bench', elapsedMs: 28000, runningSince: null }));
  expect(countdown()).toBe('0:42');
  expect(button('Resume timer')).toBeDefined();
});

it('freezes a timer whose running state cannot be saved', async () => {
  render({ onTimerChange: jest.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue() });
  await click('Start timer');
  expect(sound.stop).toHaveBeenCalled();
  expect(props.onTimerChange).toHaveBeenLastCalledWith(expect.objectContaining({ runningSince: null }));
  expect(button('Resume timer')).toBeDefined();
  expect(document.body.textContent).toContain('could not be saved');
});

it('keeps child inputs in keyboard navigation and restores focus after closing', async () => {
  const launcher = document.createElement('button');
  document.body.appendChild(launcher);
  launcher.focus();
  render({ children: <label>Reps<input aria-label="Reps" /></label> });
  await click('Start timer');
  const input = document.querySelector('[aria-label="Reps"]');
  input.focus();
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
  expect(document.activeElement).toBe(button('Stop timer and return to workout'));
  act(() => root.unmount());
  root = createRoot(container);
  expect(document.activeElement).toBe(launcher);
  launcher.remove();
});
